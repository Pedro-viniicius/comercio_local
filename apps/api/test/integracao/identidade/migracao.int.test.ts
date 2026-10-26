// Integração da migração de identidade (01b, etapa 3; CA-01 e CA-10; S1, S2,
// S3, S10, S16, S24, S77, S78 e S79; R1): o `globalSetup` (preparar-banco.ts) aplicou as
// migrações com o papel de migração. Aqui se confere o schema `identidade`
// com os dois papéis de verdade, o seed dos documentos legais e que o
// `schema.prisma` descreve o mesmo banco.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acessosIndevidos,
  problemasNoCatalogo,
  schemasDoBairrin,
} from '../../../src/compartilhado/infra/schemas-fechados.ts';
import { URL_APP_TESTE, URL_MIGRACAO_TESTE } from '../preparar-banco.ts';

const PASTA_DA_API = fileURLToPath(new URL('../../../', import.meta.url));

/** Colunas de cada tabela, na ordem: `nome tipo`, com ` null` se aceita nulo. */
const COLUNAS: Record<string, string[]> = {
  bloqueios_login: [
    'chave_hmac text',
    'tipo tipo_de_bloqueio',
    'falhas int4',
    'nivel int4',
    'janela_inicio timestamptz',
    'bloqueado_ate timestamptz null',
  ],
  codigos_recuperacao: [
    'id uuid',
    'conta_id uuid',
    'codigo_hmac text',
    'usado_em timestamptz null',
  ],
  codigos_verificacao: [
    'id uuid',
    'conta_id uuid',
    'finalidade finalidade_do_codigo',
    'codigo_hmac text',
    'tentativas int4',
    'expira_em timestamptz',
    'usado_em timestamptz null',
    'criado_em timestamptz',
  ],
  consentimentos: ['id uuid', 'conta_id uuid', 'documento_id uuid', 'aceito_em timestamptz'],
  contas: [
    'id uuid',
    'nome text',
    'email_normalizado text',
    'telefone_e164 text null',
    'senha_hash text null',
    'email_verificado_em timestamptz null',
    'ultimo_login_em timestamptz null',
    'status status_da_conta',
    'criada_em timestamptz',
    'desativada_em timestamptz null',
    'anonimizada_em timestamptz null',
  ],
  documentos_legais: [
    'id uuid',
    'tipo tipo_de_documento_legal',
    'versao text',
    'conteudo text',
    'vigente_desde timestamptz',
  ],
  exportacoes_titular: [
    'id uuid',
    'conta_id uuid',
    'conteudo_cifrado text',
    'criada_em timestamptz',
    'expira_em timestamptz',
    'baixada_em timestamptz null',
  ],
  perfis_conta: [
    'conta_id uuid',
    'perfil perfil',
    'concedido_em timestamptz',
    'concedido_por uuid null',
  ],
  segundo_fator: [
    'conta_id uuid',
    'segredo_cifrado text',
    'confirmado_em timestamptz null',
    'ultimo_passo_usado int4 null',
  ],
  sessoes: [
    'id uuid',
    'conta_id uuid',
    'familia_id uuid',
    'cliente cliente_da_sessao',
    'token_hash text',
    'token_anterior_hash text null',
    'par_novo_cifrado text null',
    'par_novo_expira_em timestamptz null',
    'trocado_em timestamptz null',
    'expira_em timestamptz',
    'expira_absoluto_em timestamptz null',
    'ultimo_uso_em timestamptz',
    'mfa bool',
    'revogada_em timestamptz null',
    'motivo_revogacao text null',
    'criada_em timestamptz',
  ],
  tokens_de_renovacao_usados: [
    'token_hash text',
    'familia_id uuid',
    'sessao_id uuid',
    'usado_em timestamptz',
  ],
  solicitacoes_titular: [
    'id uuid',
    'conta_id uuid',
    'tipo tipo_de_solicitacao',
    'status status_da_solicitacao',
    'solicitada_em timestamptz',
    'concluida_em timestamptz null',
  ],
};

const TABELAS = Object.keys(COLUNAS).sort();

/** Só leitura e inclusão para a aplicação (prova de aceite e histórico de tokens, S77). */
const SO_ACRESCIMO = ['consentimentos', 'tokens_de_renovacao_usados'];

/** Só leitura para a aplicação: versão nova entra por migração ou pelo seed (S79). */
const SO_LEITURA = ['documentos_legais'];

/** Privilégios e políticas que a aplicação deve ter em cada tabela. */
function permissoesDaAplicacao(tabela: string): { privilegios: string[]; politicas: string[] } {
  if (SO_LEITURA.includes(tabela)) return { privilegios: ['SELECT'], politicas: ['SELECT'] };
  if (SO_ACRESCIMO.includes(tabela)) {
    return { privilegios: ['SELECT', 'INSERT'], politicas: ['INSERT', 'SELECT'] };
  }
  return { privilegios: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'], politicas: ['ALL'] };
}

/** Filhas de `contas`, que somem junto com a conta (ON DELETE CASCADE). */
const FILHAS_DA_CONTA = [
  'codigos_recuperacao',
  'codigos_verificacao',
  'consentimentos',
  'exportacoes_titular',
  'perfis_conta',
  'segundo_fator',
  'sessoes',
  'solicitacoes_titular',
];

/** Tabelas da sessão e do 2FA gravadas no teste de S1 e S16. */
const TABELAS_DA_SESSAO_E_DO_2FA = [
  'codigos_recuperacao',
  'codigos_verificacao',
  'exportacoes_titular',
  'segundo_fator',
  'sessoes',
  'solicitacoes_titular',
];

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

/** Roda `fn` numa transação da aplicação e desfaz tudo no fim. */
async function naTransacaoDaAplicacao<T>(fn: () => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  try {
    return await fn();
  } finally {
    await app.query('ROLLBACK');
  }
}

/** Código do erro do Postgres de um comando que deve falhar (numa transação desfeita). */
async function codigoDaFalha(
  preparo: readonly string[],
  comando: string,
  parametros: unknown[] = [],
): Promise<string | undefined> {
  return naTransacaoDaAplicacao(async () => {
    for (const sql of preparo) await app.query(sql);
    try {
      await app.query(comando, parametros);
    } catch (erro) {
      return (erro as { code?: string }).code;
    }
    throw new Error('O comando deveria ter falhado.');
  });
}

const CONTA_ID = '00000000-0000-4000-8000-000000000001';
const OUTRA_CONTA_ID = '00000000-0000-4000-8000-000000000002';

/**
 * Conta ativa da aplicação com id fixo; os dados são fictícios. Com `diasAtras`, criada há
 * tantos dias (8 a torna apagável pelo expurgo, S78).
 */
function inserirConta(id = CONTA_ID, email = 'pessoa@exemplo.com', diasAtras = 0): string {
  return `INSERT INTO identidade.contas (id, nome, email_normalizado, telefone_e164, senha_hash, criada_em)
          VALUES ('${id}', 'Pessoa de Teste', '${email}', '+5535999991234', 'hash-ficticio',
                  now() - interval '${diasAtras} days')`;
}

/**
 * Documentos legais gravados pelo dono (a aplicação só lê, S79) e apagados no fim. O teste
 * roda `fn` com os ids; os consentimentos que ele gravar precisam ser desfeitos antes (FK
 * RESTRICT), o que `naTransacaoDaAplicacao` faz.
 */
async function comDocumentos<T>(
  versao: string,
  tipos: readonly string[],
  fn: (ids: string[]) => Promise<T>,
): Promise<T> {
  const { rows } = await dono.query<{ id: string }>(
    `INSERT INTO identidade.documentos_legais (tipo, versao, conteudo, vigente_desde)
     SELECT t::identidade.tipo_de_documento_legal, $1, 'texto', now() FROM unnest($2::text[]) AS t
     RETURNING id`,
    [versao, tipos],
  );
  try {
    return await fn(rows.map(({ id }) => id));
  } finally {
    await dono.query('DELETE FROM identidade.documentos_legais WHERE versao = $1', [versao]);
  }
}

/** Linhas da conta em cada tabela, uma consulta por vez (o cliente é um só). */
async function linhasDaConta(
  tabelas: readonly string[],
  contaId = CONTA_ID,
): Promise<Record<string, number>> {
  const totais: Record<string, number> = {};
  for (const tabela of tabelas) {
    const { rows } = await app.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM identidade.${tabela} WHERE conta_id = $1`,
      [contaId],
    );
    totais[tabela] = rows[0]?.total ?? -1;
  }
  return totais;
}

/** O mesmo total para cada tabela. */
const totalEmCada = (tabelas: readonly string[], total: number) =>
  Object.fromEntries(tabelas.map((tabela) => [tabela, total]));

describe('estrutura do schema identidade', () => {
  it('cria as doze tabelas, com RLS ligado e sem FORCE, como no núcleo', async () => {
    const { rows } = await dono.query<{ tabela: string; rls: boolean; forcado: boolean }>(
      `SELECT c.relname AS tabela, c.relrowsecurity AS rls, c.relforcerowsecurity AS forcado
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'identidade' AND c.relkind IN ('r', 'p')
        ORDER BY 1`,
    );
    expect(rows).toEqual(TABELAS.map((tabela) => ({ tabela, rls: true, forcado: false })));
  });

  it('tem as colunas do plano, com as de S1, S10, S16 e ultimo_login_em (P1-dono)', async () => {
    const { rows } = await dono.query<{ tabela: string; colunas: string[] }>(
      `SELECT table_name AS tabela,
              array_agg(column_name || ' ' || udt_name || CASE WHEN is_nullable = 'YES' THEN ' null' ELSE '' END
                        ORDER BY ordinal_position) AS colunas
         FROM information_schema.columns WHERE table_schema = 'identidade'
        GROUP BY table_name`,
    );
    expect(Object.fromEntries(rows.map(({ tabela, colunas }) => [tabela, colunas]))).toEqual(
      COLUNAS,
    );
  });

  // Os mesmos valores de PERFIS, CLIENTES e ETAPAS_DO_DESAFIO
  // (`@bairrin/contratos/validadores`); quem casa os tipos é o repositório
  // Prisma da etapa 7, conferido pelo typecheck.
  it('os enums têm os valores do plano, com a etapa do desafio do 2FA (S1)', async () => {
    const { rows } = await dono.query<{ tipo: string; valores: string[] }>(
      `SELECT t.typname AS tipo, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS valores
         FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
         JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = 'identidade' GROUP BY t.typname`,
    );
    expect(Object.fromEntries(rows.map(({ tipo, valores }) => [tipo, valores]))).toEqual({
      cliente_da_sessao: ['app_consumidor', 'app_lojista', 'painel'],
      finalidade_do_codigo: [
        'verificacao_email',
        'recuperacao_senha',
        'desafio_configurar',
        'desafio_verificar',
      ],
      perfil: ['consumidor', 'lojista', 'admin'],
      status_da_conta: ['ativa', 'desativada', 'anonimizada'],
      status_da_solicitacao: ['pendente', 'aguardando_pendencias', 'concluida'],
      tipo_de_bloqueio: ['email', 'ip', 'segundo_fator'],
      tipo_de_documento_legal: ['termos', 'privacidade'],
      tipo_de_solicitacao: ['exportacao', 'exclusao'],
    });
  });

  it('não tem FK para outro schema', async () => {
    const { rows } = await dono.query<{ restricao: string }>(
      `SELECT con.conname AS restricao FROM pg_constraint con
         JOIN pg_namespace n ON n.oid = con.connamespace
         JOIN pg_class alvo ON alvo.oid = con.confrelid
        WHERE n.nspname = 'identidade' AND con.contype = 'f'
          AND alvo.relnamespace <> n.oid`,
    );
    expect(rows).toEqual([]);
  });

  it('tem política só para bairrin_app: nos consentimentos e no histórico, SELECT e INSERT; nos documentos, só SELECT (S29, S79)', async () => {
    const { rows } = await dono.query<{ tabela: string; comando: string; papeis: string[] }>(
      `SELECT tablename AS tabela, cmd AS comando, roles::text[] AS papeis FROM pg_policies
        WHERE schemaname = 'identidade' ORDER BY 1, 2`,
    );
    const papeis = ['bairrin_app'];
    expect(rows).toEqual(
      TABELAS.flatMap((tabela) =>
        permissoesDaAplicacao(tabela).politicas.map((comando) => ({ tabela, comando, papeis })),
      ),
    );
  });

  it('dá DML sem TRUNCATE à aplicação; nos consentimentos e no histórico, só SELECT e INSERT; nos documentos, só SELECT (S3, S79)', async () => {
    const { rows } = await dono.query<{ tabela: string; privilegios: string[] }>(
      `SELECT t.tabela,
              array(SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
                     WHERE has_table_privilege('bairrin_app', 'identidade.' || t.tabela, p)) AS privilegios
         FROM unnest($1::text[]) AS t(tabela) ORDER BY 1`,
      [TABELAS],
    );
    expect(rows).toEqual(
      TABELAS.map((tabela) => ({ tabela, privilegios: permissoesDaAplicacao(tabela).privilegios })),
    );
  });

  it('a aplicação tem USAGE sem CREATE em identidade e nenhum USAGE em public (S2)', async () => {
    const { rows } = await dono.query(
      `SELECT has_schema_privilege('bairrin_app', 'identidade', 'USAGE') AS uso,
              has_schema_privilege('bairrin_app', 'identidade', 'CREATE') AS criacao,
              has_schema_privilege('bairrin_app', 'public', 'USAGE') AS "usoDoPublic"`,
    );
    expect(rows[0]).toEqual({ uso: true, criacao: false, usoDoPublic: false });
  });

  it('os tipos enum não dão USAGE a PUBLIC nem à aplicação', async () => {
    const { rows } = await dono.query<{ tipo: string; acl: string; usoDaAplicacao: boolean }>(
      `SELECT t.typname AS tipo, t.typacl::text AS acl,
              has_type_privilege('bairrin_app', t.oid, 'USAGE') AS "usoDaAplicacao"
         FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'identidade' AND t.typtype = 'e' ORDER BY 1`,
    );
    expect(rows).toHaveLength(8);
    for (const tipo of rows) {
      expect(tipo).toEqual({
        tipo: tipo.tipo,
        acl: '{bairrin_migracao=U/bairrin_migracao}',
        usoDaAplicacao: false,
      });
    }
  });
});

describe('checagens do release com o schema identidade', () => {
  it('schemasDoBairrin inclui identidade, pelo dono e pelo USAGE da aplicação (Seg-3)', async () => {
    expect(await schemasDoBairrin(dono)).toContain('identidade');
    expect(await schemasDoBairrin(app)).toContain('identidade');
  });

  it('o catálogo e os schemas fechados continuam dentro das regras (S26, S33, P8)', async () => {
    expect(await problemasNoCatalogo(dono)).toEqual([]);
    expect(await problemasNoCatalogo(dono, { schemas: ['identidade'] })).toEqual([]);
    expect(await acessosIndevidos(dono)).toEqual([]);
  });
});

describe('aplicação (bairrin_app) no schema identidade', () => {
  it('cadastra conta com perfil, aceite versionado e código de e-mail (CA-01) e lê versão e data do aceite (CA-10)', async () => {
    const aceite = await comDocumentos('teste-1', ['termos', 'privacidade'], () =>
      naTransacaoDaAplicacao(async () => {
        await app.query(inserirConta());
        await app.query(
          `INSERT INTO identidade.perfis_conta (conta_id, perfil, concedido_em)
         VALUES ($1, 'consumidor', now())`,
          [CONTA_ID],
        );
        await app.query(
          `INSERT INTO identidade.consentimentos (conta_id, documento_id, aceito_em)
         SELECT $1, id, '2026-10-17T12:00:00Z' FROM identidade.documentos_legais WHERE versao = 'teste-1'`,
          [CONTA_ID],
        );
        await app.query(
          `INSERT INTO identidade.codigos_verificacao (conta_id, finalidade, codigo_hmac, expira_em, criado_em)
         VALUES ($1, 'verificacao_email', 'hmac-ficticio', now() + interval '30 minutes', now())`,
          [CONTA_ID],
        );
        const { rows } = await app.query<{ tipo: string; versao: string; aceitoEm: Date }>(
          `SELECT d.tipo::text AS tipo, d.versao, c.aceito_em AS "aceitoEm"
           FROM identidade.consentimentos c
           JOIN identidade.documentos_legais d ON d.id = c.documento_id
          WHERE c.conta_id = $1 ORDER BY 1`,
          [CONTA_ID],
        );
        return rows;
      }),
    );
    const aceitoEm = new Date('2026-10-17T12:00:00Z');
    expect(aceite).toEqual([
      { tipo: 'privacidade', versao: 'teste-1', aceitoEm },
      { tipo: 'termos', versao: 'teste-1', aceitoEm },
    ]);
  });

  it('grava sessão com par novo cifrado (S16), desafio com etapa (S1), 2FA, freio, pedido do titular e exportação (S10)', async () => {
    const totais = await naTransacaoDaAplicacao(async () => {
      await app.query(inserirConta());
      await app.query(
        `INSERT INTO identidade.sessoes (conta_id, familia_id, cliente, token_hash, par_novo_cifrado,
                                         par_novo_expira_em, expira_em, expira_absoluto_em,
                                         ultimo_uso_em, mfa, criada_em)
         VALUES ($1, gen_random_uuid(), 'painel', 'hash-1', 'cifrado', now() + interval '60 seconds',
                 now() + interval '30 minutes', now() + interval '12 hours', now(), true, now())`,
        [CONTA_ID],
      );
      await app.query(
        `INSERT INTO identidade.codigos_verificacao (conta_id, finalidade, codigo_hmac, expira_em, criado_em)
         VALUES ($1, 'desafio_configurar', 'hmac-desafio', now() + interval '5 minutes', now())`,
        [CONTA_ID],
      );
      await app.query(
        `INSERT INTO identidade.segundo_fator (conta_id, segredo_cifrado) VALUES ($1, 'cifrado')`,
        [CONTA_ID],
      );
      await app.query(
        `INSERT INTO identidade.codigos_recuperacao (conta_id, codigo_hmac) VALUES ($1, 'hmac-rec')`,
        [CONTA_ID],
      );
      await app.query(
        `INSERT INTO identidade.bloqueios_login (chave_hmac, tipo, falhas, nivel, janela_inicio)
         VALUES ('hmac-conta', 'segundo_fator', 1, 0, now())`,
      );
      await app.query(
        `INSERT INTO identidade.solicitacoes_titular (conta_id, tipo, solicitada_em)
         VALUES ($1, 'exportacao', now())`,
        [CONTA_ID],
      );
      await app.query(
        `INSERT INTO identidade.exportacoes_titular (conta_id, conteudo_cifrado, criada_em, expira_em)
         VALUES ($1, 'cifrado', now(), now() + interval '7 days')`,
        [CONTA_ID],
      );
      // Rotação: o token novo entra e o anterior fica para detectar reuso.
      const rotacao = await app.query(
        `UPDATE identidade.sessoes SET token_anterior_hash = token_hash, token_hash = 'hash-2',
                trocado_em = now() WHERE conta_id = $1`,
        [CONTA_ID],
      );
      expect(rotacao.rowCount).toBe(1);
      return linhasDaConta(TABELAS_DA_SESSAO_E_DO_2FA);
    });
    expect(totais).toEqual(totalEmCada(TABELAS_DA_SESSAO_E_DO_2FA, 1));
  });

  it('recusa e-mail repetido', async () => {
    expect(await codigoDaFalha([inserirConta()], inserirConta(OUTRA_CONTA_ID))).toBe('23505');
  });

  const contaCom = (colunas: string, valores: string) =>
    `INSERT INTO identidade.contas (nome, email_normalizado, criada_em, ${colunas})
     VALUES ('Pessoa', 'outra@exemplo.com', now(), ${valores})`;
  const sessaoCom = (cliente: string, extra: string, valores: string) =>
    `INSERT INTO identidade.sessoes (conta_id, familia_id, cliente, token_hash, expira_em,
                                     ultimo_uso_em, criada_em, ${extra})
     VALUES ('${CONTA_ID}', gen_random_uuid(), '${cliente}', 'hash-x', now(), now(), now(), ${valores})`;

  const contaComEmail = (email: string) =>
    `INSERT INTO identidade.contas (nome, email_normalizado, telefone_e164, criada_em)
     VALUES ('Pessoa', '${email}', '+5535999991234', now())`;
  const sessaoRevogada = (colunas: string, valores: string) =>
    sessaoCom('app_consumidor', colunas, valores);

  it.each([
    ['e-mail fora da forma normalizada', contaComEmail('Pessoa@Exemplo.com')],
    ['e-mail vazio (Q19)', contaComEmail('')],
    ['e-mail sem @ (Q19)', contaComEmail('pessoa.exemplo.com')],
    ['e-mail com dois @ (Q19)', contaComEmail('pessoa@@exemplo.com')],
    ['e-mail sem parte local (Q19)', contaComEmail('@exemplo.com')],
    ['e-mail sem domínio (Q19)', contaComEmail('pessoa@')],
    ['e-mail fora do ASCII (Q19)', contaComEmail('josé@exemplo.com')],
    ['e-mail com espaço (Q19)', contaComEmail('pessoa @exemplo.com')],
    ['hash de senha vazio (R3)', contaCom('telefone_e164, senha_hash', "'+5535999991234', ''")],
    [
      'hash de senha só com espaço (R3)',
      contaCom('telefone_e164, senha_hash', "'+5535999991234', '  '"),
    ],
    ['sessão revogada sem motivo (R3)', sessaoRevogada('revogada_em', 'now()')],
    ['motivo de revogação sem data (R3)', sessaoRevogada('motivo_revogacao', "'logout'")],
    ['telefone fora do E.164', contaCom('telefone_e164', "'35999991234'")],
    ['conta ativa sem telefone', contaCom('status', "'ativa'")],
    [
      'conta desativada sem data',
      contaCom('telefone_e164, status', "'+5535999991234', 'desativada'"),
    ],
    [
      'conta anonimizada com senha (S5)',
      contaCom(
        'senha_hash, status, desativada_em, anonimizada_em',
        "'hash', 'anonimizada', now(), now()",
      ),
    ],
    [
      'conta anonimizada com telefone (S5)',
      contaCom(
        'telefone_e164, status, desativada_em, anonimizada_em',
        "'+5535999991234', 'anonimizada', now(), now()",
      ),
    ],
    ['sessão de app com mfa (S1)', sessaoCom('app_consumidor', 'mfa', 'true')],
    ['sessão do painel sem fim absoluto (S9)', sessaoCom('painel', 'mfa', 'false')],
    ['par novo sem prazo (S16)', sessaoCom('app_lojista', 'par_novo_cifrado', "'cifrado'")],
    [
      'tentativas negativas',
      `INSERT INTO identidade.codigos_verificacao (conta_id, finalidade, codigo_hmac, tentativas, expira_em, criado_em)
       VALUES ('${CONTA_ID}', 'recuperacao_senha', 'hmac', -1, now(), now())`,
    ],
  ])('a restrição CHECK recusa %s', async (_caso, comando) => {
    expect(await codigoDaFalha([inserirConta()], comando)).toBe('23514');
  });

  it('a restrição CHECK recusa versão de documento fora do formato, também para o dono (S24)', async () => {
    await dono.query('BEGIN');
    try {
      await expect(
        dono.query(
          `INSERT INTO identidade.documentos_legais (tipo, versao, conteudo, vigente_desde)
           VALUES ('termos', 'v 1', 'texto', now())`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await dono.query('ROLLBACK');
    }
  });

  it('a conta anonimizada sem senha nem telefone passa', async () => {
    const { rowCount } = await naTransacaoDaAplicacao(() =>
      app.query(contaCom('status, desativada_em, anonimizada_em', "'anonimizada', now(), now()")),
    );
    expect(rowCount).toBe(1);
  });

  it.each(
    [...SO_ACRESCIMO, ...SO_LEITURA].flatMap((tabela) => [
      [
        `UPDATE identidade.${tabela} SET ${tabela === 'tokens_de_renovacao_usados' ? 'token_hash = token_hash' : 'id = id'}`,
      ],
      [`DELETE FROM identidade.${tabela}`],
    ]),
  )(
    'não altera nem apaga documentos legais, consentimentos e histórico de tokens: %s',
    async (comando) => {
      expect(await codigoDaFalha([], comando)).toBe('42501');
    },
  );

  it('não inclui documento legal: versão nova é por migração ou seed (S79)', async () => {
    expect(
      await codigoDaFalha(
        [],
        `INSERT INTO identidade.documentos_legais (tipo, versao, conteudo, vigente_desde)
         VALUES ('termos', 'teste-app', 'texto', now())`,
      ),
    ).toBe('42501');
  });

  it.each(TABELAS)('não consegue TRUNCATE em %s', async (tabela) => {
    expect(await codigoDaFalha([], `TRUNCATE identidade.${tabela}`)).toBe('42501');
  });

  it('apagar a conta do expurgo leva junto as filhas, inclusive consentimentos sem DELETE da aplicação (P1-dono)', async () => {
    const depois = await comDocumentos('teste-2', ['termos'], () =>
      naTransacaoDaAplicacao(async () => {
        // Não verificada, sem login e criada há 8 dias: a regra do expurgo (S78).
        await app.query(inserirConta(CONTA_ID, 'pessoa@exemplo.com', 8));
        await app.query(inserirConta(OUTRA_CONTA_ID, 'admin@exemplo.com'));
        const id = [CONTA_ID];
        await app.query(
          `INSERT INTO identidade.perfis_conta (conta_id, perfil, concedido_em) VALUES ($1, 'consumidor', now())`,
          id,
        );
        // Perfil de outra conta concedido pela que vai ser apagada: fica, sem o autor.
        await app.query(
          `INSERT INTO identidade.perfis_conta (conta_id, perfil, concedido_em, concedido_por)
         VALUES ($1, 'lojista', now(), $2)`,
          [OUTRA_CONTA_ID, CONTA_ID],
        );
        await app.query(
          `INSERT INTO identidade.consentimentos (conta_id, documento_id, aceito_em)
         SELECT $1, id, now() FROM identidade.documentos_legais WHERE versao = 'teste-2'`,
          id,
        );
        const { rows: sessoes } = await app.query<{ id: string }>(
          `INSERT INTO identidade.sessoes (conta_id, familia_id, cliente, token_hash, expira_em, ultimo_uso_em, criada_em)
         VALUES ($1, gen_random_uuid(), 'app_consumidor', 'hash-c', now(), now(), now()) RETURNING id`,
          id,
        );
        await app.query(
          `INSERT INTO identidade.tokens_de_renovacao_usados (token_hash, familia_id, sessao_id, usado_em)
         VALUES ('hash-antigo', gen_random_uuid(), $1, now())`,
          [sessoes[0]?.id],
        );
        await app.query(
          `INSERT INTO identidade.codigos_verificacao (conta_id, finalidade, codigo_hmac, expira_em, criado_em)
         VALUES ($1, 'verificacao_email', 'hmac', now(), now())`,
          id,
        );
        await app.query(
          `INSERT INTO identidade.segundo_fator (conta_id, segredo_cifrado) VALUES ($1, 'cifrado')`,
          id,
        );
        await app.query(
          `INSERT INTO identidade.codigos_recuperacao (conta_id, codigo_hmac) VALUES ($1, 'hmac')`,
          id,
        );
        await app.query(
          `INSERT INTO identidade.solicitacoes_titular (conta_id, tipo, solicitada_em) VALUES ($1, 'exclusao', now())`,
          id,
        );
        await app.query(
          `INSERT INTO identidade.exportacoes_titular (conta_id, conteudo_cifrado, criada_em, expira_em)
         VALUES ($1, 'cifrado', now(), now())`,
          id,
        );
        expect(await linhasDaConta(FILHAS_DA_CONTA)).toEqual(totalEmCada(FILHAS_DA_CONTA, 1));

        const apagada = await app.query('DELETE FROM identidade.contas WHERE id = $1', id);
        expect(apagada.rowCount).toBe(1);

        // Só as linhas das contas deste teste: outros arquivos deixam linhas no mesmo banco.
        const { rows } = await app.query<{ conta: string; concedidoPor: string | null }>(
          `SELECT conta_id AS conta, concedido_por AS "concedidoPor" FROM identidade.perfis_conta
         WHERE conta_id = ANY($1::uuid[])`,
          [[CONTA_ID, OUTRA_CONTA_ID]],
        );
        expect(rows).toEqual([{ conta: OUTRA_CONTA_ID, concedidoPor: null }]);
        const { rows: historico } = await app.query(
          'SELECT token_hash FROM identidade.tokens_de_renovacao_usados WHERE sessao_id = $1',
          [sessoes[0]?.id],
        );
        expect(historico).toEqual([]);
        return linhasDaConta(FILHAS_DA_CONTA);
      }),
    );
    expect(depois).toEqual(totalEmCada(FILHAS_DA_CONTA, 0));
  });

  // S78: a cascata apagaria consentimentos (só de acréscimo) de qualquer conta apagada.
  it.each([
    [
      'verificada',
      8,
      `UPDATE identidade.contas SET email_verificado_em = now() WHERE id = '${CONTA_ID}'`,
    ],
    [
      'desativada',
      8,
      `UPDATE identidade.contas SET status = 'desativada', desativada_em = now() WHERE id = '${CONTA_ID}'`,
    ],
    [
      'anonimizada',
      8,
      `UPDATE identidade.contas SET status = 'anonimizada', desativada_em = now(), anonimizada_em = now(),
              senha_hash = NULL, telefone_e164 = NULL WHERE id = '${CONTA_ID}'`,
    ],
    ['criada há 6 dias', 6, 'SELECT 1'],
    [
      'com login há 1 dia',
      8,
      `UPDATE identidade.contas SET ultimo_login_em = now() - interval '1 day' WHERE id = '${CONTA_ID}'`,
    ],
    [
      'com perfil lojista',
      8,
      `INSERT INTO identidade.perfis_conta (conta_id, perfil, concedido_em) VALUES ('${CONTA_ID}', 'lojista', now())`,
    ],
    [
      'com perfil admin',
      8,
      `INSERT INTO identidade.perfis_conta (conta_id, perfil, concedido_em) VALUES ('${CONTA_ID}', 'admin', now())`,
    ],
  ])(
    'a trigger recusa apagar conta %s, e os consentimentos ficam (S78)',
    async (_caso, dias, preparo) => {
      const resultado = await comDocumentos('teste-s78', ['privacidade'], () =>
        naTransacaoDaAplicacao(async () => {
          await app.query(inserirConta(CONTA_ID, 'pessoa@exemplo.com', dias));
          await app.query(preparo);
          await app.query(
            `INSERT INTO identidade.consentimentos (conta_id, documento_id, aceito_em)
           SELECT $1, id, now() FROM identidade.documentos_legais WHERE versao = 'teste-s78'`,
            [CONTA_ID],
          );
          await app.query('SAVEPOINT antes_de_apagar');
          let erro: { code?: string; message?: string } | undefined;
          try {
            await app.query('DELETE FROM identidade.contas WHERE id = $1', [CONTA_ID]);
          } catch (falha) {
            erro = falha as typeof erro;
          }
          await app.query('ROLLBACK TO SAVEPOINT antes_de_apagar');
          return { erro, consentimentos: await linhasDaConta(['consentimentos']) };
        }),
      );
      expect(resultado.erro?.code).toBe('23514');
      expect(resultado.erro?.message).toContain('só o expurgo');
      expect(resultado.consentimentos).toEqual({ consentimentos: 1 });
    },
  );

  it('a função da trigger é SECURITY INVOKER, com search_path fixo e sem EXECUTE para PUBLIC (S78)', async () => {
    const { rows } = await dono.query<{ definer: boolean; config: string[]; acl: string }>(
      `SELECT p.prosecdef AS definer, p.proconfig AS config, p.proacl::text AS acl
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'identidade' AND p.proname = 'recusar_exclusao_fora_do_expurgo'`,
    );
    expect(rows).toEqual([
      { definer: false, config: ['search_path=""'], acl: '{bairrin_migracao=X/bairrin_migracao}' },
    ]);
  });
});

/** O UPDATE de `gravarRotacao` (R1, R7), reduzido às colunas que o teste confere. */
const ROTACAO_CONDICIONADA = `UPDATE identidade.sessoes
                                 SET token_anterior_hash = token_hash, token_hash = $3, trocado_em = now()
                               WHERE id = $1 AND token_hash = $2 AND revogada_em IS NULL`;

describe('leituras com trava e rotação condicionada (R1, R7), entre duas conexões da aplicação', () => {
  let outra: pg.Client;

  beforeAll(async () => {
    outra = new pg.Client({ connectionString: URL_APP_TESTE });
    await outra.connect();
  });

  afterAll(async () => {
    await outra?.end();
  });

  /** Espera até a conexão `pid` ficar bloqueada por uma trava (`wait_event_type = 'Lock'`). */
  async function esperarBloqueio(pid: number): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      const { rows } = await app.query<{ espera: string | null }>(
        'SELECT wait_event_type AS espera FROM pg_stat_activity WHERE pid = $1',
        [pid],
      );
      if (rows[0]?.espera === 'Lock') return;
      await new Promise((resolver) => setTimeout(resolver, 10));
    }
    throw new Error('a segunda conexão não chegou a esperar a trava');
  }

  async function pidDe(cliente: pg.Client): Promise<number> {
    const { rows } = await cliente.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    return rows[0]?.pid ?? -1;
  }

  it('duas falhas simultâneas na chave nova do freio viram duas (INSERT ON CONFLICT + FOR UPDATE)', async () => {
    const chave = 'hmac-corrida-r1';
    const falhar = async (cliente: pg.Client, antesDoCommit?: () => Promise<void>) => {
      await cliente.query(
        `INSERT INTO identidade.bloqueios_login (chave_hmac, tipo, falhas, nivel, janela_inicio)
         VALUES ($1, 'email', 0, 0, now()) ON CONFLICT DO NOTHING`,
        [chave],
      );
      const { rows } = await cliente.query<{ falhas: number }>(
        `SELECT falhas FROM identidade.bloqueios_login WHERE chave_hmac = $1 AND tipo = 'email' FOR UPDATE`,
        [chave],
      );
      await cliente.query(
        `UPDATE identidade.bloqueios_login SET falhas = $2 WHERE chave_hmac = $1 AND tipo = 'email'`,
        [chave, (rows[0]?.falhas ?? -1) + 1],
      );
      await antesDoCommit?.();
      await cliente.query('COMMIT');
    };
    let segunda: Promise<void> = Promise.resolve();
    try {
      const pidDaOutra = await pidDe(outra);
      await app.query('BEGIN');
      await outra.query('BEGIN');
      await falhar(app, async () => {
        segunda = falhar(outra);
        await esperarBloqueio(pidDaOutra);
      });
      await segunda;
      const { rows } = await dono.query<{ falhas: number }>(
        'SELECT falhas FROM identidade.bloqueios_login WHERE chave_hmac = $1',
        [chave],
      );
      expect(rows).toEqual([{ falhas: 2 }]);
    } finally {
      await app.query('ROLLBACK').catch(() => undefined);
      await outra.query('ROLLBACK').catch(() => undefined);
      await dono.query('DELETE FROM identidade.bloqueios_login WHERE chave_hmac = $1', [chave]);
    }
  });

  it('duas rotações simultâneas com o mesmo token: o UPDATE condicionado altera 1 linha e depois 0 (R1)', async () => {
    const contaId = '00000000-0000-4000-8000-0000000000a1';
    const rotacao = ROTACAO_CONDICIONADA;
    try {
      await dono.query(inserirConta(contaId, 'corrida@exemplo.com', 8));
      const { rows } = await dono.query<{ id: string }>(
        `INSERT INTO identidade.sessoes (conta_id, familia_id, cliente, token_hash, expira_em, ultimo_uso_em, criada_em)
         VALUES ($1, gen_random_uuid(), 'app_consumidor', 'rot-1', now() + interval '30 days', now(), now())
         RETURNING id`,
        [contaId],
      );
      const sid = rows[0]?.id;
      const pidDaOutra = await pidDe(outra);
      await app.query('BEGIN');
      await outra.query('BEGIN');
      const primeira = await app.query(rotacao, [sid, 'rot-1', 'rot-2a']);
      const segundaRotacao = outra.query(rotacao, [sid, 'rot-1', 'rot-2b']);
      await esperarBloqueio(pidDaOutra);
      await app.query('COMMIT');
      const resultado = await segundaRotacao;
      await outra.query('ROLLBACK');
      expect([primeira.rowCount, resultado.rowCount]).toEqual([1, 0]);
      const { rows: depois } = await dono.query(
        'SELECT token_hash, token_anterior_hash FROM identidade.sessoes WHERE id = $1',
        [sid],
      );
      expect(depois).toEqual([{ token_hash: 'rot-2a', token_anterior_hash: 'rot-1' }]);
    } finally {
      await app.query('ROLLBACK').catch(() => undefined);
      await outra.query('ROLLBACK').catch(() => undefined);
      await dono.query('DELETE FROM identidade.contas WHERE id = $1', [contaId]);
    }
  });

  it('revogação confirmada enquanto a rotação espera: o UPDATE altera 0 linhas e a sessão fica revogada (R7)', async () => {
    const contaId = '00000000-0000-4000-8000-0000000000a2';
    try {
      await dono.query(inserirConta(contaId, 'revogacao@exemplo.com', 8));
      const { rows } = await dono.query<{ id: string }>(
        `INSERT INTO identidade.sessoes (conta_id, familia_id, cliente, token_hash, expira_em, ultimo_uso_em, criada_em)
         VALUES ($1, gen_random_uuid(), 'app_consumidor', 'rev-1', now() + interval '30 days', now(), now())
         RETURNING id`,
        [contaId],
      );
      const sid = rows[0]?.id;
      const pidDaOutra = await pidDe(outra);
      await app.query('BEGIN');
      await outra.query('BEGIN');
      // Redefinição de senha: revoga as sessões da conta (como revogarDaConta).
      const revogacao = await app.query(
        `UPDATE identidade.sessoes SET revogada_em = now(), motivo_revogacao = 'senha_redefinida',
                par_novo_cifrado = NULL, par_novo_expira_em = NULL
          WHERE conta_id = $1 AND revogada_em IS NULL`,
        [contaId],
      );
      const rotacao = outra.query(ROTACAO_CONDICIONADA, [sid, 'rev-1', 'rev-2']);
      await esperarBloqueio(pidDaOutra);
      await app.query('COMMIT');
      const resultado = await rotacao;
      await outra.query('COMMIT');
      expect([revogacao.rowCount, resultado.rowCount]).toEqual([1, 0]);
      const { rows: depois } = await dono.query(
        `SELECT token_hash, motivo_revogacao, revogada_em IS NOT NULL AS revogada
           FROM identidade.sessoes WHERE id = $1`,
        [sid],
      );
      expect(depois).toEqual([
        { token_hash: 'rev-1', motivo_revogacao: 'senha_redefinida', revogada: true },
      ]);
    } finally {
      await app.query('ROLLBACK').catch(() => undefined);
      await outra.query('ROLLBACK').catch(() => undefined);
      await dono.query('DELETE FROM identidade.contas WHERE id = $1', [contaId]);
    }
  });
});

describe('seed dos documentos legais (S24, S79)', () => {
  /**
   * Roda o CLI do seed (fonte TypeScript, pelo Node) só com as variáveis dadas; por padrão,
   * conecta como o dono (`DATABASE_URL_MIGRACAO`), porque a aplicação não inclui documento.
   */
  function rodarSeed(ambiente: Record<string, string>) {
    return spawnSync(process.execPath, ['--conditions=@bairrin/fonte', 'src/cli/seed.ts'], {
      cwd: PASTA_DA_API,
      env: {
        PATH: process.env['PATH'] ?? '',
        DATABASE_URL_MIGRACAO: URL_MIGRACAO_TESTE,
        ...ambiente,
      },
      encoding: 'utf8',
    });
  }

  async function documentosSemeados() {
    const { rows } = await dono.query<{ tipo: string; versao: string; conteudo: string }>(
      `SELECT tipo::text AS tipo, versao, conteudo FROM identidade.documentos_legais
        WHERE versao = '1.0' ORDER BY 1`,
    );
    return rows;
  }

  /** O dono ignora o RLS e pode apagar: deixa o banco como a migração o criou. */
  async function apagarSemeados(): Promise<void> {
    await dono?.query(`DELETE FROM identidade.documentos_legais WHERE versao = '1.0'`);
  }

  beforeAll(apagarSemeados);
  afterAll(apagarSemeados);

  it.each([
    ['NODE_ENV=production', { NODE_ENV: 'production' }],
    ['sem NODE_ENV', {}],
    ['NODE_ENV desconhecido', { NODE_ENV: 'homologacao' }],
  ])('recusa %s sem gravar nada', async (_caso, ambiente: Record<string, string>) => {
    const resultado = rodarSeed(ambiente);
    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toContain('Seed recusado');
    expect(await documentosSemeados()).toEqual([]);
  });

  it('em teste grava termos e política 1.0 marcados como rascunho, como o dono; de novo, não muda nada', async () => {
    const primeira = rodarSeed({ NODE_ENV: 'test' });
    expect(primeira.status).toBe(0);
    expect(primeira.stdout).toContain('2 incluídos');
    const gravados = await documentosSemeados();
    expect(gravados.map(({ tipo, versao }) => ({ tipo, versao }))).toEqual([
      { tipo: 'privacidade', versao: '1.0' },
      { tipo: 'termos', versao: '1.0' },
    ]);
    for (const { conteudo } of gravados) {
      expect(conteudo).toContain('RASCUNHO, revisar com advogado');
    }

    const segunda = rodarSeed({ NODE_ENV: 'development' });
    expect(segunda.status).toBe(0);
    expect(segunda.stdout).toContain('0 incluídos');
    expect(await documentosSemeados()).toEqual(gravados);
  });

  it('sem DATABASE_URL_MIGRACAO, sai com erro, mesmo com a DATABASE_URL da aplicação', () => {
    const resultado = spawnSync(
      process.execPath,
      ['--conditions=@bairrin/fonte', 'src/cli/seed.ts'],
      {
        cwd: PASTA_DA_API,
        env: { PATH: process.env['PATH'] ?? '', NODE_ENV: 'test', DATABASE_URL: URL_APP_TESTE },
        encoding: 'utf8',
      },
    );
    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toContain('DATABASE_URL_MIGRACAO não definida');
  });

  it('com o papel da aplicação no lugar do dono, falha com 42501 e não grava nada (S79)', async () => {
    await apagarSemeados();
    const resultado = rodarSeed({ NODE_ENV: 'test', DATABASE_URL_MIGRACAO: URL_APP_TESTE });
    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toContain('Falha no seed (código 42501)');
    expect(await documentosSemeados()).toEqual([]);
  });
});

describe('schema.prisma e banco migrado', () => {
  it('prisma migrate diff não acha diferença entre o banco e o schema.prisma', () => {
    const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
    const resultado = spawnSync(
      process.execPath,
      [
        cli,
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      {
        cwd: PASTA_DA_API,
        env: {
          PATH: process.env['PATH'] ?? '',
          DATABASE_URL_MIGRACAO: URL_MIGRACAO_TESTE,
          CHECKPOINT_DISABLE: '1',
        },
        encoding: 'utf8',
      },
    );
    // Código 2 = há diferença; a mensagem mostra qual.
    expect(resultado.status, `${resultado.stdout}${resultado.stderr}`).toBe(0);
    expect(resultado.stdout).toContain('No difference detected');
  }, 60_000);
});
