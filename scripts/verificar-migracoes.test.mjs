// Testes do verificador de migrações (`node --test scripts/`). As fixtures de
// `fixtures/migracoes/` têm uma pasta por regra violada e migrações que passam.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analisarMigracao, PASTA_PADRAO, verificarMigracoes } from './verificar-migracoes.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/migracoes/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./verificar-migracoes.mjs', import.meta.url));
const REVERSAO = '-- reversao: só em banco sem dados.\n';
const GUARDA = `DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pedidos.pedidos) THEN
    RAISE EXCEPTION 'pedidos.pedidos tem linhas';
  END IF;
END
$$;
`;

/** Só as mensagens, para comparar sem depender da linha. */
function mensagens(pasta, sql) {
  return analisarMigracao(pasta, sql).map(({ mensagem }) => mensagem);
}

function rodarCli(...argumentos) {
  return spawnSync(process.execPath, [SCRIPT, ...argumentos], { encoding: 'utf8' });
}

describe('migrações da API', () => {
  it('passam no verificador', () => {
    assert.deepEqual(verificarMigracoes(PASTA_PADRAO).problemas, []);
  });

  it('o núcleo tem trigger BEFORE TRUNCATE e DROP SCHEMA na nota sem falso positivo', () => {
    const sql = readFileSync(join(PASTA_PADRAO, '20261016120000_nucleo', 'migration.sql'), 'utf8');
    assert.match(sql, /BEFORE TRUNCATE ON/);
    assert.match(sql, /^-- reversao:.*\n.*DROP SCHEMA compartilhado CASCADE/m);
    assert.deepEqual(analisarMigracao('20261016120000_nucleo', sql), []);
  });
});

describe('fixtures', () => {
  it('as válidas passam (inclui uma _destrutiva com guarda)', () => {
    const { total, problemas } = verificarMigracoes(join(FIXTURES, 'valida'));
    assert.equal(total, 2);
    assert.deepEqual(problemas, []);
  });

  it('cada inválida reprova pela sua regra', () => {
    const { problemas } = verificarMigracoes(join(FIXTURES, 'invalida'));
    const esperados = [
      ['20260101000000_sem_reversao', undefined, /^falta a nota "-- reversao:/],
      ['20260102000000_drop_fora_da_pasta', 9, /^comando destrutivo \(DROP\) só é aceito em pasta/],
      ['20260103000000_sem_guarda_destrutiva', undefined, /^migração destrutiva deve começar/],
      ['20260104000000_sem_rls', 2, /^tabela "pedidos\.historico" criada sem "ALTER TABLE/],
      ['20260105000000_em_public', 2, /^TABLE "vazamento" ficaria no schema public/],
      ['20260105000000_em_public', 4, /^TABLE "sem_schema" ficaria no schema public/],
      ['20260106000000_desliga_protecoes', 2, /^RLS desligado \(DISABLE ROW LEVEL SECURITY\)/],
      ['20260106000000_desliga_protecoes', 3, /^trigger desligada \(DISABLE TRIGGER\)/],
      ['20260106000000_desliga_protecoes', 4, /^GRANT para anon/],
      ['20260106000000_desliga_protecoes', 5, /^GRANT UPDATE em compartilhado\.auditoria/],
      ['20260106000000_desliga_protecoes', 6, /^função SECURITY DEFINER sem "SET search_path"/],
      ['20260106000000_desliga_protecoes', 7, /^CREATE EXTENSION "pgcrypto" sem SCHEMA/],
      ['20260106000000_desliga_protecoes', 8, /^tabela "compartilhado\.copia" criada sem/],
    ];
    assert.equal(problemas.length, esperados.length, JSON.stringify(problemas, null, 2));
    esperados.forEach(([pasta, linha, mensagem], indice) => {
      assert.equal(problemas[indice].pasta, pasta);
      assert.equal(problemas[indice].linha, linha);
      assert.match(problemas[indice].mensagem, mensagem);
    });
  });
});

describe('nota de reversão', () => {
  it('aceita "reversão" com acento e comentários antes dela', () => {
    assert.deepEqual(mensagens('a', '-- Núcleo\n\n-- reversão: apagar\nSELECT 1;'), []);
  });

  it('recusa nota vazia ou depois do primeiro comando', () => {
    for (const sql of ['-- reversao:\nSELECT 1;', 'SELECT 1;\n-- reversao: x']) {
      assert.match(mensagens('a', sql).join(), /falta a nota/);
    }
  });
});

describe('comandos destrutivos', () => {
  const casos = [
    ['DROP TABLE', 'DROP TABLE pedidos.itens;', 'DROP'],
    ['DROP COLUMN', 'ALTER TABLE pedidos.itens DROP COLUMN nota;', 'DROP'],
    ['RENAME', 'ALTER TABLE pedidos.itens RENAME COLUMN a TO b;', 'RENAME'],
    [
      'ALTER COLUMN TYPE',
      'ALTER TABLE pedidos.itens ALTER COLUMN a TYPE int;',
      'ALTER COLUMN ... TYPE',
    ],
    [
      'SET DATA TYPE',
      'ALTER TABLE "pedidos"."itens" ALTER COLUMN "a" SET DATA TYPE BIGINT;',
      'ALTER COLUMN ... TYPE',
    ],
    ['ALTER sem COLUMN', 'ALTER TABLE pedidos.itens ALTER a TYPE int;', 'ALTER COLUMN ... TYPE'],
    ['TRUNCATE', 'TRUNCATE pedidos.itens;', 'TRUNCATE'],
    [
      'TRUNCATE em bloco',
      'DO $$ BEGIN IF true THEN TRUNCATE pedidos.itens; END IF; END $$;',
      'TRUNCATE',
    ],
    [
      'SQL dinâmico',
      "DO $$ BEGIN EXECUTE format('DROP TABLE %I', 'x'); END $$;",
      'DROP em SQL dinâmico',
    ],
    ['DELETE FROM', 'DELETE FROM pedidos.itens WHERE true;', 'DELETE'],
    ['DELETE em CTE', 'WITH x AS (DELETE FROM pedidos.itens RETURNING id) SELECT 1;', 'DELETE'],
    ['delete em bloco', 'DO $$ BEGIN delete from pedidos.itens; END $$;', 'DELETE'],
    [
      'DELETE dinâmico',
      "DO $$ BEGIN EXECUTE format('DELETE FROM %I.%I', 'pedidos', 'itens'); END $$;",
      'DELETE em SQL dinâmico',
    ],
  ];
  for (const [nome, comando, esperado] of casos) {
    it(`${nome}: recusado fora de _destrutiva e sem guarda`, () => {
      const resultado = mensagens('20260101000000_x', REVERSAO + comando);
      assert.ok(
        resultado.some((m) => m.startsWith(`comando destrutivo (${esperado})`)),
        resultado.join('\n'),
      );
      assert.ok(resultado.some((m) => m.startsWith('migração destrutiva deve começar')));
    });

    it(`${nome}: aceito em _destrutiva com guarda`, () => {
      assert.deepEqual(mensagens('20260101000000_x_destrutiva', REVERSAO + GUARDA + comando), []);
    });
  }

  it('em _destrutiva, recusa guarda sem SELECT, sem RAISE EXCEPTION ou fora do início', () => {
    const semSelect = "DO $$ BEGIN RAISE EXCEPTION 'sempre'; END $$;\n";
    const semRaise = 'DO $$ BEGIN PERFORM 1 FROM pedidos.itens; END $$;\n';
    for (const sql of [semSelect, semRaise, `SELECT 1;\n${GUARDA}`, '']) {
      const resultado = mensagens('1_x_destrutiva', `${REVERSAO}${sql}DROP TABLE pedidos.itens;`);
      assert.deepEqual(resultado.length, 1, resultado.join('\n'));
      assert.match(resultado[0], /deve começar com o bloco de guarda/);
    }
  });

  it('não confunde comentário, texto, trigger, GRANT e DROP NOT NULL com comando', () => {
    const sql = `${REVERSAO}-- DROP TABLE x; TRUNCATE y; RENAME
/* DROP /* aninhado */ TRUNCATE x; */
SELECT 'DROP de tabela', E'it\\'s TRUNCATE x';
COMMENT ON TABLE pedidos.itens IS 'RENAME TO';
CREATE TRIGGER t BEFORE TRUNCATE ON pedidos.itens FOR EACH STATEMENT EXECUTE FUNCTION pedidos.f();
CREATE TRIGGER u AFTER INSERT OR TRUNCATE ON pedidos.itens FOR EACH STATEMENT EXECUTE FUNCTION pedidos.f();
GRANT SELECT, TRUNCATE ON pedidos.itens TO bairrin_app;
ALTER TABLE pedidos.itens ALTER COLUMN a DROP NOT NULL, ALTER COLUMN b DROP DEFAULT;
DO $$ BEGIN RAISE EXCEPTION 'TRUNCATE recusado: %', TG_OP; END $$;
SELECT "DROP" FROM pedidos.itens;
ALTER TABLE pedidos.itens ADD CONSTRAINT fk FOREIGN KEY (a) REFERENCES pedidos.p (id) ON DELETE CASCADE;
CREATE TRIGGER v BEFORE UPDATE OR DELETE ON pedidos.itens FOR EACH STATEMENT EXECUTE FUNCTION pedidos.f();
GRANT SELECT, INSERT, UPDATE, DELETE ON pedidos.itens TO bairrin_app;
CREATE POLICY p ON pedidos.itens FOR DELETE TO bairrin_app USING (true);
DO $$ BEGIN RAISE EXCEPTION 'DELETE FROM recusado'; END $$;`;
    assert.deepEqual(mensagens('1_x', sql), []);
  });
});

describe('RLS e schema public', () => {
  it('exige RLS para a mesma tabela, com ou sem aspas', () => {
    const ok = `${REVERSAO}CREATE TABLE "Pedidos"."Itens" (id int);
ALTER TABLE ONLY "Pedidos"."Itens" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS pedidos.notas (id int);
ALTER TABLE IF EXISTS PEDIDOS.NOTAS ENABLE ROW LEVEL SECURITY;`;
    assert.deepEqual(mensagens('1_x', ok), []);
    const errado = `${REVERSAO}CREATE TABLE "Pedidos"."Itens" (id int);
ALTER TABLE pedidos.itens ENABLE ROW LEVEL SECURITY;`;
    assert.match(mensagens('1_x', errado).join(), /"Pedidos.Itens" criada sem/);
  });

  it('recusa objeto em public, explícito, sem schema ou movido para lá', () => {
    const casos = [
      'CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;',
      'CREATE VIEW public.v AS SELECT 1;',
      'CREATE MATERIALIZED VIEW "public"."m" AS SELECT 1;',
      "CREATE TYPE estado AS ENUM ('a');",
      'CREATE SEQUENCE seq;',
      'ALTER TABLE pedidos.itens SET SCHEMA public;',
    ];
    for (const comando of casos) {
      assert.match(mensagens('1_x', REVERSAO + comando).join(), /public/, comando);
    }
  });

  it('ignora tabela temporária', () => {
    assert.deepEqual(mensagens('1_x', `${REVERSAO}CREATE TEMP TABLE t (id int);`), []);
  });
});

describe('linha de comando', () => {
  it('sai com 0 nas migrações da API e nas fixtures válidas', () => {
    for (const argumentos of [[], [join(FIXTURES, 'valida')]]) {
      const resultado = rodarCli(...argumentos);
      assert.equal(resultado.status, 0, resultado.stderr);
      assert.match(resultado.stdout, /Nenhum problema/);
    }
  });

  it('sai com 1 e lista arquivo, linha e motivo nas inválidas', () => {
    const resultado = rodarCli(join(FIXTURES, 'invalida'));
    assert.equal(resultado.status, 1);
    assert.match(resultado.stderr, /20260104000000_sem_rls\/migration\.sql:2: tabela/);
  });

  it('sai com 1 quando a pasta não existe', () => {
    const resultado = rodarCli(join(FIXTURES, 'nao-existe'));
    assert.equal(resultado.status, 1);
    assert.match(resultado.stderr, /pasta de migrações não encontrada/);
  });
});

describe('casos de borda do verificador (QA)', () => {
  const COM_RLS = 'ALTER TABLE pedidos.itens ENABLE ROW LEVEL SECURITY;';

  it('aceita SQL com fim de linha CRLF e reprova o mesmo SQL sem RLS', () => {
    const crlf = (texto) => texto.replace(/\n/g, '\r\n');
    const completo = crlf(`${REVERSAO}CREATE TABLE pedidos.itens (id int);\n${COM_RLS}\n`);
    assert.deepEqual(mensagens('1_x', completo), []);
    const semRls = crlf(`${REVERSAO}CREATE TABLE pedidos.itens (id int);\n`);
    assert.match(mensagens('1_x', semRls).join(), /"pedidos.itens" criada sem/);
    const drop = crlf(`${REVERSAO}DROP TABLE pedidos.itens;\n`);
    assert.match(mensagens('1_x', drop).join(), /comando destrutivo \(DROP\)/);
  });

  it('reprova CREATE TABLE AS sem RLS e em public', () => {
    assert.match(
      mensagens('1_x', `${REVERSAO}CREATE TABLE pedidos.copia AS SELECT 1 AS id;`).join(),
      /"pedidos.copia" criada sem/,
    );
    assert.match(
      mensagens('1_x', `${REVERSAO}CREATE TABLE public.copia AS SELECT 1 AS id;`).join(),
      /public/,
    );
  });

  it('reprova identificador de schema entre aspas e em qualquer caixa: "public" e DROP minúsculo', () => {
    assert.match(
      mensagens('1_x', `${REVERSAO}CREATE TABLE "public"."t" (id int);`).join(),
      /public/,
    );
    assert.match(
      mensagens('1_x', `${REVERSAO}drop table pedidos.itens;`).join(),
      /comando destrutivo \(DROP\)/,
    );
  });

  it('reprova DISABLE ROW LEVEL SECURITY, mesmo numa tabela que a migração acabou de ligar', () => {
    const religa = `${REVERSAO}CREATE TABLE pedidos.itens (id int);
${COM_RLS}
ALTER TABLE pedidos.itens DISABLE ROW LEVEL SECURITY;`;
    assert.match(mensagens('1_x', religa).join(), /ROW LEVEL SECURITY|RLS/i);
    const numaExistente = `${REVERSAO}alter table compartilhado.outbox disable row level security;`;
    assert.match(mensagens('1_x', numaExistente).join(), /ROW LEVEL SECURITY|RLS/i);
  });

  it('reprova SELECT ... INTO, que cria tabela sem RLS (em public quando sem schema)', () => {
    assert.notDeepEqual(mensagens('1_x', `${REVERSAO}SELECT 1 AS id INTO pedidos.copia;`), []);
    assert.match(mensagens('1_x', `${REVERSAO}SELECT 1 AS id INTO copia;`).join(), /public/);
  });

  it('reprova CREATE TABLE feito por EXECUTE dinâmico, sem RLS', () => {
    const dinamico = `${REVERSAO}DO $$ BEGIN EXECUTE 'CREATE TABLE pedidos.copia (id int)'; END $$;`;
    assert.match(mensagens('1_x', dinamico).join(), /pedidos.copia/);
  });
});

/**
 * `comando` dentro de `niveis` blocos `DO ... EXECUTE '...'`, um dentro do texto do outro, cada
 * um com o seu delimitador (o corpo de fora termina no primeiro delimitador igual).
 */
function aninhar(comando, niveis) {
  let sql = comando;
  for (let nivel = 1; nivel <= niveis; nivel += 1) {
    sql = `DO $n${nivel}$ BEGIN EXECUTE '${sql.replace(/'/g, "''")}'; END $n${nivel}$`;
  }
  return `${sql};`;
}

const DESLIGA_AUDITORIA = 'ALTER TABLE compartilhado.auditoria DISABLE TRIGGER ALL';

describe('RLS, triggers, privilégios, funções e extensões (S27)', () => {
  /** Reprovam em qualquer pasta, inclusive `_destrutiva` com guarda. */
  const recusados = [
    ['DISABLE RLS', 'ALTER TABLE pedidos.itens DISABLE ROW LEVEL SECURITY;', /^RLS desligado/],
    [
      'NO FORCE RLS',
      'ALTER TABLE pedidos.itens NO FORCE ROW LEVEL SECURITY;',
      /NO FORCE ROW LEVEL/,
    ],
    [
      'DISABLE RLS dinâmico',
      "DO $$ BEGIN EXECUTE 'ALTER TABLE pedidos.itens DISABLE ROW LEVEL SECURITY'; END $$;",
      /^RLS desligado .*\(em SQL dinâmico\)$/,
    ],
    ['DISABLE TRIGGER', 'ALTER TABLE compartilhado.auditoria DISABLE TRIGGER ALL;', /^trigger/],
    [
      'ENABLE REPLICA TRIGGER',
      'ALTER TABLE compartilhado.auditoria ENABLE REPLICA TRIGGER "auditoria_sem_truncate";',
      /^trigger desligada \(ENABLE REPLICA TRIGGER\)/,
    ],
    ['session_replication_role', 'SET session_replication_role = replica;', /session_repl/],
    [
      'session_replication_role por set_config',
      "SELECT set_config('session_replication_role', 'replica', true);",
      /session_replication_role/,
    ],
    ['GRANT a PUBLIC', 'GRANT SELECT ON pedidos.itens TO PUBLIC;', /^GRANT para public/],
    ['GRANT a anon', 'GRANT SELECT ON pedidos.itens TO bairrin_app, anon;', /^GRANT para anon/],
    [
      'GRANT a "authenticated"',
      'GRANT USAGE ON SCHEMA pedidos TO "authenticated";',
      /^GRANT para authenticated/,
    ],
    [
      'GRANT a service_role',
      'GRANT ALL ON ALL TABLES IN SCHEMA pedidos TO service_role WITH GRANT OPTION;',
      /^GRANT para service_role/,
    ],
    [
      'privilégio padrão a anon',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA pedidos GRANT SELECT ON TABLES TO anon;',
      /^GRANT para anon/,
    ],
    [
      'GRANT a anon dinâmico',
      "DO $$ BEGIN RAISE NOTICE 'x'; EXECUTE 'GRANT SELECT ON pedidos.itens TO anon'; END $$;",
      /^GRANT para anon .*\(em SQL dinâmico\)$/,
    ],
    [
      'UPDATE na auditoria',
      'GRANT UPDATE ON compartilhado.auditoria TO bairrin_app;',
      /^GRANT UPDATE em compartilhado\.auditoria/,
    ],
    [
      'DELETE na auditoria entre aspas',
      'GRANT SELECT, INSERT, DELETE ON "compartilhado"."auditoria" TO bairrin_app;',
      /^GRANT DELETE em compartilhado\.auditoria/,
    ],
    [
      'TRUNCATE na auditoria em lista',
      'GRANT TRUNCATE ON TABLE compartilhado.outbox, compartilhado.auditoria TO bairrin_app;',
      /^GRANT TRUNCATE em compartilhado\.auditoria/,
    ],
    [
      'ALL PRIVILEGES na auditoria',
      'GRANT ALL PRIVILEGES ON compartilhado.auditoria TO bairrin_app;',
      /^GRANT ALL em/,
    ],
    [
      'UPDATE de coluna na auditoria',
      'GRANT UPDATE (acao) ON compartilhado.auditoria TO bairrin_app;',
      /^GRANT UPDATE em/,
    ],
    [
      'DELETE em todas as tabelas do schema',
      'GRANT DELETE ON ALL TABLES IN SCHEMA compartilhado TO bairrin_app;',
      /^GRANT DELETE em compartilhado\.auditoria/,
    ],
    [
      'SECURITY DEFINER sem search_path',
      'CREATE FUNCTION pedidos.f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;',
      /^função SECURITY DEFINER sem "SET search_path"/,
    ],
    [
      'SECURITY DEFINER depois do corpo',
      'CREATE OR REPLACE FUNCTION pedidos.f() RETURNS int LANGUAGE plpgsql AS $f$ BEGIN RETURN 1; END $f$ SECURITY DEFINER;',
      /^função SECURITY DEFINER/,
    ],
    ['ALTER FUNCTION SECURITY DEFINER', 'ALTER FUNCTION pedidos.f() SECURITY DEFINER;', /^função/],
    [
      'SECURITY DEFINER dentro de DO',
      'DO $o$ BEGIN CREATE FUNCTION pedidos.f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $f$ SELECT 1 $f$; END $o$;',
      /^função SECURITY DEFINER/,
    ],
    [
      'CREATE EXTENSION sem SCHEMA',
      'CREATE EXTENSION pgcrypto;',
      /^CREATE EXTENSION "pgcrypto" sem/,
    ],
    [
      'CREATE EXTENSION em public',
      'CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA public;',
      /^CREATE EXTENSION "pg_trgm" em public/,
    ],
    [
      'CREATE TABLE dinâmico com %I',
      "DO $$ BEGIN EXECUTE format('CREATE TABLE %I.%I (id int)', 'pedidos', 'x'); END $$;",
      /^TABLE criado em SQL dinâmico com nome montado/,
    ],
    [
      'CREATE TABLE dinâmico concatenado',
      "DO $$ BEGIN EXECUTE 'CREATE TABLE pedidos.' || 'x' || ' (id int)'; END $$;",
      /^TABLE criado em SQL dinâmico com nome montado/,
    ],
    [
      'SELECT INTO com CTE',
      'WITH s AS (SELECT 1 AS id) SELECT * INTO pedidos.copia FROM s;',
      /^tabela "pedidos\.copia" criada sem/,
    ],
    [
      'SELECT INTO UNLOGGED TABLE',
      'SELECT 1 AS id INTO UNLOGGED TABLE pedidos.copia;',
      /^tabela "pedidos\.copia" criada sem/,
    ],
    // Q6 (1): EXECUTE só com SQL que dá para conferir.
    [
      'EXECUTE concatenado',
      "DO $$ DECLARE t text := 'itens'; BEGIN EXECUTE 'ANALYZE pedidos.' || t; END $$;",
      /^EXECUTE com SQL concatenado/,
    ],
    [
      'EXECUTE de variável',
      "DO $$ DECLARE c text := 'SELECT 1'; BEGIN EXECUTE c; END $$;",
      /^EXECUTE com argumento que não é literal/,
    ],
    [
      'EXECUTE de format concatenado',
      "DO $$ BEGIN EXECUTE format('ANALYZE %I', 'itens') || ' '; END $$;",
      /^EXECUTE com SQL concatenado/,
    ],
    [
      'EXECUTE de format com modelo variável',
      "DO $$ DECLARE c text := 'ANALYZE %I'; BEGIN EXECUTE format(c, 'itens'); END $$;",
      /^EXECUTE com argumento que não é literal/,
    ],
    [
      'EXECUTE de literais adjacentes',
      "DO $$ BEGIN EXECUTE 'ANALYZE '\n'pedidos.itens'; END $$;",
      /^EXECUTE com argumento que não é literal/,
    ],
    [
      'FOR ... IN EXECUTE de variável',
      "DO $$ DECLARE r record; c text := 'SELECT 1'; BEGIN FOR r IN EXECUTE c LOOP END LOOP; END $$;",
      /^EXECUTE com argumento que não é literal/,
    ],
    [
      'EXECUTE de variável dentro de SQL dinâmico',
      "DO $$ BEGIN EXECUTE 'DO $i$ DECLARE c text := ''SELECT 1''; BEGIN EXECUTE c; END $i$'; END $$;",
      /^EXECUTE com argumento que não é literal.*\(em SQL dinâmico\)$/,
    ],
    // Q6 (2): privilégio padrão concedido.
    [
      'ALTER DEFAULT PRIVILEGES ... GRANT',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA pedidos GRANT SELECT ON TABLES TO bairrin_app;',
      /^ALTER DEFAULT PRIVILEGES \.\.\. GRANT/,
    ],
    [
      'ALTER DEFAULT PRIVILEGES FOR ROLE ... GRANT EXECUTE',
      'alter default privileges for role bairrin_migracao grant execute on functions to bairrin_app;',
      /^ALTER DEFAULT PRIVILEGES \.\.\. GRANT/,
    ],
    [
      'ALTER DEFAULT PRIVILEGES ... GRANT dinâmico',
      "DO $$ BEGIN EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA pedidos GRANT SELECT ON TABLES TO bairrin_app'; END $$;",
      /^ALTER DEFAULT PRIVILEGES \.\.\. GRANT.*\(em SQL dinâmico\)$/,
    ],
    // Q6 e Seg-2 (3): política sempre restrita a um papel que não é do Supabase.
    [
      'CREATE POLICY sem TO',
      'CREATE POLICY p ON pedidos.itens USING (true);',
      /^CREATE POLICY sem TO/,
    ],
    [
      'CREATE POLICY sem TO, com TO só em texto',
      "CREATE POLICY p ON pedidos.itens FOR SELECT USING (nome = 'TO bairrin_app');",
      /^CREATE POLICY sem TO/,
    ],
    [
      'CREATE POLICY para PUBLIC',
      'CREATE POLICY p ON pedidos.itens FOR SELECT TO PUBLIC USING (true);',
      /^CREATE POLICY para public/,
    ],
    [
      'CREATE POLICY para anon',
      'CREATE POLICY "p" ON pedidos.itens AS PERMISSIVE FOR ALL TO anon USING (true) WITH CHECK (true);',
      /^CREATE POLICY para anon/,
    ],
    [
      'CREATE POLICY para "authenticated" em lista',
      'CREATE POLICY p ON pedidos.itens TO bairrin_app, "authenticated" USING (true);',
      /^CREATE POLICY para authenticated/,
    ],
    [
      'CREATE POLICY para service_role',
      'CREATE POLICY p ON pedidos.itens FOR INSERT TO service_role WITH CHECK (true);',
      /^CREATE POLICY para service_role/,
    ],
    [
      'CREATE POLICY sem TO dinâmico',
      "DO $$ BEGIN EXECUTE 'CREATE POLICY p ON pedidos.itens USING (true)'; END $$;",
      /^CREATE POLICY sem TO.*\(em SQL dinâmico\)$/,
    ],
    // Q6 (4): papéis e atributos de papel.
    ['CREATE ROLE', 'CREATE ROLE intruso LOGIN;', /^CREATE ROLE/],
    ['CREATE USER', 'CREATE USER intruso;', /^CREATE USER/],
    ['ALTER GROUP', 'ALTER GROUP g ADD USER bairrin_app;', /^ALTER GROUP/],
    ['BYPASSRLS', 'ALTER ROLE bairrin_app BYPASSRLS;', /^BYPASSRLS/],
    ['SUPERUSER', 'ALTER USER bairrin_app WITH SUPERUSER;', /^SUPERUSER/],
    ['CREATEROLE', 'create role intruso createrole;', /^CREATEROLE/],
    [
      'BYPASSRLS dinâmico',
      "DO $$ BEGIN EXECUTE 'ALTER ROLE bairrin_app BYPASSRLS'; END $$;",
      /^BYPASSRLS.*\(em SQL dinâmico\)$/,
    ],
    ['GRANT de papel', 'GRANT bairrin_migracao TO bairrin_app;', /^GRANT de papel sem ON/],
    [
      'GRANT de papel do Postgres com ADMIN OPTION',
      'GRANT pg_read_server_files, "pg_write_server_files" TO bairrin_app WITH ADMIN OPTION;',
      /^GRANT de papel sem ON/,
    ],
    [
      'GRANT de papel dinâmico',
      "DO $$ BEGIN EXECUTE 'GRANT bairrin_migracao TO bairrin_app'; END $$;",
      /^GRANT de papel sem ON.*\(em SQL dinâmico\)$/,
    ],
    // Q6 (5): troca de papel e RLS da sessão.
    ['SET ROLE', 'SET ROLE bairrin_migracao;', /^troca de papel \(SET ROLE\)/],
    ['SET LOCAL ROLE', 'set local role postgres;', /^troca de papel \(SET ROLE\)/],
    [
      'SET SESSION AUTHORIZATION',
      'SET SESSION AUTHORIZATION postgres;',
      /^troca de papel \(SET SESSION AUTHORIZATION\)/,
    ],
    [
      'set_config de role',
      "SELECT set_config('role', 'postgres', true);",
      /^troca de papel \(set_config\)/,
    ],
    [
      'SET ROLE dinâmico',
      "DO $$ BEGIN EXECUTE 'SET ROLE postgres'; END $$;",
      /^troca de papel \(SET ROLE\).*\(em SQL dinâmico\)$/,
    ],
    ['SET row_security', 'SET row_security = off;', /^row_security/],
    [
      'row_security por set_config',
      "SELECT set_config('row_security', 'off', false);",
      /^row_security/,
    ],
    // Q6 (6): comando do sistema operacional no servidor.
    ['COPY FROM PROGRAM', "COPY pedidos.itens FROM PROGRAM 'curl x';", /^COPY \.\.\. PROGRAM/],
    ['COPY TO PROGRAM', "COPY (SELECT 1) TO PROGRAM 'sh';", /^COPY \.\.\. PROGRAM/],
    [
      'COPY PROGRAM dinâmico',
      "DO $$ BEGIN EXECUTE 'COPY pedidos.itens TO PROGRAM ''sh'''; END $$;",
      /^COPY \.\.\. PROGRAM.*\(em SQL dinâmico\)$/,
    ],
    // Seg-2 (7): dono só o papel de migração.
    [
      'OWNER TO bairrin_app',
      'ALTER TABLE pedidos.itens OWNER TO bairrin_app;',
      /^OWNER TO bairrin_app/,
    ],
    ['OWNER TO postgres', 'ALTER SCHEMA pedidos OWNER TO postgres;', /^OWNER TO postgres/],
    [
      'OWNER TO "service_role"',
      'ALTER FUNCTION pedidos.f() OWNER TO "service_role";',
      /^OWNER TO service_role/,
    ],
    [
      'OWNER TO SESSION_USER',
      'ALTER TABLE pedidos.itens OWNER TO SESSION_USER;',
      /^OWNER TO session_user/,
    ],
    [
      'OWNER TO dinâmico',
      "DO $$ BEGIN EXECUTE format('ALTER TABLE %I.itens OWNER TO bairrin_app', 'pedidos'); END $$;",
      /^OWNER TO bairrin_app.*\(em SQL dinâmico\)$/,
    ],
    // S33: o corpo $tag$ só é código depois de DO ou AS, no topo; aspa ou -- dentro de um
    // $tag$ que o Postgres lê como texto não escondem mais o comando seguinte.
    [
      '$tag$ como texto no topo, com aspa',
      `SELECT $q$'$q$; ${DESLIGA_AUDITORIA}; SELECT $q$'$q$;`,
      /^\$tag\$ usado como texto \(S33\)/,
    ],
    [
      '$tag$ como texto no topo: o comando escondido também reprova',
      `SELECT $q$'$q$; ${DESLIGA_AUDITORIA}; SELECT $q$'$q$;`,
      /^trigger desligada \(DISABLE TRIGGER\)/,
    ],
    [
      '$tag$ em DO, com aspa',
      `DO $$ BEGIN PERFORM $q$'$q$; ${DESLIGA_AUDITORIA}; PERFORM $q$'$q$; END $$;`,
      /^\$tag\$ dentro de outro corpo \$tag\$ \(S33\)/,
    ],
    [
      '$tag$ em DO, com --',
      `DO $$ BEGIN PERFORM $q$--$q$; ${DESLIGA_AUDITORIA};\nEND $$;`,
      /^\$tag\$ dentro de outro corpo \$tag\$ \(S33\)/,
    ],
    [
      '-- no fim do corpo de DO não esconde o comando depois do delimitador',
      `DO $$ BEGIN NULL; END -- $$; ${DESLIGA_AUDITORIA}; DO $$ BEGIN NULL; END\n$$;`,
      /^trigger desligada \(DISABLE TRIGGER\)/,
    ],
    [
      'texto que passa do fim do corpo de DO',
      `DO $$ BEGIN RAISE NOTICE '$$; ${DESLIGA_AUDITORIA}; SELECT '$$';`,
      /^texto, identificador entre aspas ou comentário \/\* \*\/ passa do fim do corpo/,
    ],
    [
      'comentário /* */ que passa do fim do corpo de DO',
      `DO $$ BEGIN NULL; END /* $$; ${DESLIGA_AUDITORIA}; -- */`,
      /^trigger desligada \(DISABLE TRIGGER\)/,
    ],
    [
      '$tag$ com letra fora do ASCII como texto',
      `SELECT $ção$'$ção$; ${DESLIGA_AUDITORIA}; SELECT $ção$'$ção$;`,
      /^\$tag\$ usado como texto \(S33\)/,
    ],
    [
      'EXECUTE $q$...$q$ dentro de DO',
      'DO $$ BEGIN EXECUTE $q$ANALYZE pedidos.itens$q$; END $$;',
      /^\$tag\$ dentro de outro corpo \$tag\$ \(S33\)/,
    ],
    [
      'COMMENT ... IS $q$...$q$',
      'COMMENT ON TABLE pedidos.itens IS $q$descrição$q$;',
      /^\$tag\$ usado como texto \(S33\)/,
    ],
    [
      '$tag$ como texto em SQL dinâmico',
      "DO $$ BEGIN EXECUTE 'SELECT $q$x$q$'; END $$;",
      /^\$tag\$ usado como texto .*\(em SQL dinâmico\)$/,
    ],
    // S34, R14 e R16: comandos equivalentes aos já recusados.
    [
      'CREATE SCHEMA ... AUTHORIZATION bairrin_app',
      'CREATE SCHEMA IF NOT EXISTS identidade AUTHORIZATION bairrin_app;',
      /^CREATE SCHEMA \.\.\. AUTHORIZATION bairrin_app \(S34\)/,
    ],
    [
      'CREATE SCHEMA AUTHORIZATION sem nome do schema',
      'CREATE SCHEMA AUTHORIZATION "postgres";',
      /^CREATE SCHEMA \.\.\. AUTHORIZATION postgres/,
    ],
    [
      'CREATE SCHEMA ... AUTHORIZATION dinâmico',
      "DO $$ BEGIN EXECUTE 'CREATE SCHEMA s AUTHORIZATION bairrin_app'; END $$;",
      /^CREATE SCHEMA \.\.\. AUTHORIZATION bairrin_app.*\(em SQL dinâmico\)$/,
    ],
    [
      'GRANT CREATE ON SCHEMA',
      'GRANT USAGE, CREATE ON SCHEMA pedidos TO bairrin_app;',
      /^GRANT CREATE \(ou ALL\) em SCHEMA para bairrin_app \(S34\)/,
    ],
    [
      'GRANT ALL ON SCHEMA',
      'GRANT ALL PRIVILEGES ON SCHEMA "pedidos" TO "bairrin_app";',
      /^GRANT CREATE \(ou ALL\) em SCHEMA para bairrin_app/,
    ],
    [
      'GRANT CREATE ON DATABASE',
      'GRANT CREATE ON DATABASE postgres TO bairrin_app;',
      /^GRANT CREATE \(ou ALL\) em DATABASE para bairrin_app/,
    ],
    [
      'format com %s',
      "DO $$ DECLARE c text := 'pedidos.itens'; BEGIN EXECUTE format('ANALYZE %s', c); END $$;",
      /^EXECUTE de format com especificador que não é %I, %L nem %% \(S34\)/,
    ],
    [
      'format com %1$s',
      "DO $$ DECLARE c text := 'x'; BEGIN EXECUTE format('ANALYZE %1$I.%2$s', 'pedidos', c); END $$;",
      /^EXECUTE de format com especificador/,
    ],
    [
      "format com %s escrito por escape em E'...'",
      "DO $$ DECLARE c text := 'x'; BEGIN EXECUTE format(E'ANALYZE \\x25s', c); END $$;",
      /^EXECUTE de format com especificador/,
    ],
    [
      'format com largura (%-10I)',
      "DO $$ BEGIN EXECUTE format('ANALYZE %-10I', 'itens'); END $$;",
      /^EXECUTE de format com especificador/,
    ],
    [
      'format com %s em SQL dinâmico',
      "DO $$ BEGIN EXECUTE 'DO $i$ BEGIN EXECUTE format(''ANALYZE %s'', 1); END $i$'; END $$;",
      /^EXECUTE de format com especificador.*\(em SQL dinâmico\)$/,
    ],
    [
      'ALTER POLICY ... TO PUBLIC',
      'ALTER POLICY p ON pedidos.itens TO PUBLIC;',
      /^ALTER POLICY para public/,
    ],
    [
      'ALTER POLICY ... TO anon, com USING',
      'ALTER POLICY "p" ON pedidos.itens TO bairrin_app, anon USING (true);',
      /^ALTER POLICY para anon/,
    ],
    [
      'ALTER POLICY dinâmico',
      "DO $$ BEGIN EXECUTE 'ALTER POLICY p ON pedidos.itens TO authenticated'; END $$;",
      /^ALTER POLICY para authenticated.*\(em SQL dinâmico\)$/,
    ],
    [
      'CREATE POLICY para postgres',
      'CREATE POLICY p ON pedidos.itens TO postgres USING (true);',
      /^CREATE POLICY para postgres/,
    ],
    [
      'CREATE POLICY para supabase_auth_admin',
      'CREATE POLICY p ON pedidos.itens TO supabase_auth_admin USING (true);',
      /^CREATE POLICY para supabase_auth_admin/,
    ],
    [
      'CREATE POLICY para supabase_admin',
      'CREATE POLICY p ON pedidos.itens FOR SELECT TO bairrin_app, supabase_admin USING (true);',
      /^CREATE POLICY para supabase_admin/,
    ],
    [
      'CREATE POLICY para "dashboard_user"',
      'CREATE POLICY p ON pedidos.itens TO "dashboard_user" USING (true);',
      /^CREATE POLICY para dashboard_user/,
    ],
    [
      'REASSIGN OWNED BY ... TO bairrin_app',
      'REASSIGN OWNED BY bairrin_migracao TO bairrin_app;',
      /^REASSIGN OWNED BY \.\.\. TO bairrin_app \(S34\)/,
    ],
    [
      'REASSIGN OWNED BY ... TO postgres dinâmico',
      "DO $$ BEGIN EXECUTE 'REASSIGN OWNED BY bairrin_migracao TO postgres'; END $$;",
      /^REASSIGN OWNED BY \.\.\. TO postgres.*\(em SQL dinâmico\)$/,
    ],
    [
      'GRANT ... WITH GRANT OPTION',
      'GRANT SELECT ON pedidos.itens TO bairrin_app WITH GRANT OPTION;',
      /^GRANT \.\.\. WITH GRANT OPTION \(S34\)/,
    ],
    [
      'GRANT ... WITH GRANT OPTION dinâmico',
      "DO $$ BEGIN EXECUTE 'GRANT USAGE ON SCHEMA pedidos TO bairrin_app WITH GRANT OPTION'; END $$;",
      /^GRANT \.\.\. WITH GRANT OPTION.*\(em SQL dinâmico\)$/,
    ],
    [
      'CREATE RULE',
      'CREATE RULE r AS ON UPDATE TO compartilhado.auditoria DO INSTEAD NOTHING;',
      /^CREATE RULE \(S34\)/,
    ],
    [
      'CREATE OR REPLACE RULE dinâmico',
      "DO $$ BEGIN EXECUTE 'CREATE OR REPLACE RULE r AS ON DELETE TO compartilhado.auditoria DO INSTEAD NOTHING'; END $$;",
      /^CREATE RULE.*\(em SQL dinâmico\)$/,
    ],
    [
      'SQL dinâmico com 4 níveis ainda é conferido',
      aninhar('SET ROLE postgres', 4),
      /^troca de papel \(SET ROLE\).*\(em SQL dinâmico\)$/,
    ],
    [
      'SQL dinâmico com mais de 4 níveis',
      aninhar('SET ROLE postgres', 5),
      /^SQL dinâmico com mais de 4 níveis/,
    ],
    // R15: troca de papel pelo nome do parâmetro, entre aspas, e como opção de função ou do banco.
    ['SET "role" TO', 'SET "role" TO bairrin_app;', /^troca de papel \(SET ROLE\)/],
    ['SET SESSION "ROLE" =', 'SET SESSION "ROLE" = postgres;', /^troca de papel \(SET ROLE\)/],
    [
      'SET session_authorization TO',
      'SET session_authorization TO postgres;',
      /^troca de papel \(SET SESSION AUTHORIZATION\)/,
    ],
    [
      'SET ROLE no início do corpo de função em SQL',
      'CREATE FUNCTION pedidos.f() RETURNS int LANGUAGE sql AS $$ SET ROLE postgres; SELECT 1 $$;',
      /^troca de papel \(SET ROLE\)/,
    ],
    [
      'SET role como opção de função',
      'CREATE FUNCTION pedidos.f() RETURNS int LANGUAGE sql SET role = postgres AS $$ SELECT 1 $$;',
      /^troca de papel \(SET role como parâmetro\)/,
    ],
    [
      'SET "role" como opção do banco',
      'ALTER DATABASE postgres SET "role" TO postgres;',
      /^troca de papel \(SET role como parâmetro\)/,
    ],
    [
      'SET "role" dinâmico',
      'DO $$ BEGIN EXECUTE \'SET "role" TO postgres\'; END $$;',
      /^troca de papel \(SET ROLE\).*\(em SQL dinâmico\)$/,
    ],
  ];
  for (const [nome, comando, esperado] of recusados) {
    it(`${nome}: recusado, mesmo em _destrutiva com guarda`, () => {
      for (const [pasta, sql] of [
        ['1_x', REVERSAO + comando],
        ['1_x_destrutiva', REVERSAO + GUARDA + comando],
      ]) {
        const resultado = mensagens(pasta, sql);
        assert.ok(
          resultado.some((m) => esperado.test(m)),
          `${pasta}\n${resultado.join('\n')}`,
        );
      }
    });
  }

  it('aceita o que só parece com as regras', () => {
    const aceitos = [
      'SELECT 1 AS id INTO TEMP copia;',
      'SELECT 1 AS id INTO pedidos.copia;\nALTER TABLE pedidos.copia ENABLE ROW LEVEL SECURITY;',
      "DO $$ BEGIN EXECUTE 'CREATE TABLE pedidos.copia (id int)'; END $$;\nALTER TABLE pedidos.copia ENABLE ROW LEVEL SECURITY;",
      'DO $$ DECLARE n int; BEGIN SELECT count(*) INTO n FROM pedidos.itens; END $$;',
      'CREATE FUNCTION pedidos.g() RETURNS int LANGUAGE plpgsql AS $$ DECLARE n int; BEGIN SELECT 1 INTO n; RETURN n; END $$;',
      'WITH s AS (SELECT 1 AS id) INSERT INTO pedidos.itens SELECT * FROM s;',
      'ALTER TABLE pedidos.itens FORCE ROW LEVEL SECURITY;',
      'ALTER TABLE pedidos.itens ENABLE ALWAYS TRIGGER x;',
      'CREATE POLICY p ON compartilhado.auditoria FOR SELECT TO bairrin_app USING (true);',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON compartilhado.outbox TO bairrin_app;',
      'GRANT SELECT, INSERT ON compartilhado.auditoria TO bairrin_app;',
      'GRANT UPDATE ON SEQUENCE compartilhado.seq TO bairrin_app;',
      'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA compartilhado TO bairrin_app;',
      'REVOKE ALL ON SCHEMA public FROM anon, authenticated, PUBLIC;',
      "CREATE FUNCTION pedidos.f() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT 1 $$;",
      'CREATE FUNCTION pedidos.f() RETURNS int LANGUAGE sql SET search_path = pg_catalog, pg_temp SECURITY DEFINER AS $$ SELECT 1 $$;',
      "CREATE FUNCTION pedidos.f() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RAISE NOTICE 'SECURITY DEFINER'; RETURN 1; END $$;",
      'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;',
      "DO $$ BEGIN RAISE EXCEPTION 'GRANT SELECT ON x TO PUBLIC; DISABLE TRIGGER'; END $$;",
      "COMMENT ON FUNCTION pedidos.f() IS E'Não use SECURITY DEFINER; GRANT x TO PUBLIC é proibido';",
      // Q6 (1): EXECUTE de literal único ou de format(<literal>, ...); os de trigger e o
      // privilégio EXECUTE não são o EXECUTE do PL/pgSQL.
      "DO $$ BEGIN EXECUTE 'ANALYZE pedidos.itens'; END $$;",
      "DO $$ BEGIN EXECUTE format('ANALYZE %I.%I', 'pedidos', quote_ident('itens')); END $$;",
      "DO $$ BEGIN EXECUTE 'SELECT ''a'' || ''b'''; END $$;",
      "DO $$ BEGIN EXECUTE E'SELECT \\'a\\''; END $$;",
      "DO $$ DECLARE n int; BEGIN EXECUTE 'SELECT count(*) FROM pedidos.itens' INTO n; END $$;",
      "DO $$ DECLARE n int; BEGIN EXECUTE format('SELECT count(*) FROM %I.itens WHERE id = $1', 'pedidos') INTO STRICT n USING 1; END $$;",
      "DO $$ DECLARE r record; BEGIN FOR r IN EXECUTE 'SELECT 1' LOOP END LOOP; END $$;",
      'CREATE TRIGGER t AFTER INSERT ON pedidos.itens FOR EACH ROW EXECUTE PROCEDURE pedidos.f();',
      'GRANT EXECUTE ON FUNCTION pedidos.f() TO bairrin_app;',
      'GRANT SELECT, EXECUTE ON ALL FUNCTIONS IN SCHEMA pedidos TO bairrin_app;',
      'REVOKE EXECUTE ON FUNCTION pedidos.f() FROM PUBLIC;',
      // Q6 (2): o REVOKE de privilégio padrão passa, inclusive o da opção de GRANT.
      'ALTER DEFAULT PRIVILEGES IN SCHEMA pedidos REVOKE ALL ON TABLES FROM PUBLIC;',
      'ALTER DEFAULT PRIVILEGES REVOKE GRANT OPTION FOR SELECT ON TABLES FROM bairrin_app;',
      'ALTER DEFAULT PRIVILEGES FOR ROLE bairrin_migracao REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;',
      // Q6 (3), premissa P5: política só para bairrin_app, inclusive USING (true).
      'CREATE POLICY p ON pedidos.itens TO bairrin_app USING (true) WITH CHECK (true);',
      'CREATE POLICY p ON pedidos.itens AS RESTRICTIVE FOR UPDATE TO bairrin_app USING (true);',
      "CREATE POLICY p ON pedidos.itens TO bairrin_app USING (dono = current_setting('app.conta')::uuid);",
      // Q6 (4): GRANT de privilégio tem ON.
      'GRANT USAGE ON SCHEMA pedidos TO bairrin_app;',
      // Q6 (5) e (6): RESET ROLE não troca de papel; COPY sem PROGRAM.
      'RESET ROLE;',
      'COPY (SELECT 1) TO STDOUT;',
      // Seg-2 (7): o dono é o papel de migração.
      'ALTER TABLE pedidos.itens OWNER TO bairrin_migracao;',
      'ALTER TABLE "pedidos"."itens" OWNER TO "bairrin_migracao";',
      'ALTER SCHEMA pedidos OWNER TO CURRENT_USER;',
      // S33: $tag$ depois de DO (também com LANGUAGE) ou de AS; o -- no fim do corpo acaba
      // nele; $ e $tag$ dentro de texto, de identificador entre aspas ou colados a um nome.
      'DO LANGUAGE plpgsql $$ BEGIN NULL; END $$;',
      'DO $ção$ BEGIN NULL; END $ção$;',
      'DO $$ BEGIN NULL; END -- fim $$;',
      'SELECT \'texto com $q$ dentro\', "coluna$q$", a$b$c FROM pedidos.itens;',
      "DO $$ DECLARE n int; BEGIN EXECUTE 'SELECT count(*) FROM pedidos.itens WHERE id = $1' INTO n USING 1; END $$;",
      // S34: o papel de migração cria e é dono; GRANT em tabelas do schema não é no schema.
      'CREATE SCHEMA identidade AUTHORIZATION bairrin_migracao;',
      'CREATE SCHEMA AUTHORIZATION CURRENT_USER;',
      'GRANT CREATE ON SCHEMA pedidos TO bairrin_migracao;',
      'GRANT ALL ON ALL TABLES IN SCHEMA pedidos TO bairrin_app;',
      'REASSIGN OWNED BY bairrin_app TO bairrin_migracao;',
      'REVOKE GRANT OPTION FOR SELECT ON pedidos.itens FROM bairrin_app;',
      "COMMENT ON TABLE pedidos.itens IS 'CREATE RULE não é aceito; WITH GRANT OPTION também não';",
      // R14: format só com %I, %L (também com posição) e %%.
      "DO $$ BEGIN EXECUTE format('ANALYZE %1$I.%2$I -- 100%%', 'pedidos', 'itens'); END $$;",
      "DO $$ BEGIN EXECUTE format(E'SELECT %L', 'a'); END $$;",
      // R16: ALTER POLICY para bairrin_app ou sem TO (mantém os papéis).
      'ALTER POLICY p ON pedidos.itens TO bairrin_app USING (true);',
      "ALTER POLICY p ON pedidos.itens USING (dono = current_setting('app.conta')::uuid);",
      // S34: 4 níveis de SQL dinâmico, todos conferidos.
      aninhar('ANALYZE pedidos.itens', 4),
      // R15: SET role fora do início do comando é coluna; coluna execute fora de PL/pgSQL.
      "UPDATE pedidos.itens SET role = 'x', nota = 'y' WHERE role IS NULL;",
      'UPDATE pedidos.itens AS i SET "role" = \'x\';',
      "INSERT INTO pedidos.itens (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET role = 'x';",
      'CREATE TABLE pedidos.t (execute int);\nALTER TABLE pedidos.t ENABLE ROW LEVEL SECURITY;',
      // Q11: row_security em mensagem de RAISE ou em descrição de COMMENT não é configuração.
      "COMMENT ON TABLE pedidos.itens IS 'row_security fica sempre ligado';",
      "DO $$ BEGIN RAISE NOTICE 'row_security fica sempre ligado'; END $$;",
    ];
    for (const comando of aceitos) {
      assert.deepEqual(mensagens('1_x', REVERSAO + comando), [], comando);
    }
  });

  it('o privilégio EXECUTE em ALTER DEFAULT PRIVILEGES reprova só pelo GRANT padrão', () => {
    const sql = `${REVERSAO}ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO bairrin_app;`;
    const resultado = mensagens('1_x', sql);
    assert.equal(resultado.length, 1, resultado.join('\n'));
    assert.match(resultado[0], /^ALTER DEFAULT PRIVILEGES \.\.\. GRANT/);
  });
});

describe('GRANT só para bairrin_app e bairrin_migracao (P8 do 01b)', () => {
  /** Cada um reprova com exatamente estas mensagens, em qualquer pasta. */
  const recusados = [
    ['TO postgres', 'GRANT SELECT ON pedidos.itens TO postgres;', [/^GRANT para postgres \(P8\)/]],
    [
      'TO supabase_admin',
      'GRANT USAGE ON SCHEMA pedidos TO supabase_admin;',
      [/^GRANT para supabase_admin \(P8\)/],
    ],
    [
      'TO CURRENT_USER',
      'GRANT SELECT ON pedidos.itens TO CURRENT_USER;',
      [/^GRANT para current_user \(P8\)/],
    ],
    [
      'TO SESSION_USER',
      'GRANT SELECT ON pedidos.itens TO SESSION_USER;',
      [/^GRANT para session_user \(P8\)/],
    ],
    [
      'TO CURRENT_ROLE',
      'GRANT EXECUTE ON FUNCTION pedidos.f() TO CURRENT_ROLE;',
      [/^GRANT para current_role \(P8\)/],
    ],
    [
      'TO bairrin_app, postgres',
      'GRANT SELECT ON pedidos.itens TO bairrin_app, postgres;',
      [/^GRANT para postgres \(P8\)/],
    ],
    [
      'TO um papel qualquer, com GROUP e em outra linha',
      'GRANT SELECT\n  ON pedidos.itens\n  TO bairrin_migracao,\n  GROUP papel_qualquer;',
      [/^GRANT para papel_qualquer \(P8\)/],
    ],
    [
      'TO "BAIRRIN_APP" entre aspas e em maiúsculas é outro papel',
      'GRANT SELECT ON pedidos.itens TO "BAIRRIN_APP";',
      [/^GRANT para BAIRRIN_APP \(P8\)/],
    ],
    [
      'TO PUBLIC continua com o motivo do S2',
      'GRANT SELECT ON pedidos.itens TO bairrin_app, PUBLIC;',
      [/^GRANT para public \(S2\)/],
    ],
    [
      'TO postgres dentro de DO',
      'DO $$ BEGIN GRANT SELECT ON pedidos.itens TO postgres; END $$;',
      [/^GRANT para postgres \(P8\)/],
    ],
    [
      'TO postgres dentro de EXECUTE',
      "DO $$ BEGIN EXECUTE 'GRANT SELECT ON pedidos.itens TO postgres'; END $$;",
      [/^GRANT para postgres \(P8\).*\(em SQL dinâmico\)$/],
    ],
    [
      'TO supabase_admin dentro de EXECUTE format',
      "DO $$ BEGIN EXECUTE format('GRANT SELECT ON %I.itens TO supabase_admin', 'pedidos'); END $$;",
      [/^GRANT para supabase_admin \(P8\).*\(em SQL dinâmico\)$/],
    ],
    [
      'TO CURRENT_USER e TO bairrin_app, postgres dentro de EXECUTE',
      "DO $$ BEGIN EXECUTE 'GRANT USAGE ON SCHEMA pedidos TO CURRENT_USER'; EXECUTE 'GRANT SELECT ON pedidos.itens TO bairrin_app, postgres'; END $$;",
      [/^GRANT para current_user \(P8\).*\(em SQL dinâmico\)$/, /^GRANT para postgres \(P8\)/],
    ],
    [
      'papel montado em tempo de execução (%I)',
      "DO $$ BEGIN EXECUTE format('GRANT SELECT ON pedidos.itens TO %I', 'bairrin_app'); END $$;",
      [/^GRANT para papel montado em tempo de execução \(P8\).*\(em SQL dinâmico\)$/],
    ],
    [
      'GRANT CREATE em schema para CURRENT_USER',
      'GRANT CREATE ON SCHEMA pedidos TO CURRENT_USER;',
      [/^GRANT para current_user \(P8\)/],
    ],
  ];
  for (const [nome, comando, esperados] of recusados) {
    it(`${nome}: recusado, mesmo em _destrutiva com guarda`, () => {
      for (const [pasta, sql] of [
        ['1_x', REVERSAO + comando],
        ['1_x_destrutiva', REVERSAO + GUARDA + comando],
      ]) {
        const resultado = mensagens(pasta, sql);
        assert.equal(resultado.length, esperados.length, `${pasta}\n${resultado.join('\n')}`);
        esperados.forEach((esperado, indice) => assert.match(resultado[indice], esperado));
      }
    });
  }

  it('ALTER DEFAULT PRIVILEGES ... GRANT para postgres reprova pelas duas regras', () => {
    const resultado = mensagens(
      '1_x',
      `${REVERSAO}ALTER DEFAULT PRIVILEGES IN SCHEMA pedidos GRANT SELECT ON TABLES TO postgres;`,
    );
    assert.equal(resultado.length, 2, resultado.join('\n'));
    assert.ok(resultado.some((m) => /^GRANT para postgres \(P8\)/.test(m)));
    assert.ok(resultado.some((m) => /^ALTER DEFAULT PRIVILEGES \.\.\. GRANT/.test(m)));
  });

  it('aceita GRANT só para os dois papéis do Bairrin, REVOKE de qualquer papel e texto que não executa', () => {
    const aceitos = [
      'GRANT SELECT ON pedidos.itens TO bairrin_app;',
      'GRANT SELECT ON pedidos.itens TO "bairrin_app";',
      'GRANT SELECT ON pedidos.itens TO bairrin_migracao;',
      'GRANT SELECT ON pedidos.itens TO BAIRRIN_APP;',
      'GRANT SELECT ON pedidos.itens TO GROUP bairrin_app;',
      'GRANT SELECT ON pedidos.itens TO bairrin_app\n  , "bairrin_migracao";',
      'GRANT USAGE ON SCHEMA pedidos TO bairrin_app;\nGRANT CREATE ON SCHEMA pedidos TO bairrin_migracao;',
      "DO $$ BEGIN EXECUTE 'GRANT SELECT ON pedidos.itens TO bairrin_app'; END $$;",
      "DO $$ BEGIN EXECUTE format('GRANT SELECT ON %I.itens TO bairrin_app', 'pedidos'); END $$;",
      'REVOKE ALL ON SCHEMA pedidos FROM postgres, supabase_admin, CURRENT_USER;',
      "DO $$ BEGIN RAISE NOTICE 'GRANT SELECT ON x TO postgres'; END $$;",
      "COMMENT ON TABLE pedidos.itens IS 'nunca GRANT SELECT ON pedidos.itens TO postgres';",
      '-- GRANT SELECT ON pedidos.itens TO postgres;\nSELECT 1;',
    ];
    for (const comando of aceitos) {
      assert.deepEqual(mensagens('1_x', REVERSAO + comando), [], comando);
    }
  });
});

describe('migração parecida com a da identidade do 01b (QA do grupo 0): sem falso positivo e com o motivo certo', () => {
  const MIGRACAO = `-- reversao: DROP SCHEMA identidade CASCADE (só em banco sem dados).
CREATE SCHEMA IF NOT EXISTS "identidade";
GRANT USAGE ON SCHEMA "identidade" TO bairrin_app;
CREATE TYPE "identidade"."PapelDaConta" AS ENUM ('consumidor', 'lojista', 'admin');
CREATE TABLE "identidade"."contas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "role" "identidade"."PapelDaConta" NOT NULL DEFAULT 'consumidor',
  "senha_hash" TEXT NOT NULL,
  "criada_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contas_email_ck" CHECK ("email" = lower("email"))
);
CREATE TABLE "identidade"."sessoes" (
  "id" UUID NOT NULL,
  "conta_id" UUID NOT NULL,
  CONSTRAINT "sessoes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contas_email_key" ON "identidade"."contas"("email");
CREATE INDEX "contas_admin_idx" ON "identidade"."contas"("id") WHERE "role" = 'admin';
ALTER TABLE "identidade"."sessoes" ADD CONSTRAINT "sessoes_conta_fkey" FOREIGN KEY ("conta_id") REFERENCES "identidade"."contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "identidade"."contas" OWNER TO bairrin_migracao;
ALTER TABLE "identidade"."sessoes" OWNER TO CURRENT_USER;
ALTER TABLE "identidade"."contas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identidade"."contas" FORCE ROW LEVEL SECURITY;
ALTER TABLE "identidade"."sessoes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contas_aplicacao" ON "identidade"."contas" FOR ALL TO bairrin_app USING (true) WITH CHECK (true);
CREATE POLICY "sessoes_aplicacao" ON "identidade"."sessoes" AS PERMISSIVE FOR ALL TO bairrin_app USING (true);
REVOKE ALL ON ALL TABLES IN SCHEMA "identidade" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON "identidade"."contas" TO bairrin_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "identidade"."sessoes" TO bairrin_app;
COMMENT ON TABLE "identidade"."contas" IS 'Contas; nunca GRANT TO PUBLIC nem SET ROLE aqui.';
CREATE FUNCTION "identidade"."toca"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.criada_em := now(); RETURN NEW; END $$;
CREATE TRIGGER "contas_toca" BEFORE UPDATE ON "identidade"."contas" FOR EACH ROW EXECUTE FUNCTION "identidade"."toca"();
`;
  const PASTA = '20261020000000_identidade';

  it('passa: tabela com RLS, política TO bairrin_app USING (true), GRANT, OWNER TO bairrin_migracao e coluna role', () => {
    assert.deepEqual(mensagens(PASTA, MIGRACAO), []);
  });

  /** Uma alteração por vez; cada uma reprova com exatamente o problema esperado. */
  const mutacoes = [
    [
      'política sem TO',
      (sql) => sql.replace('FOR ALL TO bairrin_app USING (true) WITH', 'FOR ALL USING (true) WITH'),
      [/^CREATE POLICY sem TO/],
    ],
    [
      'política para bairrin_app e PUBLIC, sem espaço depois da vírgula',
      (sql) =>
        sql.replace('TO bairrin_app USING (true) WITH', 'TO bairrin_app,PUBLIC USING (true) WITH'),
      [/^CREATE POLICY para public/],
    ],
    [
      'dono da tabela é a aplicação',
      (sql) => sql.replace('OWNER TO bairrin_migracao', 'OWNER TO bairrin_app'),
      [/^OWNER TO bairrin_app/],
    ],
    [
      'ALTER DEFAULT PRIVILEGES ... GRANT',
      (sql) =>
        `${sql}ALTER DEFAULT PRIVILEGES IN SCHEMA "identidade" GRANT SELECT ON TABLES TO bairrin_app;\n`,
      [/^ALTER DEFAULT PRIVILEGES \.\.\. GRANT/],
    ],
    [
      'GRANT de papel a papel',
      (sql) => `${sql}GRANT bairrin_migracao TO bairrin_app;\n`,
      [/^GRANT de papel sem ON/],
    ],
    [
      'GRANT da tabela de contas também para postgres (P8)',
      (sql) =>
        sql.replace(
          'ON "identidade"."contas" TO bairrin_app;',
          'ON "identidade"."contas" TO bairrin_app, postgres;',
        ),
      [/^GRANT para postgres \(P8\)/],
    ],
    [
      'GRANT para supabase_admin dentro de EXECUTE (P8)',
      (sql) =>
        `${sql}DO $$ BEGIN EXECUTE 'GRANT SELECT ON identidade.contas TO supabase_admin'; END $$;\n`,
      [/^GRANT para supabase_admin \(P8\).*\(em SQL dinâmico\)$/],
    ],
    ['SET ROLE', (sql) => `${sql}SET ROLE postgres;\n`, [/^troca de papel \(SET ROLE\)/]],
    [
      'ALTER ROLE ... BYPASSRLS (as duas regras)',
      (sql) => `${sql}ALTER ROLE bairrin_app BYPASSRLS;\n`,
      [/^ALTER ROLE/, /^BYPASSRLS/],
    ],
    ['row_security desligado', (sql) => `${sql}SET row_security = off;\n`, [/^row_security/]],
    [
      'COPY ... PROGRAM',
      (sql) => `${sql}COPY identidade.contas TO PROGRAM 'sh';\n`,
      [/^COPY \.\.\. PROGRAM/],
    ],
    [
      'EXECUTE com SQL concatenado',
      (sql) =>
        `${sql}DO $$ DECLARE t text := 'contas'; BEGIN EXECUTE 'ALTER TABLE identidade.' || t || ' DISABLE ROW LEVEL SECURITY'; END $$;\n`,
      [/^EXECUTE com SQL concatenado/],
    ],
    [
      'tabela sem RLS ao lado das outras',
      (sql) => sql.replace('ALTER TABLE "identidade"."sessoes" ENABLE ROW LEVEL SECURITY;\n', ''),
      [/^tabela "identidade\.sessoes" criada sem/],
    ],
  ];
  for (const [nome, alterar, esperados] of mutacoes) {
    it(`${nome}: reprova só por isso`, () => {
      const resultado = mensagens(PASTA, alterar(MIGRACAO));
      assert.equal(resultado.length, esperados.length, resultado.join('\n'));
      esperados.forEach((esperado, indice) => {
        assert.match(resultado[indice], esperado);
      });
    });
  }

  const recusadosNasBordas = [
    [
      'OWNER TO "BAIRRIN_MIGRACAO" entre aspas e em maiúsculas é outro papel',
      'ALTER TABLE identidade.contas OWNER TO "BAIRRIN_MIGRACAO";',
      /^OWNER TO BAIRRIN_MIGRACAO/,
    ],
    [
      'OWNER TO em linhas separadas',
      'ALTER TABLE identidade.contas OWNER\n  TO\n  bairrin_app;',
      /^OWNER TO bairrin_app/,
    ],
    [
      'GRANT de papel em linhas separadas',
      'GRANT\n  bairrin_migracao\n  TO bairrin_app;',
      /^GRANT de papel sem ON/,
    ],
    [
      'SET com comentário antes de ROLE',
      'SET /* x */ ROLE postgres;',
      /^troca de papel \(SET ROLE\)/,
    ],
    [
      'SET LOCAL ROLE dentro do corpo de uma função',
      'CREATE FUNCTION identidade.f() RETURNS int LANGUAGE plpgsql AS $$ BEGIN SET LOCAL ROLE postgres; RETURN 1; END $$;',
      /^troca de papel \(SET ROLE\)/,
    ],
    [
      'set_config em maiúsculas',
      "SELECT SET_CONFIG('ROLE', 'postgres', false);",
      /^troca de papel \(set_config\)/,
    ],
    [
      'ALTER ROLE dentro de DO',
      'DO $$ BEGIN ALTER ROLE bairrin_app BYPASSRLS; END $$;',
      /^ALTER ROLE/,
    ],
    [
      'COPY e PROGRAM em linhas separadas, em minúsculas',
      "copy identidade.contas\n to\n program 'sh';",
      /^COPY \.\.\. PROGRAM/,
    ],
    [
      'RETURN QUERY EXECUTE de variável',
      "CREATE FUNCTION identidade.f() RETURNS SETOF int LANGUAGE plpgsql AS $$ DECLARE q text := 'SELECT 1'; BEGIN RETURN QUERY EXECUTE q; END $$;",
      /^EXECUTE com argumento que não é literal/,
    ],
    [
      'EXECUTE de concat()',
      "DO $$ DECLARE t text := 'itens'; BEGIN EXECUTE concat('ANALYZE identidade.', t); END $$;",
      /^EXECUTE com argumento que não é literal/,
    ],
  ];
  for (const [nome, comando, esperado] of recusadosNasBordas) {
    it(`${nome}: recusado`, () => {
      const resultado = mensagens(PASTA, `${REVERSAO}${comando}`);
      assert.ok(
        resultado.some((mensagem) => esperado.test(mensagem)),
        `${esperado}: ${resultado.join(' | ')}`,
      );
    });
  }

  it('aceita as formas legítimas parecidas com as proibidas', () => {
    const aceitos = [
      // Coluna chamada role entre aspas, o contorno documentado do falso positivo.
      'UPDATE identidade.contas SET "role" = \'consumidor\' WHERE "role" IS NULL;',
      'ALTER TABLE identidade.contas ALTER COLUMN "role" SET NOT NULL, ALTER COLUMN role SET DEFAULT \'consumidor\';',
      'ALTER TABLE identidade.contas ADD COLUMN role text;',
      'RESET ROLE;',
      'RESET SESSION AUTHORIZATION;',
      "SET LOCAL lock_timeout = '5s';",
      // `||` depois de USING é parâmetro, não o texto do comando.
      "DO $$ DECLARE v text; BEGIN EXECUTE 'SELECT $1' INTO v USING 'a' || 'b'; END $$;",
      'CREATE TRIGGER t BEFORE INSERT ON identidade.contas FOR EACH ROW\n  EXECUTE\n  FUNCTION identidade.f();',
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA identidade TO bairrin_app;',
      'GRANT EXECUTE ON ALL ROUTINES IN SCHEMA identidade TO bairrin_app;',
      'CREATE POLICY p ON identidade.contas TO bairrin_app USING(true);',
      'CREATE POLICY p ON identidade.contas FOR INSERT TO bairrin_app WITH CHECK(true);',
      'CREATE POLICY p ON identidade.contas TO "Authenticated" USING (true);',
      'ALTER TABLE identidade.contas OWNER TO BAIRRIN_MIGRACAO;',
    ];
    for (const comando of aceitos) {
      assert.deepEqual(mensagens(PASTA, REVERSAO + comando), [], comando);
    }
  });

  it('UPDATE ... SET role sem aspas passa (R15): só SET no início do comando troca o papel', () => {
    assert.deepEqual(mensagens(PASTA, `${REVERSAO}UPDATE identidade.contas SET role = 'x';`), []);
    assert.match(
      mensagens(
        PASTA,
        `${REVERSAO}UPDATE identidade.contas SET role = 'x'; SET role TO postgres;`,
      ).join(),
      /^troca de papel \(SET ROLE\)/,
    );
  });

  it('SET ROLE é recusado em cada posição em que um comando começa (QA, R15)', () => {
    const casos = [
      ['no início do arquivo', 'SET ROLE postgres;'],
      ['depois de ponto e vírgula', 'SELECT 1; SET LOCAL ROLE postgres;'],
      ['comentário entre SET e ROLE', 'SET /* x */ ROLE postgres;'],
      ['depois de BEGIN', 'DO $$ BEGIN SET ROLE postgres; END $$;'],
      [
        'depois de ponto e vírgula dentro de DO',
        'DO $$ BEGIN PERFORM 1; SET ROLE postgres; END $$;',
      ],
      ['depois de THEN', 'DO $$ BEGIN IF true THEN SET ROLE postgres; END IF; END $$;'],
      ['depois de LOOP', 'DO $$ BEGIN LOOP SET ROLE postgres; EXIT; END LOOP; END $$;'],
      [
        'no corpo SQL depois de AS',
        'CREATE FUNCTION identidade.f() RETURNS void LANGUAGE sql AS $$ SET ROLE postgres $$;',
      ],
      [
        'depois de BEGIN ATOMIC',
        'CREATE FUNCTION identidade.f() RETURNS void LANGUAGE sql BEGIN ATOMIC SET ROLE postgres; END;',
      ],
    ];
    for (const [posicao, comando] of casos) {
      assert.match(
        mensagens(PASTA, REVERSAO + comando).join(),
        /^troca de papel \(SET ROLE\)/,
        posicao,
      );
    }
  });
});

describe('GRANT só para bairrin_app e bairrin_migracao: bordas do QA (P8, grupo A)', () => {
  const PASTA = '20261020000000_identidade';

  /** Cada um reprova pelo P8 (ou pelo S2, no caso de PUBLIC), com o papel certo na mensagem. */
  const recusados = [
    [
      'lista sem espaço depois da vírgula',
      'GRANT SELECT ON identidade.t TO bairrin_app,postgres;',
      'postgres',
    ],
    [
      'espaço antes da vírgula',
      'GRANT SELECT ON identidade.t TO bairrin_app ,postgres;',
      'postgres',
    ],
    [
      'comentário de bloco no meio da lista',
      'GRANT SELECT ON identidade.t TO bairrin_app, /* nada */ postgres;',
      'postgres',
    ],
    [
      'comentário de linha no meio da lista',
      'GRANT SELECT ON identidade.t TO bairrin_app, -- nada\n  postgres;',
      'postgres',
    ],
    [
      'dois GRANT na mesma linha, o segundo para postgres',
      'GRANT SELECT ON identidade.t TO bairrin_app;GRANT SELECT ON identidade.t TO postgres;',
      'postgres',
    ],
    ['papel em maiúsculas e sem aspas', 'GRANT SELECT ON identidade.t TO Postgres;', 'postgres'],
    [
      'papel entre aspas, sem espaço depois do TO',
      'GRANT SELECT ON identidade.t TO"postgres";',
      'postgres',
    ],
    [
      'papel embutido do Postgres',
      'GRANT SELECT ON identidade.t TO pg_read_all_data;',
      'pg_read_all_data',
    ],
    [
      'nome que só começa como o papel',
      'GRANT SELECT ON identidade.t TO bairrin_appx;',
      'bairrin_appx',
    ],
    [
      'nome que só termina como o papel',
      'GRANT SELECT ON identidade.t TO xbairrin_app;',
      'xbairrin_app',
    ],
    [
      'EXECUTE em todas as funções do schema',
      'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA identidade TO postgres;',
      'postgres',
    ],
    ['USAGE em tipo', 'GRANT USAGE ON TYPE identidade.papel TO postgres;', 'postgres'],
    [
      'USAGE em sequência para authenticated',
      'GRANT USAGE ON SEQUENCE identidade.seq TO authenticated;',
      'authenticated',
    ],
    [
      'em todas as tabelas, junto com PUBLIC',
      'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA identidade TO bairrin_app, public;',
      'public',
    ],
    [
      'GRANT dentro de função SQL (corpo entre aspas)',
      "CREATE FUNCTION identidade.f() RETURNS void LANGUAGE sql AS 'GRANT SELECT ON identidade.t TO postgres';",
      'postgres',
    ],
    [
      'GRANT dentro de função SQL (BEGIN ATOMIC)',
      'CREATE FUNCTION identidade.f() RETURNS void LANGUAGE sql BEGIN ATOMIC GRANT SELECT ON identidade.t TO postgres; END;',
      'postgres',
    ],
    [
      "GRANT dentro de EXECUTE com E'...'",
      "DO $$ BEGIN EXECUTE E'GRANT SELECT ON identidade.t TO postgres'; END $$;",
      'postgres',
    ],
  ];
  for (const [nome, comando, papel] of recusados) {
    it(`recusa ${nome}`, () => {
      const resultado = mensagens(PASTA, REVERSAO + comando);
      assert.equal(resultado.length, 1, resultado.join('\n'));
      assert.match(resultado[0], new RegExp(`^GRANT para ${papel} \\((P8|S2)\\)`));
    });
  }

  /** Destino que o verificador não consegue ler como nome: reprova, em vez de deixar passar. */
  const nomesIlegiveis = [
    [
      'concatenação (||) no EXECUTE',
      "DO $$ BEGIN EXECUTE 'GRANT SELECT ON identidade.t TO ' || 'postgres'; END $$;",
    ],
    [
      'variável no EXECUTE',
      "DO $$ DECLARE r text := 'postgres'; BEGIN EXECUTE 'GRANT SELECT ON identidade.t TO ' || r; END $$;",
    ],
    [
      '%s no format',
      "DO $$ BEGIN EXECUTE format('GRANT SELECT ON identidade.t TO %s', 'postgres'); END $$;",
    ],
    [
      '%L no format',
      "DO $$ BEGIN EXECUTE format('GRANT SELECT ON identidade.t TO %L', 'postgres'); END $$;",
    ],
    [
      '%I no meio da lista',
      "DO $$ BEGIN EXECUTE format('GRANT SELECT ON identidade.t TO bairrin_app, %I', 'postgres'); END $$;",
    ],
    [
      "\\x70 no lugar do p em E'...'",
      "DO $$ BEGIN EXECUTE E'GRANT SELECT ON identidade.t TO \\x70ostgres'; END $$;",
    ],
    ['parênteses no lugar do nome', 'GRANT SELECT ON identidade.t TO (postgres);'],
  ];
  for (const [nome, comando] of nomesIlegiveis) {
    it(`reprova destino que não é um nome: ${nome}`, () => {
      const resultado = mensagens(PASTA, REVERSAO + comando);
      assert.ok(
        resultado.some((m) =>
          /^GRANT para (papel montado em tempo de execução|postgres) \(P8\)/.test(m),
        ),
        resultado.join('\n') || 'passou sem problema',
      );
    });
  }

  it('aceita o par que a migração da identidade vai usar: REVOKE FROM PUBLIC e depois GRANT em função e tipo', () => {
    const sql = `${REVERSAO}CREATE TYPE identidade.papel AS ENUM ('a');
REVOKE USAGE ON TYPE identidade.papel FROM PUBLIC;
GRANT USAGE ON TYPE identidade.papel TO bairrin_app;
CREATE FUNCTION identidade.f() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT 1 $$;
REVOKE ALL ON FUNCTION identidade.f() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identidade.f() TO bairrin_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA identidade FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA identidade TO bairrin_app, bairrin_migracao;
REVOKE ALL ON SCHEMA identidade FROM PUBLIC;
GRANT USAGE ON SCHEMA identidade TO bairrin_app;
`;
    assert.deepEqual(mensagens(PASTA, sql), []);
  });

  it('o REVOKE de qualquer papel passa, mas o GRANT que vem depois para o mesmo papel reprova', () => {
    const sql = `${REVERSAO}REVOKE ALL ON ALL TABLES IN SCHEMA identidade FROM postgres, PUBLIC;
GRANT SELECT ON identidade.t TO postgres;
`;
    const resultado = mensagens(PASTA, sql);
    assert.equal(resultado.length, 1, resultado.join('\n'));
    assert.match(resultado[0], /^GRANT para postgres \(P8\)/);
  });

  it('a mensagem diz qual papel foi recusado e a regra, sem repetir o resto do comando', () => {
    const [problema] = analisarMigracao(
      PASTA,
      `${REVERSAO}GRANT SELECT ON identidade.contas TO bairrin_app, supabase_admin;`,
    );
    assert.equal(problema.linha, 2);
    assert.match(
      problema.mensagem,
      /^GRANT para supabase_admin \(P8\): só bairrin_app e bairrin_migracao/,
    );
    assert.doesNotMatch(problema.mensagem, /identidade\.contas/);
  });
});

describe('modelo da migração da identidade (QA do grupo A)', () => {
  const MODELO = join(FIXTURES, 'identidade-modelo');
  const PASTA = '20261020000000_identidade_qa';
  const sql = readFileSync(join(MODELO, PASTA, 'migration.sql'), 'utf8');

  it('passa no verificador, com REVOKE ... FROM PUBLIC antes dos GRANT de função e tipo', () => {
    const { total, problemas } = verificarMigracoes(MODELO);
    assert.equal(total, 1);
    assert.deepEqual(problemas, []);
    assert.match(sql, /REVOKE ALL ON FUNCTION[^;]*FROM PUBLIC;/);
    assert.match(sql, /REVOKE USAGE ON TYPE[^;]*FROM PUBLIC;/);
  });

  it('sem os REVOKE o verificador também passa: o que sobra para PUBLIC só o catálogo vê', () => {
    const semRevoke = sql.replaceAll(/^REVOKE .*$/gm, '');
    assert.doesNotMatch(semRevoke, /^REVOKE/m);
    assert.deepEqual(mensagens(PASTA, semRevoke), []);
  });

  it('um GRANT a mais para postgres no modelo reprova só por isso', () => {
    const comGrantAMais = `${sql}GRANT SELECT ON "identidade_qa"."contas" TO postgres;\n`;
    const resultado = mensagens(PASTA, comGrantAMais);
    assert.equal(resultado.length, 1, resultado.join('\n'));
    assert.match(resultado[0], /^GRANT para postgres \(P8\)/);
  });
});
