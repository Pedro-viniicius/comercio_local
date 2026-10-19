// Reserva da tentativa (S91, A-R2) contra o Postgres de teste, com os repositórios Prisma e a
// cripto reais: o login e a exclusão contam a falha numa transação curta e conferem a senha
// (Argon2id) FORA de qualquer transação. Com o hash dentro da transação e os freios travados,
// cada login seguraria uma conexão do pool (10) e a trava do freio de origem durante o hash:
// várias pessoas atrás do mesmo IP (CGNAT, `origem:desconhecida`) fariam fila e esgotariam o
// pool. Aqui, N logins da mesma origem ficam todos parados no hash ao mesmo tempo, e o banco
// continua respondendo pelo mesmo pool, sem ninguém esperando trava.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chaveDoFreioPorEmail } from '../../../src/modulos/identidade/aplicacao/comum/chaves.ts';
import { chaveDoFreioPorOrigem } from '../../../src/modulos/identidade/aplicacao/sessao/comum.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import {
  apagarContasDoTeste,
  cadastrar,
  conectarDono,
  type DocumentosDeTeste,
  emailUnico,
  montarPilha,
  ninguemEsperaTrava,
  semearDocumentos,
} from './pilha-de-casos-de-uso.ts';

/** Mais logins que conexões no pool do `pg` (10): com o hash na transação, não caberiam. */
const LOGINS_SIMULTANEOS = 12;
const IP = '192.0.2.77';

const p = montarPilha();
let dono: pg.Client;
let docs: DocumentosDeTeste;
const contasDoTeste: string[] = [];
const freiosDoTeste: string[] = [];

beforeAll(async () => {
  dono = await conectarDono();
  docs = await semearDocumentos(dono);
  freiosDoTeste.push(chaveDoFreioPorOrigem(p.servicos.cifrador, IP));
});

afterAll(async () => {
  await apagarContasDoTeste(dono, contasDoTeste, freiosDoTeste);
  await docs.remover();
  await dono.end();
  await p.prisma.$disconnect();
});

/**
 * Troca `simularVerificacao` e `verificar` do Argon2 real por versões que anotam se havia
 * transação aberta na chamada e esperam `liberar()` antes de calcular. `todos` resolve quando
 * `quantos` chamadas chegaram.
 */
function segurarOHash(quantos: number) {
  const { hasher } = p.servicos;
  const original = {
    verificar: hasher.verificar.bind(hasher),
    simularVerificacao: hasher.simularVerificacao.bind(hasher),
  };
  let chegaram = 0;
  let comTransacao = 0;
  let avisarTodos: () => void = () => undefined;
  const todos = new Promise<void>((resolver) => {
    avisarTodos = resolver;
  });
  let liberar: () => void = () => undefined;
  const liberado = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  const chegar = async () => {
    if (p.unidade.transacaoAtual() !== undefined) comTransacao += 1;
    chegaram += 1;
    if (chegaram === quantos) avisarTodos();
    await liberado;
  };
  hasher.verificar = async (senha, hash) => {
    await chegar();
    return original.verificar(senha, hash);
  };
  hasher.simularVerificacao = async (senha) => {
    await chegar();
    return original.simularVerificacao(senha);
  };
  return {
    todos,
    liberar,
    get chegaram() {
      return chegaram;
    },
    get comTransacao() {
      return comTransacao;
    },
    restaurar() {
      liberar();
      hasher.verificar = original.verificar;
      hasher.simularVerificacao = original.simularVerificacao;
    },
  };
}

/** Resolve com `true` se `promessa` resolveu antes de `ms`. */
async function antesDe(promessa: Promise<unknown>, ms: number): Promise<boolean> {
  let temporizador: NodeJS.Timeout | undefined;
  const prazo = new Promise<false>((resolver) => {
    temporizador = setTimeout(() => resolver(false), ms);
  });
  try {
    return await Promise.race([promessa.then(() => true as const), prazo]);
  } finally {
    clearTimeout(temporizador);
  }
}

describe('reserva da tentativa (S91)', () => {
  it(`${LOGINS_SIMULTANEOS} logins da mesma origem conferem a senha ao mesmo tempo, sem transação aberta, e o pool segue livre`, async () => {
    const emails = Array.from({ length: LOGINS_SIMULTANEOS }, () => emailUnico('s91'));
    for (const email of emails) {
      freiosDoTeste.push(chaveDoFreioPorEmail(p.servicos.cifrador, Email.criar(email)));
    }
    const hash = segurarOHash(LOGINS_SIMULTANEOS);
    try {
      const logins = Promise.all(
        emails.map((email) =>
          p.casos.entrar.executar({
            email,
            senha: 'qualquer-senha-1',
            cliente: 'app_consumidor',
            ip: IP,
          }),
        ),
      );
      // Com o hash dentro da transação, o freio de origem travado deixaria um por vez no hash.
      expect(await antesDe(hash.todos, 8_000)).toBe(true);
      expect(hash.comTransacao).toBe(0);
      // Todos parados no hash: o mesmo pool ainda atende, e ninguém espera trava.
      expect(await antesDe(p.prisma.$queryRaw`SELECT 1`, 2_000)).toBe(true);
      expect(await ninguemEsperaTrava(dono)).toBe(true);
      hash.liberar();

      const resultados = await logins;
      expect(resultados).toEqual(
        Array.from({ length: LOGINS_SIMULTANEOS }, () => ({ tipo: 'credenciais_invalidas' })),
      );
    } finally {
      hash.restaurar();
    }
    // A falha de cada tentativa foi reservada no freio de origem antes do hash.
    const { rows } = await dono.query<{ falhas: number }>(
      "SELECT falhas FROM identidade.bloqueios_login WHERE chave_hmac = $1 AND tipo = 'ip'",
      [chaveDoFreioPorOrigem(p.servicos.cifrador, IP)],
    );
    expect(rows[0]?.falhas).toBe(LOGINS_SIMULTANEOS);
  });

  it('a senha certa estorna a falha reservada na origem e zera a do e-mail; a exclusão também confere fora da transação', async () => {
    const conta = await cadastrar(p, docs);
    contasDoTeste.push(conta.id);
    freiosDoTeste.push(chaveDoFreioPorEmail(p.servicos.cifrador, Email.criar(conta.email)));
    const origem = chaveDoFreioPorOrigem(p.servicos.cifrador, IP);
    const falhasNaOrigem = async () => {
      const { rows } = await dono.query<{ falhas: number }>(
        "SELECT falhas FROM identidade.bloqueios_login WHERE chave_hmac = $1 AND tipo = 'ip'",
        [origem],
      );
      return rows[0]?.falhas ?? 0;
    };
    const antes = await falhasNaOrigem();

    const hash = segurarOHash(1);
    try {
      const login = p.casos.entrar.executar({
        email: conta.email,
        senha: conta.senha,
        cliente: 'app_consumidor',
        ip: IP,
      });
      await hash.todos;
      // Durante o hash, a falha está reservada nos dois freios.
      expect(await falhasNaOrigem()).toBe(antes + 1);
      hash.liberar();
      expect((await login).tipo).toBe('sessao');
    } finally {
      hash.restaurar();
    }
    expect(await falhasNaOrigem()).toBe(antes);
    const { rows } = await dono.query(
      "SELECT 1 FROM identidade.bloqueios_login WHERE chave_hmac = $1 AND tipo = 'email'",
      [chaveDoFreioPorEmail(p.servicos.cifrador, Email.criar(conta.email))],
    );
    expect(rows).toEqual([]);

    const daExclusao = segurarOHash(1);
    try {
      const exclusao = p.casos.solicitarExclusao.executar({
        contaId: conta.id,
        senha: conta.senha,
      });
      await daExclusao.todos;
      expect(daExclusao.comTransacao).toBe(0);
      expect(await ninguemEsperaTrava(dono)).toBe(true);
      daExclusao.liberar();
      expect(await exclusao).toEqual({ tipo: 'desativada' });
    } finally {
      daExclusao.restaurar();
    }
  });
});
