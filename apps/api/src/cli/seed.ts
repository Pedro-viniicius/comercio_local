// Seed de desenvolvimento e teste (`pnpm --filter api seed`): grava a versão
// 1.0 dos Termos de Uso e da Política de Privacidade, marcada como rascunho,
// para o cadastro (CA-01) e a tela de privacidade (CA-10) terem um documento
// vigente. O texto definitivo vem do advogado e não sai daqui.
//
// Só roda com NODE_ENV `development` ou `test`: recusa `production` (S24) e
// também ambiente sem NODE_ENV. Conecta como o dono dos schemas
// (DATABASE_URL_MIGRACAO, papel bairrin_migracao): a aplicação só lê documentos
// legais (S79), e versão nova em produção entra por migração. Rodar de novo não
// muda nada: a versão já gravada fica como está.
//
// Não lê `.env` sozinho: o script `seed` do package.json passa
// `--env-file-if-exists=.env` ao Node.
import pg from 'pg';

/** Ambientes em que o seed roda. */
const AMBIENTES_DO_SEED = new Set(['development', 'test']);

/** Espera máxima pela conexão com o banco. */
const ESPERA_POR_CONEXAO_EM_MS = 5_000;

/** Marca obrigatória de todo documento legal semeado (S24). */
const AVISO_DE_RASCUNHO = 'RASCUNHO, revisar com advogado';

/** Versão semeada, no formato de `versaoDeDocumentoSchema`. */
const VERSAO = '1.0';

interface DocumentoDoSeed {
  tipo: 'termos' | 'privacidade';
  conteudo: string;
}

const DOCUMENTOS: readonly DocumentoDoSeed[] = [
  {
    tipo: 'termos',
    conteudo: [
      '# Termos de Uso do Bairrin',
      '',
      `**${AVISO_DE_RASCUNHO}.** Texto provisório para desenvolvimento e testes. Não vale como termo de uso.`,
      '',
      '## O que é o Bairrin',
      '',
      'Marketplace que aproxima o comércio do bairro de quem compra perto de casa.',
      '',
      '## Sua conta',
      '',
      'A conta é pessoal. Mantenha a senha em segredo e avise o Bairrin se notar uso indevido.',
      '',
      '## Pedidos e retirada',
      '',
      'As condições de pedido, pagamento e retirada na loja serão descritas na versão revisada.',
      '',
    ].join('\n'),
  },
  {
    tipo: 'privacidade',
    conteudo: [
      '# Política de Privacidade do Bairrin',
      '',
      `**${AVISO_DE_RASCUNHO}.** Texto provisório para desenvolvimento e testes. Não vale como política de privacidade.`,
      '',
      '## Dados que guardamos',
      '',
      'Nome, e-mail e celular informados no cadastro, para identificar a conta e falar com você.',
      '',
      '## Seus direitos',
      '',
      'Na tela de Privacidade você pede uma cópia dos seus dados, pronta em até 48 horas, e a exclusão da conta.',
      '',
      '## Operadores, retenção e encarregado',
      '',
      'Operadores, prazos de retenção e o contato do encarregado entram na versão revisada.',
      '',
    ].join('\n'),
  },
];

/**
 * Inclui os documentos que faltam numa transação só e devolve quantos entraram.
 * `ON CONFLICT DO NOTHING` mantém a versão já gravada, com o texto e a data dela.
 */
async function semearDocumentosLegais(cliente: pg.Client): Promise<number> {
  await cliente.query('BEGIN');
  try {
    let incluidos = 0;
    for (const { tipo, conteudo } of DOCUMENTOS) {
      const { rowCount } = await cliente.query(
        `INSERT INTO identidade.documentos_legais (tipo, versao, conteudo, vigente_desde)
         VALUES ($1::identidade.tipo_de_documento_legal, $2, $3, now())
         ON CONFLICT (tipo, versao) DO NOTHING`,
        [tipo, VERSAO, conteudo],
      );
      incluidos += rowCount ?? 0;
    }
    await cliente.query('COMMIT');
    return incluidos;
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw erro;
  }
}

const nodeEnv = process.env['NODE_ENV'];
const url = process.env['DATABASE_URL_MIGRACAO'];
if (nodeEnv === undefined || !AMBIENTES_DO_SEED.has(nodeEnv)) {
  console.error(
    'Seed recusado: só roda com NODE_ENV=development ou NODE_ENV=test, nunca em produção.',
  );
  process.exitCode = 1;
} else if (url === undefined || url.trim() === '') {
  console.error('DATABASE_URL_MIGRACAO não definida: o seed não foi aplicado.');
  process.exitCode = 1;
} else {
  const cliente = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: ESPERA_POR_CONEXAO_EM_MS,
  });
  try {
    await cliente.connect();
    const incluidos = await semearDocumentosLegais(cliente);
    console.log(
      `Documentos legais ${VERSAO} (rascunho): ${incluidos} incluídos, ` +
        `${DOCUMENTOS.length - incluidos} já existiam.`,
    );
  } catch (erro) {
    // Só o código do Postgres: a mensagem do driver pode trazer parâmetros da
    // consulta e dados da conexão.
    const codigo = (erro as { code?: unknown }).code;
    console.error(
      `Falha no seed (código ${typeof codigo === 'string' ? codigo : 'desconhecido'}).`,
    );
    process.exitCode = 1;
  } finally {
    await cliente.end().catch(() => undefined);
  }
}
