// Código de 6 dígitos enviado por e-mail (`identidade.codigos_verificacao`,
// finalidades `verificacao_email` e `recuperacao_senha`): vale 30 min, uma
// vez e 5 tentativas (CA-01, CA-06).
//
// O código nunca é guardado nem passa pelo domínio em claro: o assinante o
// gera no envio (etapa 13) e guarda só o HMAC, que cobre finalidade, conta e
// código (etapa 6). Quem confere calcula se o código digitado bate com o HMAC
// (comparação em tempo constante, no `Cifrador`) e passa só o resultado para
// `conferir`.
//
// A mesma tabela guarda os desafios do segundo fator (`desafio-de-segundo-fator.ts`).

/** Finalidades do código enviado por e-mail. */
export type FinalidadeDoCodigo = 'verificacao_email' | 'recuperacao_senha';

/** Validade do código (spec 01: "Ele vale por 30 minutos"). */
export const VALIDADE_DO_CODIGO_EM_MS = 30 * 60 * 1000;
/** Tentativas por código (plano 01b, Limites). */
export const TENTATIVAS_POR_CODIGO = 5;

/** Forma persistida, coluna a coluna. */
export interface DadosDoCodigoDeVerificacao {
  readonly id: string;
  readonly contaId: string;
  readonly finalidade: FinalidadeDoCodigo;
  readonly codigoHmac: string;
  /** Tentativas erradas. */
  readonly tentativas: number;
  readonly expiraEm: Date;
  /** Aceito ou invalidado por um código novo; `null` enquanto vale. */
  readonly usadoEm: Date | null;
  /** Emissão (`criado_em`): o mais recente é o que vale. */
  readonly criadoEm: Date;
}

export interface NovoCodigoDeVerificacao {
  id: string;
  contaId: string;
  finalidade: FinalidadeDoCodigo;
  codigoHmac: string;
  agora: Date;
}

/**
 * - `aceito`: confere e foi consumido;
 * - `errado`: não confere e ainda sobra tentativa;
 * - `invalido`: vencido, já usado, esgotado, ou a quinta tentativa errada.
 */
export type ResultadoDoCodigo = 'aceito' | 'errado' | 'invalido';

export class CodigoDeVerificacao {
  readonly #id: string;
  readonly #contaId: string;
  readonly #finalidade: FinalidadeDoCodigo;
  readonly #codigoHmac: string;
  #tentativas: number;
  readonly #expiraEm: Date;
  #usadoEm: Date | null;
  readonly #criadoEm: Date;

  private constructor(dados: DadosDoCodigoDeVerificacao) {
    if (!Number.isInteger(dados.tentativas) || dados.tentativas < 0) {
      throw new Error('Tentativas do código devem ser um inteiro não negativo.');
    }
    this.#id = dados.id;
    this.#contaId = dados.contaId;
    this.#finalidade = dados.finalidade;
    this.#codigoHmac = dados.codigoHmac;
    this.#tentativas = dados.tentativas;
    this.#expiraEm = new Date(dados.expiraEm.getTime());
    this.#usadoEm = dados.usadoEm === null ? null : new Date(dados.usadoEm.getTime());
    this.#criadoEm = new Date(dados.criadoEm.getTime());
  }

  /**
   * Código novo, vale 30 min. Quem emite invalida antes os códigos ainda
   * válidos da mesma conta e finalidade (`invalidarVigentes` do repositório),
   * para só o último valer.
   */
  static emitir(novo: NovoCodigoDeVerificacao): CodigoDeVerificacao {
    if (novo.codigoHmac.length === 0) throw new Error('O HMAC do código não pode ser vazio.');
    return new CodigoDeVerificacao({
      id: novo.id,
      contaId: novo.contaId,
      finalidade: novo.finalidade,
      codigoHmac: novo.codigoHmac,
      tentativas: 0,
      expiraEm: new Date(novo.agora.getTime() + VALIDADE_DO_CODIGO_EM_MS),
      usadoEm: null,
      criadoEm: novo.agora,
    });
  }

  static reconstituir(dados: DadosDoCodigoDeVerificacao): CodigoDeVerificacao {
    return new CodigoDeVerificacao(dados);
  }

  get id(): string {
    return this.#id;
  }

  get contaId(): string {
    return this.#contaId;
  }

  get finalidade(): FinalidadeDoCodigo {
    return this.#finalidade;
  }

  get codigoHmac(): string {
    return this.#codigoHmac;
  }

  get criadoEm(): Date {
    return new Date(this.#criadoEm.getTime());
  }

  /** Não usado, não vencido e com tentativa sobrando. */
  estaValido(agora: Date): boolean {
    return (
      this.#usadoEm === null &&
      agora.getTime() < this.#expiraEm.getTime() &&
      this.#tentativas < TENTATIVAS_POR_CODIGO
    );
  }

  /**
   * Registra a tentativa. `confere` é o resultado da comparação do código
   * digitado com o HMAC. Código inválido não gasta tentativa nem é aceito,
   * mesmo que confira.
   */
  conferir(confere: boolean, agora: Date): ResultadoDoCodigo {
    if (!this.estaValido(agora)) return 'invalido';
    if (confere) {
      this.#usadoEm = new Date(agora.getTime());
      return 'aceito';
    }
    this.#tentativas += 1;
    return this.#tentativas < TENTATIVAS_POR_CODIGO ? 'errado' : 'invalido';
  }

  /** Tira o código de uso (um código novo da mesma finalidade foi emitido). Idempotente. */
  invalidar(agora: Date): void {
    this.#usadoEm ??= new Date(agora.getTime());
  }

  get dados(): DadosDoCodigoDeVerificacao {
    return {
      id: this.#id,
      contaId: this.#contaId,
      finalidade: this.#finalidade,
      codigoHmac: this.#codigoHmac,
      tentativas: this.#tentativas,
      expiraEm: new Date(this.#expiraEm.getTime()),
      usadoEm: this.#usadoEm === null ? null : new Date(this.#usadoEm.getTime()),
      criadoEm: new Date(this.#criadoEm.getTime()),
    };
  }
}
