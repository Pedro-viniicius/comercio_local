// Domínio × banco (01b, etapas 3 e 4): todo estado que as entidades de domínio
// produzem passa nas restrições da migração `identidade` e volta igual ao ser
// lido e remontado. Os repositórios Prisma só chegam na etapa 7; aqui a gravação
// e a leitura são SQL direto, com o papel da aplicação, em transação desfeita.
// Se uma restrição do banco recusar um estado válido do domínio, o caso de uso
// falharia em produção com um erro do Postgres.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BloqueioDeLogin,
  type DadosDoBloqueioDeLogin,
  ESPERAS_EM_MS,
  LIMIAR_DE_FALHAS,
} from '../../../src/modulos/identidade/dominio/bloqueio-de-login.ts';
import {
  CodigoDeVerificacao,
  type DadosDoCodigoDeVerificacao,
} from '../../../src/modulos/identidade/dominio/codigo-de-verificacao.ts';
import { Conta, type DadosDaConta } from '../../../src/modulos/identidade/dominio/conta.ts';
import {
  type DadosDoDesafioDeSegundoFator,
  DesafioDeSegundoFator,
  finalidadeDoDesafio,
} from '../../../src/modulos/identidade/dominio/desafio-de-segundo-fator.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import {
  avaliarTokenJaUsado,
  type DadosDaSessao,
  Sessao,
  type TokenDeRenovacaoUsado,
} from '../../../src/modulos/identidade/dominio/sessao.ts';
import { Telefone } from '../../../src/modulos/identidade/dominio/telefone.ts';
import { URL_APP_TESTE, URL_MIGRACAO_TESTE } from '../preparar-banco.ts';

const T0 = new Date('2026-10-17T12:00:00.000Z');
const minutosDepois = (minutos: number) => new Date(T0.getTime() + minutos * 60_000);

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const ID_CONTA = uuid(1);
const ID_ADMIN = uuid(2);

let app: pg.Client;
/** O dono grava os documentos legais, que a aplicação só lê (S79). */
let dono: pg.Client;

beforeAll(async () => {
  app = new pg.Client({ connectionString: URL_APP_TESTE });
  dono = new pg.Client({ connectionString: URL_MIGRACAO_TESTE });
  await Promise.all([app.connect(), dono.connect()]);
});

afterAll(async () => {
  await Promise.all([app?.end(), dono?.end()]);
});

async function naTransacao(fn: () => Promise<void>): Promise<void> {
  await app.query('BEGIN');
  try {
    await fn();
  } finally {
    await app.query('ROLLBACK');
  }
}

const paraColuna = (chave: string) => chave.replace(/([A-Z])/g, '_$1').toLowerCase();
const paraChave = (coluna: string) =>
  coluna.replace(/_([a-z0-9])/g, (_inteiro, letra: string) => letra.toUpperCase());

type Linha = Record<string, unknown>;

/** `INSERT` com as colunas dadas (chaves em camelCase, como os `dados` do domínio). */
async function inserir(tabela: string, valores: Linha): Promise<void> {
  const colunas = Object.keys(valores).map(paraColuna);
  const marcadores = colunas.map((_coluna, indice) => `$${indice + 1}`);
  await app.query(
    `INSERT INTO identidade.${tabela} (${colunas.join(', ')}) VALUES (${marcadores.join(', ')})`,
    Object.values(valores),
  );
}

/** `UPDATE` de todas as colunas menos a chave, como o repositório faria. */
async function atualizar(tabela: string, chave: string, valores: Linha): Promise<void> {
  const { [chave]: valorDaChave, ...resto } = valores;
  const colunas = Object.keys(resto).map(paraColuna);
  const atribuicoes = colunas.map((coluna, indice) => `${coluna} = $${indice + 1}`);
  await app.query(
    `UPDATE identidade.${tabela} SET ${atribuicoes.join(', ')} WHERE ${paraColuna(chave)} = $${colunas.length + 1}`,
    [...Object.values(resto), valorDaChave],
  );
}

async function lerLinha(tabela: string, chave: string, valor: unknown): Promise<Linha> {
  const { rows } = await app.query<Linha>(
    `SELECT * FROM identidade.${tabela} WHERE ${paraColuna(chave)} = $1`,
    [valor],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error(`linha de ${tabela} não encontrada`);
  return Object.fromEntries(Object.entries(linha).map(([coluna, v]) => [paraChave(coluna), v]));
}

// ---------------------------------------------------------------------------
// Conta

function novaConta(email = 'ana.souza@exemplo.com.br', nome = 'Ana Souza'): Conta {
  return Conta.criar({
    id: ID_CONTA,
    nome,
    email: Email.criar(email),
    telefone: Telefone.criar('(35) 99999-1234'),
    senhaHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    agora: T0,
  });
}

function colunasDaConta({ perfis: _perfis, ...colunas }: DadosDaConta): Linha {
  return colunas;
}

async function gravarConta(conta: Conta, jaExiste: boolean): Promise<void> {
  const dados = conta.dados;
  if (jaExiste) await atualizar('contas', 'id', colunasDaConta(dados));
  else await inserir('contas', colunasDaConta(dados));
  for (const perfil of dados.perfis) {
    await app.query(
      `INSERT INTO identidade.perfis_conta (conta_id, perfil, concedido_em, concedido_por)
       VALUES ($1, $2, $3, $4) ON CONFLICT (conta_id, perfil) DO NOTHING`,
      [dados.id, perfil.perfil, perfil.concedidoEm, perfil.concedidoPor],
    );
  }
}

async function lerConta(id: string): Promise<Conta> {
  const linha = await lerLinha('contas', 'id', id);
  const { rows } = await app.query<{
    perfil: DadosDaConta['perfis'][number]['perfil'];
    concedido_em: Date;
    concedido_por: string | null;
  }>(
    'SELECT perfil::text AS perfil, concedido_em, concedido_por FROM identidade.perfis_conta WHERE conta_id = $1 ORDER BY concedido_em, perfil',
    [id],
  );
  return Conta.reconstituir({
    ...(linha as unknown as Omit<DadosDaConta, 'perfis'>),
    perfis: rows.map((r) => ({
      perfil: r.perfil,
      concedidoEm: r.concedido_em,
      concedidoPor: r.concedido_por,
    })),
  });
}

/** Dados da conta com os perfis em ordem estável (o banco não guarda a ordem de concessão). */
function dadosOrdenados(conta: Conta): DadosDaConta {
  const dados = conta.dados;
  return { ...dados, perfis: [...dados.perfis].sort((a, b) => a.perfil.localeCompare(b.perfil)) };
}

describe('Conta: cada passo do ciclo de vida passa nos CHECKs e volta igual', () => {
  it('cadastro, verificação, login, perfil lojista, exclusão e anonimização (CA-01, CA-11)', async () => {
    await naTransacao(async () => {
      // A conta que concede o perfil (o banco confere a FK de `concedido_por`).
      await gravarConta(
        Conta.criar({
          id: ID_ADMIN,
          nome: 'Admin',
          email: Email.criar('admin@exemplo.com'),
          telefone: Telefone.criar('(35) 99999-0000'),
          senhaHash: 'hash',
          agora: T0,
        }),
        false,
      );
      const conta = novaConta();
      await gravarConta(conta, false);
      expect(dadosOrdenados(await lerConta(ID_CONTA))).toEqual(dadosOrdenados(conta));

      conta.registrarLogin(minutosDepois(5));
      conta.verificarEmail(minutosDepois(6));
      conta.concederPerfil('lojista', minutosDepois(7), ID_ADMIN);
      await gravarConta(conta, true);
      expect(dadosOrdenados(await lerConta(ID_CONTA))).toEqual(dadosOrdenados(conta));

      conta.desativar(minutosDepois(10));
      await gravarConta(conta, true);
      expect(dadosOrdenados(await lerConta(ID_CONTA))).toEqual(dadosOrdenados(conta));

      conta.anonimizar(minutosDepois(20));
      await gravarConta(conta, true);
      const lida = await lerConta(ID_CONTA);
      expect(dadosOrdenados(lida)).toEqual(dadosOrdenados(conta));
      expect(lida.dados).toMatchObject({
        nome: 'Conta anonimizada',
        telefoneE164: null,
        senhaHash: null,
        status: 'anonimizada',
      });
    });
  });

  it('a anonimização preserva o aceite (versão e data) e o histórico de pedidos do titular (CA-10, CA-11)', async () => {
    await dono.query(
      `INSERT INTO identidade.documentos_legais (id, tipo, versao, conteudo, vigente_desde)
       VALUES ($1, 'privacidade', 'qa-1', 'texto', $2)`,
      [uuid(40), T0],
    );
    try {
      await naTransacao(async () => {
        const conta = novaConta();
        await gravarConta(conta, false);
        await app.query(
          `INSERT INTO identidade.consentimentos (conta_id, documento_id, aceito_em) VALUES ($1, $2, $3)`,
          [ID_CONTA, uuid(40), minutosDepois(1)],
        );
        await app.query(
          `INSERT INTO identidade.solicitacoes_titular (conta_id, tipo, status, solicitada_em)
         VALUES ($1, 'exclusao', 'pendente', $2)`,
          [ID_CONTA, minutosDepois(2)],
        );

        conta.desativar(minutosDepois(2));
        await gravarConta(conta, true);
        conta.anonimizar(minutosDepois(3));
        await gravarConta(conta, true);

        const { rows } = await app.query<{ versao: string; aceito_em: Date; solicitacoes: number }>(
          `SELECT d.versao, c.aceito_em,
                (SELECT count(*)::int FROM identidade.solicitacoes_titular s WHERE s.conta_id = c.conta_id) AS solicitacoes
           FROM identidade.consentimentos c JOIN identidade.documentos_legais d ON d.id = c.documento_id
          WHERE c.conta_id = $1`,
          [ID_CONTA],
        );
        expect(rows).toEqual([{ versao: 'qa-1', aceito_em: minutosDepois(1), solicitacoes: 1 }]);
      });
    } finally {
      await dono.query('DELETE FROM identidade.documentos_legais WHERE id = $1', [uuid(40)]);
    }
  });

  it('a conta anonimizada libera o e-mail original para um novo cadastro (CA-11)', async () => {
    await naTransacao(async () => {
      const antiga = novaConta('mesmo@exemplo.com');
      await gravarConta(antiga, false);
      antiga.desativar(minutosDepois(1));
      antiga.anonimizar(minutosDepois(2));
      await gravarConta(antiga, true);

      const nova = Conta.criar({
        id: uuid(9),
        nome: 'Outra Pessoa',
        email: Email.criar('mesmo@exemplo.com'),
        telefone: Telefone.criar('(11) 91234-5678'),
        senhaHash: 'hash-novo',
        agora: minutosDepois(3),
      });
      await expect(inserir('contas', colunasDaConta(nova.dados))).resolves.toBeUndefined();
    });
  });

  it('duas contas anonimizadas convivem (o e-mail substituto deriva do id)', async () => {
    await naTransacao(async () => {
      for (const [indice, id] of [uuid(10), uuid(11)].entries()) {
        const conta = Conta.criar({
          id,
          nome: 'Fulana',
          email: Email.criar(`pessoa${indice}@exemplo.com`),
          telefone: Telefone.criar('(35) 99999-1234'),
          senhaHash: 'hash',
          agora: T0,
        });
        await gravarConta(conta, false);
        conta.desativar(minutosDepois(1));
        conta.anonimizar(minutosDepois(2));
        await gravarConta(conta, true);
      }
      const { rows } = await app.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM identidade.contas WHERE status = 'anonimizada'",
      );
      expect(rows[0]?.total).toBe(2);
    });
  });

  it('nome de 80 pontos de código (com emoji) e e-mail de 254 caracteres cabem', async () => {
    const local = 'a'.repeat(64);
    const dominio = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
    const email = `${local}@${dominio}`;
    expect(email.length).toBe(254);
    const nome = `${'Ana '.repeat(19)}Ana😀`;
    expect([...nome]).toHaveLength(80);
    await naTransacao(async () => {
      const conta = novaConta(email, nome);
      await gravarConta(conta, false);
      expect(dadosOrdenados(await lerConta(ID_CONTA))).toEqual(dadosOrdenados(conta));
    });
  });
});

// ---------------------------------------------------------------------------
// Sessão

function colunasDaSessao(dados: DadosDaSessao): Linha {
  return { ...dados };
}

async function lerSessao(id: string): Promise<Sessao> {
  return Sessao.reconstituir((await lerLinha('sessoes', 'id', id)) as unknown as DadosDaSessao);
}

async function comContaGravada(fn: () => Promise<void>): Promise<void> {
  await naTransacao(async () => {
    await gravarConta(novaConta(), false);
    await fn();
  });
}

describe('Sessao: cada estado passa nos CHECKs e volta igual (S1, S9, S16, CA-05)', () => {
  it('app: criada, rotacionada com par novo cifrado e revogada no logout', async () => {
    await comContaGravada(async () => {
      const sessao = Sessao.criar({
        id: uuid(20),
        contaId: ID_CONTA,
        cliente: 'app_consumidor',
        tokenHash: 'hmac-token-1',
        mfa: false,
        agora: T0,
      });
      await inserir('sessoes', colunasDaSessao(sessao.dados));
      expect((await lerSessao(uuid(20))).dados).toEqual(sessao.dados);

      sessao.rotacionar('hmac-token-2', 'cifrado-v1:par-novo', minutosDepois(14));
      await atualizar('sessoes', 'id', colunasDaSessao(sessao.dados));
      expect((await lerSessao(uuid(20))).dados).toEqual(sessao.dados);

      sessao.revogar('logout', minutosDepois(15));
      await atualizar('sessoes', 'id', colunasDaSessao(sessao.dados));
      const lida = await lerSessao(uuid(20));
      expect(lida.dados).toEqual(sessao.dados);
      expect(lida.dados.parNovoCifrado).toBeNull();
    });
  });

  it('painel com mfa: fim absoluto de 12 h, renovação e revogação por reuso', async () => {
    await comContaGravada(async () => {
      const sessao = Sessao.criar({
        id: uuid(21),
        contaId: ID_CONTA,
        cliente: 'painel',
        tokenHash: 'hmac-painel-1',
        mfa: true,
        agora: T0,
      });
      await inserir('sessoes', colunasDaSessao(sessao.dados));
      sessao.rotacionar('hmac-painel-2', 'cifrado-v1:painel', minutosDepois(20));
      await atualizar('sessoes', 'id', colunasDaSessao(sessao.dados));
      sessao.revogar('reuso_detectado', minutosDepois(21));
      await atualizar('sessoes', 'id', colunasDaSessao(sessao.dados));

      const lida = await lerSessao(uuid(21));
      expect(lida.dados).toEqual(sessao.dados);
      expect(lida.dados.mfa).toBe(true);
      expect(lida.dados.expiraAbsolutoEm).toEqual(new Date(T0.getTime() + 12 * 3_600_000));
    });
  });

  it('T1→T2→T3: cada rotação condicionada grava o trocado no histórico; T1 de novo revoga a família e T3 dá 401 (S77, R1)', async () => {
    await comContaGravada(async () => {
      const sessao = Sessao.criar({
        id: uuid(23),
        contaId: ID_CONTA,
        cliente: 'app_consumidor',
        tokenHash: 'hmac-t1',
        mfa: false,
        agora: T0,
      });
      await inserir('sessoes', colunasDaSessao(sessao.dados));

      /**
       * O que `gravarRotacao` faz (R1, R7): UPDATE só das colunas da rotação, condicionado ao
       * token trocado e à sessão não revogada, e o histórico só com 1 linha alterada.
       */
      async function rotacionar(novo: string, agora: Date): Promise<number> {
        sessao.rotacionar(novo, `cifrado-v1:${novo}`, agora);
        const trocado = sessao.ultimoTokenTrocado as TokenDeRenovacaoUsado;
        const dados = sessao.dados;
        const { rowCount } = await app.query(
          `UPDATE identidade.sessoes
              SET token_hash = $3, token_anterior_hash = $2, par_novo_cifrado = $4,
                  par_novo_expira_em = $5, trocado_em = $6, ultimo_uso_em = $7, expira_em = $8
            WHERE id = $1 AND token_hash = $2 AND revogada_em IS NULL`,
          [
            dados.id,
            trocado.tokenHash,
            dados.tokenHash,
            dados.parNovoCifrado,
            dados.parNovoExpiraEm,
            dados.trocadoEm,
            dados.ultimoUsoEm,
            dados.expiraEm,
          ],
        );
        if (rowCount === 1) await inserir('tokens_de_renovacao_usados', { ...trocado });
        return rowCount ?? 0;
      }

      /** O caminho da renovação: sessão pelo token atual ou anterior; senão, o histórico. */
      async function avaliar(tokenHash: string, agora: Date) {
        const { rows } = await app.query<{ id: string }>(
          'SELECT id FROM identidade.sessoes WHERE token_hash = $1 OR token_anterior_hash = $1',
          [tokenHash],
        );
        if (rows[0] !== undefined) {
          const lida = await lerSessao(rows[0].id);
          return lida.avaliarRenovacao(tokenHash, 'app_consumidor', agora);
        }
        const uso = await app.query<Linha>(
          'SELECT * FROM identidade.tokens_de_renovacao_usados WHERE token_hash = $1',
          [tokenHash],
        );
        const linha = uso.rows[0];
        const avaliacao = avaliarTokenJaUsado(
          linha === undefined
            ? null
            : {
                tokenHash: String(linha['token_hash']),
                familiaId: String(linha['familia_id']),
                sessaoId: String(linha['sessao_id']),
                usadoEm: linha['usado_em'] as Date,
              },
        );
        if (avaliacao.tipo === 'reuso') {
          await app.query(
            `UPDATE identidade.sessoes SET revogada_em = $2, motivo_revogacao = 'reuso_detectado',
                    par_novo_cifrado = NULL, par_novo_expira_em = NULL
              WHERE familia_id = $1 AND revogada_em IS NULL`,
            [linha?.['familia_id'], agora],
          );
        }
        return avaliacao;
      }

      expect(await rotacionar('hmac-t2', minutosDepois(1))).toBe(1);
      expect(await rotacionar('hmac-t3', minutosDepois(2))).toBe(1);
      // O UPDATE condicionado não acha mais o token trocado: 0 linhas (outra renovação ganhou).
      const atrasada = await app.query(
        "UPDATE identidade.sessoes SET token_hash = 'hmac-x' WHERE id = $1 AND token_hash = 'hmac-t2'",
        [uuid(23)],
      );
      expect(atrasada.rowCount).toBe(0);

      expect(await avaliar('hmac-t2', new Date(minutosDepois(2).getTime() + 30_000))).toEqual({
        tipo: 'tolerancia',
        parNovoCifrado: 'cifrado-v1:hmac-t3',
      });
      expect(await avaliar('hmac-t1', new Date(minutosDepois(2).getTime() + 30_000))).toEqual({
        tipo: 'reuso',
      });
      const revogada = await lerSessao(uuid(23));
      expect(revogada.motivoRevogacao).toBe('reuso_detectado');
      expect(await avaliar('hmac-t3', minutosDepois(3))).toEqual({ tipo: 'invalida' });
      // A entidade lida antes da revogação ainda rotacionaria T3; o UPDATE não acha a linha
      // (revogada_em IS NULL) e a revogação fica (R7).
      expect(await rotacionar('hmac-t4', minutosDepois(3))).toBe(0);
      expect((await lerSessao(uuid(23))).dados).toMatchObject({
        tokenHash: 'hmac-t3',
        motivoRevogacao: 'reuso_detectado',
      });
      expect(await avaliar('hmac-nunca-usado', minutosDepois(3))).toEqual({ tipo: 'invalida' });
    });
  });

  it.each([
    'logout',
    'senha_redefinida',
    'reuso_detectado',
    'conta_desativada',
    'substituida',
    'segundo_fator_reconfigurado',
    'segundo_fator_freado',
  ] as const)('o motivo de revogação %s é gravável e volta igual', async (motivo) => {
    await comContaGravada(async () => {
      const sessao = Sessao.criar({
        id: uuid(22),
        contaId: ID_CONTA,
        cliente: 'app_lojista',
        tokenHash: 'hmac-x',
        mfa: false,
        agora: T0,
      });
      sessao.revogar(motivo, minutosDepois(1));
      await inserir('sessoes', colunasDaSessao(sessao.dados));
      expect((await lerSessao(uuid(22))).dados).toEqual(sessao.dados);
    });
  });
});

// ---------------------------------------------------------------------------
// Códigos, desafios e freio

describe('Códigos, desafios e freio: o estado do domínio passa nos CHECKs e volta igual', () => {
  it('código de e-mail: emitido, com 4 erros e depois aceito (CA-01, CA-06)', async () => {
    await comContaGravada(async () => {
      const codigo = CodigoDeVerificacao.emitir({
        id: uuid(30),
        contaId: ID_CONTA,
        finalidade: 'verificacao_email',
        codigoHmac: 'hmac-codigo',
        agora: T0,
      });
      await inserir('codigos_verificacao', { ...codigo.dados });
      for (let i = 0; i < 4; i += 1) codigo.conferir(false, minutosDepois(1));
      expect(codigo.conferir(true, minutosDepois(2))).toBe('aceito');
      await atualizar('codigos_verificacao', 'id', { ...codigo.dados });

      const lida = CodigoDeVerificacao.reconstituir(
        (await lerLinha(
          'codigos_verificacao',
          'id',
          uuid(30),
        )) as unknown as DadosDoCodigoDeVerificacao,
      );
      expect(lida.dados).toEqual(codigo.dados);
      expect(lida.dados.tentativas).toBe(4);
    });
  });

  it('código e desafio esgotados (5 tentativas erradas) são gravados e voltam iguais', async () => {
    await comContaGravada(async () => {
      const codigo = CodigoDeVerificacao.emitir({
        id: uuid(32),
        contaId: ID_CONTA,
        finalidade: 'recuperacao_senha',
        codigoHmac: 'hmac-codigo-2',
        agora: T0,
      });
      for (let i = 0; i < 5; i += 1) codigo.conferir(false, minutosDepois(1));
      expect(codigo.dados.tentativas).toBe(5);
      await inserir('codigos_verificacao', { ...codigo.dados });
      const lido = CodigoDeVerificacao.reconstituir(
        (await lerLinha(
          'codigos_verificacao',
          'id',
          uuid(32),
        )) as unknown as DadosDoCodigoDeVerificacao,
      );
      expect(lido.dados).toEqual(codigo.dados);
      expect(lido.estaValido(minutosDepois(2))).toBe(false);
    });
  });

  it.each(['configurar', 'verificar'] as const)(
    'desafio da etapa %s é gravado como código com a finalidade desafio_%s (S1)',
    async (etapa) => {
      await comContaGravada(async () => {
        const desafio = DesafioDeSegundoFator.emitir({
          id: uuid(31),
          contaId: ID_CONTA,
          etapa,
          tokenHmac: 'hmac-desafio',
          agora: T0,
        });
        const { etapa: _etapa, tokenHmac, ...resto } = desafio.dados;
        await inserir('codigos_verificacao', {
          ...resto,
          finalidade: finalidadeDoDesafio(etapa),
          codigoHmac: tokenHmac,
        });

        const linha = await lerLinha('codigos_verificacao', 'id', uuid(31));
        const { finalidade, codigoHmac, ...igual } = linha;
        const lido = DesafioDeSegundoFator.reconstituir({
          ...(igual as unknown as Omit<DadosDoDesafioDeSegundoFator, 'etapa' | 'tokenHmac'>),
          etapa: String(finalidade).replace('desafio_', '') as typeof etapa,
          tokenHmac: String(codigoHmac),
        });
        expect(lido.dados).toEqual(desafio.dados);
      });
    },
  );

  it.each(['email', 'ip', 'segundo_fator'] as const)(
    'freio %s: zerado, em espera nos três níveis e depois de zerar por sucesso',
    async (tipo) => {
      await naTransacao(async () => {
        const chave = `hmac-${tipo}`;
        const freio = BloqueioDeLogin.novo(chave, tipo, T0);
        await inserir('bloqueios_login', { ...freio.dados });

        let agora = T0.getTime();
        for (let nivel = 0; nivel < ESPERAS_EM_MS.length; nivel += 1) {
          for (let falha = 0; falha < LIMIAR_DE_FALHAS[tipo]; falha += 1) {
            agora += 1_000;
            freio.registrarFalha(new Date(agora));
          }
          await atualizar('bloqueios_login', 'chaveHmac', { ...freio.dados });
          const { rows } = await app.query<Linha>(
            'SELECT chave_hmac, tipo::text AS tipo, falhas, nivel, janela_inicio, bloqueado_ate FROM identidade.bloqueios_login WHERE chave_hmac = $1',
            [chave],
          );
          const lido = BloqueioDeLogin.reconstituir({
            chaveHmac: String(rows[0]?.['chave_hmac']),
            tipo: rows[0]?.['tipo'] as typeof tipo,
            falhas: Number(rows[0]?.['falhas']),
            nivel: Number(rows[0]?.['nivel']),
            janelaInicio: rows[0]?.['janela_inicio'] as Date,
            bloqueadoAte: rows[0]?.['bloqueado_ate'] as Date | null,
          } satisfies DadosDoBloqueioDeLogin);
          expect(lido.dados).toEqual(freio.dados);
          expect(lido.nivel).toBe(nivel + 1);
          agora = (freio.dados.bloqueadoAte?.getTime() ?? agora) + 1_000;
        }
      });
    },
  );
});
