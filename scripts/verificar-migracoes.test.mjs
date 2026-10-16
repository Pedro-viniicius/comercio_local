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
    ];
    for (const comando of aceitos) {
      assert.deepEqual(mensagens('1_x', REVERSAO + comando), [], comando);
    }
  });
});
