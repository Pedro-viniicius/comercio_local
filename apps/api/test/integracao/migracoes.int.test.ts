// Integração da migração do núcleo (CA-F4; S2 e S3): o banco de teste foi
// recriado e migrado pelo `globalSetup` (preparar-banco.ts) com o papel de
// migração. Aqui se confere o resultado com os dois papéis de verdade.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acessosIndevidos,
  exigirSchemasFechados,
  SchemasAbertosAoSupabase,
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

  it('não dá CREATE à aplicação em nenhum schema', async () => {
    const { rows } = await dono.query<{ publico: boolean; compartilhado: boolean }>(
      `SELECT has_schema_privilege('bairrin_app', 'public', 'CREATE') AS publico,
              has_schema_privilege('bairrin_app', 'compartilhado', 'CREATE') AS compartilhado`,
    );
    expect(rows[0]).toEqual({ publico: false, compartilhado: false });
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
});
