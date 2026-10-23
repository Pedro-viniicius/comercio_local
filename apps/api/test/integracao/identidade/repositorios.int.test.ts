// Repositórios Prisma da Identidade (01b, etapa 7) contra o Postgres de teste, no papel
// `bairrin_app`. Cada repositório cumpre a porta de `dominio/repositorios.ts` como o fake em
// memória: o que o caso de uso grava volta igual, as gravações restritas mudam só as suas
// colunas (R1, R7, S77), `listarParaExpurgo` dá o mesmo resultado de `Conta.deveSerExpurgada`,
// e erro do banco chega como erro de domínio sem dado pessoal (CA-12).
//
// A maior parte roda numa unidade de trabalho desfeita no fim (`desfeito`), para não deixar
// linha que outro arquivo conte (há contagens de contas anonimizadas em
// `migracao-dominio.int.test.ts`). O que precisa de dado confirmado usa ids aleatórios.
import { randomUUID } from 'node:crypto';
import type { PinoLogger } from 'nestjs-pino';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Ambiente } from '../../../src/compartilhado/config/ambiente.ts';
import { PrismaService } from '../../../src/compartilhado/infra/prisma.service.ts';
import { UnidadeDeTrabalhoPrisma } from '../../../src/compartilhado/infra/unidade-de-trabalho-prisma.ts';
import {
  BloqueioDeLogin,
  LIMIAR_DE_FALHAS,
} from '../../../src/modulos/identidade/dominio/bloqueio-de-login.ts';
import {
  CodigoDeVerificacao,
  TENTATIVAS_POR_CODIGO,
} from '../../../src/modulos/identidade/dominio/codigo-de-verificacao.ts';
import {
  Conta,
  type DadosDaConta,
  EmailJaCadastrado,
  limiteDoExpurgo,
} from '../../../src/modulos/identidade/dominio/conta.ts';
import { DesafioDeSegundoFator } from '../../../src/modulos/identidade/dominio/desafio-de-segundo-fator.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import {
  OperacaoInvalidaNaSessao,
  Sessao,
} from '../../../src/modulos/identidade/dominio/sessao.ts';
import { Telefone } from '../../../src/modulos/identidade/dominio/telefone.ts';
import { RepositorioDeBloqueiosPrisma } from '../../../src/modulos/identidade/infra/prisma/bloqueios.repositorio.ts';
import {
  RepositorioDeCodigosDeVerificacaoPrisma,
  RepositorioDeDesafiosPrisma,
} from '../../../src/modulos/identidade/infra/prisma/codigos.repositorio.ts';
import { ForaDaUnidadeDeTrabalhoPrisma } from '../../../src/modulos/identidade/infra/prisma/comum.ts';
import { RepositorioDeContasPrisma } from '../../../src/modulos/identidade/infra/prisma/contas.repositorio.ts';
import { RepositorioDeDocumentosLegaisPrisma } from '../../../src/modulos/identidade/infra/prisma/documentos-legais.repositorio.ts';
import { RepositorioDeExportacoesPrisma } from '../../../src/modulos/identidade/infra/prisma/exportacoes.repositorio.ts';
import {
  CodigoDeRecuperacaoInvalido,
  RepositorioDeSegundoFatorPrisma,
} from '../../../src/modulos/identidade/infra/prisma/segundo-fator.repositorio.ts';
import { RepositorioDeSessoesPrisma } from '../../../src/modulos/identidade/infra/prisma/sessoes.repositorio.ts';
import { RepositorioDeSolicitacoesPrisma } from '../../../src/modulos/identidade/infra/prisma/solicitacoes.repositorio.ts';
import { URL_APP_TESTE, URL_MIGRACAO_TESTE } from '../preparar-banco.ts';

const T0 = new Date('2026-10-17T12:00:00.000Z');
const UM_MINUTO = 60_000;
const UM_DIA = 24 * 60 * UM_MINUTO;
const depois = (ms: number, base: Date = T0) => new Date(base.getTime() + ms);
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
const TELEFONE = '(35) 99999-1234';

function loggerSilencioso(): PinoLogger {
  const nada = () => undefined;
  return {
    setContext: nada,
    trace: nada,
    debug: nada,
    info: nada,
    warn: nada,
    error: nada,
    fatal: nada,
  } as unknown as PinoLogger;
}

const prisma = new PrismaService({ DATABASE_URL: URL_APP_TESTE } as Ambiente, loggerSilencioso());
const unidade = new UnidadeDeTrabalhoPrisma(prisma);
const contas = new RepositorioDeContasPrisma(unidade);
const sessoes = new RepositorioDeSessoesPrisma(unidade);
const codigos = new RepositorioDeCodigosDeVerificacaoPrisma(unidade);
const desafios = new RepositorioDeDesafiosPrisma(unidade);
const bloqueios = new RepositorioDeBloqueiosPrisma(unidade);
const documentos = new RepositorioDeDocumentosLegaisPrisma(unidade);
const segundoFator = new RepositorioDeSegundoFatorPrisma(unidade);
const solicitacoes = new RepositorioDeSolicitacoesPrisma(unidade);
const exportacoes = new RepositorioDeExportacoesPrisma(unidade);

/** O dono lê as linhas cruas e grava documentos legais, que a aplicação só lê (S79). */
let dono: pg.Client;

beforeAll(async () => {
  dono = new pg.Client({ connectionString: URL_MIGRACAO_TESTE });
  await dono.connect();
});

/** Ids de toda conta montada aqui: as confirmadas são apagadas no fim (`apagarContasDoTeste`). */
const contasDoTeste = new Set<string>();

afterAll(async () => {
  await apagarContasDoTeste([...contasDoTeste]);
  await dono?.end();
  await prisma.$disconnect();
});

/**
 * Apaga, como dono, as contas que o teste confirmou (e, em cascata, sessões, histórico,
 * códigos, consentimentos e exportações), para outro arquivo que lê a tabela inteira não as
 * ver. A trigger `contas_so_expurgo` (S78) vale também para o dono, então a conta volta antes
 * à forma que o expurgo aceita: ativa, não verificada, sem admin nem lojista e criada há 8 dias.
 */
async function apagarContasDoTeste(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await dono.query('BEGIN');
  try {
    await dono.query(
      "DELETE FROM identidade.perfis_conta WHERE conta_id = ANY($1::uuid[]) AND perfil IN ('admin', 'lojista')",
      [ids],
    );
    await dono.query(
      `UPDATE identidade.contas
          SET status = 'ativa', desativada_em = NULL, anonimizada_em = NULL,
              email_verificado_em = NULL, ultimo_login_em = NULL,
              criada_em = now() - interval '8 days'
        WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    await dono.query('DELETE FROM identidade.contas WHERE id = ANY($1::uuid[])', [ids]);
    await dono.query('COMMIT');
  } catch (erro) {
    await dono.query('ROLLBACK');
    throw erro;
  }
}

class Desfazer extends Error {}

/** Roda `trabalho` numa unidade de trabalho e a desfaz no fim (nada fica no banco). */
async function desfeito(trabalho: () => Promise<void>): Promise<void> {
  try {
    await unidade.executar(async () => {
      await trabalho();
      throw new Desfazer();
    });
  } catch (erro) {
    if (erro instanceof Desfazer) return;
    throw erro;
  }
  throw new Error('a unidade de trabalho deveria ter sido desfeita');
}

function emailNovo(): string {
  return `p${randomUUID().slice(0, 8)}@exemplo.com.br`;
}

function novaConta(agora: Date = T0, email: string = emailNovo()): Conta {
  const conta = Conta.criar({
    id: randomUUID(),
    nome: 'Ana Souza',
    email: Email.criar(email),
    telefone: Telefone.criar(TELEFONE),
    senhaHash: HASH,
    agora,
  });
  contasDoTeste.add(conta.id);
  return conta;
}

function novaSessao(contaId: string, agora: Date = T0, tokenHash = `t-${randomUUID()}`): Sessao {
  return Sessao.criar({
    id: randomUUID(),
    contaId,
    cliente: 'app_consumidor',
    tokenHash,
    mfa: false,
    agora,
  });
}

/** Linha crua (`SELECT *`), lida pelo dono fora da transação da aplicação. */
async function linhaCrua(tabela: string, id: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await dono.query<Record<string, unknown>>(
    `SELECT * FROM identidade.${tabela} WHERE id = $1`,
    [id],
  );
  return rows[0];
}

/** Linha crua lida pela própria transação da unidade (vê o que ela gravou). */
async function linhaNaTransacao(tabela: string, id: string): Promise<Record<string, unknown>> {
  const linhas = await unidade
    .cliente()
    .$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM identidade.${tabela} WHERE id = $1::uuid`,
      id,
    );
  const linha = linhas[0];
  if (linha === undefined) throw new Error(`linha de ${tabela} não encontrada`);
  return linha;
}

/** Tudo o que um erro pode levar adiante: mensagem, pilha, JSON e causa. */
function textoDoErro(erro: unknown): string {
  if (!(erro instanceof Error)) return String(erro);
  const causa = erro.cause === undefined ? '' : textoDoErro(erro.cause);
  return [erro.name, erro.message, erro.stack ?? '', JSON.stringify(erro), causa].join('\n');
}

async function erroDe(promessa: Promise<unknown>): Promise<unknown> {
  try {
    await promessa;
  } catch (erro) {
    return erro;
  }
  throw new Error('era esperado um erro');
}

// ---------------------------------------------------------------------------

describe('RepositorioDeContasPrisma', () => {
  it('grava e lê a conta com perfis, por id e por e-mail (CA-01)', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      conta.concederPerfil('lojista', depois(UM_MINUTO));
      await contas.inserir(conta);
      expect((await contas.buscarPorId(conta.id))?.dados).toEqual(conta.dados);
      expect((await contas.buscarPorEmail(conta.email))?.dados).toEqual(conta.dados);
      await expect(contas.buscarPorId(randomUUID())).resolves.toBeNull();
      await expect(contas.buscarPorId('nao-e-uuid')).resolves.toBeNull();
    });
  });

  it('e-mail repetido vira EmailJaCadastrado sem dado pessoal, e a transação continua usável (CA-02, CA-12)', async () => {
    await desfeito(async () => {
      const email = emailNovo();
      const primeira = novaConta(T0, email);
      await contas.inserir(primeira);
      const segunda = novaConta(T0, email);

      const erro = await erroDe(contas.inserir(segunda));
      expect(erro).toBeInstanceOf(EmailJaCadastrado);
      const texto = textoDoErro(erro);
      for (const dado of [email, 'Ana Souza', '99999', HASH]) expect(texto).not.toContain(dado);

      // Sem erro do Postgres: a mesma transação segue (o cadastro responde como o CA-02).
      expect((await contas.buscarPorEmail(Email.criar(email)))?.id).toBe(primeira.id);
      await expect(contas.buscarPorId(segunda.id)).resolves.toBeNull();
    });
  });

  it('atualizar grava o estado e os perfis novos, sem tirar os antigos', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      conta.verificarEmail(depois(UM_MINUTO));
      conta.concederPerfil('lojista', depois(2 * UM_MINUTO));
      await contas.atualizar(conta);
      conta.desativar(depois(3 * UM_MINUTO));
      await contas.atualizar(conta);
      expect((await contas.buscarPorId(conta.id))?.dados).toEqual(conta.dados);
      expect(conta.perfis).toEqual(['consumidor', 'lojista']);
    });
  });

  it('atualizar para o e-mail de outra conta vira EmailJaCadastrado sem dado pessoal (CA-12)', async () => {
    const email = emailNovo();
    const outra = novaConta(T0, email);
    const conta = novaConta();
    await contas.inserir(outra);
    await contas.inserir(conta);
    const comEmailDaOutra = Conta.reconstituir({ ...conta.dados, emailNormalizado: email });

    const erro = await erroDe(contas.atualizar(comEmailDaOutra));
    expect(erro).toBeInstanceOf(EmailJaCadastrado);
    expect(textoDoErro(erro)).not.toContain(email);
    expect((await contas.buscarPorId(conta.id))?.email.valor).toBe(conta.email.valor);
  });

  it('gravarUltimoLogin muda só ultimo_login_em, e só em conta ativa', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      const antes = await linhaNaTransacao('contas', conta.id);

      await expect(contas.gravarUltimoLogin(conta.id, depois(UM_DIA))).resolves.toBe(true);
      expect(await linhaNaTransacao('contas', conta.id)).toEqual({
        ...antes,
        ultimo_login_em: depois(UM_DIA),
      });

      conta.desativar(depois(2 * UM_DIA));
      await contas.atualizar(conta);
      const desativada = await linhaNaTransacao('contas', conta.id);
      await expect(contas.gravarUltimoLogin(conta.id, depois(3 * UM_DIA))).resolves.toBe(false);
      expect(await linhaNaTransacao('contas', conta.id)).toEqual(desativada);

      await expect(contas.gravarUltimoLogin(randomUUID(), T0)).resolves.toBe(false);
      await expect(contas.gravarUltimoLogin('nao-e-uuid', T0)).resolves.toBe(false);
    });
  });

  it('gravarEmailVerificado muda só email_verificado_em, guarda a primeira data e só em conta ativa', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      const antes = await linhaNaTransacao('contas', conta.id);

      await expect(contas.gravarEmailVerificado(conta.id, depois(UM_DIA))).resolves.toBe(true);
      await expect(contas.gravarEmailVerificado(conta.id, depois(2 * UM_DIA))).resolves.toBe(true);
      expect(await linhaNaTransacao('contas', conta.id)).toEqual({
        ...antes,
        email_verificado_em: depois(UM_DIA),
      });

      const outra = novaConta();
      await contas.inserir(outra);
      outra.desativar(depois(UM_MINUTO));
      await contas.atualizar(outra);
      const desativada = await linhaNaTransacao('contas', outra.id);
      await expect(contas.gravarEmailVerificado(outra.id, depois(UM_DIA))).resolves.toBe(false);
      expect(await linhaNaTransacao('contas', outra.id)).toEqual(desativada);

      await expect(contas.gravarEmailVerificado(randomUUID(), T0)).resolves.toBe(false);
      await expect(contas.gravarEmailVerificado('nao-e-uuid', T0)).resolves.toBe(false);
    });
  });

  it('gravarSenhaRedefinida muda só senha_hash e email_verificado_em (primeira data), e só em conta ativa (S95)', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      const antes = await linhaNaTransacao('contas', conta.id);
      const NOVO = '$argon2id$v=19$m=19456,t=2,p=1$bm92bw$bm92bw';

      await expect(contas.gravarSenhaRedefinida(conta.id, NOVO, depois(UM_DIA))).resolves.toBe(
        true,
      );
      await expect(contas.gravarSenhaRedefinida(conta.id, NOVO, depois(2 * UM_DIA))).resolves.toBe(
        true,
      );
      expect(await linhaNaTransacao('contas', conta.id)).toEqual({
        ...antes,
        senha_hash: NOVO,
        email_verificado_em: depois(UM_DIA),
      });

      conta.desativar(depois(3 * UM_DIA));
      await contas.atualizar(conta);
      const desativada = await linhaNaTransacao('contas', conta.id);
      await expect(contas.gravarSenhaRedefinida(conta.id, HASH, depois(4 * UM_DIA))).resolves.toBe(
        false,
      );
      expect(await linhaNaTransacao('contas', conta.id)).toEqual(desativada);
      await expect(contas.gravarSenhaRedefinida(randomUUID(), HASH, T0)).resolves.toBe(false);
      await expect(contas.gravarSenhaRedefinida('nao-e-uuid', HASH, T0)).resolves.toBe(false);
    });
  });

  it('gravarSenhaRemovida e gravarDesativacao mudam só as suas colunas, e só em conta ativa (S95, S97)', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      const antes = await linhaNaTransacao('contas', conta.id);

      await expect(contas.gravarSenhaRemovida(conta.id)).resolves.toBe(true);
      expect(await linhaNaTransacao('contas', conta.id)).toEqual({ ...antes, senha_hash: null });
      await expect(contas.gravarDesativacao(conta.id, depois(UM_DIA))).resolves.toBe(true);
      const desativada = await linhaNaTransacao('contas', conta.id);
      expect(desativada).toEqual({
        ...antes,
        senha_hash: null,
        status: 'desativada',
        desativada_em: depois(UM_DIA),
      });

      await expect(contas.gravarDesativacao(conta.id, depois(2 * UM_DIA))).resolves.toBe(false);
      await expect(contas.gravarSenhaRemovida(conta.id)).resolves.toBe(false);
      expect(await linhaNaTransacao('contas', conta.id)).toEqual(desativada);
      for (const id of [randomUUID(), 'nao-e-uuid']) {
        await expect(contas.gravarDesativacao(id, T0)).resolves.toBe(false);
        await expect(contas.gravarSenhaRemovida(id)).resolves.toBe(false);
      }
    });
  });

  it('buscarPorIdParaAtualizar lê a conta com trava e recusa trabalho fora da unidade', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      await expect(contas.buscarPorIdParaAtualizar(conta.id)).resolves.toEqual(
        await contas.buscarPorId(conta.id),
      );
      await expect(contas.buscarPorIdParaAtualizar(randomUUID())).resolves.toBeNull();
      await expect(contas.buscarPorIdParaAtualizar('nao-e-uuid')).resolves.toBeNull();
    });
    await expect(contas.buscarPorIdParaAtualizar(randomUUID())).rejects.toThrow(
      'fora da unidade de trabalho',
    );
  });

  it('listarParaExpurgo dá o mesmo resultado de Conta.deveSerExpurgada, uma conta por caso', async () => {
    // Datas de 1999 e 2000: nenhuma conta de outro teste fica antes deste limite.
    const agora = new Date('2000-01-10T12:00:00.000Z');
    const limite = limiteDoExpurgo(agora);
    const antesDoLimite = (ms: number) => new Date(limite.getTime() - ms);

    const base = (criadaEm: Date): DadosDaConta => novaConta(criadaEm).dados;
    const casos: Record<string, DadosDaConta> = {
      'sem login, criada antes do limite': base(antesDoLimite(UM_DIA)),
      'criada 1 ms antes do limite': base(antesDoLimite(1)),
      'criada exatamente no limite': base(limite),
      'criada depois do limite': base(depois(1, limite)),
      'login antigo': {
        ...base(antesDoLimite(9 * UM_DIA)),
        ultimoLoginEm: antesDoLimite(2 * UM_DIA),
      },
      'login recente': {
        ...base(antesDoLimite(9 * UM_DIA)),
        ultimoLoginEm: depois(UM_MINUTO, limite),
      },
      'e-mail verificado': {
        ...base(antesDoLimite(UM_DIA)),
        emailVerificadoEm: antesDoLimite(UM_DIA),
      },
      desativada: {
        ...base(antesDoLimite(UM_DIA)),
        status: 'desativada',
        desativadaEm: antesDoLimite(UM_MINUTO),
      },
      anonimizada: {
        ...base(antesDoLimite(UM_DIA)),
        nome: 'Conta anonimizada',
        telefoneE164: null,
        senhaHash: null,
        status: 'anonimizada',
        desativadaEm: antesDoLimite(2 * UM_MINUTO),
        anonimizadaEm: antesDoLimite(UM_MINUTO),
      },
    };
    const comPerfil = (perfil: 'admin' | 'lojista') => {
      const conta = Conta.reconstituir(base(antesDoLimite(UM_DIA)));
      if (perfil === 'admin') conta.concederAdmin(antesDoLimite(UM_DIA));
      else conta.concederPerfil('lojista', antesDoLimite(UM_DIA));
      return conta.dados;
    };
    casos['com admin'] = comPerfil('admin');
    casos['com lojista'] = comPerfil('lojista');

    await desfeito(async () => {
      const ids = new Map<string, string>();
      for (const [caso, dados] of Object.entries(casos)) {
        const conta = Conta.reconstituir(dados);
        await contas.inserir(conta);
        ids.set(conta.id, caso);
      }
      const listados = (await contas.listarParaExpurgo(limite, 100)).filter((id) => ids.has(id));
      // Em ordem de id (S105); o UUID em minúsculas ordena no JS como no banco.
      const esperados = Object.values(casos)
        .map((dados) => Conta.reconstituir(dados))
        .filter((conta) => conta.deveSerExpurgada(agora))
        .map((conta) => conta.id)
        .sort();

      expect(listados).toEqual(esperados);
      expect(listados.map((id) => ids.get(id)).sort()).toEqual([
        'criada 1 ms antes do limite',
        'login antigo',
        'sem login, criada antes do limite',
      ]);
      const [primeiro] = await contas.listarParaExpurgo(limite, 1);
      expect(primeiro).toBe(listados[0]);
      // Cursor: só os ids depois do último visto.
      const depoisDoPrimeiro = (
        await contas.listarParaExpurgo(limite, 100, listados[0] ?? null)
      ).filter((id) => ids.has(id));
      expect(depoisDoPrimeiro).toEqual(listados.slice(1));
      await expect(contas.listarParaExpurgo(limite, 100, listados.at(-1) ?? null)).resolves.toEqual(
        [],
      );
      await expect(contas.listarParaExpurgo(limite, 100, 'nao-e-uuid')).resolves.toEqual([]);
      await expect(contas.listarParaExpurgo(limite, 0)).resolves.toEqual([]);
    });
  });

  it('apagar leva a conta do expurgo e o que é dela; a trigger recusa as outras (S78)', async () => {
    // A trigger compara com o now() do banco: a conta precisa ter 8 dias de verdade.
    const oitoDiasAtras = new Date(Date.now() - 8 * UM_DIA);
    const expurgavel = novaConta(oitoDiasAtras);
    const verificada = novaConta(oitoDiasAtras);
    verificada.verificarEmail(oitoDiasAtras);
    await contas.inserir(expurgavel);
    await contas.inserir(verificada);
    const sessao = novaSessao(expurgavel.id, oitoDiasAtras);
    await sessoes.inserir(sessao);
    await codigos.inserir(
      CodigoDeVerificacao.emitir({
        id: randomUUID(),
        contaId: expurgavel.id,
        finalidade: 'verificacao_email',
        codigoHmac: 'hmac',
        agora: oitoDiasAtras,
      }),
    );

    await unidade.executar(() => contas.apagar(expurgavel.id));
    await expect(contas.buscarPorId(expurgavel.id)).resolves.toBeNull();
    await expect(sessoes.buscarPorId(sessao.id)).resolves.toBeNull();
    const { rows } = await dono.query(
      'SELECT 1 FROM identidade.codigos_verificacao WHERE conta_id = $1',
      [expurgavel.id],
    );
    expect(rows).toEqual([]);

    const erro = await erroDe(contas.apagar(verificada.id));
    expect(textoDoErro(erro)).not.toContain(verificada.email.valor);
    expect((await contas.buscarPorId(verificada.id))?.dados).toEqual(verificada.dados);
    await expect(contas.apagar(randomUUID())).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('RepositorioDeSessoesPrisma', () => {
  it('grava e lê a sessão do app e a do painel com mfa', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      const app = novaSessao(conta.id);
      const painel = Sessao.criar({
        id: randomUUID(),
        contaId: conta.id,
        cliente: 'painel',
        tokenHash: `t-${randomUUID()}`,
        mfa: true,
        agora: T0,
        familiaId: app.familiaId,
      });
      await sessoes.inserir(app);
      await sessoes.inserir(painel);
      expect((await sessoes.buscarPorId(app.id))?.dados).toEqual(app.dados);
      expect((await sessoes.buscarPorId(painel.id))?.dados).toEqual(painel.dados);
      expect((await sessoes.buscarPorTokenHash(app.dados.tokenHash))?.id).toBe(app.id);
      await expect(sessoes.buscarPorTokenHash('desconhecido')).resolves.toBeNull();
      await expect(sessoes.buscarPorId('nao-e-uuid')).resolves.toBeNull();
    });
  });

  it('gravarRotacao muda só as colunas da rotação e guarda o token trocado no histórico (S77)', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      const sessao = novaSessao(conta.id, T0, 't1-rotacao');
      await sessoes.inserir(sessao);
      const antes = await linhaNaTransacao('sessoes', sessao.id);

      const lida = await sessoes.buscarPorTokenHash('t1-rotacao');
      if (lida === null) throw new Error('sessão não encontrada');
      lida.rotacionar('t2-rotacao', 'par-cifrado', depois(UM_MINUTO));
      await expect(sessoes.gravarRotacao(lida)).resolves.toBe(true);

      const dados = lida.dados;
      expect(await linhaNaTransacao('sessoes', sessao.id)).toEqual({
        ...antes,
        token_hash: 't2-rotacao',
        token_anterior_hash: 't1-rotacao',
        par_novo_cifrado: 'par-cifrado',
        par_novo_expira_em: dados.parNovoExpiraEm,
        trocado_em: depois(UM_MINUTO),
        ultimo_uso_em: depois(UM_MINUTO),
        expira_em: dados.expiraEm,
      });
      expect((await sessoes.buscarPorId(sessao.id))?.dados).toEqual(dados);
      // O anterior imediato ainda acha a sessão (tolerância); o histórico guarda o trocado.
      expect((await sessoes.buscarPorTokenHash('t1-rotacao'))?.id).toBe(sessao.id);
      await expect(sessoes.buscarTokenUsado('t1-rotacao')).resolves.toEqual({
        tokenHash: 't1-rotacao',
        familiaId: sessao.familiaId,
        sessaoId: sessao.id,
        usadoEm: depois(UM_MINUTO),
      });
      await expect(sessoes.buscarTokenUsado('t2-rotacao')).resolves.toBeNull();

      // A mesma entidade velha de novo: o token guardado já não é o trocado.
      const velha = Sessao.reconstituir(sessao.dados);
      velha.rotacionar('t3-rotacao', 'outro-par', depois(2 * UM_MINUTO));
      await expect(sessoes.gravarRotacao(velha)).resolves.toBe(false);
      expect((await sessoes.buscarPorId(sessao.id))?.dados).toEqual(dados);
    });
  });

  it('gravarRotacao recusa sessão revogada e trabalho fora da unidade (R1, R7)', async () => {
    const conta = novaConta();
    await contas.inserir(conta);
    const sessao = novaSessao(conta.id);
    await sessoes.inserir(sessao);
    const lida = Sessao.reconstituir(sessao.dados);
    lida.rotacionar(`novo-${randomUUID()}`, 'par', depois(UM_MINUTO));

    await expect(sessoes.gravarRotacao(lida)).rejects.toBeInstanceOf(ForaDaUnidadeDeTrabalhoPrisma);
    await expect(sessoes.revogarDaConta(conta.id, 'logout', depois(30_000))).resolves.toBe(1);
    await expect(unidade.executar(() => sessoes.gravarRotacao(lida))).resolves.toBe(false);
    expect((await sessoes.buscarPorId(sessao.id))?.dados).toMatchObject({
      tokenHash: sessao.dados.tokenHash,
      revogadaEm: depois(30_000),
      motivoRevogacao: 'logout',
    });
    await expect(sessoes.buscarTokenUsado(sessao.dados.tokenHash)).resolves.toBeNull();
  });

  it('atualizar grava só a revogação: não rebaixa a rotação nem troca a primeira revogação (R7)', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      const sessao = novaSessao(conta.id);
      await sessoes.inserir(sessao);
      const velha = Sessao.reconstituir(sessao.dados);
      const outraVelha = Sessao.reconstituir(sessao.dados);

      const rotacionada = Sessao.reconstituir(sessao.dados);
      rotacionada.rotacionar(`novo-${randomUUID()}`, 'par', depois(UM_MINUTO));
      await sessoes.gravarRotacao(rotacionada);

      velha.revogar('logout', depois(2 * UM_MINUTO));
      await sessoes.atualizar(velha);
      outraVelha.revogar('senha_redefinida', depois(3 * UM_MINUTO));
      await sessoes.atualizar(outraVelha);

      expect((await sessoes.buscarPorId(sessao.id))?.dados).toEqual({
        ...rotacionada.dados,
        revogadaEm: depois(2 * UM_MINUTO),
        motivoRevogacao: 'logout',
        parNovoCifrado: null,
        parNovoExpiraEm: null,
      });

      const naoRevogada = novaSessao(conta.id);
      await sessoes.inserir(naoRevogada);
      await expect(sessoes.atualizar(naoRevogada)).rejects.toBeInstanceOf(OperacaoInvalidaNaSessao);
    });
  });

  it('revogações em lote mudam só as sessões ainda não revogadas, e apagarDaConta leva o histórico', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      const primeira = novaSessao(conta.id);
      const daFamilia = Sessao.criar({
        id: randomUUID(),
        contaId: conta.id,
        cliente: 'app_lojista',
        tokenHash: `t-${randomUUID()}`,
        mfa: false,
        agora: T0,
        familiaId: primeira.familiaId,
      });
      const outra = novaSessao(conta.id);
      for (const sessao of [primeira, daFamilia, outra]) await sessoes.inserir(sessao);
      daFamilia.revogar('logout', depois(UM_MINUTO));
      await sessoes.atualizar(daFamilia);

      await expect(
        sessoes.revogarDaFamilia(primeira.familiaId, 'reuso_detectado', depois(2 * UM_MINUTO)),
      ).resolves.toBe(1);
      await expect(
        sessoes.revogarDaConta(conta.id, 'senha_redefinida', depois(3 * UM_MINUTO)),
      ).resolves.toBe(1);
      const motivos = await Promise.all(
        [primeira, daFamilia, outra].map(
          async (s) => (await sessoes.buscarPorId(s.id))?.motivoRevogacao,
        ),
      );
      expect(motivos).toEqual(['reuso_detectado', 'logout', 'senha_redefinida']);
      await expect(sessoes.revogarDaConta(conta.id, 'logout', depois(4 * UM_MINUTO))).resolves.toBe(
        0,
      );

      const viva = novaSessao(conta.id, T0, 'viva-1');
      await sessoes.inserir(viva);
      viva.rotacionar('viva-2', 'par', depois(UM_MINUTO));
      await sessoes.gravarRotacao(viva);
      await sessoes.apagarDaConta(conta.id);
      await expect(sessoes.buscarPorId(viva.id)).resolves.toBeNull();
      await expect(sessoes.buscarTokenUsado('viva-1')).resolves.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------

describe('RepositorioDeCodigosDeVerificacaoPrisma e RepositorioDeDesafiosPrisma', () => {
  function codigo(
    contaId: string,
    agora: Date,
    finalidade: 'verificacao_email' | 'recuperacao_senha' = 'verificacao_email',
  ) {
    return CodigoDeVerificacao.emitir({
      id: randomUUID(),
      contaId,
      finalidade,
      codigoHmac: `c-${randomUUID()}`,
      agora,
    });
  }

  function desafio(contaId: string, agora: Date, etapa: 'configurar' | 'verificar' = 'verificar') {
    return DesafioDeSegundoFator.emitir({
      id: randomUUID(),
      contaId,
      etapa,
      tokenHmac: `d-${randomUUID()}`,
      agora,
    });
  }

  it('buscarVigenteParaAtualizar acha o código mais recente que ainda vale, só da finalidade', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      const antigo = codigo(conta.id, T0);
      const recente = codigo(conta.id, depois(UM_MINUTO));
      const deOutraFinalidade = codigo(conta.id, depois(2 * UM_MINUTO), 'recuperacao_senha');
      for (const c of [antigo, recente, deOutraFinalidade]) await codigos.inserir(c);
      await desafios.inserir(desafio(conta.id, depois(3 * UM_MINUTO)));

      const vigente = await codigos.buscarVigenteParaAtualizar(
        conta.id,
        'verificacao_email',
        depois(5 * UM_MINUTO),
      );
      expect(vigente?.dados).toEqual(recente.dados);

      // Esgotado: as tentativas gravadas tiram o código de uso.
      for (let i = 0; i < TENTATIVAS_POR_CODIGO; i += 1)
        vigente?.conferir(false, depois(6 * UM_MINUTO));
      if (vigente !== null) await codigos.atualizar(vigente);
      const seguinte = await codigos.buscarVigenteParaAtualizar(
        conta.id,
        'verificacao_email',
        depois(7 * UM_MINUTO),
      );
      expect(seguinte?.id).toBe(antigo.id);

      // Vencido (30 min) e de conta sem código: nada.
      await expect(
        codigos.buscarVigenteParaAtualizar(conta.id, 'verificacao_email', depois(31 * UM_MINUTO)),
      ).resolves.toBeNull();
      await expect(
        codigos.buscarVigenteParaAtualizar(randomUUID(), 'verificacao_email', T0),
      ).resolves.toBeNull();
    });
  });

  it('invalidarVigentes marca só os que valem, da finalidade; apagarDaConta leva códigos e desafios', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      const valendo = codigo(conta.id, T0);
      const deOutraFinalidade = codigo(conta.id, T0, 'recuperacao_senha');
      const usado = codigo(conta.id, T0);
      usado.conferir(true, depois(UM_MINUTO));
      for (const c of [valendo, deOutraFinalidade, usado]) await codigos.inserir(c);

      await codigos.invalidarVigentes(conta.id, 'verificacao_email', depois(2 * UM_MINUTO));
      expect((await linhaNaTransacao('codigos_verificacao', valendo.id))['usado_em']).toEqual(
        depois(2 * UM_MINUTO),
      );
      expect((await linhaNaTransacao('codigos_verificacao', usado.id))['usado_em']).toEqual(
        depois(UM_MINUTO),
      );
      expect(
        (await linhaNaTransacao('codigos_verificacao', deOutraFinalidade.id))['usado_em'],
      ).toBeNull();

      const d = desafio(conta.id, T0);
      await desafios.inserir(d);
      await codigos.apagarDaConta(conta.id);
      await expect(desafios.buscarPorIdParaAtualizar(d.id)).resolves.toBeNull();
      await expect(
        codigos.buscarVigenteParaAtualizar(conta.id, 'recuperacao_senha', depois(UM_MINUTO)),
      ).resolves.toBeNull();
    });
  });

  it('o desafio volta com a etapa, só pelo repositório de desafios, e invalidarVigentes respeita a etapa', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      const configurar = desafio(conta.id, T0, 'configurar');
      const verificar = desafio(conta.id, T0, 'verificar');
      await desafios.inserir(configurar);
      await desafios.inserir(verificar);
      const c = codigo(conta.id, T0);
      await codigos.inserir(c);

      expect((await desafios.buscarPorIdParaAtualizar(configurar.id))?.dados).toEqual(
        configurar.dados,
      );
      await expect(desafios.buscarPorIdParaAtualizar(c.id)).resolves.toBeNull();
      await expect(desafios.buscarPorIdParaAtualizar('nao-e-uuid')).resolves.toBeNull();

      await desafios.invalidarVigentes(conta.id, 'configurar', depois(UM_MINUTO));
      expect(
        (await desafios.buscarPorIdParaAtualizar(configurar.id))?.estaValidoPara(
          'configurar',
          depois(UM_MINUTO),
        ),
      ).toBe(false);
      const lido = await desafios.buscarPorIdParaAtualizar(verificar.id);
      expect(lido?.estaValidoPara('verificar', depois(UM_MINUTO))).toBe(true);

      const freio = BloqueioDeLogin.novo(`f-${randomUUID()}`, 'segundo_fator', T0);
      lido?.avaliarCodigo({
        etapa: 'verificar',
        freio,
        codigoConfere: false,
        agora: depois(UM_MINUTO),
      });
      if (lido !== null) await desafios.atualizar(lido);
      expect((await desafios.buscarPorIdParaAtualizar(verificar.id))?.dados.tentativas).toBe(1);
      // O código por e-mail não muda pelo repositório de desafios.
      await expect(
        desafios.atualizar(DesafioDeSegundoFator.reconstituir({ ...verificar.dados, id: c.id })),
      ).rejects.toThrow();
    });
  });

  it('buscarPorId lê só desafios, sem trava; apagarDaConta leva só os desafios da conta (Q29)', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      const outra = novaConta();
      for (const c of [conta, outra]) await contas.inserir(c);
      const configurar = desafio(conta.id, T0, 'configurar');
      const verificar = desafio(conta.id, T0, 'verificar');
      verificar.avaliarCodigo({
        etapa: 'verificar',
        freio: BloqueioDeLogin.novo(`f-${randomUUID()}`, 'segundo_fator', T0),
        codigoConfere: false,
        agora: depois(UM_MINUTO),
      });
      const daOutra = desafio(outra.id, T0);
      for (const d of [configurar, verificar, daOutra]) await desafios.inserir(d);
      const recuperacao = codigo(conta.id, T0, 'recuperacao_senha');
      await codigos.inserir(recuperacao);

      expect((await desafios.buscarPorId(verificar.id))?.dados).toEqual(verificar.dados);
      await expect(desafios.buscarPorId(recuperacao.id)).resolves.toBeNull();
      await expect(desafios.buscarPorId('nao-e-uuid')).resolves.toBeNull();
      expect(await desafios.somarTentativasDesde(conta.id, new Date(T0.getTime() - 1))).toBe(1);

      await desafios.apagarDaConta(conta.id);
      await desafios.apagarDaConta('nao-e-uuid');

      await expect(desafios.buscarPorId(configurar.id)).resolves.toBeNull();
      await expect(desafios.buscarPorId(verificar.id)).resolves.toBeNull();
      expect(await desafios.somarTentativasDesde(conta.id, new Date(T0.getTime() - 1))).toBe(0);
      expect((await desafios.buscarPorId(daOutra.id))?.contaId).toBe(outra.id);
      expect((await linhaNaTransacao('codigos_verificacao', recuperacao.id))['finalidade']).toBe(
        'recuperacao_senha',
      );
    });
  });

  it('as leituras com trava recusam trabalho fora da unidade (R1)', async () => {
    await expect(
      codigos.buscarVigenteParaAtualizar(randomUUID(), 'verificacao_email', T0),
    ).rejects.toBeInstanceOf(ForaDaUnidadeDeTrabalhoPrisma);
    await expect(desafios.buscarPorIdParaAtualizar(randomUUID())).rejects.toBeInstanceOf(
      ForaDaUnidadeDeTrabalhoPrisma,
    );
    await expect(bloqueios.buscarParaAtualizar('chave', 'email', T0)).rejects.toBeInstanceOf(
      ForaDaUnidadeDeTrabalhoPrisma,
    );
    await expect(contas.travarCriacaoDeAdmin()).rejects.toBeInstanceOf(
      ForaDaUnidadeDeTrabalhoPrisma,
    );
  });
});

// ---------------------------------------------------------------------------

describe('RepositorioDeBloqueiosPrisma (CA-04)', () => {
  it('5 falhas em 15 min freiam por 1 min; o freio volta igual e zera apagando a linha', async () => {
    await desfeito(async () => {
      const chave = `hmac-${randomUUID()}`;
      await expect(bloqueios.buscar(chave, 'email')).resolves.toBeNull();

      for (let falha = 0; falha < LIMIAR_DE_FALHAS.email; falha += 1) {
        const freio = await bloqueios.buscarParaAtualizar(
          chave,
          'email',
          depois(falha * UM_MINUTO),
        );
        freio.registrarFalha(depois(falha * UM_MINUTO));
        await bloqueios.salvar(freio);
      }
      const freado = await bloqueios.buscar(chave, 'email');
      expect(freado?.estaBloqueado(depois(4 * UM_MINUTO))).toBe(true);
      expect(freado?.segundosDeEspera(depois(4 * UM_MINUTO))).toBe(60);
      expect(freado?.estaBloqueado(depois(5 * UM_MINUTO))).toBe(false);
      // O mesmo HMAC em outro tipo é outro freio.
      await expect(bloqueios.buscar(chave, 'ip')).resolves.toBeNull();

      const travado = await bloqueios.buscarParaAtualizar(chave, 'email', depois(6 * UM_MINUTO));
      expect(travado.dados).toEqual(freado?.dados);
      travado.registrarSucesso('senha');
      await bloqueios.salvar(travado);
      await expect(bloqueios.buscar(chave, 'email')).resolves.toBeNull();
    });
  });

  it('buscarParaAtualizar cria a linha zerada da chave nova', async () => {
    await desfeito(async () => {
      const chave = `hmac-${randomUUID()}`;
      const freio = await bloqueios.buscarParaAtualizar(chave, 'ip', T0);
      expect(freio.dados).toEqual(BloqueioDeLogin.novo(chave, 'ip', T0).dados);
      expect((await bloqueios.buscar(chave, 'ip'))?.dados).toEqual(freio.dados);
    });
  });
});

// ---------------------------------------------------------------------------

describe('RepositorioDeDocumentosLegaisPrisma (CA-01, CA-10)', () => {
  const sufixo = randomUUID().slice(0, 8);
  const ids = { v1: randomUUID(), v2: randomUUID(), futura: randomUUID() };

  beforeAll(async () => {
    // Datas de 1990 a 2000: nenhum documento de outro teste fica antes delas.
    const inserir = (id: string, versao: string, vigenteDesde: string) =>
      dono.query(
        `INSERT INTO identidade.documentos_legais (id, tipo, versao, conteudo, vigente_desde)
         VALUES ($1, 'termos', $2, 'Termos de teste', $3)`,
        [id, versao, vigenteDesde],
      );
    await inserir(ids.v1, `v1-${sufixo}`, '1990-01-01T00:00:00Z');
    await inserir(ids.v2, `v2-${sufixo}`, '1995-01-01T00:00:00Z');
    await inserir(ids.futura, `v3-${sufixo}`, '2000-01-01T00:00:00Z');
  });

  afterAll(async () => {
    const todos = Object.values(ids);
    await dono.query('DELETE FROM identidade.consentimentos WHERE documento_id = ANY($1::uuid[])', [
      todos,
    ]);
    await dono.query('DELETE FROM identidade.documentos_legais WHERE id = ANY($1::uuid[])', [
      todos,
    ]);
  });

  it('buscarVigente devolve a versão mais recente já em vigor', async () => {
    await expect(
      documentos.buscarVigente('termos', new Date('1997-06-01T00:00:00Z')),
    ).resolves.toEqual({
      id: ids.v2,
      tipo: 'termos',
      versao: `v2-${sufixo}`,
      conteudo: 'Termos de teste',
      vigenteDesde: new Date('1995-01-01T00:00:00Z'),
    });
    expect((await documentos.buscarVigente('termos', new Date('1990-06-01T00:00:00Z')))?.id).toBe(
      ids.v1,
    );
    await expect(
      documentos.buscarVigente('privacidade', new Date('1980-01-01T00:00:00Z')),
    ).resolves.toBeNull();
  });

  it('registra o aceite da versão e devolve a data; aceitar de novo a mesma versão é recusado', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      await expect(documentos.buscarAceite(conta.id, ids.v2)).resolves.toBeNull();
      await documentos.registrarConsentimento({
        id: randomUUID(),
        contaId: conta.id,
        documentoId: ids.v2,
        aceitoEm: T0,
      });
      await expect(documentos.buscarAceite(conta.id, ids.v2)).resolves.toEqual(T0);
      await expect(documentos.buscarAceite(conta.id, ids.v1)).resolves.toBeNull();
      await expect(documentos.buscarAceite('nao-e-uuid', ids.v1)).resolves.toBeNull();
    });
    const conta = novaConta();
    await contas.inserir(conta);
    await documentos.registrarConsentimento({
      id: randomUUID(),
      contaId: conta.id,
      documentoId: ids.v1,
      aceitoEm: T0,
    });
    await expect(
      documentos.registrarConsentimento({
        id: randomUUID(),
        contaId: conta.id,
        documentoId: ids.v1,
        aceitoEm: depois(UM_MINUTO),
      }),
    ).rejects.toThrow();
    await expect(documentos.buscarAceite(conta.id, ids.v1)).resolves.toEqual(T0);
  });

  it('listarConsentimentos traz todos os aceites, inclusive de versão fora de vigor, com tipo e versão', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      const aceiteV2 = {
        id: randomUUID(),
        contaId: conta.id,
        documentoId: ids.v2,
        aceitoEm: depois(UM_DIA),
      };
      const aceiteV1 = { id: randomUUID(), contaId: conta.id, documentoId: ids.v1, aceitoEm: T0 };
      await documentos.registrarConsentimento(aceiteV2);
      await documentos.registrarConsentimento(aceiteV1);

      await expect(documentos.listarConsentimentos(conta.id)).resolves.toEqual([
        { ...aceiteV1, tipo: 'termos', versao: `v1-${sufixo}` },
        { ...aceiteV2, tipo: 'termos', versao: `v2-${sufixo}` },
      ]);
      await expect(documentos.listarConsentimentos(randomUUID())).resolves.toEqual([]);
      await expect(documentos.listarConsentimentos('nao-e-uuid')).resolves.toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------

describe('RepositorioDeSegundoFatorPrisma', () => {
  it('grava, troca e apaga o segundo fator e os códigos de recuperação', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      await expect(segundoFator.buscar(conta.id)).resolves.toBeNull();
      await segundoFator.salvar({
        contaId: conta.id,
        segredoCifrado: 'v1:cifrado',
        confirmadoEm: null,
        ultimoPassoUsado: null,
      });
      const confirmado = {
        contaId: conta.id,
        segredoCifrado: 'v1:cifrado',
        confirmadoEm: T0,
        ultimoPassoUsado: 12345,
      };
      await segundoFator.salvar(confirmado);
      await expect(segundoFator.buscar(conta.id)).resolves.toEqual(confirmado);

      const novos = Array.from({ length: 3 }, (_, i) => ({
        id: randomUUID(),
        contaId: conta.id,
        codigoHmac: `r-${i}`,
        usadoEm: null,
      }));
      await segundoFator.substituirCodigosDeRecuperacao(conta.id, [
        { id: randomUUID(), contaId: conta.id, codigoHmac: 'velho', usadoEm: null },
      ]);
      await segundoFator.substituirCodigosDeRecuperacao(conta.id, novos);
      const naoUsados = await segundoFator.listarCodigosDeRecuperacaoNaoUsados(conta.id);
      expect([...naoUsados].sort((a, b) => a.codigoHmac.localeCompare(b.codigoHmac))).toEqual(
        novos,
      );

      const [primeiro] = novos;
      if (primeiro === undefined) throw new Error('sem código');
      await segundoFator.marcarCodigoDeRecuperacaoUsado(primeiro.id, depois(UM_MINUTO));
      await segundoFator.marcarCodigoDeRecuperacaoUsado(primeiro.id, depois(2 * UM_MINUTO));
      expect((await linhaNaTransacao('codigos_recuperacao', primeiro.id))['usado_em']).toEqual(
        depois(UM_MINUTO),
      );
      expect(await segundoFator.listarCodigosDeRecuperacaoNaoUsados(conta.id)).toHaveLength(2);

      await expect(
        segundoFator.substituirCodigosDeRecuperacao(conta.id, [
          { ...primeiro, contaId: randomUUID() },
        ]),
      ).rejects.toBeInstanceOf(CodigoDeRecuperacaoInvalido);
      await expect(
        segundoFator.marcarCodigoDeRecuperacaoUsado(randomUUID(), T0),
      ).rejects.toBeInstanceOf(CodigoDeRecuperacaoInvalido);

      await segundoFator.apagar(conta.id);
      await expect(segundoFator.buscar(conta.id)).resolves.toBeNull();
      await expect(segundoFator.listarCodigosDeRecuperacaoNaoUsados(conta.id)).resolves.toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------

describe('RepositorioDeSolicitacoesPrisma e RepositorioDeExportacoesPrisma', () => {
  it('solicitações: grava, conclui, acha a última e lista por status das mais antigas para as mais novas', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      // Datas de 1990: vêm antes de qualquer solicitação de outro teste na lista por status.
      const em = (dia: number) => new Date(Date.UTC(1990, 0, dia));
      const nova = (dia: number, tipo: 'exportacao' | 'exclusao' = 'exportacao') => ({
        id: randomUUID(),
        contaId: conta.id,
        tipo,
        status: 'pendente' as const,
        solicitadaEm: em(dia),
        concluidaEm: null,
      });
      const primeira = nova(1);
      const segunda = nova(2);
      const exclusao = nova(3, 'exclusao');
      for (const s of [segunda, primeira, exclusao]) await solicitacoes.inserir(s);

      await expect(solicitacoes.buscarPorId(primeira.id)).resolves.toEqual(primeira);
      await expect(solicitacoes.buscarUltima(conta.id, 'exportacao')).resolves.toEqual(segunda);
      await expect(solicitacoes.buscarUltima(randomUUID(), 'exportacao')).resolves.toBeNull();
      const pendentes = await solicitacoes.listarPorStatus('exportacao', 'pendente', 2);
      expect(pendentes.map((s) => s.id)).toEqual([primeira.id, segunda.id]);
      // Cursor (S105): (solicitada_em, id) depois da primeira; o id desempata o mesmo instante.
      const depoisDaPrimeira = await solicitacoes.listarPorStatus('exportacao', 'pendente', 1, {
        solicitadaEm: primeira.solicitadaEm,
        id: primeira.id,
      });
      expect(depoisDaPrimeira.map((s) => s.id)).toEqual([segunda.id]);
      const mesmoInstante = await solicitacoes.listarPorStatus('exportacao', 'pendente', 1, {
        solicitadaEm: segunda.solicitadaEm,
        id: '00000000-0000-0000-0000-000000000000',
      });
      expect(mesmoInstante.map((s) => s.id)).toEqual([segunda.id]);
      const depoisDaSegunda = await solicitacoes.listarPorStatus('exportacao', 'pendente', 1, {
        solicitadaEm: segunda.solicitadaEm,
        id: segunda.id,
      });
      expect(depoisDaSegunda.map((s) => s.id)).not.toContain(segunda.id);
      expect(depoisDaSegunda.map((s) => s.id)).not.toContain(primeira.id);

      const concluida = { ...primeira, status: 'concluida' as const, concluidaEm: em(5) };
      await solicitacoes.atualizar(concluida);
      await expect(solicitacoes.buscarPorId(primeira.id)).resolves.toEqual(concluida);
      await expect(solicitacoes.listarPorStatus('exportacao', 'pendente', 0)).resolves.toEqual([]);

      // contarDesde: depois da data (exclusivo), do tipo e da conta, em qualquer status.
      await expect(solicitacoes.contarDesde(conta.id, 'exportacao', em(1))).resolves.toBe(1);
      await expect(solicitacoes.contarDesde(conta.id, 'exportacao', em(0))).resolves.toBe(2);
      await expect(solicitacoes.contarDesde(conta.id, 'exclusao', em(0))).resolves.toBe(1);
      await expect(solicitacoes.contarDesde(randomUUID(), 'exportacao', em(0))).resolves.toBe(0);
      await expect(solicitacoes.contarDesde('nao-e-uuid', 'exportacao', em(0))).resolves.toBe(0);
    });
  });

  it('exportações: a disponível é a mais recente não baixada e não vencida; baixar é uso único (S10)', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      await contas.inserir(conta);
      const nova = (criadaEm: Date) => ({
        id: randomUUID(),
        contaId: conta.id,
        conteudoCifrado: `v1:${randomUUID()}`,
        criadaEm,
        expiraEm: depois(7 * UM_DIA, criadaEm),
        baixadaEm: null,
      });
      const antiga = nova(T0);
      const recente = nova(depois(UM_DIA));
      await exportacoes.inserir(antiga);
      await exportacoes.inserir(recente);

      await expect(exportacoes.buscarDisponivel(conta.id, depois(2 * UM_DIA))).resolves.toEqual(
        recente,
      );
      await expect(exportacoes.marcarBaixada(recente.id, depois(2 * UM_DIA))).resolves.toBe(true);
      await expect(exportacoes.marcarBaixada(recente.id, depois(3 * UM_DIA))).resolves.toBe(false);
      expect((await linhaNaTransacao('exportacoes_titular', recente.id))['baixada_em']).toEqual(
        depois(2 * UM_DIA),
      );
      expect((await exportacoes.buscarDisponivel(conta.id, depois(2 * UM_DIA)))?.id).toBe(
        antiga.id,
      );
      await expect(exportacoes.buscarDisponivel(conta.id, depois(7 * UM_DIA))).resolves.toBeNull();
      await expect(exportacoes.marcarBaixada(randomUUID(), T0)).resolves.toBe(false);
      await expect(exportacoes.marcarBaixada('nao-e-uuid', T0)).resolves.toBe(false);

      // Na data de vencimento da antiga: some a baixada e a vencida; a que ainda vale fica.
      const valendo = nova(depois(6 * UM_DIA));
      await exportacoes.inserir(valendo);
      await expect(exportacoes.apagarVencidas(depois(7 * UM_DIA))).resolves.toBeGreaterThanOrEqual(
        2,
      );
      await expect(exportacoes.buscarDisponivel(conta.id, depois(7 * UM_DIA))).resolves.toEqual(
        valendo,
      );
      await exportacoes.apagarDaConta(conta.id);
      await expect(exportacoes.buscarDisponivel(conta.id, depois(7 * UM_DIA))).resolves.toBeNull();
    });
  });

  it('apagarNaoBaixadas apaga só as não baixadas da conta, vencidas ou não (S98)', async () => {
    await desfeito(async () => {
      const conta = novaConta();
      const outra = novaConta();
      await contas.inserir(conta);
      await contas.inserir(outra);
      const nova = (contaId: string, baixadaEm: Date | null, expiraEm = depois(7 * UM_DIA)) => ({
        id: randomUUID(),
        contaId,
        conteudoCifrado: `v1:${randomUUID()}`,
        criadaEm: T0,
        expiraEm,
        baixadaEm,
      });
      const viva = nova(conta.id, null);
      const vencida = nova(conta.id, null, depois(UM_MINUTO));
      const baixada = nova(conta.id, depois(UM_MINUTO));
      const daOutra = nova(outra.id, null);
      for (const e of [viva, vencida, baixada, daOutra]) await exportacoes.inserir(e);

      await expect(exportacoes.apagarNaoBaixadas(conta.id)).resolves.toBe(2);
      for (const [e, fica] of [
        [viva, false],
        [vencida, false],
        [baixada, true],
        [daOutra, true],
      ] as const) {
        const linhas = await unidade
          .cliente()
          .$queryRawUnsafe<unknown[]>(
            'SELECT 1 FROM identidade.exportacoes_titular WHERE id = $1::uuid',
            e.id,
          );
        expect(linhas.length === 1).toBe(fica);
      }
      await expect(exportacoes.apagarNaoBaixadas('nao-e-uuid')).resolves.toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------

describe('dado confirmado fica no banco só como o domínio gravou', () => {
  it('a conta inserida fora de uma unidade está lá para outra conexão', async () => {
    const conta = novaConta();
    await contas.inserir(conta);
    expect(await linhaCrua('contas', conta.id)).toMatchObject({
      email_normalizado: conta.email.valor,
      status: 'ativa',
    });
  });
});
