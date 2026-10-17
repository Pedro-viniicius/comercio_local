// Checagem do passo de release (S26): nenhum papel do Supabase exposto pela
// API de dados (PostgREST) enxerga os schemas do Bairrin. No Supabase, o
// `REVOKE` da migração inicial não tem efeito em `public` (o dono é o
// `postgres`, não o papel de migração) e o `public` dá USAGE a PUBLIC por
// padrão; por isso o release confere o resultado em vez de confiar no REVOKE.
//
// Papel ou schema que não existe é ignorado: no Postgres local não há `anon`
// nem `authenticated`, e o schema `pgboss` só existe depois do passo dele.
//
// Os schemas conferidos não dependem de lista mantida à mão (Seg-3): além do
// piso fixo, entra todo schema do papel conectado (o de migração, que cria os
// schemas dos módulos e o do pg-boss) e todo schema que a aplicação usa. Isso
// só amplia o conjunto: um schema a mais pode parar o deploy, nunca liberá-lo.
//
// Nos mesmos schemas, o release confere também o catálogo depois das migrações
// (S33, `problemasNoCatalogo`): o verificador de migrações lê o SQL, e o que
// ele não enxergar (texto dinâmico, um `$tag$` lido de outro jeito) aparece
// aqui no estado real do banco.
import pg from 'pg';
import { PAPEL_DA_APLICACAO, SCHEMA_DO_PG_BOSS } from './pg-boss.ts';

/** Papéis da API de dados do Supabase. */
export const PAPEIS_DO_SUPABASE: readonly string[] = ['anon', 'authenticated'];

/** Piso dos schemas que esses papéis não podem usar (ver `schemasDoBairrin`). */
export const SCHEMAS_FECHADOS: readonly string[] = [
  'public',
  'compartilhado',
  'migracoes',
  SCHEMA_DO_PG_BOSS,
];

/**
 * Schemas do Bairrin, em ordem: o piso `SCHEMAS_FECHADOS`, os schemas cujo dono
 * é o papel conectado (`current_user`) e os schemas em que `bairrin_app` tem
 * USAGE (direto ou por PUBLIC), sem os do sistema (`pg_*` e
 * `information_schema`). Precisa rodar com o papel de migração: como
 * `postgres`, no Supabase, entram os schemas da plataforma e a checagem falha
 * fechada.
 */
export async function schemasDoBairrin(cliente: Pick<pg.Client, 'query'>): Promise<string[]> {
  const { rows } = await cliente.query<{ schema: string }>(
    `SELECT n.nspname AS schema
       FROM pg_namespace n
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        AND (n.nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
             OR EXISTS (SELECT FROM pg_roles a
                         WHERE a.rolname = $1
                           AND has_schema_privilege(a.oid, n.oid, 'USAGE')))`,
    [PAPEL_DA_APLICACAO],
  );
  const schemas = new Set([...SCHEMAS_FECHADOS, ...rows.map(({ schema }) => schema)]);
  return [...schemas].sort();
}

export interface AcessoIndevido {
  papel: string;
  schema: string;
}

/**
 * Pares papel/schema com USAGE ou CREATE, direto ou herdado de PUBLIC ou de
 * outro papel (`has_schema_privilege`). Lista vazia: tudo fechado. Sem lista
 * de schemas, confere os de `schemasDoBairrin`.
 */
export async function acessosIndevidos(
  cliente: Pick<pg.Client, 'query'>,
  papeis: readonly string[] = PAPEIS_DO_SUPABASE,
  schemas?: readonly string[],
): Promise<AcessoIndevido[]> {
  const conferidos = schemas ?? (await schemasDoBairrin(cliente));
  const { rows } = await cliente.query<AcessoIndevido>(
    `SELECT r.rolname AS papel, s.nspname AS schema
       FROM pg_roles r CROSS JOIN pg_namespace s
      WHERE r.rolname = ANY($1::text[]) AND s.nspname = ANY($2::text[])
        AND has_schema_privilege(r.oid, s.oid, 'USAGE, CREATE')
      ORDER BY 1, 2`,
    [papeis, conferidos],
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

/** Conecta com a URL de migração, executa e desconecta. */
async function comClienteDeMigracao(
  urlDeMigracao: string,
  executar: (cliente: pg.Client) => Promise<void>,
): Promise<void> {
  const cliente = new pg.Client({
    connectionString: urlDeMigracao,
    connectionTimeoutMillis: 5_000,
  });
  await cliente.connect();
  try {
    await executar(cliente);
  } finally {
    await cliente.end();
  }
}

/** Conecta com a URL de migração e rejeita com `SchemasAbertosAoSupabase` se houver acesso. */
export async function exigirSchemasFechados(urlDeMigracao: string): Promise<void> {
  await comClienteDeMigracao(urlDeMigracao, async (cliente) => {
    const acessos = await acessosIndevidos(cliente);
    if (acessos.length > 0) throw new SchemasAbertosAoSupabase(acessos);
  });
}

/**
 * Papéis que nenhuma política de RLS pode citar (S33): os da API de dados do
 * Supabase. O `service_role` ignora RLS lá, mas política para ele indica
 * engano. PUBLIC (oid 0 em `pg_policy.polroles`) é conferido à parte.
 */
export const PAPEIS_FORA_DAS_POLITICAS: readonly string[] = [...PAPEIS_DO_SUPABASE, 'service_role'];

/**
 * Única tabela sem RLS aceita: o controle do Prisma, no schema `migracoes`,
 * criado pelo próprio Prisma e sem nenhum acesso da aplicação.
 */
export const TABELA_DE_CONTROLE_DO_PRISMA = 'migracoes._prisma_migrations';

/** Triggers que fazem da auditoria somente acréscimo (migração do núcleo, S3). */
export const TRIGGERS_DA_AUDITORIA: readonly string[] = [
  'auditoria_sem_truncate',
  'auditoria_sem_update_delete',
];

/** Papel de migração (infra/postgres/init/01-papeis.sql): dono dos schemas e dos objetos. */
export const PAPEL_DE_MIGRACAO = 'bairrin_migracao';

/**
 * Únicos papéis que recebem privilégio nos objetos do Bairrin, além do dono de
 * cada objeto (P8 do 01b): a aplicação e o papel de migração.
 */
export const PAPEIS_COM_PRIVILEGIO: readonly string[] = [PAPEL_DA_APLICACAO, PAPEL_DE_MIGRACAO];

/** Regras conferidas no catálogo (S33), na ordem da mensagem. */
export type RegraDoCatalogo =
  | 'dono-e-a-aplicacao'
  | 'dono-fora-dos-papeis'
  | 'create-da-aplicacao'
  | 'tabela-sem-rls'
  | 'politica-para-papel-proibido'
  | 'trigger-da-auditoria'
  | 'regra-de-reescrita'
  | 'grant-option-da-aplicacao'
  | 'privilegio-para-outro-papel'
  | 'view-sem-security-invoker';

export interface ProblemaNoCatalogo {
  regra: RegraDoCatalogo;
  objeto: string;
}

export interface OpcoesDoCatalogo {
  /** Schemas conferidos; sem lista, os de `schemasDoBairrin`. */
  schemas?: readonly string[];
  /** Papéis proibidos nas políticas; sem lista, `PAPEIS_FORA_DAS_POLITICAS`. */
  papeisForaDasPoliticas?: readonly string[];
  /**
   * Papéis que podem receber privilégio (`privilegio-para-outro-papel`); sem
   * lista, `PAPEIS_COM_PRIVILEGIO`. Papel que não existe é ignorado.
   */
  papeisPermitidos?: readonly string[];
}

/**
 * Uma linha por objeto fora das regras, nos schemas conferidos:
 * - `dono-e-a-aplicacao`: schema, relação, função ou tipo cujo dono é
 *   `bairrin_app` (ou papel de que ele é membro); o dono ignora RLS e GRANTs;
 * - `dono-fora-dos-papeis` (R29 e S76 do 01b): relação, função ou tipo, num
 *   schema cujo dono é `PAPEL_DE_MIGRACAO`, com outro dono que não seja a
 *   aplicação (esse cai na regra anterior). Fecha o que o P8 deixa de fora,
 *   porque ele só confere os objetos de `PAPEL_DE_MIGRACAO`;
 * - `create-da-aplicacao`: `bairrin_app` com CREATE no schema;
 * - `tabela-sem-rls`: tabela comum ou particionada sem RLS ligado (menos
 *   `TABELA_DE_CONTROLE_DO_PRISMA`);
 * - `politica-para-papel-proibido`: política para PUBLIC ou para um dos
 *   papéis proibidos (papel que não existe é ignorado);
 * - `trigger-da-auditoria`: trigger de `TRIGGERS_DA_AUDITORIA` ausente ou com
 *   `tgenabled` diferente de `O` (desligado, só em réplica ou sempre);
 * - `regra-de-reescrita`: regra em `pg_rewrite` que não seja o `_RETURN` de
 *   uma view (`CREATE RULE` roda com os privilégios do dono da tabela);
 * - `grant-option-da-aplicacao`: privilégio com `WITH GRANT OPTION` para
 *   `bairrin_app` (S34) em schema, relação, coluna, função, tipo, no banco ou
 *   em privilégio padrão;
 * - `privilegio-para-outro-papel` (P8 do 01b): entrada da ACL de schema,
 *   relação, coluna, função ou tipo cujo dono é `PAPEL_DE_MIGRACAO`, ou de
 *   privilégio padrão definido por ele, para papel que não seja o dono nem um
 *   de `PAPEIS_COM_PRIVILEGIO`; PUBLIC conta como outro papel. O objeto sai
 *   como `<objeto> para <papel>`. Ficam de fora o banco (no Supabase outros
 *   papéis têm CONNECT) e os objetos de outros donos (R29): o `public` do
 *   Supabase, do `pg_database_owner`, dá USAGE a `postgres` e `service_role`, e
 *   ali `acessosIndevidos` continua barrando `anon`, `authenticated` e PUBLIC;
 *   dentro dos schemas do Bairrin, objeto de outro dono cai em
 *   `dono-fora-dos-papeis`. Só a ACL explícita conta, menos na função
 *   `SECURITY DEFINER` (S72): com ACL nula (o padrão do Postgres), função e
 *   tipo dão EXECUTE e USAGE a PUBLIC sem entrada, e só na `SECURITY DEFINER`
 *   a ACL nula vale como a padrão (`acldefault`), que aponta PUBLIC. Nas
 *   outras, o primeiro GRANT grava essa entrada, e então a migração precisa do
 *   `REVOKE ... FROM PUBLIC`. Aplicar o padrão a tudo reprovaria os tipos de
 *   linha e as funções do pg-boss;
 * - `view-sem-security-invoker`: view sem `security_invoker=true` (lê as
 *   tabelas com os privilégios do dono, que ignora RLS).
 * Lista vazia: catálogo dentro das regras.
 */
export async function problemasNoCatalogo(
  cliente: Pick<pg.Client, 'query'>,
  opcoes: OpcoesDoCatalogo = {},
): Promise<ProblemaNoCatalogo[]> {
  const schemas = opcoes.schemas ?? (await schemasDoBairrin(cliente));
  const { rows } = await cliente.query<ProblemaNoCatalogo>(
    `WITH app AS (SELECT oid FROM pg_roles WHERE rolname = $2),
          mig AS (SELECT oid FROM pg_roles WHERE rolname = $7),
          ns AS (SELECT oid, nspname, nspowner, nspacl FROM pg_namespace
                  WHERE nspname = ANY($1::text[])),
          rel AS (SELECT c.*, ns.nspname || '.' || c.relname AS nome, ns.nspowner AS dono_do_schema
                    FROM pg_class c JOIN ns ON ns.oid = c.relnamespace),
          -- ACLs explícitas (NULL = padrão do Postgres, sem entrada) com o dono de cada
          -- objeto. Na função SECURITY DEFINER, a ACL nula vira a padrão, com EXECUTE
          -- para PUBLIC (S72).
          acls AS (
            SELECT 'schema ' || ns.nspname AS objeto, ns.nspowner AS dono, ns.nspacl AS acl,
                   'objeto' AS fonte
              FROM ns
            UNION ALL
            SELECT 'relação ' || rel.nome, rel.relowner, rel.relacl, 'objeto' FROM rel
            UNION ALL
            SELECT 'coluna ' || rel.nome || '.' || a.attname, rel.relowner, a.attacl, 'objeto'
              FROM pg_attribute a JOIN rel ON rel.oid = a.attrelid
             WHERE a.attacl IS NOT NULL
            UNION ALL
            SELECT 'função ' || p.oid::regprocedure::text, p.proowner,
                   CASE WHEN p.prosecdef THEN coalesce(p.proacl, acldefault('f', p.proowner))
                        ELSE p.proacl END,
                   'objeto'
              FROM pg_proc p JOIN ns ON ns.oid = p.pronamespace
            UNION ALL
            SELECT 'tipo ' || ns.nspname || '.' || t.typname, t.typowner, t.typacl, 'objeto'
              FROM pg_type t JOIN ns ON ns.oid = t.typnamespace
            UNION ALL
            SELECT 'banco ' || d.datname, d.datdba, d.datacl, 'banco' FROM pg_database d
             WHERE d.datname = current_database()
            UNION ALL
            SELECT 'privilégio padrão de ' || pg_get_userbyid(d.defaclrole), d.defaclrole,
                   d.defaclacl, 'padrao'
              FROM pg_default_acl d
             WHERE d.defaclnamespace = 0 OR d.defaclnamespace IN (SELECT oid FROM ns)),
          problemas AS (
            SELECT 'dono-e-a-aplicacao' AS regra, 'schema ' || ns.nspname AS objeto
              FROM ns, app WHERE pg_has_role(app.oid, ns.nspowner, 'MEMBER')
            UNION ALL
            SELECT 'dono-e-a-aplicacao', 'relação ' || rel.nome
              FROM rel, app WHERE pg_has_role(app.oid, rel.relowner, 'MEMBER')
            UNION ALL
            SELECT 'dono-e-a-aplicacao', 'função ' || p.oid::regprocedure::text
              FROM pg_proc p JOIN ns ON ns.oid = p.pronamespace, app
             WHERE pg_has_role(app.oid, p.proowner, 'MEMBER')
            UNION ALL
            -- Tipos de relação e de array vêm junto da relação ou do tipo base.
            SELECT 'dono-e-a-aplicacao', 'tipo ' || ns.nspname || '.' || t.typname
              FROM pg_type t JOIN ns ON ns.oid = t.typnamespace, app
             WHERE t.typrelid = 0 AND t.typcategory <> 'A'
               AND pg_has_role(app.oid, t.typowner, 'MEMBER')
            UNION ALL
            -- Num schema de bairrin_migracao, outro dono só se o objeto não for da
            -- aplicação (esse já sai em dono-e-a-aplicacao). Sem a aplicação no
            -- banco, todo dono de fora é apontado.
            SELECT 'dono-fora-dos-papeis', 'relação ' || rel.nome
              FROM rel JOIN mig ON mig.oid = rel.dono_do_schema
             WHERE rel.relowner <> mig.oid
               AND NOT EXISTS (SELECT FROM app WHERE pg_has_role(app.oid, rel.relowner, 'MEMBER'))
            UNION ALL
            SELECT 'dono-fora-dos-papeis', 'função ' || p.oid::regprocedure::text
              FROM pg_proc p JOIN ns ON ns.oid = p.pronamespace JOIN mig ON mig.oid = ns.nspowner
             WHERE p.proowner <> mig.oid
               AND NOT EXISTS (SELECT FROM app WHERE pg_has_role(app.oid, p.proowner, 'MEMBER'))
            UNION ALL
            SELECT 'dono-fora-dos-papeis', 'tipo ' || ns.nspname || '.' || t.typname
              FROM pg_type t JOIN ns ON ns.oid = t.typnamespace JOIN mig ON mig.oid = ns.nspowner
             WHERE t.typrelid = 0 AND t.typcategory <> 'A' AND t.typowner <> mig.oid
               AND NOT EXISTS (SELECT FROM app WHERE pg_has_role(app.oid, t.typowner, 'MEMBER'))
            UNION ALL
            SELECT 'create-da-aplicacao', 'schema ' || ns.nspname
              FROM ns, app WHERE has_schema_privilege(app.oid, ns.oid, 'CREATE')
            UNION ALL
            SELECT 'tabela-sem-rls', rel.nome FROM rel
             WHERE rel.relkind IN ('r', 'p') AND NOT rel.relrowsecurity AND rel.nome <> $4
            UNION ALL
            SELECT 'politica-para-papel-proibido', rel.nome || ' (' || pol.polname || ')'
              FROM pg_policy pol JOIN rel ON rel.oid = pol.polrelid
             WHERE 0::oid = ANY(pol.polroles)
                OR EXISTS (SELECT FROM pg_roles r
                            WHERE r.oid = ANY(pol.polroles) AND r.rolname = ANY($3::text[]))
            UNION ALL
            SELECT 'trigger-da-auditoria', 'compartilhado.auditoria (' || e.nome || ' ausente)'
              FROM unnest($5::text[]) AS e(nome)
             WHERE NOT EXISTS (SELECT FROM pg_trigger t
                                WHERE t.tgrelid = to_regclass('compartilhado.auditoria')
                                  AND t.tgname = e.nome)
            UNION ALL
            SELECT 'trigger-da-auditoria',
                   'compartilhado.auditoria (' || t.tgname || ' com tgenabled ' || t.tgenabled::text || ')'
              FROM pg_trigger t
             WHERE t.tgrelid = to_regclass('compartilhado.auditoria')
               AND t.tgname = ANY($5::text[]) AND t.tgenabled <> 'O'
            UNION ALL
            SELECT 'regra-de-reescrita', rel.nome || ' (' || r.rulename || ')'
              FROM pg_rewrite r JOIN rel ON rel.oid = r.ev_class
             WHERE NOT (rel.relkind IN ('v', 'm') AND r.rulename = '_RETURN')
            UNION ALL
            SELECT DISTINCT 'grant-option-da-aplicacao', a.objeto
              FROM acls a, aclexplode(a.acl) x, app
             WHERE x.is_grantable
               AND CASE WHEN x.grantee = 0 THEN false
                        ELSE pg_has_role(app.oid, x.grantee, 'MEMBER') END
            UNION ALL
            -- Só objeto e privilégio padrão de bairrin_migracao (R29): o banco fica de
            -- fora (no Supabase outros papéis têm CONNECT), e o public do Supabase, de
            -- outro dono, dá USAGE a papéis da plataforma. PUBLIC (grantee 0) conta
            -- como outro papel.
            SELECT DISTINCT 'privilegio-para-outro-papel',
                   a.objeto || ' para '
                     || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END
              FROM acls a JOIN mig ON mig.oid = a.dono, aclexplode(a.acl) x
             WHERE a.fonte <> 'banco'
               AND x.grantee <> a.dono
               AND (x.grantee = 0
                    OR x.grantee NOT IN (SELECT oid FROM pg_roles WHERE rolname = ANY($6::text[])))
            UNION ALL
            SELECT 'view-sem-security-invoker', rel.nome FROM rel
             WHERE rel.relkind = 'v'
               AND NOT EXISTS (SELECT FROM pg_options_to_table(rel.reloptions) op
                                WHERE op.option_name = 'security_invoker'
                                  AND op.option_value::boolean))
     SELECT regra, objeto FROM problemas ORDER BY 1, 2`,
    [
      schemas,
      PAPEL_DA_APLICACAO,
      opcoes.papeisForaDasPoliticas ?? PAPEIS_FORA_DAS_POLITICAS,
      TABELA_DE_CONTROLE_DO_PRISMA,
      TRIGGERS_DA_AUDITORIA,
      opcoes.papeisPermitidos ?? PAPEIS_COM_PRIVILEGIO,
      PAPEL_DE_MIGRACAO,
    ],
  );
  return rows;
}

/** O catálogo tem objeto fora das regras de `problemasNoCatalogo`: o release para. */
export class CatalogoForaDasRegras extends Error {
  constructor(readonly problemas: readonly ProblemaNoCatalogo[]) {
    super(
      'Catálogo do banco fora das regras depois das migrações (S33): ' +
        problemas.map(({ regra, objeto }) => `${regra}: ${objeto}`).join('; ') +
        '. Corrija com uma migração nova (ou como postgres) antes de seguir com o deploy.',
    );
    this.name = 'CatalogoForaDasRegras';
  }
}

/** Conecta com a URL de migração e rejeita com `CatalogoForaDasRegras` se houver problema. */
export async function exigirCatalogoNasRegras(urlDeMigracao: string): Promise<void> {
  await comClienteDeMigracao(urlDeMigracao, async (cliente) => {
    const problemas = await problemasNoCatalogo(cliente);
    if (problemas.length > 0) throw new CatalogoForaDasRegras(problemas);
  });
}
