// Integração da migração do núcleo (CA-F4; S2 e S3): o banco de teste foi
// recriado e migrado pelo `globalSetup` (preparar-banco.ts) com o papel de
// migração. Aqui se confere o resultado com os dois papéis de verdade.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acessosIndevidos,
  CatalogoForaDasRegras,
  exigirCatalogoNasRegras,
  exigirSchemasFechados,
  type ProblemaNoCatalogo,
  problemasNoCatalogo,
  SCHEMAS_FECHADOS,
  SchemasAbertosAoSupabase,
  schemasDoBairrin,
} from '../../src/compartilhado/infra/schemas-fechados.ts';
import { URL_APP_TESTE, URL_MIGRACAO_TESTE } from './preparar-banco.ts';

const TABELAS_DO_NUCLEO = ['auditoria', 'configuracoes', 'eventos_processados', 'outbox'];

/** Schemas do sistema e o de controle do Prisma, fora da regra de RLS. */
const SCHEMAS_DO_SISTEMA = ['pg_catalog', 'information_schema', 'pg_toast'];

let dono: pg.Client;
let app: pg.Client;

beforeAll(async () => {
  dono = new pg.Client({ connectionString: URL_MIGRACAO_TESTE });
  app = new pg.Client({ connectionString: URL_APP_TESTE });
  await Promise.all([dono.connect(), app.connect()]);
});

afterAll(async () => {
  await Promise.all([dono?.end(), app?.end()]);
});

/** Erro do Postgres esperado: devolve código e mensagem para o `expect`. */
async function falhaDe(consulta: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await consulta;
  } catch (erro) {
    return erro as { code?: string; message: string };
  }
  throw new Error('A consulta deveria ter falhado.');
}

async function inserirAuditoria(cliente: pg.Client, acao: string): Promise<string> {
  const { rows } = await cliente.query<{ id: string }>(
    `INSERT INTO compartilhado.auditoria (ator_tipo, acao, recurso, recurso_id, depois, origem, ocorrido_em)
     VALUES ('sistema', $1, 'teste', 'r-1', '{"ativo": true}', 'teste', now())
     RETURNING id`,
    [acao],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('INSERT sem id');
  return id;
}

async function contarAuditoria(id: string): Promise<number> {
  const { rows } = await dono.query<{ total: number }>(
    'SELECT count(*)::int AS total FROM compartilhado.auditoria WHERE id = $1',
    [id],
  );
  return rows[0]?.total ?? -1;
}

describe('estrutura criada pela migração', () => {
  it('cria as quatro tabelas no schema compartilhado, com RLS ligado e sem FORCE', async () => {
    const { rows } = await dono.query<{ tabela: string; rls: boolean; forcado: boolean }>(
      `SELECT c.relname AS tabela, c.relrowsecurity AS rls, c.relforcerowsecurity AS forcado
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'compartilhado' AND c.relkind IN ('r', 'p')
        ORDER BY 1`,
    );
    expect(rows).toEqual(
      TABELAS_DO_NUCLEO.map((tabela) => ({ tabela, rls: true, forcado: false })),
    );
  });

  it('não cria nada no schema public (tabela, função, tipo ou sequência)', async () => {
    const { rows } = await dono.query<{ objeto: string }>(
      `SELECT c.relname AS objeto FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
       UNION ALL
       SELECT p.proname FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
       UNION ALL
       SELECT t.typname FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'`,
    );
    expect(rows).toEqual([]);
  });

  it('guarda o controle do Prisma no schema migracoes, fora do alcance da aplicação', async () => {
    const { rows } = await dono.query<{ schema: string }>(
      `SELECT table_schema AS schema FROM information_schema.tables
        WHERE table_name = '_prisma_migrations'`,
    );
    expect(rows).toEqual([{ schema: 'migracoes' }]);
    const acesso = await dono.query<{ uso: boolean }>(
      "SELECT has_schema_privilege('bairrin_app', 'migracoes', 'USAGE') AS uso",
    );
    expect(acesso.rows[0]?.uso).toBe(false);
  });

  it('liga RLS em toda tabela de schema da aplicação', async () => {
    const { rows } = await dono.query<{ tabela: string }>(
      `SELECT n.nspname || '.' || c.relname AS tabela
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
          AND n.nspname <> 'migracoes' AND n.nspname <> ALL($1::text[])`,
      [SCHEMAS_DO_SISTEMA],
    );
    expect(rows).toEqual([]);
  });

  it('tem política só para bairrin_app em cada tabela; nas de acréscimo, só SELECT e INSERT', async () => {
    const { rows } = await dono.query<{ tabela: string; comando: string; papeis: string[] }>(
      `SELECT tablename AS tabela, cmd AS comando, roles::text[] AS papeis FROM pg_policies
        WHERE schemaname = 'compartilhado' ORDER BY 1, 2`,
    );
    const papeis = ['bairrin_app'];
    expect(rows).toEqual([
      { tabela: 'auditoria', comando: 'INSERT', papeis },
      { tabela: 'auditoria', comando: 'SELECT', papeis },
      { tabela: 'configuracoes', comando: 'INSERT', papeis },
      { tabela: 'configuracoes', comando: 'SELECT', papeis },
      { tabela: 'eventos_processados', comando: 'ALL', papeis },
      { tabela: 'outbox', comando: 'ALL', papeis },
    ]);
  });

  it('não dá CREATE à aplicação em nenhum schema nem USAGE em public (Seg-4)', async () => {
    const { rows } = await dono.query<{
      publico: boolean;
      compartilhado: boolean;
      usoDoPublico: boolean;
    }>(
      `SELECT has_schema_privilege('bairrin_app', 'public', 'CREATE') AS publico,
              has_schema_privilege('bairrin_app', 'compartilhado', 'CREATE') AS compartilhado,
              has_schema_privilege('bairrin_app', 'public', 'USAGE') AS "usoDoPublico"`,
    );
    expect(rows[0]).toEqual({ publico: false, compartilhado: false, usoDoPublico: false });
  });

  it('dá DML sem TRUNCATE à aplicação e, na auditoria e nas configurações, só SELECT e INSERT', async () => {
    const { rows } = await dono.query<{ tabela: string; privilegios: string[] }>(
      `SELECT t.tabela,
              array(SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
                     WHERE has_table_privilege('bairrin_app', 'compartilhado.' || t.tabela, p)) AS privilegios
         FROM unnest($1::text[]) AS t(tabela) ORDER BY 1`,
      [TABELAS_DO_NUCLEO],
    );
    const dml = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
    expect(rows).toEqual([
      { tabela: 'auditoria', privilegios: ['SELECT', 'INSERT'] },
      { tabela: 'configuracoes', privilegios: ['SELECT', 'INSERT'] },
      { tabela: 'eventos_processados', privilegios: dml },
      { tabela: 'outbox', privilegios: dml },
    ]);
  });
});

describe('aplicação (bairrin_app) com RLS ligado', () => {
  it('lê, grava, altera e apaga na outbox pela política', async () => {
    const { rows } = await app.query<{ id: string }>(
      `INSERT INTO compartilhado.outbox (tipo, versao, agregado_id, payload, ocorrido_em)
       VALUES ('teste.criado', 1, gen_random_uuid(), '{}', now()) RETURNING id`,
    );
    const id = rows[0]?.id;
    const alterada = await app.query(
      'UPDATE compartilhado.outbox SET publicado_em = now() WHERE id = $1',
      [id],
    );
    expect(alterada.rowCount).toBe(1);
    const apagada = await app.query('DELETE FROM compartilhado.outbox WHERE id = $1', [id]);
    expect(apagada.rowCount).toBe(1);
  });

  it('não consegue TRUNCATE nas tabelas com DML', async () => {
    const erro = await falhaDe(app.query('TRUNCATE compartilhado.outbox'));
    expect(erro.code).toBe('42501');
  });
});

describe('configurações versionadas (S28)', () => {
  async function inserirConfiguracao(): Promise<string> {
    const { rows } = await app.query<{ id: string }>(
      `INSERT INTO compartilhado.configuracoes (chave, valor, vigente_desde, criado_em)
       VALUES ('teste.taxa', '{"centavos": 100}', now(), now()) RETURNING id`,
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('INSERT sem id');
    return id;
  }

  it('a aplicação inclui e lê uma versão nova', async () => {
    const id = await inserirConfiguracao();
    const { rowCount } = await app.query(
      'SELECT 1 FROM compartilhado.configuracoes WHERE id = $1',
      [id],
    );
    expect(rowCount).toBe(1);
  });

  it.each([
    ['UPDATE', `UPDATE compartilhado.configuracoes SET valor = '{"centavos": 1}' WHERE id = $1`],
    ['DELETE', 'DELETE FROM compartilhado.configuracoes WHERE id = $1'],
  ])('%s pela aplicação é recusado', async (_operacao, sql) => {
    const id = await inserirConfiguracao();
    const erro = await falhaDe(app.query(sql, [id]));
    expect(erro.code).toBe('42501');
  });

  it('com um GRANT de UPDATE e DELETE dado por engano, o RLS ainda não deixa alterar (S29)', async () => {
    const id = await inserirConfiguracao();
    await dono.query('GRANT UPDATE, DELETE ON compartilhado.configuracoes TO bairrin_app');
    try {
      const alterada = await app.query(
        `UPDATE compartilhado.configuracoes SET valor = '{"centavos": 1}' WHERE id = $1`,
        [id],
      );
      const apagada = await app.query('DELETE FROM compartilhado.configuracoes WHERE id = $1', [
        id,
      ]);
      expect([alterada.rowCount, apagada.rowCount]).toEqual([0, 0]);
    } finally {
      await dono.query('REVOKE UPDATE, DELETE ON compartilhado.configuracoes FROM bairrin_app');
    }
    const { rows } = await dono.query<{ valor: unknown }>(
      'SELECT valor FROM compartilhado.configuracoes WHERE id = $1',
      [id],
    );
    expect(rows).toEqual([{ valor: { centavos: 100 } }]);
  });
});

describe('auditoria somente acréscimo (S3)', () => {
  it('aceita INSERT e SELECT da aplicação', async () => {
    const id = await inserirAuditoria(app, 'criar');
    const { rowCount } = await app.query('SELECT 1 FROM compartilhado.auditoria WHERE id = $1', [
      id,
    ]);
    expect(rowCount).toBe(1);
  });

  describe('com o papel da aplicação: falha por falta de privilégio', () => {
    it.each([
      ['UPDATE', "UPDATE compartilhado.auditoria SET acao = 'adulterada' WHERE id = $1"],
      ['DELETE', 'DELETE FROM compartilhado.auditoria WHERE id = $1'],
    ])('%s é recusado', async (_operacao, sql) => {
      const id = await inserirAuditoria(app, 'criar');
      const erro = await falhaDe(app.query(sql, [id]));
      expect(erro.code).toBe('42501');
      expect(await contarAuditoria(id)).toBe(1);
    });

    it('TRUNCATE é recusado', async () => {
      const id = await inserirAuditoria(app, 'criar');
      const erro = await falhaDe(app.query('TRUNCATE compartilhado.auditoria'));
      expect(erro.code).toBe('42501');
      expect(await contarAuditoria(id)).toBe(1);
    });
  });

  describe('contornos pelo papel da aplicação', () => {
    it('INSERT ... ON CONFLICT DO UPDATE é recusado (exigiria UPDATE)', async () => {
      const id = await inserirAuditoria(app, 'criar');
      const erro = await falhaDe(
        app.query(
          `INSERT INTO compartilhado.auditoria
             (id, ator_tipo, ator_id, acao, recurso, recurso_id, origem, ocorrido_em)
           VALUES ($1, 'sistema', NULL, 'adulterada', 'teste', 'x', 'worker', now())
           ON CONFLICT (id) DO UPDATE SET acao = EXCLUDED.acao`,
          [id],
        ),
      );
      expect(erro.code).toBe('42501');
      const { rows } = await app.query<{ acao: string }>(
        'SELECT acao FROM compartilhado.auditoria WHERE id = $1',
        [id],
      );
      expect(rows[0]?.acao).toBe('criar');
    });

    it('SELECT ... FOR UPDATE é recusado (travar linha exige UPDATE)', async () => {
      const id = await inserirAuditoria(app, 'criar');
      const erro = await falhaDe(
        app.query('SELECT id FROM compartilhado.auditoria WHERE id = $1 FOR UPDATE', [id]),
      );
      expect(erro.code).toBe('42501');
    });

    it.each([
      ['desligar o trigger', 'ALTER TABLE compartilhado.auditoria DISABLE TRIGGER ALL'],
      ['remover o trigger', 'DROP TRIGGER auditoria_sem_truncate ON compartilhado.auditoria'],
      ['pular triggers com session_replication_role', "SET session_replication_role = 'replica'"],
      ['apagar a tabela', 'DROP TABLE compartilhado.auditoria'],
    ])('não consegue %s', async (_nome, sql) => {
      const id = await inserirAuditoria(app, 'criar');
      const erro = await falhaDe(app.query(sql));
      expect(erro.code).toBe('42501');
      expect(await contarAuditoria(id)).toBe(1);
    });
  });

  describe('com o dono (bairrin_migracao): falha pelo trigger', () => {
    it.each([
      ['UPDATE', "UPDATE compartilhado.auditoria SET acao = 'adulterada' WHERE id = $1"],
      ['DELETE', 'DELETE FROM compartilhado.auditoria WHERE id = $1'],
    ])('%s é recusado', async (operacao, sql) => {
      const id = await inserirAuditoria(dono, 'criar');
      const erro = await falhaDe(dono.query(sql, [id]));
      expect(erro.code).toBe('P0001');
      expect(erro.message).toContain(`somente acréscimo: ${operacao} recusado`);
      expect(await contarAuditoria(id)).toBe(1);
    });

    it('UPDATE e DELETE sem linha afetada também são recusados', async () => {
      const semLinha = '00000000-0000-0000-0000-000000000000';
      for (const sql of [
        "UPDATE compartilhado.auditoria SET acao = 'x' WHERE id = $1",
        'DELETE FROM compartilhado.auditoria WHERE id = $1',
      ]) {
        const erro = await falhaDe(dono.query(sql, [semLinha]));
        expect(erro.code).toBe('P0001');
      }
    });

    it('TRUNCATE junto com outra tabela é recusado e a outra tabela não perde linhas', async () => {
      const id = await inserirAuditoria(dono, 'criar');
      await dono.query(
        `INSERT INTO compartilhado.outbox (tipo, versao, agregado_id, payload, ocorrido_em)
         VALUES ('teste.Truncado', 1, gen_random_uuid(), '{}', now())`,
      );
      const erro = await falhaDe(
        dono.query('TRUNCATE compartilhado.outbox, compartilhado.auditoria'),
      );
      expect(erro.code).toBe('P0001');
      expect(await contarAuditoria(id)).toBe(1);
      const { rows } = await dono.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM compartilhado.outbox WHERE tipo = 'teste.Truncado'",
      );
      expect(rows[0]?.total).toBe(1);
      await dono.query("DELETE FROM compartilhado.outbox WHERE tipo = 'teste.Truncado'");
    });

    it('não consegue pular o trigger com session_replication_role (não é superusuário)', async () => {
      const id = await inserirAuditoria(dono, 'criar');
      const erro = await falhaDe(dono.query("SET session_replication_role = 'replica'"));
      expect(erro.code).toBe('42501');
      expect(await contarAuditoria(id)).toBe(1);
    });

    it('TRUNCATE é recusado', async () => {
      const id = await inserirAuditoria(dono, 'criar');
      const erro = await falhaDe(dono.query('TRUNCATE compartilhado.auditoria'));
      expect(erro.code).toBe('P0001');
      expect(erro.message).toContain('somente acréscimo: TRUNCATE recusado');
      expect(await contarAuditoria(id)).toBe(1);
    });
  });
});

describe('schemas fechados aos papéis do Supabase (S26)', () => {
  it('passa no Postgres local, onde anon e authenticated não existem', async () => {
    expect(await acessosIndevidos(dono)).toEqual([]);
    await expect(exigirSchemasFechados(URL_MIGRACAO_TESTE)).resolves.toBeUndefined();
  });

  it('acha o papel que enxerga o schema e ignora papel e schema inexistentes', async () => {
    // `bairrin_app` faz o papel de um anon com USAGE: ele tem USAGE em compartilhado.
    const acessos = await acessosIndevidos(
      dono,
      ['bairrin_app', 'papel_que_nao_existe'],
      ['compartilhado', 'migracoes', 'schema_que_nao_existe'],
    );
    expect(acessos).toEqual([{ papel: 'bairrin_app', schema: 'compartilhado' }]);
    expect(new SchemasAbertosAoSupabase(acessos).message).toContain('bairrin_app em compartilhado');
  });

  it('schemasDoBairrin tem o piso e os schemas do dono, sem os do sistema (Seg-3)', async () => {
    const schemas = await schemasDoBairrin(dono);
    expect(schemas).toEqual(expect.arrayContaining([...SCHEMAS_FECHADOS]));
    for (const doSistema of ['pg_catalog', 'pg_toast', 'information_schema']) {
      expect(schemas).not.toContain(doSistema);
    }
    expect(schemas.some((schema) => schema.startsWith('pg_'))).toBe(false);
  });

  describe('schema novo, sem editar a lista (Seg-3)', () => {
    const COM_USO = 'teste_seg3_com_uso';
    const SEM_USO = 'teste_seg3_sem_uso';

    beforeAll(async () => {
      await dono.query(`CREATE SCHEMA ${COM_USO}`);
      await dono.query(`CREATE SCHEMA ${SEM_USO}`);
      await dono.query(`GRANT USAGE ON SCHEMA ${COM_USO} TO bairrin_app`);
    });

    afterAll(async () => {
      await dono?.query(`DROP SCHEMA IF EXISTS ${COM_USO}, ${SEM_USO} CASCADE`);
    });

    it('o schema do dono com USAGE da aplicação aparece em acessosIndevidos sem lista', async () => {
      const acessos = await acessosIndevidos(dono, ['bairrin_app']);
      expect(acessos).toContainEqual({ papel: 'bairrin_app', schema: COM_USO });
      expect(acessos).not.toContainEqual({ papel: 'bairrin_app', schema: SEM_USO });
    });

    it('entra pelo dono (conectado como dono) e pelo USAGE da aplicação (conectado como app)', async () => {
      expect(await schemasDoBairrin(dono)).toEqual(expect.arrayContaining([COM_USO, SEM_USO]));
      // `bairrin_app` não é dono de nada: só a regra do USAGE traz o schema.
      const daAplicacao = await schemasDoBairrin(app);
      expect(daAplicacao).toContain(COM_USO);
      expect(daAplicacao).not.toContain(SEM_USO);
    });
  });

  describe('schema com USAGE só por PUBLIC (Seg-3, QA)', () => {
    const POR_PUBLIC = 'teste_seg3_por_public';

    beforeAll(async () => {
      await dono.query(`CREATE SCHEMA ${POR_PUBLIC}`);
      await dono.query(`GRANT USAGE ON SCHEMA ${POR_PUBLIC} TO PUBLIC`);
    });

    afterAll(async () => {
      await dono?.query(`DROP SCHEMA IF EXISTS ${POR_PUBLIC} CASCADE`);
    });

    it('a aplicação o enxerga por PUBLIC, então ele entra e é apontado, sem lista de schemas', async () => {
      expect(await schemasDoBairrin(app)).toContain(POR_PUBLIC);
      expect(await acessosIndevidos(dono, ['bairrin_app'])).toContainEqual({
        papel: 'bairrin_app',
        schema: POR_PUBLIC,
      });
    });
  });
});

describe('catálogo conferido no release (S33)', () => {
  const SCHEMA = 'teste_s33';

  beforeAll(async () => {
    // Do dono: entra em `schemasDoBairrin` sem lista.
    await dono.query(`CREATE SCHEMA ${SCHEMA}`);
  });

  afterAll(async () => {
    // O dono do schema apaga tudo dentro dele, inclusive o que é da aplicação.
    await dono?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  });

  /**
   * Executa o SQL numa transação do dono, confere o catálogo dentro dela e
   * desfaz tudo no fim, passe ou não.
   */
  async function problemasCom(
    sql: readonly string[],
    opcoes?: Parameters<typeof problemasNoCatalogo>[1],
  ): Promise<ProblemaNoCatalogo[]> {
    await dono.query('BEGIN');
    try {
      for (const comando of sql) await dono.query(comando);
      return await problemasNoCatalogo(dono, opcoes);
    } finally {
      await dono.query('ROLLBACK');
    }
  }

  /** Tabela com RLS e política só para a aplicação: dentro das regras. */
  const tabelaCerta = (nome: string) => [
    `CREATE TABLE ${SCHEMA}.${nome} (x int)`,
    `ALTER TABLE ${SCHEMA}.${nome} ENABLE ROW LEVEL SECURITY`,
  ];

  it('passa no banco migrado (núcleo e pg-boss)', async () => {
    expect(await problemasNoCatalogo(dono)).toEqual([]);
    await expect(exigirCatalogoNasRegras(URL_MIGRACAO_TESTE)).resolves.toBeUndefined();
  });

  it('passa com tabela com RLS, política só para a aplicação e view com security_invoker', async () => {
    expect(
      await problemasCom([
        ...tabelaCerta('certa'),
        `CREATE POLICY aplicacao ON ${SCHEMA}.certa TO bairrin_app USING (true)`,
        `GRANT SELECT ON ${SCHEMA}.certa TO bairrin_app`,
        `CREATE VIEW ${SCHEMA}.vista WITH (security_invoker = on) AS SELECT x FROM ${SCHEMA}.certa`,
      ]),
    ).toEqual([]);
  });

  it('reprova relação, função e tipo cujo dono é a aplicação', async () => {
    // O dono não pode passar objeto para `bairrin_app` (exigiria SET ROLE):
    // a aplicação cria com um CREATE dado por engano, que é tirado antes da checagem.
    await dono.query(`GRANT USAGE, CREATE ON SCHEMA ${SCHEMA} TO bairrin_app`);
    try {
      await app.query(`CREATE TABLE ${SCHEMA}.da_app (x int)`);
      await app.query(`ALTER TABLE ${SCHEMA}.da_app ENABLE ROW LEVEL SECURITY`);
      await app.query(
        `CREATE FUNCTION ${SCHEMA}.funcao_da_app() RETURNS int LANGUAGE sql AS 'SELECT 1'`,
      );
      await app.query(`CREATE TYPE ${SCHEMA}.tipo_da_app AS ENUM ('a')`);
      await dono.query(`REVOKE CREATE ON SCHEMA ${SCHEMA} FROM bairrin_app`);
      const problemas = await problemasNoCatalogo(dono);
      expect(problemas).toEqual([
        { regra: 'dono-e-a-aplicacao', objeto: `função ${SCHEMA}.funcao_da_app()` },
        { regra: 'dono-e-a-aplicacao', objeto: `relação ${SCHEMA}.da_app` },
        { regra: 'dono-e-a-aplicacao', objeto: `tipo ${SCHEMA}.tipo_da_app` },
      ]);
      await expect(exigirCatalogoNasRegras(URL_MIGRACAO_TESTE)).rejects.toBeInstanceOf(
        CatalogoForaDasRegras,
      );
    } finally {
      await app.query(`DROP TABLE IF EXISTS ${SCHEMA}.da_app`);
      await app.query(`DROP FUNCTION IF EXISTS ${SCHEMA}.funcao_da_app()`);
      await app.query(`DROP TYPE IF EXISTS ${SCHEMA}.tipo_da_app`);
      await dono.query(`REVOKE ALL ON SCHEMA ${SCHEMA} FROM bairrin_app`);
    }
  });

  it('reprova CREATE da aplicação num schema', async () => {
    expect(await problemasCom([`GRANT CREATE ON SCHEMA ${SCHEMA} TO bairrin_app`])).toEqual([
      { regra: 'create-da-aplicacao', objeto: `schema ${SCHEMA}` },
    ]);
  });

  it('reprova tabela comum e particionada sem RLS', async () => {
    expect(
      await problemasCom([
        `CREATE TABLE ${SCHEMA}.sem_rls (x int)`,
        `CREATE TABLE ${SCHEMA}.particionada (x int) PARTITION BY RANGE (x)`,
      ]),
    ).toEqual([
      { regra: 'tabela-sem-rls', objeto: `${SCHEMA}.particionada` },
      { regra: 'tabela-sem-rls', objeto: `${SCHEMA}.sem_rls` },
    ]);
  });

  it('reprova política para PUBLIC, explícita ou sem TO', async () => {
    expect(
      await problemasCom([
        ...tabelaCerta('aberta'),
        `CREATE POLICY para_public ON ${SCHEMA}.aberta TO PUBLIC USING (true)`,
        `CREATE POLICY sem_to ON ${SCHEMA}.aberta USING (true)`,
        `CREATE POLICY varios ON ${SCHEMA}.aberta TO bairrin_app, PUBLIC USING (true)`,
      ]),
    ).toEqual([
      { regra: 'politica-para-papel-proibido', objeto: `${SCHEMA}.aberta (para_public)` },
      { regra: 'politica-para-papel-proibido', objeto: `${SCHEMA}.aberta (sem_to)` },
      { regra: 'politica-para-papel-proibido', objeto: `${SCHEMA}.aberta (varios)` },
    ]);
  });

  it('reprova política para papel proibido e ignora papel que não existe', async () => {
    // `bairrin_app` faz o papel de um `anon` (que não existe no Postgres local).
    const sql = [
      ...tabelaCerta('para_anon'),
      `CREATE POLICY aplicacao ON ${SCHEMA}.para_anon TO bairrin_app USING (true)`,
    ];
    expect(
      // Só o schema do teste: as políticas do núcleo também são para `bairrin_app`.
      await problemasCom(sql, {
        schemas: [SCHEMA],
        papeisForaDasPoliticas: ['bairrin_app', 'papel_que_nao_existe'],
      }),
    ).toEqual([
      { regra: 'politica-para-papel-proibido', objeto: `${SCHEMA}.para_anon (aplicacao)` },
    ]);
    expect(await problemasCom(sql)).toEqual([]);
  });

  it.each([
    [
      'desligada',
      'DISABLE TRIGGER auditoria_sem_truncate',
      'auditoria_sem_truncate com tgenabled D',
    ],
    [
      'só em réplica',
      'ENABLE REPLICA TRIGGER auditoria_sem_update_delete',
      'auditoria_sem_update_delete com tgenabled R',
    ],
    [
      'sempre',
      'ENABLE ALWAYS TRIGGER auditoria_sem_truncate',
      'auditoria_sem_truncate com tgenabled A',
    ],
  ])('reprova trigger da auditoria %s', async (_caso, alteracao, objeto) => {
    expect(await problemasCom([`ALTER TABLE compartilhado.auditoria ${alteracao}`])).toEqual([
      { regra: 'trigger-da-auditoria', objeto: `compartilhado.auditoria (${objeto})` },
    ]);
  });

  it('reprova trigger da auditoria ausente', async () => {
    expect(
      await problemasCom(['DROP TRIGGER auditoria_sem_update_delete ON compartilhado.auditoria']),
    ).toEqual([
      {
        regra: 'trigger-da-auditoria',
        objeto: 'compartilhado.auditoria (auditoria_sem_update_delete ausente)',
      },
    ]);
  });

  it('reprova regra de reescrita em tabela e em view, mas não o `_RETURN` da view', async () => {
    expect(
      await problemasCom([
        ...tabelaCerta('com_regra'),
        `CREATE RULE nada AS ON INSERT TO ${SCHEMA}.com_regra DO INSTEAD NOTHING`,
        `CREATE VIEW ${SCHEMA}.vista WITH (security_invoker) AS SELECT x FROM ${SCHEMA}.com_regra`,
        `CREATE RULE na_vista AS ON INSERT TO ${SCHEMA}.vista DO INSTEAD NOTHING`,
      ]),
    ).toEqual([
      { regra: 'regra-de-reescrita', objeto: `${SCHEMA}.com_regra (nada)` },
      { regra: 'regra-de-reescrita', objeto: `${SCHEMA}.vista (na_vista)` },
    ]);
  });

  it('reprova WITH GRANT OPTION para a aplicação em tabela, coluna, schema e privilégio padrão (S34)', async () => {
    expect(
      await problemasCom([
        ...tabelaCerta('repassavel'),
        `GRANT SELECT ON ${SCHEMA}.repassavel TO bairrin_app WITH GRANT OPTION`,
        ...tabelaCerta('coluna'),
        `GRANT UPDATE (x) ON ${SCHEMA}.coluna TO bairrin_app WITH GRANT OPTION`,
        `GRANT USAGE ON SCHEMA ${SCHEMA} TO bairrin_app WITH GRANT OPTION`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA ${SCHEMA} GRANT SELECT ON TABLES TO bairrin_app WITH GRANT OPTION`,
      ]),
    ).toEqual([
      { regra: 'grant-option-da-aplicacao', objeto: `coluna ${SCHEMA}.coluna.x` },
      { regra: 'grant-option-da-aplicacao', objeto: 'privilégio padrão de bairrin_migracao' },
      { regra: 'grant-option-da-aplicacao', objeto: `relação ${SCHEMA}.repassavel` },
      { regra: 'grant-option-da-aplicacao', objeto: `schema ${SCHEMA}` },
    ]);
  });

  it('reprova WITH GRANT OPTION para a aplicação em função e tipo (S34, QA)', async () => {
    expect(
      await problemasCom([
        `CREATE FUNCTION ${SCHEMA}.repassavel() RETURNS int LANGUAGE sql AS 'SELECT 1'`,
        `GRANT EXECUTE ON FUNCTION ${SCHEMA}.repassavel() TO bairrin_app WITH GRANT OPTION`,
        `CREATE TYPE ${SCHEMA}.repassavel AS ENUM ('a')`,
        `GRANT USAGE ON TYPE ${SCHEMA}.repassavel TO bairrin_app WITH GRANT OPTION`,
      ]),
    ).toEqual([
      { regra: 'grant-option-da-aplicacao', objeto: `função ${SCHEMA}.repassavel()` },
      { regra: 'grant-option-da-aplicacao', objeto: `tipo ${SCHEMA}.repassavel` },
    ]);
  });

  it('o GRANT sem GRANT OPTION para a aplicação não é apontado', async () => {
    expect(
      await problemasCom([
        ...tabelaCerta('sem_repasse'),
        `GRANT SELECT ON ${SCHEMA}.sem_repasse TO bairrin_app`,
        `CREATE FUNCTION ${SCHEMA}.sem_repasse() RETURNS int LANGUAGE sql AS 'SELECT 1'`,
        `GRANT EXECUTE ON FUNCTION ${SCHEMA}.sem_repasse() TO bairrin_app`,
        `GRANT USAGE ON SCHEMA ${SCHEMA} TO bairrin_app`,
      ]),
    ).toEqual([]);
  });

  it('reprova view sem security_invoker ou com ele desligado', async () => {
    expect(
      await problemasCom([
        `CREATE VIEW ${SCHEMA}.sem_invoker AS SELECT 1 AS x`,
        `CREATE VIEW ${SCHEMA}.invoker_desligado WITH (security_invoker = false) AS SELECT 1 AS x`,
      ]),
    ).toEqual([
      { regra: 'view-sem-security-invoker', objeto: `${SCHEMA}.invoker_desligado` },
      { regra: 'view-sem-security-invoker', objeto: `${SCHEMA}.sem_invoker` },
    ]);
  });

  describe('o que só um superusuário cria (QA)', () => {
    // O papel de migração não é dono do banco nem membro de `bairrin_app`: schema da
    // aplicação e GRANT OPTION em banco só se montam como `postgres` (valores locais do
    // `infra/docker-compose.yml`, como em `preparar-banco.ts`).
    const URL_ADMIN_TESTE =
      process.env['DATABASE_URL_ADMIN_TESTE'] ??
      'postgresql://postgres:dev_postgres_somente_local@127.0.0.1:5433/bairrin_teste';
    let admin: pg.Client;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: URL_ADMIN_TESTE });
      await admin.connect();
    });

    afterAll(async () => {
      await admin?.end();
    });

    async function problemasComoAdmin(sql: readonly string[]): Promise<ProblemaNoCatalogo[]> {
      await admin.query('BEGIN');
      try {
        for (const comando of sql) await admin.query(comando);
        return await problemasNoCatalogo(admin, { schemas: [SCHEMA] });
      } finally {
        await admin.query('ROLLBACK');
      }
    }

    it('reprova schema cujo dono é a aplicação', async () => {
      expect(await problemasComoAdmin([`ALTER SCHEMA ${SCHEMA} OWNER TO bairrin_app`])).toEqual([
        { regra: 'create-da-aplicacao', objeto: `schema ${SCHEMA}` },
        { regra: 'dono-e-a-aplicacao', objeto: `schema ${SCHEMA}` },
      ]);
    });

    it('reprova WITH GRANT OPTION para a aplicação no banco', async () => {
      expect(
        await problemasComoAdmin([
          'GRANT CONNECT ON DATABASE bairrin_teste TO bairrin_app WITH GRANT OPTION',
        ]),
      ).toEqual([{ regra: 'grant-option-da-aplicacao', objeto: 'banco bairrin_teste' }]);
    });
  });

  it('a mensagem do erro do release cita regra e objeto', () => {
    const erro = new CatalogoForaDasRegras([
      { regra: 'tabela-sem-rls', objeto: `${SCHEMA}.sem_rls` },
    ]);
    expect(erro.message).toContain(`tabela-sem-rls: ${SCHEMA}.sem_rls`);
    expect(erro.name).toBe('CatalogoForaDasRegras');
  });
});
