// Checagem do passo de release (S26): nenhum papel do Supabase exposto pela
// API de dados (PostgREST) enxerga os schemas do Bairrin. No Supabase, o
// `REVOKE` da migração inicial não tem efeito em `public` (o dono é o
// `postgres`, não o papel de migração) e o `public` dá USAGE a PUBLIC por
// padrão; por isso o release confere o resultado em vez de confiar no REVOKE.
//
// Papel ou schema que não existe é ignorado: no Postgres local não há `anon`
// nem `authenticated`, e o schema `pgboss` só existe depois do passo dele.
import pg from 'pg';
import { SCHEMA_DO_PG_BOSS } from './pg-boss.ts';

/** Papéis da API de dados do Supabase. */
export const PAPEIS_DO_SUPABASE: readonly string[] = ['anon', 'authenticated'];

/** Schemas que esses papéis não podem usar. */
export const SCHEMAS_FECHADOS: readonly string[] = [
  'public',
  'compartilhado',
  'migracoes',
  SCHEMA_DO_PG_BOSS,
];

export interface AcessoIndevido {
  papel: string;
  schema: string;
}

/**
 * Pares papel/schema com USAGE ou CREATE, direto ou herdado de PUBLIC ou de
 * outro papel (`has_schema_privilege`). Lista vazia: tudo fechado.
 */
export async function acessosIndevidos(
  cliente: Pick<pg.Client, 'query'>,
  papeis: readonly string[] = PAPEIS_DO_SUPABASE,
  schemas: readonly string[] = SCHEMAS_FECHADOS,
): Promise<AcessoIndevido[]> {
  const { rows } = await cliente.query<AcessoIndevido>(
    `SELECT r.rolname AS papel, s.nspname AS schema
       FROM pg_roles r CROSS JOIN pg_namespace s
      WHERE r.rolname = ANY($1::text[]) AND s.nspname = ANY($2::text[])
        AND has_schema_privilege(r.oid, s.oid, 'USAGE, CREATE')
      ORDER BY 1, 2`,
    [papeis, schemas],
  );
  return rows;
}

/** Algum papel do Supabase enxerga um schema do Bairrin: o release para. */
export class SchemasAbertosAoSupabase extends Error {
  constructor(readonly acessos: readonly AcessoIndevido[]) {
    super(
      'Papéis do Supabase com acesso a schemas do Bairrin (S26): ' +
        acessos.map(({ papel, schema }) => `${papel} em ${schema}`).join(', ') +
        '. Revogue USAGE e CREATE como postgres antes de seguir com o deploy.',
    );
    this.name = 'SchemasAbertosAoSupabase';
  }
}

/** Conecta com a URL de migração e rejeita com `SchemasAbertosAoSupabase` se houver acesso. */
export async function exigirSchemasFechados(urlDeMigracao: string): Promise<void> {
  const cliente = new pg.Client({
    connectionString: urlDeMigracao,
    connectionTimeoutMillis: 5_000,
  });
  await cliente.connect();
  try {
    const acessos = await acessosIndevidos(cliente);
    if (acessos.length > 0) throw new SchemasAbertosAoSupabase(acessos);
  } finally {
    await cliente.end();
  }
}
