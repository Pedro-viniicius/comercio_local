// `globalSetup` dos testes de integração: recria o Postgres de teste do zero e
// aplica as migrações com o papel de migração (S3), como o `release_command`
// faz em produção: `prisma migrate deploy` e depois o passo do pg-boss. Roda
// uma vez por execução, antes de qualquer arquivo.
//
// As URLs vêm do ambiente do processo (o CI as define) ou, na falta, dos
// valores públicos do `infra/docker-compose.yml`. Nunca lê `.env`.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrarPgBoss } from '../../src/compartilhado/infra/pg-boss.ts';

/** Papel de migração (dono dos schemas) no Postgres de teste. */
export const URL_MIGRACAO_TESTE =
  process.env['DATABASE_URL_MIGRACAO_TESTE'] ??
  'postgresql://bairrin_migracao:dev_migracao_somente_local@127.0.0.1:5433/bairrin_teste';

/** Papel da aplicação (`bairrin_app`, só DML) no Postgres de teste. */
export const URL_APP_TESTE =
  process.env['DATABASE_URL_TESTE'] ??
  'postgresql://bairrin_app:dev_app_somente_local@127.0.0.1:5433/bairrin_teste';

const PASTA_DA_API = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Trava contra engano de configuração: o setup apaga schemas, então só aceita
 * banco cujo nome termina em `_teste`.
 */
function exigirBancoDeTeste(url: string): void {
  const banco = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!banco.endsWith('_teste')) {
    throw new Error(
      'DATABASE_URL_MIGRACAO_TESTE precisa apontar para um banco terminado em "_teste": o ' +
        'preparo dos testes apaga os schemas das migrações.',
    );
  }
}

/**
 * Apaga tudo o que o papel de migração criou (schemas, o de controle do Prisma
 * incluso, e qualquer objeto que uma migração errada tenha posto em `public`),
 * para cada execução começar do zero. O banco e o schema `public` não são do
 * papel e ficam; os GRANTs de banco feitos pelo init do compose também.
 */
async function limparBanco(url: string): Promise<void> {
  const cliente = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await cliente.connect();
  } catch (erro) {
    // A causa é o erro do `pg` (cita papel e host, nunca a senha).
    const codigo = (erro as { code?: unknown }).code;
    throw new Error(
      `Postgres de teste inacessível (${typeof codigo === 'string' ? codigo : 'sem código'}). ` +
        'Suba com: docker compose -f infra/docker-compose.yml up -d --wait',
      { cause: erro },
    );
  }
  try {
    const { rows } = await cliente.query<{ superusuario: boolean }>(
      'SELECT rolsuper AS superusuario FROM pg_roles WHERE rolname = current_user',
    );
    if (rows[0]?.superusuario !== false) {
      throw new Error(
        'DATABASE_URL_MIGRACAO_TESTE deve usar o papel de migração (bairrin_migracao), não um ' +
          'superusuário: os testes provam as permissões desse papel.',
      );
    }
    await cliente.query('DROP OWNED BY CURRENT_USER CASCADE');
  } finally {
    await cliente.end();
  }
}

/** `prisma migrate deploy`, como no deploy, com a URL do papel de migração. */
function aplicarMigracoes(url: string): void {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const resultado = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], {
    cwd: PASTA_DA_API,
    env: { ...process.env, DATABASE_URL_MIGRACAO: url, CHECKPOINT_DISABLE: '1' },
    encoding: 'utf8',
  });
  // A saída do Prisma cita banco, host e papel, nunca a senha; só aparece se falhar.
  if (resultado.status !== 0) {
    throw new Error(
      `prisma migrate deploy falhou no banco de teste:\n${resultado.stdout}${resultado.stderr}`,
    );
  }
}

export default async function prepararBanco(): Promise<void> {
  exigirBancoDeTeste(URL_MIGRACAO_TESTE);
  await limparBanco(URL_MIGRACAO_TESTE);
  aplicarMigracoes(URL_MIGRACAO_TESTE);
  await migrarPgBoss(URL_MIGRACAO_TESTE);
}
