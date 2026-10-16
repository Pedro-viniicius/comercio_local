// Porta da unidade de trabalho: o caso de uso pede uma transação sem saber
// como ela é aberta. Sem Nest nem Prisma (ADR-003), para a aplicação dos
// módulos depender só dela. O adaptador é `infra/unidade-de-trabalho-prisma.ts`.

export interface OpcoesDaUnidadeDeTrabalho {
  /**
   * Tempo máximo da transação. Ao passar dele, tudo é desfeito e `executar`
   * rejeita. Ignorado numa unidade aninhada (vale o da externa).
   */
  prazoEmMs?: number;
}

/**
 * Porta da aplicação: executa o trabalho numa transação. Se o trabalho
 * rejeitar, nada do que ele gravou fica (inclusive os eventos da outbox e a
 * auditoria). Chamada dentro de outra unidade, participa da externa.
 */
export abstract class UnidadeDeTrabalho {
  abstract executar<T>(trabalho: () => Promise<T>, opcoes?: OpcoesDaUnidadeDeTrabalho): Promise<T>;
}
