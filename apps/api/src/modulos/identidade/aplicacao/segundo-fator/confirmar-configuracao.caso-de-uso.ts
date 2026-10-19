// `POST /v1/segundo-fator/confirmacao` (plano 01b, etapa 10; S1, CA-09): o
// admin digita o primeiro código do app autenticador; com o código certo, o
// segundo fator fica confirmado, ele recebe os 10 códigos de recuperação
// (mostrados uma vez) e entra no painel com `mfa`.
//
// Respostas na ordem de "Respostas do 2FA" (P3):
// (1) desafio inexistente, vencido, usado, de outra etapa (só `configurar`)
//     ou esgotado, conta que não pode mais entrar no painel e segundo fator já
//     confirmado (S1) → `desafio_invalido`, sem distinguir;
// (2) freio de segundo fator da conta ativo → `freado`, sem gastar tentativa;
// (3) código errado → uma falha no desafio e no freio; `codigo_errado` se
//     ainda sobra tentativa, `desafio_invalido` na quinta.
// Configuração não iniciada (sem segredo guardado) conta como código errado.
//
// Travas (R8): desafio → freio de segundo fator → `segundo_fator`. O segredo e
// o último passo usado só são lidos com o freio da conta travado.
//
// Os códigos de recuperação vão em claro só na resposta; o banco guarda o HMAC
// de cada um ligado à conta (`codigo_recuperacao_segundo_fator`).
import { QUANTIDADE_DE_CODIGOS_DE_RECUPERACAO } from '@bairrin/contratos';
import { Injectable } from '@nestjs/common';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import {
  type CodigoDeRecuperacao,
  RepositorioDeBloqueios,
  RepositorioDeContas,
  RepositorioDeDesafios,
  RepositorioDeSegundoFator,
  RepositorioDeSessoes,
} from '../../dominio/repositorios.ts';
import type { SessaoEmitida } from '../comum/sessao-emitida.ts';
import { Cifrador } from '../portas/cifrador.ts';
import { EmissorDeJwt } from '../portas/emissor-de-jwt.ts';
import { GeradorDeSegredos } from '../portas/gerador-de-segredos.ts';
import { VerificadorTotp } from '../portas/verificador-totp.ts';
import {
  abrirSessaoComSegundoFator,
  chaveDoFreioDeSegundoFator,
  DESAFIO_INVALIDO,
  lerDesafio,
  podeConcluirSegundoFator,
  segredoTotp,
} from './comum.ts';

/** Tentativas de gerar um código repetido antes de desistir (gerador com defeito). */
const LIMITE_DE_SORTEIOS = 10 * QUANTIDADE_DE_CODIGOS_DE_RECUPERACAO;

/**
 * A conta saiu de `ativa` entre a leitura e a abertura da sessão
 * (`abrirSessaoComSegundoFator` devolveu `null`, exclusão no meio): desfaz
 * tudo, inclusive a confirmação e o uso do código, e responde
 * `desafio_invalido` (A-R8).
 */
class ContaIndisponivelNoMeio extends Error {
  constructor() {
    super('A conta deixou de estar ativa durante o segundo fator.');
    this.name = 'ContaIndisponivelNoMeio';
  }
}

export interface EntradaDeConfirmarConfiguracao {
  /** Token do desafio, como veio no corpo (`<id>.<segredo>`). */
  readonly desafio: string;
  /** Código de 6 dígitos do app autenticador, já normalizado pelo contrato. */
  readonly codigo: string;
}

export type ResultadoDeConfirmarConfiguracao =
  | typeof DESAFIO_INVALIDO
  | { readonly tipo: 'freado'; readonly segundosDeEspera: number }
  | { readonly tipo: 'codigo_errado' }
  | {
      readonly tipo: 'concluido';
      /** Os 10 códigos de recuperação, em claro só aqui. */
      readonly codigosRecuperacao: readonly string[];
      readonly sessao: SessaoEmitida;
    };

@Injectable()
export class ConfirmarConfiguracaoDoSegundoFatorCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly relogio: Relogio,
    private readonly contas: RepositorioDeContas,
    private readonly desafios: RepositorioDeDesafios,
    private readonly bloqueios: RepositorioDeBloqueios,
    private readonly segundoFator: RepositorioDeSegundoFator,
    private readonly sessoes: RepositorioDeSessoes,
    private readonly cifrador: Cifrador,
    private readonly gerador: GeradorDeSegredos,
    private readonly totp: VerificadorTotp,
    private readonly emissor: EmissorDeJwt,
  ) {}

  async executar(
    entrada: EntradaDeConfirmarConfiguracao,
  ): Promise<ResultadoDeConfirmarConfiguracao> {
    try {
      return await this.#confirmar(entrada);
    } catch (erro) {
      if (erro instanceof ContaIndisponivelNoMeio) return DESAFIO_INVALIDO;
      throw erro;
    }
  }

  #confirmar(entrada: EntradaDeConfirmarConfiguracao): Promise<ResultadoDeConfirmarConfiguracao> {
    const agora = this.relogio.agora();
    return this.unidade.executar(async () => {
      const desafio = await lerDesafio(
        { desafios: this.desafios, cifrador: this.cifrador },
        entrada.desafio,
      );
      if (desafio === null || !desafio.estaValidoPara('configurar', agora)) {
        return DESAFIO_INVALIDO;
      }
      const conta = await this.contas.buscarPorId(desafio.contaId);
      if (!podeConcluirSegundoFator(conta)) return DESAFIO_INVALIDO;

      const freio = await this.bloqueios.buscarParaAtualizar(
        chaveDoFreioDeSegundoFator(this.cifrador, conta.id),
        'segundo_fator',
        agora,
      );
      const atual = await this.segundoFator.buscar(conta.id);
      if (atual !== null && atual.confirmadoEm !== null) {
        await this.bloqueios.salvar(freio);
        return DESAFIO_INVALIDO;
      }
      if (freio.estaBloqueado(agora)) {
        return { tipo: 'freado', segundosDeEspera: freio.segundosDeEspera(agora) };
      }

      const passo =
        atual === null
          ? null
          : this.totp.verificar(
              segredoTotp(this.cifrador, conta.id, atual.segredoCifrado),
              entrada.codigo,
              agora,
              atual.ultimoPassoUsado,
            );
      const resultado = desafio.avaliarCodigo({
        etapa: 'configurar',
        freio,
        codigoConfere: passo !== null,
        agora,
      });
      await this.desafios.atualizar(desafio);
      await this.bloqueios.salvar(freio);
      if (resultado.tipo !== 'concluido') return resultado;
      if (atual === null || passo === null) {
        throw new Error('Segundo fator concluído sem código conferido.');
      }

      await this.segundoFator.salvar({ ...atual, confirmadoEm: agora, ultimoPassoUsado: passo });
      const codigosRecuperacao = this.#sortearCodigosDeRecuperacao();
      await this.segundoFator.substituirCodigosDeRecuperacao(
        conta.id,
        codigosRecuperacao.map((codigo): CodigoDeRecuperacao => ({
          id: this.gerador.novoId(),
          contaId: conta.id,
          codigoHmac: this.cifrador.hmac('codigo_recuperacao_segundo_fator', [conta.id, codigo]),
          usadoEm: null,
        })),
      );
      const sessao = await abrirSessaoComSegundoFator(
        {
          contas: this.contas,
          sessoes: this.sessoes,
          cifrador: this.cifrador,
          gerador: this.gerador,
          emissor: this.emissor,
        },
        conta,
        agora,
      );
      if (sessao === null) throw new ContaIndisponivelNoMeio();
      return { tipo: 'concluido', codigosRecuperacao, sessao };
    });
  }

  /** `QUANTIDADE_DE_CODIGOS_DE_RECUPERACAO` códigos distintos do gerador. */
  #sortearCodigosDeRecuperacao(): string[] {
    const codigos = new Set<string>();
    for (let sorteio = 0; sorteio < LIMITE_DE_SORTEIOS; sorteio += 1) {
      codigos.add(this.gerador.codigoDeRecuperacao());
      if (codigos.size === QUANTIDADE_DE_CODIGOS_DE_RECUPERACAO) return [...codigos];
    }
    throw new Error('O gerador repetiu códigos de recuperação demais.');
  }
}
