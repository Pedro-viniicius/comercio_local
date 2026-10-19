// E-mail da conta (`contas.email_normalizado`): valor imutável, sempre na forma
// normalizada de `normalizarEmail` (NFC, sem espaço nas pontas, minúsculas). É
// a chave da conta: o cadastro grava e o recadastro compara só por ela.
//
// Os campos são privados (`#`): `JSON.stringify` de um `Email` dá `{}`, então
// um objeto de domínio que escape para um log não leva o endereço.
import { normalizarEmail } from '@bairrin/contratos/validadores';

/** O texto não é um e-mail aceito. A mensagem nunca repete o valor. */
export class EmailInvalido extends Error {
  constructor() {
    super('E-mail inválido.');
    this.name = 'EmailInvalido';
  }
}

export class Email {
  readonly #valor: string;

  private constructor(valor: string) {
    this.#valor = valor;
  }

  /** Normaliza e valida; lança `EmailInvalido` se o texto não for um e-mail aceito. */
  static criar(texto: string): Email {
    const normalizado = normalizarEmail(texto);
    if (normalizado === null) throw new EmailInvalido();
    return new Email(normalizado);
  }

  /** Como `criar`, mas devolve `null` em vez de lançar. */
  static tentarCriar(texto: string): Email | null {
    const normalizado = normalizarEmail(texto);
    return normalizado === null ? null : new Email(normalizado);
  }

  /**
   * E-mail que substitui o real na anonimização (CA-11): deriva só do id da
   * conta, então não leva a nada do endereço original, e usa o domínio
   * reservado `.invalid` (RFC 2606), que nunca recebe mensagem. Mantém
   * `email_normalizado` único e preenchido e libera o endereço real para um
   * cadastro novo.
   */
  static substitutoDaAnonimizacao(contaId: string): Email {
    return Email.criar(`anonimizada-${contaId}@anonimizada.invalid`);
  }

  /** A forma normalizada, que é a guardada e a comparada. */
  get valor(): string {
    return this.#valor;
  }

  /**
   * Para mostrar sem revelar o endereço inteiro (`GET /v1/conta`, rótulo do
   * TOTP): os dois primeiros caracteres da parte local (um, se ela tiver até
   * dois), `***` e o domínio. `ana.souza@gmail.com` vira `an***@gmail.com`.
   */
  get mascarado(): string {
    const arroba = this.#valor.lastIndexOf('@');
    const local = this.#valor.slice(0, arroba);
    const visiveis = local.length <= 2 ? 1 : 2;
    return `${local.slice(0, visiveis)}***${this.#valor.slice(arroba)}`;
  }

  igual(outro: Email): boolean {
    return this.#valor === outro.#valor;
  }
}
