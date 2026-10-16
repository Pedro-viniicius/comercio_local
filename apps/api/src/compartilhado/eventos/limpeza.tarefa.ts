// Tarefa diária de retenção (S5; 00-arquitetura, "Anonimização em todos os
// contextos"): apaga da outbox os eventos publicados há mais de 30 dias e, do
// pg-boss, os jobs encerrados (concluídos, com falha ou cancelados) há mais de
// 7 dias. O worker agenda a tarefa uma vez por dia (`AGENDA_DA_LIMPEZA`).
//
// As filas de assinante também nascem com `deleteAfterSeconds` de 7 dias, e a
// manutenção do pg-boss apaga por conta própria; a tarefa garante o prazo
// mesmo se a manutenção estiver desligada ou a fila tiver sido criada com
// outra configuração.
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { SCHEMA_DO_PG_BOSS } from '../infra/pg-boss.ts';
import { UnidadeDeTrabalhoPrisma } from '../infra/unidade-de-trabalho-prisma.ts';
import { Relogio } from '../tempo/relogio.ts';

const UM_DIA_EM_MS = 24 * 60 * 60 * 1_000;

/** Eventos publicados ficam na outbox por 30 dias. */
export const RETENCAO_DA_OUTBOX_EM_DIAS = 30;

/** Jobs encerrados ficam no pg-boss por 7 dias. */
export const RETENCAO_DOS_JOBS_EM_DIAS = 7;

/** Fila da tarefa no pg-boss. */
export const FILA_DA_LIMPEZA = 'compartilhado.limpeza-de-retencao';

/** Todo dia às 3h15 (horário de Brasília), fora do movimento. */
export const AGENDA_DA_LIMPEZA = { cron: '15 3 * * *', fusoHorario: 'America/Sao_Paulo' } as const;

export interface ResultadoDaLimpeza {
  eventosApagados: number;
  jobsApagados: number;
}

@Injectable()
export class TarefaDeLimpeza {
  constructor(
    private readonly unidade: UnidadeDeTrabalhoPrisma,
    private readonly relogio: Relogio,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(TarefaDeLimpeza.name);
  }

  async executar(): Promise<ResultadoDaLimpeza> {
    const agora = this.relogio.agora().getTime();
    const limiteDaOutbox = new Date(agora - RETENCAO_DA_OUTBOX_EM_DIAS * UM_DIA_EM_MS);
    const limiteDosJobs = new Date(agora - RETENCAO_DOS_JOBS_EM_DIAS * UM_DIA_EM_MS);
    const cliente = this.unidade.cliente();
    // Pendente (`publicado_em` nulo) nunca sai: `lt` não casa com NULL.
    const { count: eventosApagados } = await cliente.outbox.deleteMany({
      where: { publicadoEm: { lt: limiteDaOutbox } },
    });
    // Tabela do pg-boss (o schema é constante, não vem de fora). `completed_on`
    // é a hora em que o job se encerrou, com sucesso, falha ou cancelamento;
    // job pendente ou em execução não tem.
    const jobsApagados = await cliente.$executeRawUnsafe(
      `DELETE FROM ${SCHEMA_DO_PG_BOSS}.job
        WHERE state IN ('completed', 'failed', 'cancelled') AND completed_on < $1`,
      limiteDosJobs,
    );
    const resultado = { eventosApagados, jobsApagados };
    this.logger.info(resultado, 'limpeza de retenção concluída');
    return resultado;
  }
}
