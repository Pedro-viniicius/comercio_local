// Tarefa diária de um módulo de contexto, agendada e consumida pelo worker
// (`worker.module.ts`) numa fila própria do pg-boss. O módulo dono declara a
// lista e registra a tarefa como provider; o worker só a agenda e a executa.
import type { Type } from '@nestjs/common';

/** Tarefa diária com fila própria no pg-boss, agendada e consumida pelo worker. */
export interface TarefaAgendada {
  /** Nome da fila e da agenda no pg-boss (`^[\w.\-/]+$`): renomear perde a agenda antiga. */
  readonly fila: string;
  /** Expressão cron e fuso horário (IANA). */
  readonly agenda: { readonly cron: string; readonly fusoHorario: string };
  /** Provider do Nest com `executar()`, registrado pelo módulo dono. */
  readonly tarefa: Type<{ executar(): Promise<unknown> }>;
}
