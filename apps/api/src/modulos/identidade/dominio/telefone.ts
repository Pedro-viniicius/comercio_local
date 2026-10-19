// Celular da conta (`contas.telefone_e164`): valor imutável em E.164
// (`+5535999991234`), saído de `normalizarCelular`. Sem verificação por SMS no
// MVP (CA-01). Campos privados (`#`): `JSON.stringify` dá `{}`.
import { normalizarCelular } from '@bairrin/contratos/validadores';

/** O texto não é um celular brasileiro aceito. A mensagem nunca repete o valor. */
export class TelefoneInvalido extends Error {
  constructor() {
    super('Telefone inválido.');
    this.name = 'TelefoneInvalido';
  }
}

export class Telefone {
  readonly #valor: string;

  private constructor(valor: string) {
    this.#valor = valor;
  }

  /** Normaliza para E.164; lança `TelefoneInvalido` se não for celular com DDD válido. */
  static criar(texto: string): Telefone {
    const normalizado = normalizarCelular(texto);
    if (normalizado === null) throw new TelefoneInvalido();
    return new Telefone(normalizado);
  }

  /** Como `criar`, mas devolve `null` em vez de lançar. */
  static tentarCriar(texto: string): Telefone | null {
    const normalizado = normalizarCelular(texto);
    return normalizado === null ? null : new Telefone(normalizado);
  }

  /** E.164, a forma guardada. */
  get valor(): string {
    return this.#valor;
  }

  igual(outro: Telefone): boolean {
    return this.#valor === outro.#valor;
  }
}
