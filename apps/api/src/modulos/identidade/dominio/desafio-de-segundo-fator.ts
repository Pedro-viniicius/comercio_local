// Desafio pós-senha do admin no painel (S1; plano 01b, "Respostas do 2FA").
// Guardado em `identidade.codigos_verificacao` com a finalidade
// `desafio_configurar` ou `desafio_verificar` e só o HMAC do token do desafio
// em `codigo_hmac`.
//
// - A etapa é `configurar` só se o segundo fator da conta ainda não foi
//   confirmado; senão, `verificar` (`etapaDoDesafio`).
// - Vale 5 min, uma vez e 5 tentativas.
// - Ordem das respostas nas rotas com código (`avaliarCodigo`): (1) desafio
//   inexistente, vencido, usado, de outra etapa ou esgotado → `desafio_invalido`,
//   sem distinguir o motivo; (2) freio de segundo fator ativo → `freado`, sem
//   gastar tentativa; (3) código errado → soma uma falha no desafio e no freio
//   e devolve `codigo_errado` se ainda sobra tentativa, ou `desafio_invalido`
//   na quinta. A configuração (`iniciar`) só tem o passo 1 (`estaValidoPara`).
import type { EtapaDoDesafio } from '@bairrin/contratos/validadores';
import type { BloqueioDeLogin } from './bloqueio-de-login.ts';

/** Finalidade gravada em `codigos_verificacao` para cada etapa. */
export type FinalidadeDoDesafio = `desafio_${EtapaDoDesafio}`;

/** Validade do desafio (5 min). */
export const VALIDADE_DO_DESAFIO_EM_MS = 5 * 60 * 1000;
/** Tentativas por desafio (S1). */
export const TENTATIVAS_POR_DESAFIO = 5;

/**
 * Teto diário de erros de segundo fator por conta (S103; decisão do dono de
 * 2026-10-21): somadas as tentativas erradas dos desafios da conta, das duas
 * etapas, emitidos nas últimas 24 h, passar de 20 tem a mesma reação do freio
 * acionado de novo no nível máximo (P16: senha apagada, sessões revogadas e
 * aviso por e-mail). Fecha o caminho de quem erra 4 vezes a cada 15 min, sem
 * nunca pôr o freio em espera.
 */
export const LIMITE_DE_ERROS_DE_SEGUNDO_FATOR_POR_DIA = 20;
/** Janela do teto diário (`LIMITE_DE_ERROS_DE_SEGUNDO_FATOR_POR_DIA`): as últimas 24 h. */
export const JANELA_DO_LIMITE_DE_ERROS_DE_SEGUNDO_FATOR_EM_MS = 24 * 60 * 60 * 1000;

/** Os erros de segundo fator das últimas 24 h passaram do teto diário (S103): 21 ou mais. */
export function passouDoLimiteDiarioDeSegundoFator(errosNasUltimas24h: number): boolean {
  return errosNasUltimas24h > LIMITE_DE_ERROS_DE_SEGUNDO_FATOR_POR_DIA;
}

export interface DadosDoDesafioDeSegundoFator {
  readonly id: string;
  readonly contaId: string;
  readonly etapa: EtapaDoDesafio;
  /** HMAC do token do desafio (`codigo_hmac`). */
  readonly tokenHmac: string;
  readonly tentativas: number;
  readonly expiraEm: Date;
  readonly usadoEm: Date | null;
  /** Emissão (`criado_em`). */
  readonly criadoEm: Date;
}

export interface NovoDesafioDeSegundoFator {
  id: string;
  contaId: string;
  etapa: EtapaDoDesafio;
  tokenHmac: string;
  agora: Date;
}

export type ResultadoDoSegundoFator =
  | { tipo: 'desafio_invalido' }
  | { tipo: 'freado'; segundosDeEspera: number }
  | { tipo: 'codigo_errado' }
  | { tipo: 'concluido' };

export interface TentativaDeSegundoFator {
  /** Etapa da rota: `configurar` na confirmação, `verificar` no login. */
  etapa: EtapaDoDesafio;
  /** Freio `segundo_fator` da conta do desafio. */
  freio: BloqueioDeLogin;
  /** O TOTP (ou o código de recuperação ainda não usado) confere. */
  codigoConfere: boolean;
  agora: Date;
}

/** `configurar` só para conta sem segundo fator confirmado (S1). */
export function etapaDoDesafio(segundoFatorConfirmado: boolean): EtapaDoDesafio {
  return segundoFatorConfirmado ? 'verificar' : 'configurar';
}

export function finalidadeDoDesafio(etapa: EtapaDoDesafio): FinalidadeDoDesafio {
  return `desafio_${etapa}`;
}

export class DesafioDeSegundoFator {
  readonly #id: string;
  readonly #contaId: string;
  readonly #etapa: EtapaDoDesafio;
  readonly #tokenHmac: string;
  #tentativas: number;
  readonly #expiraEm: Date;
  #usadoEm: Date | null;
  readonly #criadoEm: Date;

  private constructor(dados: DadosDoDesafioDeSegundoFator) {
    if (!Number.isInteger(dados.tentativas) || dados.tentativas < 0) {
      throw new Error('Tentativas do desafio devem ser um inteiro não negativo.');
    }
    this.#id = dados.id;
    this.#contaId = dados.contaId;
    this.#etapa = dados.etapa;
    this.#tokenHmac = dados.tokenHmac;
    this.#tentativas = dados.tentativas;
    this.#expiraEm = new Date(dados.expiraEm.getTime());
    this.#usadoEm = dados.usadoEm === null ? null : new Date(dados.usadoEm.getTime());
    this.#criadoEm = new Date(dados.criadoEm.getTime());
  }

  /** Desafio emitido depois da senha certa no painel, para conta com `admin`. */
  static emitir(novo: NovoDesafioDeSegundoFator): DesafioDeSegundoFator {
    if (novo.tokenHmac.length === 0) throw new Error('O HMAC do desafio não pode ser vazio.');
    return new DesafioDeSegundoFator({
      id: novo.id,
      contaId: novo.contaId,
      etapa: novo.etapa,
      tokenHmac: novo.tokenHmac,
      tentativas: 0,
      expiraEm: new Date(novo.agora.getTime() + VALIDADE_DO_DESAFIO_EM_MS),
      usadoEm: null,
      criadoEm: novo.agora,
    });
  }

  static reconstituir(dados: DadosDoDesafioDeSegundoFator): DesafioDeSegundoFator {
    return new DesafioDeSegundoFator(dados);
  }

  get id(): string {
    return this.#id;
  }

  get contaId(): string {
    return this.#contaId;
  }

  get etapa(): EtapaDoDesafio {
    return this.#etapa;
  }

  get tokenHmac(): string {
    return this.#tokenHmac;
  }

  /** Passo 1 das respostas: da etapa pedida, não usado, não vencido e não esgotado. */
  estaValidoPara(etapa: EtapaDoDesafio, agora: Date): boolean {
    return (
      this.#etapa === etapa &&
      this.#usadoEm === null &&
      agora.getTime() < this.#expiraEm.getTime() &&
      this.#tentativas < TENTATIVAS_POR_DESAFIO
    );
  }

  /**
   * Aplica os passos 1 a 3 de "Respostas do 2FA". Altera o desafio e o freio;
   * quem chama grava os dois. No sucesso, o desafio é consumido e o freio de
   * segundo fator zera.
   */
  avaliarCodigo(tentativa: TentativaDeSegundoFator): ResultadoDoSegundoFator {
    const { etapa, freio, codigoConfere, agora } = tentativa;
    if (freio.tipo !== 'segundo_fator') {
      throw new Error('O desafio só usa o freio de segundo fator.');
    }
    if (!this.estaValidoPara(etapa, agora)) return { tipo: 'desafio_invalido' };
    if (freio.estaBloqueado(agora)) {
      return { tipo: 'freado', segundosDeEspera: freio.segundosDeEspera(agora) };
    }
    if (codigoConfere) {
      this.#usadoEm = new Date(agora.getTime());
      freio.registrarSucesso('segundo_fator');
      return { tipo: 'concluido' };
    }
    this.#tentativas += 1;
    freio.registrarFalha(agora);
    return this.#tentativas < TENTATIVAS_POR_DESAFIO
      ? { tipo: 'codigo_errado' }
      : { tipo: 'desafio_invalido' };
  }

  get dados(): DadosDoDesafioDeSegundoFator {
    return {
      id: this.#id,
      contaId: this.#contaId,
      etapa: this.#etapa,
      tokenHmac: this.#tokenHmac,
      tentativas: this.#tentativas,
      expiraEm: new Date(this.#expiraEm.getTime()),
      usadoEm: this.#usadoEm === null ? null : new Date(this.#usadoEm.getTime()),
      criadoEm: new Date(this.#criadoEm.getTime()),
    };
  }
}
