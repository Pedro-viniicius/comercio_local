// Concorrência nos repositórios Prisma da Identidade (01b, etapa 7; R1, R7, S77, A-R1, A-R3,
// Q23, Q24) contra o Postgres de teste, em READ COMMITTED. Cada caso tem duas transações em
// duas conexões (duas pilhas Prisma, com pools separados): a primeira trava e para; a segunda
// começa antes de a primeira confirmar, e o teste confere em `pg_locks` que ela está esperando
// a trava; só então a primeira confirma. Sem a trava (ou com o UPDATE que regrava a entidade
// inteira), a segunda leria o valor velho e uma das atualizações se perderia.
import { randomUUID } from 'node:crypto';
import type { PinoLogger } from 'nestjs-pino';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Ambiente } from '../../../src/compartilhado/config/ambiente.ts';
import { PrismaService } from '../../../src/compartilhado/infra/prisma.service.ts';
import { UnidadeDeTrabalhoPrisma } from '../../../src/compartilhado/infra/unidade-de-trabalho-prisma.ts';
import { BloqueioDeLogin } from '../../../src/modulos/identidade/dominio/bloqueio-de-login.ts';
import { CodigoDeVerificacao } from '../../../src/modulos/identidade/dominio/codigo-de-verificacao.ts';
import { Conta } from '../../../src/modulos/identidade/dominio/conta.ts';
import { DesafioDeSegundoFator } from '../../../src/modulos/identidade/dominio/desafio-de-segundo-fator.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import { Sessao } from '../../../src/modulos/identidade/dominio/sessao.ts';
import { Telefone } from '../../../src/modulos/identidade/dominio/telefone.ts';
import { RepositorioDeBloqueiosPrisma } from '../../../src/modulos/identidade/infra/prisma/bloqueios.repositorio.ts';
import {
  RepositorioDeCodigosDeVerificacaoPrisma,
  RepositorioDeDesafiosPrisma,
} from '../../../src/modulos/identidade/infra/prisma/codigos.repositorio.ts';
import { RepositorioDeContasPrisma } from '../../../src/modulos/identidade/infra/prisma/contas.repositorio.ts';
import { RepositorioDeExportacoesPrisma } from '../../../src/modulos/identidade/infra/prisma/exportacoes.repositorio.ts';
import { RepositorioDeSessoesPrisma } from '../../../src/modulos/identidade/infra/prisma/sessoes.repositorio.ts';
import { URL_APP_TESTE, URL_MIGRACAO_TESTE } from '../preparar-banco.ts';

const T0 = new Date('2026-10-17T12:00:00.000Z');
const depois = (ms: number) => new Date(T0.getTime() + ms);

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

/** Uma conexão da aplicação com os seus repositórios. */
function montarPilha() {
  const prisma = new PrismaService({ DATABASE_URL: URL_APP_TESTE } as Ambiente, loggerSilencioso());
  const unidade = new UnidadeDeTrabalhoPrisma(prisma);
  return {
    prisma,
    unidade,
    contas: new RepositorioDeContasPrisma(unidade),
    sessoes: new RepositorioDeSessoesPrisma(unidade),
    codigos: new RepositorioDeCodigosDeVerificacaoPrisma(unidade),
    desafios: new RepositorioDeDesafiosPrisma(unidade),
    bloqueios: new RepositorioDeBloqueiosPrisma(unidade),
    exportacoes: new RepositorioDeExportacoesPrisma(unidade),
  };
}

type Pilha = ReturnType<typeof montarPilha>;

const primeira = montarPilha();
const segunda = montarPilha();
/** O dono consulta `pg_locks` e lê as linhas sem passar pelos repositórios. */
let dono: pg.Client;

beforeAll(async () => {
  dono = new pg.Client({ connectionString: URL_MIGRACAO_TESTE });
  await dono.connect();
});

/** O que os casos confirmam no banco, apagado no fim. */
const contasDoTeste: string[] = [];
const freiosDoTeste: string[] = [];

afterAll(async () => {
  await apagarContasDoTeste(contasDoTeste);
  await dono.query('DELETE FROM identidade.bloqueios_login WHERE chave_hmac = ANY($1::text[])', [
    freiosDoTeste,
  ]);
  await dono?.end();
  await Promise.all([primeira.prisma.$disconnect(), segunda.prisma.$disconnect()]);
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

/** Espera até alguma transação estar parada numa trava (pedido não concedido em `pg_locks`). */
async function esperarAlguemNaTrava(): Promise<void> {
  const limite = Date.now() + 5_000;
  while (Date.now() < limite) {
    const { rows } = await dono.query<{ esperando: number }>(
      'SELECT count(*)::int AS esperando FROM pg_locks WHERE NOT granted',
    );
    if ((rows[0]?.esperando ?? 0) > 0) return;
    await new Promise((resolver) => setTimeout(resolver, 20));
  }
  throw new Error('a segunda transação não chegou a esperar a trava da primeira');
}

/**
 * A primeira transação roda `travar` e para antes de confirmar; a segunda roda `esperar`, que
 * precisa ficar parada na trava; a primeira confirma e a segunda termina. Devolve o que cada
 * uma devolveu.
 */
async function corrida<A, B>(
  travar: (pilha: Pilha) => Promise<A>,
  esperar: (pilha: Pilha) => Promise<B>,
): Promise<[A, B]> {
  let avisarQueTravou: () => void = () => undefined;
  const travou = new Promise<void>((resolver) => {
    avisarQueTravou = resolver;
  });
  let liberar: () => void = () => undefined;
  const liberada = new Promise<void>((resolver) => {
    liberar = resolver;
  });

  const daPrimeira = primeira.unidade.executar(async () => {
    const resultado = await travar(primeira);
    avisarQueTravou();
    await liberada;
    return resultado;
  });
  await travou;
  const daSegunda = segunda.unidade.executar(() => esperar(segunda));
  try {
    await esperarAlguemNaTrava();
  } finally {
    liberar();
  }
  return [await daPrimeira, await daSegunda];
}

async function contaConfirmada(): Promise<Conta> {
  const conta = Conta.criar({
    id: randomUUID(),
    nome: 'Ana Souza',
    email: Email.criar(`c${randomUUID().slice(0, 8)}@exemplo.com.br`),
    telefone: Telefone.criar('(35) 99999-1234'),
    senhaHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    agora: T0,
  });
  await primeira.contas.inserir(conta);
  contasDoTeste.push(conta.id);
  return conta;
}

async function sessaoConfirmada(contaId: string, tokenHash: string): Promise<Sessao> {
  const sessao = Sessao.criar({
    id: randomUUID(),
    contaId,
    cliente: 'app_consumidor',
    tokenHash,
    mfa: false,
    agora: T0,
  });
  await primeira.sessoes.inserir(sessao);
  return sessao;
}

/**
 * Como `corrida`, mas a primeira para ENTRE a leitura com trava e a gravação (A-R3): ela já
 * leu e ainda não gravou; a segunda lê enquanto isso. Só a trava da leitura faz a segunda
 * esperar e ler o que a primeira gravou; sem ela, as duas leriam o mesmo valor e uma gravação
 * apagaria a outra.
 */
async function corridaComPausaNoMeio<T>(
  ler: (pilha: Pilha) => Promise<T>,
  gravar: (pilha: Pilha, lido: T) => Promise<void>,
): Promise<void> {
  let avisarQueLeu: () => void = () => undefined;
  const leu = new Promise<void>((resolver) => {
    avisarQueLeu = resolver;
  });
  let liberar: () => void = () => undefined;
  const liberada = new Promise<void>((resolver) => {
    liberar = resolver;
  });

  const daPrimeira = primeira.unidade.executar(async () => {
    const lido = await ler(primeira);
    avisarQueLeu();
    await liberada;
    await gravar(primeira, lido);
  });
  await leu;
  const daSegunda = segunda.unidade.executar(async () => {
    await gravar(segunda, await ler(segunda));
  });
  try {
    await esperarAlguemNaTrava();
  } finally {
    liberar();
  }
  await Promise.all([daPrimeira, daSegunda]);
}

describe('duas transações ao mesmo tempo (R1)', () => {
  it.each([
    ['chave nova (a segunda espera a linha que a primeira inseriu)', false],
    ['chave que já tem linha (a segunda espera a trava da primeira)', true],
  ])(
    'duas falhas no mesmo freio somam 2, com a primeira parada entre ler e gravar: %s (A-R3)',
    async (_caso, jaExiste) => {
      const chave = `hmac-${randomUUID()}`;
      freiosDoTeste.push(chave);
      if (jaExiste) {
        await primeira.unidade.executar(async () => {
          const freio = await primeira.bloqueios.buscarParaAtualizar(chave, 'email', T0);
          freio.registrarFalha(T0);
          await primeira.bloqueios.salvar(freio);
        });
      }
      await corridaComPausaNoMeio(
        (pilha) => pilha.bloqueios.buscarParaAtualizar(chave, 'email', depois(1_000)),
        async (pilha, freio) => {
          freio.registrarFalha(depois(1_000));
          await pilha.bloqueios.salvar(freio);
        },
      );
      const esperado = jaExiste ? 3 : 2;
      expect((await primeira.bloqueios.buscar(chave, 'email'))?.dados.falhas).toBe(esperado);
    },
  );

  it('a primeira zera o freio (apaga a linha) enquanto a segunda espera a trava: a segunda recebe um freio novo, sem erro (A-R1, S96)', async () => {
    const chave = `hmac-${randomUUID()}`;
    freiosDoTeste.push(chave);
    await primeira.unidade.executar(async () => {
      const freio = await primeira.bloqueios.buscarParaAtualizar(chave, 'email', T0);
      for (let i = 0; i < 3; i += 1) freio.registrarFalha(T0);
      await primeira.bloqueios.salvar(freio);
    });

    // A primeira trava a linha que já existia e para; a segunda chega e espera essa trava; a
    // primeira acerta a senha (zera e apaga a linha) e confirma; a segunda erra a senha.
    const lidosPelaSegunda: BloqueioDeLogin[] = [];
    await corridaComPausaNoMeio(
      async (pilha) => {
        const freio = await pilha.bloqueios.buscarParaAtualizar(chave, 'email', depois(1_000));
        if (pilha === segunda) lidosPelaSegunda.push(BloqueioDeLogin.reconstituir(freio.dados));
        return freio;
      },
      async (pilha, freio) => {
        if (pilha === primeira) freio.registrarSucesso('senha');
        else freio.registrarFalha(depois(1_000));
        await pilha.bloqueios.salvar(freio);
      },
    );

    expect(lidosPelaSegunda.map((freio) => freio.dados)).toEqual([
      BloqueioDeLogin.novo(chave, 'email', depois(1_000)).dados,
    ]);
    expect((await primeira.bloqueios.buscar(chave, 'email'))?.dados.falhas).toBe(1);
  });

  it('duas tentativas erradas no mesmo código somam 2', async () => {
    const conta = await contaConfirmada();
    const codigo = CodigoDeVerificacao.emitir({
      id: randomUUID(),
      contaId: conta.id,
      finalidade: 'verificacao_email',
      codigoHmac: `c-${randomUUID()}`,
      agora: T0,
    });
    await primeira.codigos.inserir(codigo);
    const errar = async (pilha: Pilha) => {
      const lido = await pilha.codigos.buscarVigenteParaAtualizar(
        conta.id,
        'verificacao_email',
        depois(1_000),
      );
      if (lido === null) throw new Error('código não encontrado');
      const resultado = lido.conferir(false, depois(1_000));
      await pilha.codigos.atualizar(lido);
      return resultado;
    };
    expect(await corrida(errar, errar)).toEqual(['errado', 'errado']);
    const { rows } = await dono.query<{ tentativas: number }>(
      'SELECT tentativas FROM identidade.codigos_verificacao WHERE id = $1',
      [codigo.id],
    );
    expect(rows[0]?.tentativas).toBe(2);
  });

  it('duas tentativas erradas no mesmo desafio somam 2', async () => {
    const conta = await contaConfirmada();
    const desafio = DesafioDeSegundoFator.emitir({
      id: randomUUID(),
      contaId: conta.id,
      etapa: 'verificar',
      tokenHmac: `d-${randomUUID()}`,
      agora: T0,
    });
    await primeira.desafios.inserir(desafio);
    const errar = async (pilha: Pilha) => {
      const lido = await pilha.desafios.buscarPorIdParaAtualizar(desafio.id);
      if (lido === null) throw new Error('desafio não encontrado');
      const freio = BloqueioDeLogin.novo(`f-${randomUUID()}`, 'segundo_fator', depois(1_000));
      const resultado = lido.avaliarCodigo({
        etapa: 'verificar',
        freio,
        codigoConfere: false,
        agora: depois(1_000),
      });
      await pilha.desafios.atualizar(lido);
      return resultado.tipo;
    };
    expect(await corrida(errar, errar)).toEqual(['codigo_errado', 'codigo_errado']);
    const relido = await primeira.unidade.executar(() =>
      primeira.desafios.buscarPorIdParaAtualizar(desafio.id),
    );
    expect(relido?.dados.tentativas).toBe(2);
  });
});

describe('rotação da sessão concorrente (R1, R7, S77)', () => {
  it('duas gravarRotacao com o mesmo token antigo: uma grava, a outra devolve false, e o histórico tem uma linha', async () => {
    const conta = await contaConfirmada();
    const sessao = await sessaoConfirmada(conta.id, `t1-${randomUUID()}`);
    const t1 = sessao.dados.tokenHash;
    // As duas renovações leram a sessão (sem trava) antes de qualquer uma gravar.
    const lidaA = await primeira.sessoes.buscarPorTokenHash(t1);
    const lidaB = await segunda.sessoes.buscarPorTokenHash(t1);
    if (lidaA === null || lidaB === null) throw new Error('sessão não encontrada');
    lidaA.rotacionar(`t2a-${randomUUID()}`, 'par-a', depois(1_000));
    lidaB.rotacionar(`t2b-${randomUUID()}`, 'par-b', depois(1_000));

    const resultados = await corrida(
      (pilha) => pilha.sessoes.gravarRotacao(lidaA),
      (pilha) => pilha.sessoes.gravarRotacao(lidaB),
    );

    expect(resultados).toEqual([true, false]);
    expect((await primeira.sessoes.buscarPorId(sessao.id))?.dados).toEqual(lidaA.dados);
    const { rows } = await dono.query<{ token_hash: string }>(
      'SELECT token_hash FROM identidade.tokens_de_renovacao_usados WHERE sessao_id = $1',
      [sessao.id],
    );
    expect(rows).toEqual([{ token_hash: t1 }]);
  });

  it.each(['revogarDaFamilia', 'atualizar (logout)'] as const)(
    'a revogação confirma enquanto a gravarRotacao espera (%s): 0 linhas e a sessão continua revogada',
    async (operacao) => {
      const conta = await contaConfirmada();
      const sessao = await sessaoConfirmada(conta.id, `t1-${randomUUID()}`);
      const t1 = sessao.dados.tokenHash;
      const renovacao = await segunda.sessoes.buscarPorTokenHash(t1);
      if (renovacao === null) throw new Error('sessão não encontrada');
      renovacao.rotacionar(`t2-${randomUUID()}`, 'par', depois(1_000));

      const [, gravou] = await corrida(
        async (pilha) => {
          if (operacao === 'revogarDaFamilia') {
            await pilha.sessoes.revogarDaFamilia(sessao.familiaId, 'reuso_detectado', depois(500));
          } else {
            const logout = await pilha.sessoes.buscarPorId(sessao.id);
            logout?.revogar('reuso_detectado', depois(500));
            if (logout !== null) await pilha.sessoes.atualizar(logout);
          }
        },
        (pilha) => pilha.sessoes.gravarRotacao(renovacao),
      );

      expect(gravou).toBe(false);
      expect((await primeira.sessoes.buscarPorId(sessao.id))?.dados).toEqual({
        ...sessao.dados,
        revogadaEm: depois(500),
        motivoRevogacao: 'reuso_detectado',
      });
      await expect(primeira.sessoes.buscarTokenUsado(t1)).resolves.toBeNull();
    },
  );
});

describe('ultimo_login_em concorrente com a exclusão', () => {
  it('a exclusão desativa e confirma enquanto gravarUltimoLogin espera: 0 linhas e a conta continua desativada', async () => {
    const conta = await contaConfirmada();
    const [, gravou] = await corrida(
      async (pilha) => {
        const lida = await pilha.contas.buscarPorId(conta.id);
        if (lida === null) throw new Error('conta não encontrada');
        lida.desativar(depois(500));
        await pilha.contas.atualizar(lida);
      },
      (pilha) => pilha.contas.gravarUltimoLogin(conta.id, depois(1_000)),
    );

    expect(gravou).toBe(false);
    expect((await primeira.contas.buscarPorId(conta.id))?.dados).toMatchObject({
      status: 'desativada',
      desativadaEm: depois(500),
      ultimoLoginEm: null,
    });
  });
});

describe('conta travada (Q23, Q24)', () => {
  it('buscarPorIdParaAtualizar: a segunda espera a primeira e lê o que ela confirmou', async () => {
    const conta = await contaConfirmada();
    const [, lida] = await corrida(
      async (pilha) => {
        const travada = await pilha.contas.buscarPorIdParaAtualizar(conta.id);
        if (travada?.status !== 'ativa') throw new Error('conta não encontrada');
        await pilha.contas.gravarDesativacao(conta.id, depois(500));
      },
      (pilha) => pilha.contas.buscarPorIdParaAtualizar(conta.id),
    );
    expect(lida?.status).toBe('desativada');
  });

  it('a trava da conta não espera quem só inseriu uma filha (FOR NO KEY UPDATE contra a FK)', async () => {
    const conta = await contaConfirmada();
    let liberar: () => void = () => undefined;
    const liberada = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    let avisar: () => void = () => undefined;
    const inseriu = new Promise<void>((resolver) => {
      avisar = resolver;
    });
    // A primeira insere uma sessão (a FK trava a conta com KEY SHARE) e fica aberta.
    const daPrimeira = primeira.unidade.executar(async () => {
      await primeira.sessoes.inserir(
        Sessao.criar({
          id: randomUUID(),
          contaId: conta.id,
          cliente: 'app_consumidor',
          tokenHash: `t-${randomUUID()}`,
          mfa: false,
          agora: T0,
        }),
      );
      avisar();
      await liberada;
      throw new Error('desfazer');
    });
    await inseriu;
    try {
      await expect(
        segunda.unidade.executar(() => segunda.contas.buscarPorIdParaAtualizar(conta.id)),
      ).resolves.toMatchObject({ id: conta.id });
    } finally {
      liberar();
    }
    await expect(daPrimeira).rejects.toThrow('desfazer');
  });
});

describe('download da exportação concorrente (S10)', () => {
  it('dois downloads ao mesmo tempo: só um marca, o outro recebe false', async () => {
    const conta = await contaConfirmada();
    const exportacao = {
      id: randomUUID(),
      contaId: conta.id,
      conteudoCifrado: `v1:${randomUUID()}`,
      criadaEm: T0,
      expiraEm: depois(7 * 24 * 60 * 60 * 1_000),
      baixadaEm: null,
    };
    await primeira.exportacoes.inserir(exportacao);

    const resultados = await corrida(
      (pilha) => pilha.exportacoes.marcarBaixada(exportacao.id, depois(1_000)),
      (pilha) => pilha.exportacoes.marcarBaixada(exportacao.id, depois(2_000)),
    );

    expect(resultados).toEqual([true, false]);
    const { rows } = await dono.query<{ baixada_em: Date }>(
      'SELECT baixada_em FROM identidade.exportacoes_titular WHERE id = $1',
      [exportacao.id],
    );
    expect(rows[0]?.baixada_em).toEqual(depois(1_000));
  });
});
