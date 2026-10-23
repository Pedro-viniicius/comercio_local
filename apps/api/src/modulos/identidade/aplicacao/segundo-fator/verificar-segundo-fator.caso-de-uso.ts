// `POST /v1/sessoes/segundo-fator` (plano 01b, etapa 10; S1, CA-09): o admin
// com segundo fator confirmado digita o código do app autenticador (TOTP) ou um
// código de recuperação e entra no painel com `mfa`.
//
// Respostas na ordem de "Respostas do 2FA" (P3):
// (1) desafio inexistente, vencido, usado, de outra etapa (só `verificar`) ou
//     esgotado, conta que não pode mais entrar no painel e segundo fator que
//     sumiu ou não está confirmado (CLI no meio) → `desafio_invalido`;
// (2) freio de segundo fator da conta ativo → `freado`, sem gastar tentativa;
// (3) código errado → uma falha no desafio e no freio; `codigo_errado` (com o
//     `campo` que veio, para o 400 `campos[codigo|codigoRecuperacao].invalido`)
//     se ainda sobra tentativa, `desafio_invalido` na quinta.
// O freio só zera com o segundo fator concluído (S1); a senha certa não zera.
// Quando a falha põe o freio em espera, sai `SegundoFatorFreado` (aviso ao dono
// por e-mail, S92). Se ele foi acionado de novo já no nível máximo (15 min,
// P16), ou se os erros de segundo fator da conta nas últimas 24 h passaram de
// 20 (S103), a senha da conta é apagada, as sessões dela são revogadas e a
// auditoria registra (S104), e o aviso manda recuperar a senha
// (`reagirAoFreioDeSegundoFator`). Por isso toda tentativa trava antes de tudo
// o freio por e-mail da conta do desafio (`travarFreioPorEmailDoDesafio`).
//
// Travas (R8, S104): freio por e-mail da conta → desafio → freio de segundo
// fator → `segundo_fator` e códigos de recuperação. Dois desafios da mesma conta com o mesmo TOTP (ou o mesmo
// código de recuperação) ao mesmo tempo: o segundo espera o freio, lê o passo
// (ou o código) já gasto pelo primeiro e recebe `codigo_errado`.
import { normalizarCodigoDeRecuperacao } from '@bairrin/contratos/validadores';
import { Injectable } from '@nestjs/common';
import { RepositorioDeAuditoria } from '../../../../compartilhado/auditoria/repositorio-de-auditoria.ts';
import { PublicadorDeEventos } from '../../../../compartilhado/eventos/publicador.ts';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import type { Conta } from '../../dominio/conta.ts';
import {
  type CodigoDeRecuperacao,
  RepositorioDeBloqueios,
  RepositorioDeContas,
  RepositorioDeDesafios,
  RepositorioDeSegundoFator,
  RepositorioDeSessoes,
  type SegundoFator,
} from '../../dominio/repositorios.ts';
import type { SessaoEmitida } from '../comum/sessao-emitida.ts';
import { Cifrador } from '../portas/cifrador.ts';
import { EmissorDeJwt } from '../portas/emissor-de-jwt.ts';
import { GeradorDeSegredos } from '../portas/gerador-de-segredos.ts';
import { VerificadorTotp } from '../portas/verificador-totp.ts';
import {
  abrirSessaoComSegundoFator,
  avaliarFalhaDeSegundoFator,
  chaveDoFreioDeSegundoFator,
  DESAFIO_INVALIDO,
  lerDesafio,
  podeConcluirSegundoFator,
  reagirAoFreioDeSegundoFator,
  segredoTotp,
  travarFreioPorEmailDoDesafio,
} from './comum.ts';

/** Campo do corpo que trouxe o código (o 400 aponta para ele). */
export type CampoDoCodigo = 'codigo' | 'codigoRecuperacao';

/**
 * Corpo já validado por `verificarSegundoFatorSchema`: exatamente um dos
 * códigos, cada um normalizado pelo contrato.
 */
export interface EntradaDeVerificarSegundoFator {
  /** Token do desafio, como veio no corpo (`<id>.<segredo>`). */
  readonly desafio: string;
  /** Código de 6 dígitos do app autenticador. */
  readonly codigo?: string | undefined;
  /** Código de recuperação (10 caracteres base32). */
  readonly codigoRecuperacao?: string | undefined;
}

export type ResultadoDeVerificarSegundoFator =
  | typeof DESAFIO_INVALIDO
  | { readonly tipo: 'freado'; readonly segundosDeEspera: number }
  | { readonly tipo: 'codigo_errado'; readonly campo: CampoDoCodigo }
  | { readonly tipo: 'concluido'; readonly sessao: SessaoEmitida };

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

/** O código conferido e o que gastar dele se o segundo fator for concluído. */
type Conferencia =
  | { readonly tipo: 'totp'; readonly passo: number }
  | { readonly tipo: 'recuperacao'; readonly codigoId: string }
  | null;

@Injectable()
export class VerificarSegundoFatorCasoDeUso {
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
    private readonly publicador: PublicadorDeEventos,
    private readonly auditoria: RepositorioDeAuditoria,
  ) {}

  async executar(
    entrada: EntradaDeVerificarSegundoFator,
  ): Promise<ResultadoDeVerificarSegundoFator> {
    const campo = campoInformado(entrada);
    try {
      return await this.#verificar(entrada, campo);
    } catch (erro) {
      if (erro instanceof ContaIndisponivelNoMeio) return DESAFIO_INVALIDO;
      throw erro;
    }
  }

  #verificar(
    entrada: EntradaDeVerificarSegundoFator,
    campo: CampoDoCodigo,
  ): Promise<ResultadoDeVerificarSegundoFator> {
    const agora = this.relogio.agora();
    return this.unidade.executar(async () => {
      const contaDoDesafio = await travarFreioPorEmailDoDesafio(
        {
          desafios: this.desafios,
          contas: this.contas,
          bloqueios: this.bloqueios,
          cifrador: this.cifrador,
        },
        entrada.desafio,
        agora,
      );
      if (contaDoDesafio === null) return DESAFIO_INVALIDO;
      const desafio = await lerDesafio(
        { desafios: this.desafios, cifrador: this.cifrador },
        entrada.desafio,
      );
      if (
        desafio === null ||
        desafio.contaId !== contaDoDesafio ||
        !desafio.estaValidoPara('verificar', agora)
      ) {
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
      if (atual === null || atual.confirmadoEm === null) {
        await this.bloqueios.salvar(freio);
        return DESAFIO_INVALIDO;
      }
      if (freio.estaBloqueado(agora)) {
        return { tipo: 'freado', segundosDeEspera: freio.segundosDeEspera(agora) };
      }

      const conferencia =
        campo === 'codigo'
          ? this.#conferirTotp(conta, atual, entrada.codigo ?? '', agora)
          : await this.#conferirRecuperacao(conta, entrada.codigoRecuperacao ?? '');
      const nivelAntes = freio.nivel;
      const resultado = desafio.avaliarCodigo({
        etapa: 'verificar',
        freio,
        codigoConfere: conferencia !== null,
        agora,
      });
      await this.desafios.atualizar(desafio);
      await this.bloqueios.salvar(freio);
      const consequencia = await avaliarFalhaDeSegundoFator(
        { desafios: this.desafios },
        { contaId: conta.id, codigoConfere: conferencia !== null, nivelAntes, freio, agora },
      );
      await reagirAoFreioDeSegundoFator(
        {
          contas: this.contas,
          sessoes: this.sessoes,
          auditoria: this.auditoria,
          publicador: this.publicador,
        },
        { contaId: conta.id, consequencia, agora },
      );
      if (resultado.tipo === 'codigo_errado') return { tipo: 'codigo_errado', campo };
      if (resultado.tipo !== 'concluido') return resultado;
      if (conferencia === null) throw new Error('Segundo fator concluído sem código conferido.');

      if (conferencia.tipo === 'totp') {
        await this.segundoFator.salvar({ ...atual, ultimoPassoUsado: conferencia.passo });
      } else {
        await this.segundoFator.marcarCodigoDeRecuperacaoUsado(conferencia.codigoId, agora);
      }
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
      return { tipo: 'concluido', sessao };
    });
  }

  /** O passo do TOTP, se confere e é posterior ao último usado (sem reuso). */
  #conferirTotp(conta: Conta, atual: SegundoFator, codigo: string, agora: Date): Conferencia {
    const segredo = segredoTotp(this.cifrador, conta.id, atual.segredoCifrado);
    const passo = this.totp.verificar(segredo, codigo, agora, atual.ultimoPassoUsado);
    return passo === null ? null : { tipo: 'totp', passo };
  }

  /**
   * O código de recuperação ainda não usado cujo HMAC confere com o digitado,
   * na conta do desafio. Confere todos, sem parar no primeiro, para o tempo não
   * depender da posição do código na lista.
   */
  async #conferirRecuperacao(conta: Conta, digitado: string): Promise<Conferencia> {
    const normalizado = normalizarCodigoDeRecuperacao(digitado);
    const naoUsados = await this.segundoFator.listarCodigosDeRecuperacaoNaoUsados(conta.id);
    if (normalizado === null) return null;
    let achado: CodigoDeRecuperacao | null = null;
    for (const codigo of naoUsados) {
      const confere = this.cifrador.hmacConfere(
        'codigo_recuperacao_segundo_fator',
        [conta.id, normalizado],
        codigo.codigoHmac,
      );
      if (confere && achado === null) achado = codigo;
    }
    return achado === null ? null : { tipo: 'recuperacao', codigoId: achado.id };
  }
}

/**
 * O campo que trouxe o código. O contrato já exige exatamente um; os dois ou
 * nenhum aqui é erro de quem chama (a rota não validou o corpo).
 */
function campoInformado(entrada: EntradaDeVerificarSegundoFator): CampoDoCodigo {
  const temCodigo = entrada.codigo !== undefined;
  const temRecuperacao = entrada.codigoRecuperacao !== undefined;
  if (temCodigo === temRecuperacao) {
    throw new Error('Informe exatamente um código: o do autenticador ou o de recuperação.');
  }
  return temCodigo ? 'codigo' : 'codigoRecuperacao';
}
