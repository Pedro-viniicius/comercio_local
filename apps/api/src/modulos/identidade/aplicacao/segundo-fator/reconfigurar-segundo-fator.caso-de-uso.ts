// Reconfiguração do segundo fator do admin (plano 01b, etapa 10; S1, S97, S99):
// no MVP, só pela CLI `reconfigurar-segundo-fator` (admin que perdeu o celular
// e os códigos de recuperação). Nenhuma rota chama este caso de uso.
//
// A conta chega pelo id ou pelo e-mail (a CLI lê o e-mail da entrada padrão,
// nunca de um argumento, que ficaria no histórico do shell e na lista de
// processos). O operador é a conta admin de quem roda a CLI: precisa existir,
// estar ativa e ter `admin`, e só o id dele vai para a auditoria.
//
// Na mesma transação:
// - os desafios ainda válidos da conta, das duas etapas, deixam de valer;
// - o segundo fator e os códigos de recuperação são apagados, então o próximo
//   login no painel recebe um desafio `configurar` (CA-09);
// - a senha é apagada (`gravarSenhaRemovida`, S97) e sai `RecuperacaoSolicitada`:
//   o código de redefinição vai para o e-mail da conta (etapa 13), e só quem lê
//   esse e-mail define a senha nova e configura o autenticador de novo. Sem
//   isso, quem tivesse só a senha (o celular perdido não protege mais nada)
//   configuraria o 2FA dele;
// - todas as sessões da conta são revogadas (`segundo_fator_reconfigurado`):
//   quem estava com o celular perdido não segue no painel;
// - a auditoria registra a ação com o operador como ator, só com ids.
// O freio de segundo fator fica como está: zera só com o segundo fator
// concluído (S1).
//
// Travas: freio por e-mail → desafios → freio de segundo fator → segundo fator →
// conta → sessões, a ordem do cabeçalho de `dominio/repositorios.ts`. O freio por
// e-mail vem primeiro (A-R13, S97) porque é ele que serializa com o login e a
// redefinição: um login que já conferiu a senha antiga e está na conclusão
// segura esse freio até abrir a sessão, então a CLI espera e revoga também essa
// sessão; e o login que chega depois relê a conta já sem senha e é recusado.
// Sem essa trava, o login relia a conta antes de a senha sumir e gravava a
// sessão depois da revogação. A conta é relida com o freio travado. Depois, a
// invalidação espera um desafio em uso terminar; a senha (UPDATE da conta) vem
// antes das sessões.
import { Injectable } from '@nestjs/common';
import { RepositorioDeAuditoria } from '../../../../compartilhado/auditoria/repositorio-de-auditoria.ts';
import { PublicadorDeEventos } from '../../../../compartilhado/eventos/publicador.ts';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import type { Conta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import {
  RepositorioDeBloqueios,
  RepositorioDeContas,
  RepositorioDeDesafios,
  RepositorioDeSegundoFator,
  RepositorioDeSessoes,
} from '../../dominio/repositorios.ts';
import { chaveDoFreioPorEmail } from '../comum/chaves.ts';
import { eventoDeIdentidade } from '../eventos.ts';
import { Cifrador } from '../portas/cifrador.ts';
import { chaveDoFreioDeSegundoFator } from './comum.ts';

/** A conta a reconfigurar: pelo id (`--conta`) ou pelo e-mail lido da entrada padrão. */
export type ContaDaReconfiguracao = { readonly contaId: string } | { readonly email: string };

export interface EntradaDeReconfigurarSegundoFator {
  /** O e-mail, quando vier, nunca vai para log, saída nem auditoria. */
  readonly conta: ContaDaReconfiguracao;
  /** Id da conta admin de quem roda a CLI (`--operador`): o ator da auditoria. */
  readonly operadorId: string;
}

export type ResultadoDeReconfigurarSegundoFator =
  | { readonly tipo: 'email_invalido' }
  | { readonly tipo: 'operador_invalido' }
  | { readonly tipo: 'conta_nao_encontrada' }
  | { readonly tipo: 'nao_e_admin' }
  | { readonly tipo: 'conta_inativa' }
  | { readonly tipo: 'reconfigurado'; readonly contaId: string; readonly sessoesRevogadas: number };

/** A conta saiu de `ativa` entre a leitura e a remoção da senha: desfaz tudo. */
class ContaInativaNoMeio extends Error {
  constructor() {
    super('A conta deixou de estar ativa durante a reconfiguração do segundo fator.');
    this.name = 'ContaInativaNoMeio';
  }
}

@Injectable()
export class ReconfigurarSegundoFatorCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly relogio: Relogio,
    private readonly contas: RepositorioDeContas,
    private readonly desafios: RepositorioDeDesafios,
    private readonly bloqueios: RepositorioDeBloqueios,
    private readonly segundoFator: RepositorioDeSegundoFator,
    private readonly sessoes: RepositorioDeSessoes,
    private readonly auditoria: RepositorioDeAuditoria,
    private readonly publicador: PublicadorDeEventos,
    private readonly cifrador: Cifrador,
  ) {}

  async executar(
    entrada: EntradaDeReconfigurarSegundoFator,
  ): Promise<ResultadoDeReconfigurarSegundoFator> {
    const buscarConta = this.#buscaDaConta(entrada.conta);
    if (buscarConta === null) return { tipo: 'email_invalido' };
    const agora = this.relogio.agora();
    try {
      return await this.unidade.executar(async () => {
        const operador = await this.contas.buscarPorId(entrada.operadorId);
        if (!operadorValido(operador)) return { tipo: 'operador_invalido' };

        const lida = await buscarConta();
        if (lida === null) return { tipo: 'conta_nao_encontrada' };
        // O e-mail da conta não muda; a leitura sem trava serve só para a chave do freio.
        const freioDoEmail = await this.bloqueios.buscarParaAtualizar(
          chaveDoFreioPorEmail(this.cifrador, lida.email),
          'email',
          agora,
        );
        // O freio não muda: `salvar` só apaga a linha zerada que a trava criou.
        await this.bloqueios.salvar(freioDoEmail);
        const conta = await this.contas.buscarPorId(lida.id);
        if (conta === null) return { tipo: 'conta_nao_encontrada' };
        if (!conta.temPerfil('admin')) return { tipo: 'nao_e_admin' };
        if (conta.status !== 'ativa') return { tipo: 'conta_inativa' };

        return await this.#reconfigurar(conta, operador.id, agora);
      });
    } catch (erro) {
      if (erro instanceof ContaInativaNoMeio) return { tipo: 'conta_inativa' };
      throw erro;
    }
  }

  /** Como achar a conta pedida; `null` se o e-mail não é válido. */
  #buscaDaConta(alvo: ContaDaReconfiguracao): (() => Promise<Conta | null>) | null {
    if ('contaId' in alvo) return () => this.contas.buscarPorId(alvo.contaId);
    const email = Email.tentarCriar(alvo.email);
    return email === null ? null : () => this.contas.buscarPorEmail(email);
  }

  async #reconfigurar(
    conta: Conta,
    operadorId: string,
    agora: Date,
  ): Promise<ResultadoDeReconfigurarSegundoFator> {
    await this.desafios.invalidarVigentes(conta.id, 'configurar', agora);
    await this.desafios.invalidarVigentes(conta.id, 'verificar', agora);
    const freio = await this.bloqueios.buscarParaAtualizar(
      chaveDoFreioDeSegundoFator(this.cifrador, conta.id),
      'segundo_fator',
      agora,
    );
    await this.segundoFator.apagar(conta.id);
    // Sem senha, a conta só entra de novo depois do código enviado ao e-mail (S97).
    if (!(await this.contas.gravarSenhaRemovida(conta.id))) throw new ContaInativaNoMeio();
    const sessoesRevogadas = await this.sessoes.revogarDaConta(
      conta.id,
      'segundo_fator_reconfigurado',
      agora,
    );
    // O freio não muda: `salvar` só apaga a linha zerada que a trava criou.
    await this.bloqueios.salvar(freio);
    await this.publicador.publicar(
      eventoDeIdentidade('RecuperacaoSolicitada', { contaId: conta.id }),
    );
    await this.auditoria.registrar({
      atorTipo: 'admin',
      atorId: operadorId,
      acao: 'segundo_fator_reconfigurado',
      recurso: 'conta',
      recursoId: conta.id,
      depois: { sessoesRevogadas, senhaRemovida: true },
      origem: 'cli',
    });
    return { tipo: 'reconfigurado', contaId: conta.id, sessoesRevogadas };
  }
}

/** O operador é uma conta ativa com `admin`. */
function operadorValido(operador: Conta | null): operador is Conta {
  return operador !== null && operador.status === 'ativa' && operador.temPerfil('admin');
}
