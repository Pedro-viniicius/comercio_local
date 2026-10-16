// Fonte única da hora atual: a porta e os relógios, sem Nest nem Prisma. Os
// timestamps do núcleo (outbox, auditoria, eventos processados) são NOT NULL
// sem default no banco de propósito: vêm daqui, para que os testes controlem
// o tempo sem depender do relógio do Postgres.

/** Porta: quem precisa da hora pede ao relógio, nunca a `new Date()`. */
export abstract class Relogio {
  abstract agora(): Date;
}

/** Relógio de produção: a hora do sistema. */
export class RelogioDoSistema extends Relogio {
  override agora(): Date {
    return new Date();
  }
}

/** Relógio parado num instante, para testes e rotinas que fixam a hora. */
export class RelogioFixo extends Relogio {
  #instante: Date;

  constructor(instante: Date) {
    super();
    this.#instante = new Date(instante.getTime());
  }

  override agora(): Date {
    return new Date(this.#instante.getTime());
  }

  definir(instante: Date): void {
    this.#instante = new Date(instante.getTime());
  }

  avancar(milissegundos: number): void {
    this.#instante = new Date(this.#instante.getTime() + milissegundos);
  }
}
