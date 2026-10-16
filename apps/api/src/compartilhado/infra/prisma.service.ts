// Acesso ao banco pela aplicação: Prisma 7 com o driver adapter do `pg`, no
// papel `bairrin_app` (DATABASE_URL: só DML, sem posse de schema, S3). As
// migrações usam outro papel e outra URL (prisma.config.ts).
//
// Conexão preguiçosa: a API sobe mesmo com o banco fora do ar e quem acusa é
// o `GET /v1/saude/pronto`.
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PinoLogger } from 'nestjs-pino';
import { AMBIENTE, type Ambiente } from '../config/ambiente.ts';
import { PrismaClient } from './gerado/prisma/client.ts';

/** Espera máxima por uma conexão livre (o padrão do `pg` é esperar para sempre). */
export const ESPERA_POR_CONEXAO_EM_MS = 5_000;

/** Prazo da consulta de prontidão. */
export const PRAZO_DA_VERIFICACAO_EM_MS = 3_000;

/** O banco não respondeu dentro do prazo da verificação. */
export class BancoSemResposta extends Error {
  constructor() {
    super('O banco não respondeu dentro do prazo.');
    this.name = 'BancoSemResposta';
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(AMBIENTE) ambiente: Ambiente, logger: PinoLogger) {
    super({
      adapter: new PrismaPg(
        {
          connectionString: ambiente.DATABASE_URL,
          connectionTimeoutMillis: ESPERA_POR_CONEXAO_EM_MS,
        },
        {
          // Conexão ociosa que caiu: o `pg` emite `error` no pool. Registra só
          // tipo e código (o serializador `err` descarta a mensagem, que pode
          // trazer parâmetros da query).
          onPoolError: (erro) => logger.warn({ err: erro }, 'conexão ociosa do banco caiu'),
        },
      ),
    });
    logger.setContext(PrismaService.name);
  }

  /**
   * Faz `SELECT 1` com prazo. Resolve se o banco respondeu; rejeita com o
   * erro do driver ou com `BancoSemResposta`. Quem chama decide o que
   * registrar: a mensagem do erro do driver não deve ir para log nem resposta.
   */
  async verificarConexao(prazoEmMs = PRAZO_DA_VERIFICACAO_EM_MS): Promise<void> {
    let temporizador: NodeJS.Timeout | undefined;
    const prazo = new Promise<never>((_resolver, rejeitar) => {
      temporizador = setTimeout(() => rejeitar(new BancoSemResposta()), prazoEmMs);
    });
    try {
      await Promise.race([this.$queryRaw`SELECT 1`, prazo]);
    } finally {
      clearTimeout(temporizador);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
