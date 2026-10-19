// Redefinição de senha pelo código enviado ao e-mail (`POST
// /v1/senha/redefinicao`, público; CA-05, CA-06; P1-dono, S6, S8, S14; plano
// 01b, etapa 9).
//
// O hash da senha nova é calculado antes de tudo, em todos os caminhos, para o
// tempo de resposta não separar e-mail com e sem conta, e fora da transação: o
// Argon2id não segura conexão aberta.
//
// Ordem, numa transação só:
// 1. trava o freio por e-mail (S14: o código da redefinição soma no mesmo
//    freio do login e da exclusão). Freio ativo devolve `freado` sem conferir o
//    código;
// 2. lê a conta só depois do freio travado. A exclusão trava o mesmo freio
//    antes de desativar a conta, e o login antes de gravar o login, então a
//    conta gravada inteira no passo 4 não ressuscita uma conta desativada nem
//    desfaz uma mudança confirmada no meio;
// 3. trava o código de recuperação vigente da conta e confere: errado, vencido,
//    já usado ou esgotado (e e-mail sem conta, ou conta fora de `ativa`) somam
//    uma falha no freio e devolvem `codigo_invalido`, sem distinguir. A
//    tentativa errada fica gravada;
// 4. código certo (uso único, 30 min; CA-06): zera o freio, invalida os
//    desafios do 2FA ainda vivos das duas etapas (S94: quem tinha a senha
//    antiga e já passou dela não conclui o segundo fator), grava o hash novo e
//    verifica o e-mail (`gravarSenhaRedefinida`, só essas colunas e só em conta
//    ativa, S95; P1-dono), revoga todas as sessões da conta com
//    `senha_redefinida` (CA-05, S8), inclusive as de quem criou a conta antes
//    com o e-mail de outra pessoa, e publica `SenhaRedefinida`. Se a conta
//    saiu de `ativa` no meio, tudo é desfeito (inclusive o uso do código) e a
//    resposta é `codigo_invalido`.
// Travas na ordem freio → código → desafios → conta → sessões, compatível com
// a do cabeçalho de `dominio/repositorios.ts` (o segundo fator trava o desafio
// antes de gravar o login na conta). Não emite sessão (a rota responde 204): a
// pessoa entra de novo com a senha nova, nunca com `admin` nem `mfa` vindos
// daqui (S1).
import { Injectable } from '@nestjs/common';
import { PublicadorDeEventos } from '../../../../compartilhado/eventos/publicador.ts';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import { Email } from '../../dominio/email.ts';
import {
  RepositorioDeBloqueios,
  RepositorioDeCodigosDeVerificacao,
  RepositorioDeContas,
  RepositorioDeDesafios,
  RepositorioDeSessoes,
} from '../../dominio/repositorios.ts';
import { chaveDoFreioPorEmail } from '../comum/chaves.ts';
import { eventoDeIdentidade } from '../eventos.ts';
import { Cifrador } from '../portas/cifrador.ts';
import { Hasher } from '../portas/hasher.ts';

/**
 * Corpo já validado por `redefinirSenhaSchema`: e-mail normalizado, código de
 * 6 dígitos e senha nova como foi digitada (a lista pública de senhas comuns é
 * conferida na rota, etapa 16).
 */
export interface EntradaDeRedefinirSenha {
  readonly email: string;
  readonly codigo: string;
  readonly novaSenha: string;
}

/**
 * - `redefinida`: senha trocada e sessões revogadas (204);
 * - `codigo_invalido`: o mesmo para todos os motivos, inclusive e-mail sem
 *   conta (400 com `campos[codigo].invalido`);
 * - `freado`: freio por e-mail ativo (429 com `Retry-After` =
 *   `segundosDeEspera`), código não conferido.
 */
export type ResultadoDeRedefinirSenha =
  | { readonly tipo: 'redefinida' }
  | { readonly tipo: 'codigo_invalido' }
  | { readonly tipo: 'freado'; readonly segundosDeEspera: number };

const CODIGO_INVALIDO = { tipo: 'codigo_invalido' } as const;

/** A conta saiu de `ativa` entre a leitura e a gravação da senha: desfaz tudo. */
class ContaIndisponivelNoMeio extends Error {
  constructor() {
    super('A conta deixou de estar ativa durante a redefinição de senha.');
    this.name = 'ContaIndisponivelNoMeio';
  }
}

@Injectable()
export class RedefinirSenhaCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly relogio: Relogio,
    private readonly contas: RepositorioDeContas,
    private readonly sessoes: RepositorioDeSessoes,
    private readonly codigos: RepositorioDeCodigosDeVerificacao,
    private readonly desafios: RepositorioDeDesafios,
    private readonly bloqueios: RepositorioDeBloqueios,
    private readonly publicador: PublicadorDeEventos,
    private readonly hasher: Hasher,
    private readonly cifrador: Cifrador,
  ) {}

  async executar(entrada: EntradaDeRedefinirSenha): Promise<ResultadoDeRedefinirSenha> {
    // O contrato já normalizou; um e-mail inválido aqui é rota sem validação.
    const email = Email.criar(entrada.email);
    const novoHash = await this.hasher.gerarHash(entrada.novaSenha);
    const agora = this.relogio.agora();
    try {
      return await this.unidade.executar(() =>
        this.#redefinir(email, entrada.codigo, novoHash, agora),
      );
    } catch (erro) {
      if (erro instanceof ContaIndisponivelNoMeio) return CODIGO_INVALIDO;
      throw erro;
    }
  }

  async #redefinir(
    email: Email,
    codigo: string,
    novoHash: string,
    agora: Date,
  ): Promise<ResultadoDeRedefinirSenha> {
    const freio = await this.bloqueios.buscarParaAtualizar(
      chaveDoFreioPorEmail(this.cifrador, email),
      'email',
      agora,
    );
    if (freio.estaBloqueado(agora)) {
      return { tipo: 'freado', segundosDeEspera: freio.segundosDeEspera(agora) };
    }

    const conta = await this.contas.buscarPorEmail(email);
    const registro =
      conta?.status === 'ativa'
        ? await this.codigos.buscarVigenteParaAtualizar(conta.id, 'recuperacao_senha', agora)
        : null;
    if (conta === null || registro === null) {
      freio.registrarFalha(agora);
      await this.bloqueios.salvar(freio);
      return CODIGO_INVALIDO;
    }

    const confere = this.cifrador.hmacConfere(
      'recuperacao_senha',
      [conta.id, codigo],
      registro.codigoHmac,
    );
    const resultado = registro.conferir(confere, agora);
    await this.codigos.atualizar(registro);
    if (resultado !== 'aceito') {
      freio.registrarFalha(agora);
      await this.bloqueios.salvar(freio);
      return CODIGO_INVALIDO;
    }
    freio.registrarSucesso('senha');
    await this.bloqueios.salvar(freio);

    // Antes da conta: o segundo fator trava o desafio e depois grava o login (S94).
    await this.desafios.invalidarVigentes(conta.id, 'configurar', agora);
    await this.desafios.invalidarVigentes(conta.id, 'verificar', agora);
    // Só a senha e a verificação, e só com a conta ainda ativa (S95, P1-dono).
    if (!(await this.contas.gravarSenhaRedefinida(conta.id, novoHash, agora))) {
      throw new ContaIndisponivelNoMeio();
    }
    await this.sessoes.revogarDaConta(conta.id, 'senha_redefinida', agora);
    await this.publicador.publicar(eventoDeIdentidade('SenhaRedefinida', { contaId: conta.id }));
    return { tipo: 'redefinida' };
  }
}
