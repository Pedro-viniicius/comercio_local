// pg-boss: as filas de jobs do worker (ADR-011), no schema `pgboss`, nunca em
// `public` (S2).
//
// Quem cria e migra o schema é o papel de migração (S3), num passo próprio
// depois do `prisma migrate deploy` (`dist/cli/migrar-pg-boss.js` no deploy e o
// `globalSetup` nos testes): o `bairrin_app` não tem CREATE no banco. Esse
// passo usa a CLI do próprio pg-boss (`pg-boss migrate`: instala ou migra, e
// roda fora da transação os índices `CONCURRENTLY`) e depois dá ao
// `bairrin_app` só o mínimo: USAGE no schema, DML nas tabelas (sem TRUNCATE) e
// EXECUTE nas funções, com RLS ligado e política só para ele em toda tabela.
//
// Não é migração do Prisma de propósito: o SQL do pg-boss tem `DROP TABLE`
// dinâmico (função `delete_queue`) e muda a cada versão da biblioteca; gravá-lo
// em `prisma/migrations` exigiria pasta `_destrutiva` e reescrever o SQL dele.
//
// A aplicação sobe o pg-boss sem migrar (`migrate: false`): ele só confere que
// a versão do schema bate com a da biblioteca e falha se não bater.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import type { PinoLogger } from 'nestjs-pino';

export const SCHEMA_DO_PG_BOSS = 'pgboss';

/** Papel da aplicação (infra/postgres/init/01-papeis.sql), o mesmo das migrações. */
export const PAPEL_DA_APLICACAO = 'bairrin_app';

type Registro = Pick<PinoLogger, 'warn' | 'error'>;

export interface OpcoesDoPgBoss {
  /** Manutenção do pg-boss: expira jobs presos, apaga os vencidos. Padrão: ligada. */
  supervisionar?: boolean;
  /** Agendamentos cron (`schedule`). Padrão: ligados. */
  agendar?: boolean;
  /** Conexões do pool do pg-boss. */
  conexoes?: number;
}

/**
 * pg-boss da aplicação, no papel `bairrin_app`, sem migração nem DDL:
 * sem reindexação automática, sem registro de instâncias e sem gravar avisos
 * e estatísticas no banco (o texto de um aviso pode trazer mensagem de erro).
 * Erros e avisos vão para o log sem mensagem: só tipo, código e o tipo do aviso.
 */
export function criarPgBoss(url: string, registro: Registro, opcoes: OpcoesDoPgBoss = {}): PgBoss {
  const fila = new PgBoss({
    connectionString: url,
    schema: SCHEMA_DO_PG_BOSS,
    application_name: 'bairrin-worker',
    max: opcoes.conexoes ?? 4,
    connectionTimeoutMillis: 5_000,
    migrate: false,
    createSchema: false,
    reindex: false,
    registerInstance: false,
    persistWarnings: false,
    persistQueueStats: false,
    supervise: opcoes.supervisionar ?? true,
    schedule: opcoes.agendar ?? true,
  });
  // Sem ouvinte, o `error` do EventEmitter derruba o processo.
  fila.on('error', (erro) => registro.error({ err: erro }, 'erro no pg-boss'));
  fila.on('warning', (aviso) => {
    const tipo = (aviso.data as { type?: unknown } | undefined)?.type;
    registro.warn({ tipo: typeof tipo === 'string' ? tipo : 'desconhecido' }, 'aviso do pg-boss');
  });
  return fila;
}

/**
 * Permissões do `bairrin_app` no schema do pg-boss, idempotentes. Rodam depois
 * de toda instalação ou migração, porque uma versão nova pode criar tabela ou
 * função. RLS em toda tabela (inclusive as partições) com política só para a
 * aplicação (S2); o dono ignora RLS (sem FORCE), como no schema `compartilhado`.
 */
export function sqlDasPermissoes(schema = SCHEMA_DO_PG_BOSS, papel = PAPEL_DA_APLICACAO): string {
  return `
    REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;
    GRANT USAGE ON SCHEMA ${schema} TO ${papel};
    REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM PUBLIC;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${papel};
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM PUBLIC;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${papel};
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schema} FROM PUBLIC;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} TO ${papel};
    DO $$
    DECLARE
      tabela record;
    BEGIN
      FOR tabela IN
        SELECT c.relname AS nome
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = '${schema}' AND c.relkind IN ('r', 'p')
      LOOP
        EXECUTE format('ALTER TABLE ${schema}.%I ENABLE ROW LEVEL SECURITY', tabela.nome);
        IF NOT EXISTS (
          SELECT FROM pg_policies
           WHERE schemaname = '${schema}' AND tablename = tabela.nome AND policyname = 'aplicacao'
        ) THEN
          EXECUTE format(
            'CREATE POLICY aplicacao ON ${schema}.%I TO ${papel} USING (true) WITH CHECK (true)',
            tabela.nome
          );
        END IF;
      END LOOP;
    END
    $$;
  `;
}

/** Erro do passo de migração do pg-boss. Cita a saída da CLI (host, banco e papel; nunca a senha). */
export class FalhaNaMigracaoDoPgBoss extends Error {
  constructor(detalhe: string) {
    super(`Migração do pg-boss falhou: ${detalhe}`);
    this.name = 'FalhaNaMigracaoDoPgBoss';
  }
}

/**
 * Ambiente do processo filho da CLI (S30): só `PATH`, `NODE_ENV` e as duas
 * variáveis do pg-boss. Os segredos da aplicação (`JWT_SEGREDO`, chaves de
 * cifragem, `SENTRY_DSN`...) e as `PG*`/`PGBOSS_*` de fora não passam: a
 * conexão depende só da URL de migração. A URL vai pelo ambiente, não pelos
 * argumentos (que aparecem na lista de processos).
 */
export function ambienteDaCliDoPgBoss(
  urlDeMigracao: string,
  ambienteDoProcesso: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const { PATH, NODE_ENV } = ambienteDoProcesso;
  return {
    ...(PATH === undefined ? {} : { PATH }),
    ...(NODE_ENV === undefined ? {} : { NODE_ENV }),
    PGBOSS_DATABASE_URL: urlDeMigracao,
    PGBOSS_SCHEMA: SCHEMA_DO_PG_BOSS,
  };
}

function executarCliDoPgBoss(urlDeMigracao: string): string {
  const cli = createRequire(import.meta.url).resolve('pg-boss/dist/cli.js');
  const resultado = spawnSync(process.execPath, [cli, 'migrate'], {
    env: ambienteDaCliDoPgBoss(urlDeMigracao),
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (resultado.status !== 0) {
    throw new FalhaNaMigracaoDoPgBoss(
      `${resultado.stdout ?? ''}${resultado.stderr ?? ''}`.trim() || 'sem saída',
    );
  }
  return resultado.stdout.trim();
}

/**
 * Instala ou migra o pg-boss e aplica as permissões da aplicação. Roda com o
 * papel de migração (dono dos schemas). Devolve a saída da CLI do pg-boss.
 */
export async function migrarPgBoss(urlDeMigracao: string): Promise<string> {
  const saida = executarCliDoPgBoss(urlDeMigracao);
  const cliente = new pg.Client({
    connectionString: urlDeMigracao,
    connectionTimeoutMillis: 5_000,
  });
  await cliente.connect();
  try {
    await cliente.query(sqlDasPermissoes());
  } finally {
    await cliente.end();
  }
  return saida;
}
