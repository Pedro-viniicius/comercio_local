// Bordas do banco da Identidade (01b, rodada 2 do grupo B; S77, S78, Q19, R1) que as
// suítes `migracao` e `migracao-dominio` não cobrem: o limite exato da trigger do expurgo
// contra a regra do domínio, a trigger fora do alcance da aplicação, o histórico de tokens
// como tabela de acréscimo, todo e-mail aceito pelo domínio passando no CHECK e a releitura
// da validade do código depois da espera pela trava (`FOR UPDATE`). Papel da aplicação em
// transações desfeitas; o dono só semeia dado que a aplicação não escreve.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Conta,
  DIAS_ATE_EXPURGO_DE_NAO_VERIFICADA,
} from '../../../src/modulos/identidade/dominio/conta.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import { Telefone } from '../../../src/modulos/identidade/dominio/telefone.ts';
import { URL_APP_TESTE, URL_MIGRACAO_TESTE } from '../preparar-banco.ts';

const uuid = (n: number) => `00000000-0000-4000-8000-${(n + 0xb00).toString(16).padStart(12, '0')}`;
const CONTA = uuid(1);
const OUTRA = uuid(2);

let app: pg.Client;
let outra: pg.Client;
let dono: pg.Client;

beforeAll(async () => {
  app = new pg.Client({ connectionString: URL_APP_TESTE });
  outra = new pg.Client({ connectionString: URL_APP_TESTE });
  dono = new pg.Client({ connectionString: URL_MIGRACAO_TESTE });
  await Promise.all([app.connect(), outra.connect(), dono.connect()]);
});

afterAll(async () => {
  await Promise.all([app?.end(), outra?.end(), dono?.end()]);
});

async function naTransacao<T>(fn: () => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  try {
    return await fn();
  } finally {
    await app.query('ROLLBACK');
  }
}

/** Roda `comando` num savepoint e devolve o código do erro do Postgres (ou `null`, se passou). */
async function codigoDoErro(
  comando: string,
  parametros: unknown[] = [],
  manterSeCerto = false,
): Promise<string | null> {
  await app.query('SAVEPOINT tentativa');
  let codigo: string | null = null;
  try {
    await app.query(comando, parametros);
  } catch (erro) {
    codigo = (erro as { code?: string }).code ?? 'sem-codigo';
  }
  await app.query(
    manterSeCerto && codigo === null
      ? 'RELEASE SAVEPOINT tentativa'
      : 'ROLLBACK TO SAVEPOINT tentativa',
  );
  return codigo;
}

/** Conta ativa e não verificada, com `criada_em` e `ultimo_login_em` dados em SQL (relativos a now()). */
async function inserirConta(
  id: string,
  email: string,
  criadaEm: string,
  ultimoLoginEm = 'NULL',
): Promise<void> {
  await app.query(
    `INSERT INTO identidade.contas (id, nome, email_normalizado, telefone_e164, criada_em, ultimo_login_em)
     VALUES ($1, 'Pessoa', $2, '+5535999991234', ${criadaEm}, ${ultimoLoginEm})`,
    [id, email],
  );
}

const SETE_DIAS = `${DIAS_ATE_EXPURGO_DE_NAO_VERIFICADA} days`;

describe('trigger contas_so_expurgo: o limite é o do domínio (S78, P1-dono)', () => {
  // `now()` é fixo na transação: `now() - 7 dias` cai exatamente no limite.
  it.each([
    ['criada exatamente no limite de 7 dias', `now() - interval '${SETE_DIAS}'`, 'NULL', '23514'],
    ['criada 1 ms antes do limite', `now() - interval '${SETE_DIAS} 1 millisecond'`, 'NULL', null],
    [
      'criada há 30 dias, com login exatamente no limite',
      `now() - interval '30 days'`,
      `now() - interval '${SETE_DIAS}'`,
      '23514',
    ],
    [
      'criada há 30 dias, com login 1 ms antes do limite',
      `now() - interval '30 days'`,
      `now() - interval '${SETE_DIAS} 1 millisecond'`,
      null,
    ],
    [
      'criada há 30 dias, com login há 1 hora (o login vale mais que o cadastro)',
      `now() - interval '30 days'`,
      `now() - interval '1 hour'`,
      '23514',
    ],
    ['criada há 8 dias, com login recente', `now() - interval '8 days'`, 'now()', '23514'],
  ])('%s', async (_caso, criadaEm, ultimoLoginEm, esperado) => {
    await naTransacao(async () => {
      await inserirConta(CONTA, 'limite@exemplo.com', criadaEm, ultimoLoginEm);
      expect(await codigoDoErro('DELETE FROM identidade.contas WHERE id = $1', [CONTA])).toBe(
        esperado,
      );
    });
  });

  it('a regra do domínio concorda com a trigger nos dois lados do limite (estritamente mais antiga que 7 dias)', () => {
    const criadaEm = new Date('2026-10-01T12:00:00.000Z');
    const conta = Conta.criar({
      id: CONTA,
      nome: 'Ana',
      email: Email.criar('ana@exemplo.com'),
      telefone: Telefone.criar('(35) 99999-1234'),
      senhaHash: 'hash',
      agora: criadaEm,
    });
    const sete = DIAS_ATE_EXPURGO_DE_NAO_VERIFICADA * 86_400_000;
    expect(conta.deveSerExpurgada(new Date(criadaEm.getTime() + sete))).toBe(false);
    expect(conta.deveSerExpurgada(new Date(criadaEm.getTime() + sete + 1))).toBe(true);
  });

  it('um DELETE que mistura conta apagável e conta verificada falha inteiro e não apaga nenhuma', async () => {
    await naTransacao(async () => {
      await inserirConta(CONTA, 'velha@exemplo.com', `now() - interval '9 days'`);
      await inserirConta(OUTRA, 'verificada@exemplo.com', `now() - interval '9 days'`);
      await app.query('UPDATE identidade.contas SET email_verificado_em = now() WHERE id = $1', [
        OUTRA,
      ]);
      expect(
        await codigoDoErro('DELETE FROM identidade.contas WHERE id = ANY($1::uuid[])', [
          [CONTA, OUTRA],
        ]),
      ).toBe('23514');
      const { rows } = await app.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM identidade.contas WHERE id = ANY($1::uuid[])',
        [[CONTA, OUTRA]],
      );
      expect(rows[0]?.total).toBe(2);
    });
  });

  it('a aplicação não desliga, não troca e não apaga a trigger nem a função', async () => {
    await naTransacao(async () => {
      const comandos = [
        'SET session_replication_role = replica',
        'ALTER TABLE identidade.contas DISABLE TRIGGER contas_so_expurgo',
        'ALTER TABLE identidade.contas DISABLE TRIGGER ALL',
        'DROP TRIGGER contas_so_expurgo ON identidade.contas',
        'DROP FUNCTION identidade.recusar_exclusao_fora_do_expurgo() CASCADE',
        `CREATE OR REPLACE FUNCTION identidade.recusar_exclusao_fora_do_expurgo() RETURNS trigger
           LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END $$`,
      ];
      const codigos = [];
      for (const comando of comandos) codigos.push(await codigoDoErro(comando));
      expect(codigos).toEqual(comandos.map(() => '42501'));
    });
  });

  it('a conta de perfil admin ou lojista não é apagada nem pelo dono (a trigger vale para todos)', async () => {
    await dono.query('BEGIN');
    try {
      await dono.query(
        `INSERT INTO identidade.contas (id, nome, email_normalizado, telefone_e164, criada_em)
         VALUES ($1, 'Pessoa', 'dono@exemplo.com', '+5535999991234', now() - interval '30 days')`,
        [CONTA],
      );
      await dono.query(
        `INSERT INTO identidade.perfis_conta (conta_id, perfil, concedido_em) VALUES ($1, 'lojista', now())`,
        [CONTA],
      );
      await dono.query('SAVEPOINT t');
      await expect(
        dono.query('DELETE FROM identidade.contas WHERE id = $1', [CONTA]),
      ).rejects.toMatchObject({ code: '23514' });
      await dono.query('ROLLBACK TO SAVEPOINT t');
    } finally {
      await dono.query('ROLLBACK');
    }
  });
});

describe('histórico de tokens de renovação: só acréscimo, uma linha por token e sempre de uma sessão (S77)', () => {
  async function inserirSessao(id: string): Promise<void> {
    await app.query(
      `INSERT INTO identidade.sessoes (id, conta_id, familia_id, cliente, token_hash, expira_em, ultimo_uso_em, criada_em)
       VALUES ($1::uuid, $2, $1::uuid, 'app_consumidor', 'hash-' || $1::text, now() + interval '30 days', now(), now())`,
      [id, CONTA],
    );
  }
  const usar = (token: string, sessao: string) =>
    codigoDoErro(
      `INSERT INTO identidade.tokens_de_renovacao_usados (token_hash, familia_id, sessao_id, usado_em)
       VALUES ($1, $2, $2, clock_timestamp())`,
      [token, sessao],
      true,
    );

  it('o mesmo token não entra duas vezes (23505) e token de sessão inexistente é recusado (23503)', async () => {
    await naTransacao(async () => {
      await inserirConta(CONTA, 'hist@exemplo.com', 'now()');
      await inserirSessao(uuid(10));
      expect(await usar('antigo-1', uuid(10))).toBeNull();
      expect(await usar('antigo-1', uuid(10))).toBe('23505');
      expect(await usar('antigo-2', uuid(99))).toBe('23503');
    });
  });

  it('a aplicação lê o histórico, mas não o altera nem o apaga, nem por UPDATE sem linha', async () => {
    await naTransacao(async () => {
      await inserirConta(CONTA, 'hist2@exemplo.com', 'now()');
      await inserirSessao(uuid(10));
      await usar('antigo-1', uuid(10));
      const { rows } = await app.query<{ token_hash: string }>(
        'SELECT token_hash FROM identidade.tokens_de_renovacao_usados',
      );
      expect(rows).toEqual([{ token_hash: 'antigo-1' }]);
      for (const comando of [
        "UPDATE identidade.tokens_de_renovacao_usados SET familia_id = gen_random_uuid() WHERE token_hash = 'x'",
        "DELETE FROM identidade.tokens_de_renovacao_usados WHERE token_hash = 'x'",
      ]) {
        expect(await codigoDoErro(comando)).toBe('42501');
      }
      const { rows: depois } = await app.query(
        'SELECT 1 FROM identidade.tokens_de_renovacao_usados',
      );
      expect(depois).toHaveLength(1);
    });
  });

  it('o histórico acompanha a sessão apagada: depois dela, o token antigo some e o reuso vira inválido', async () => {
    await naTransacao(async () => {
      await inserirConta(CONTA, 'hist3@exemplo.com', 'now()');
      await inserirSessao(uuid(10));
      await usar('antigo-1', uuid(10));
      await app.query('DELETE FROM identidade.sessoes WHERE id = $1', [uuid(10)]);
      const { rows } = await app.query('SELECT 1 FROM identidade.tokens_de_renovacao_usados');
      expect(rows).toEqual([]);
    });
  });
});

describe('todo e-mail que o domínio aceita passa no CHECK de forma (Q19)', () => {
  /** Gerador com semente fixa (mulberry32): o mesmo conjunto a cada execução. */
  function aleatorio(semente: number): () => number {
    let a = semente;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('300 endereços gerados nos limites do formato (local de 1 a 64, domínio até 254 no total, sufixo xn--) entram na tabela', async () => {
    const sorteio = aleatorio(20261017);
    const escolher = (alfabeto: string, tamanho: number) =>
      Array.from(
        { length: tamanho },
        () => alfabeto[Math.floor(sorteio() * alfabeto.length)] ?? 'a',
      ).join('');
    const miolo = `abcdefghijklmnopqrstuvwxyz0123456789_'+-`;
    const rotulo = () => {
      const tamanho = 1 + Math.floor(sorteio() * 20);
      return `${escolher('abcdefghijklmnopqrstuvwxyz0123456789', 1)}${escolher('abcdefghijklmnopqrstuvwxyz0123456789-', tamanho)}`.replace(
        /-+$/,
        'x',
      );
    };
    const emails: string[] = [];
    for (let i = 0; emails.length < 300; i += 1) {
      const local = `${escolher('abcdefghijklmnopqrstuvwxyz0123456789', 1)}${escolher(miolo, Math.floor(sorteio() * 20))}`;
      const sufixo = i % 5 === 0 ? 'xn--p1ai' : 'com';
      const candidato = `${local}@${rotulo()}.${rotulo()}.${sufixo}`;
      const normalizado = Email.tentarCriar(candidato);
      if (normalizado !== null) emails.push(normalizado.valor);
    }
    // As quatro bordas de tamanho entram sempre.
    emails.push(
      'a@b.co',
      `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`,
      "o'neil+tag_x-y@exemplo.com.br",
      'a.b.c.d@xn--80ak6aa92e.com',
    );
    await naTransacao(async () => {
      let n = 0;
      for (const email of new Set(emails)) {
        n += 1;
        const codigo = await codigoDoErro(
          `INSERT INTO identidade.contas (nome, email_normalizado, telefone_e164, criada_em)
           VALUES ('Pessoa', $1, '+5535999991234', now())`,
          [email],
        );
        expect(codigo, `e-mail aceito pelo domínio e recusado pelo banco (caso ${n})`).toBeNull();
      }
    });
  });
});

describe('código por e-mail: a validade é conferida de novo depois da espera pela trava (R1)', () => {
  async function esperarBloqueio(pid: number): Promise<void> {
    for (let i = 0; i < 300; i += 1) {
      const { rows } = await app.query<{ espera: string | null }>(
        'SELECT wait_event_type AS espera FROM pg_stat_activity WHERE pid = $1',
        [pid],
      );
      if (rows[0]?.espera === 'Lock') return;
      await new Promise((resolver) => setTimeout(resolver, 10));
    }
    throw new Error('a segunda conexão não chegou a esperar a trava');
  }

  /** A consulta que o adaptador faz: o mais recente que ainda vale, travado. */
  const VIGENTE_PARA_ATUALIZAR = `
    SELECT id, tentativas FROM identidade.codigos_verificacao
     WHERE conta_id = $1 AND finalidade = 'verificacao_email'
       AND usado_em IS NULL AND expira_em > now() AND tentativas < 5
     ORDER BY criado_em DESC LIMIT 1 FOR UPDATE`;

  it('o código esgotado pela primeira conexão enquanto a segunda esperava volta sem linha; com 4 tentativas, a segunda lê 4 e conta a quinta', async () => {
    try {
      await dono.query(
        `INSERT INTO identidade.contas (id, nome, email_normalizado, telefone_e164, criada_em)
         VALUES ($1, 'Pessoa', 'codigo@exemplo.com', '+5535999991234', now() - interval '30 days')`,
        [CONTA],
      );
      await dono.query(
        `INSERT INTO identidade.codigos_verificacao (id, conta_id, finalidade, codigo_hmac, tentativas, expira_em, criado_em)
         VALUES ($1, $2, 'verificacao_email', 'hmac', 3, now() + interval '10 minutes', now())`,
        [uuid(20), CONTA],
      );
      const pidDaOutra = (await outra.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows[0]?.pid;
      await app.query('BEGIN');
      await outra.query('BEGIN');

      // Primeira: lê 3, grava 4 e segura a trava.
      const primeira = await app.query<{ tentativas: number }>(VIGENTE_PARA_ATUALIZAR, [CONTA]);
      expect(primeira.rows[0]?.tentativas).toBe(3);
      await app.query('UPDATE identidade.codigos_verificacao SET tentativas = 4 WHERE id = $1', [
        uuid(20),
      ]);

      // Segunda: espera, e depois da confirmação lê o valor gravado (4), não o de antes (3).
      const segunda = outra.query<{ tentativas: number }>(VIGENTE_PARA_ATUALIZAR, [CONTA]);
      await esperarBloqueio(pidDaOutra ?? -1);
      await app.query('COMMIT');
      const lida = await segunda;
      expect(lida.rows.map((l) => l.tentativas)).toEqual([4]);
      await outra.query(
        'UPDATE identidade.codigos_verificacao SET tentativas = tentativas + 1 WHERE id = $1',
        [uuid(20)],
      );
      await outra.query('COMMIT');
      const { rows } = await dono.query<{ tentativas: number }>(
        'SELECT tentativas FROM identidade.codigos_verificacao WHERE id = $1',
        [uuid(20)],
      );
      expect(rows).toEqual([{ tentativas: 5 }]);

      // Com o código já esgotado (5), uma nova leitura não o devolve mais.
      await outra.query('BEGIN');
      const esgotado = await outra.query(VIGENTE_PARA_ATUALIZAR, [CONTA]);
      await outra.query('ROLLBACK');
      expect(esgotado.rows).toEqual([]);
    } finally {
      await app.query('ROLLBACK').catch(() => undefined);
      await outra.query('ROLLBACK').catch(() => undefined);
      await dono.query('DELETE FROM identidade.contas WHERE id = $1', [CONTA]);
    }
  });
});

describe('seed: um documento já gravado (e revisado) nunca é sobrescrito (S79, S24)', () => {
  const PASTA_DA_API = fileURLToPath(new URL('../../../', import.meta.url));
  const apagarSemeados = () =>
    dono.query("DELETE FROM identidade.documentos_legais WHERE versao = '1.0'");

  beforeAll(apagarSemeados);
  afterAll(apagarSemeados);

  it('o texto revisado e a data de vigência ficam, e o seed diz que os dois já existiam', async () => {
    await dono.query(
      `INSERT INTO identidade.documentos_legais (tipo, versao, conteudo, vigente_desde)
       VALUES ('termos', '1.0', 'Texto revisado pelo advogado', '2026-01-02T03:04:05Z')`,
    );
    const resultado = spawnSync(process.execPath, ['src/cli/seed.ts'], {
      cwd: PASTA_DA_API,
      env: {
        PATH: process.env['PATH'] ?? '',
        NODE_ENV: 'test',
        DATABASE_URL_MIGRACAO: URL_MIGRACAO_TESTE,
      },
      encoding: 'utf8',
    });

    expect(resultado.status).toBe(0);
    // A política não existia: entra. Os termos já existiam: ficam como estão.
    expect(resultado.stdout).toContain('1 incluídos, 1 já existiam');
    const { rows } = await dono.query<{ tipo: string; conteudo: string; vigente_desde: Date }>(
      `SELECT tipo::text AS tipo, conteudo, vigente_desde FROM identidade.documentos_legais
        WHERE versao = '1.0' ORDER BY tipo`,
    );
    expect(rows.map((linha) => [linha.tipo, linha.conteudo.startsWith('# Política')])).toEqual([
      ['privacidade', true],
      ['termos', false],
    ]);
    expect(rows[1]).toMatchObject({
      conteudo: 'Texto revisado pelo advogado',
      vigente_desde: new Date('2026-01-02T03:04:05Z'),
    });
  });
});
