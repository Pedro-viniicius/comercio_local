// Bordas da etapa 5c do plano 01b (CA-05): o `cliente` no corpo da renovação, o `clienteDoApp` que
// chega inválido em tempo de execução e a opção `renovarEm401: false` com requisições concorrentes
// (S9, S16). Os casos simples da etapa ficam em `sessao.test.ts`; aqui entram as corridas e os
// valores que o TypeScript não pega.
import { describe, expect, it, vi } from 'vitest';
import { renovarSessaoSchema, z, type Sessao } from '@bairrin/contratos';
import {
  CAMINHO_DA_RENOVACAO,
  criarClienteApi,
  criarClienteAutenticado,
  ErroDeApi,
  type ArmazenamentoDeRevogacao,
  type ArmazenamentoDeSessao,
  type FetchInjetavel,
  type ModoDeRenovacao,
  type MotivoDoEncerramento,
  type OpcoesDoClienteAutenticado,
  type PedidoMinimo,
  type RespostaMinima,
} from './index.ts';

const BASE = 'https://api.teste';
const URL_DA_RENOVACAO = `${BASE}${CAMINHO_DA_RENOVACAO}`;
const contaSchema = z.object({ nome: z.string() });

const SESSAO_1: Sessao = {
  tokenAcesso: 'acesso-1.aaa',
  expiraEm: '2026-10-17T12:15:00Z',
  emailVerificado: false,
  tokenRenovacao: 'renovacao-1_bbb',
};
const SESSAO_2: Sessao = {
  tokenAcesso: 'acesso-2.ccc',
  expiraEm: '2026-10-17T12:30:00Z',
  emailVerificado: true,
  tokenRenovacao: 'renovacao-2_ddd',
};

const PROBLEMA_401 = {
  type: 'urn:bairrin:erro:nao_autenticado',
  title: 'Não autenticado',
  status: 401,
  codigo: 'nao_autenticado',
};

function json(status: number, valor: unknown): RespostaMinima {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(JSON.stringify(valor)),
  };
}

function adiada<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

/**
 * API com o contrato da renovação (corpo fora de `renovarSessaoSchema` dá 400). A conta só abre com
 * o acesso da SESSAO_2; o token de renovação da SESSAO_1 rende a SESSAO_2.
 */
function criarApi(opcoes: { renovacao?: () => RespostaMinima | Promise<RespostaMinima> } = {}) {
  const chamadas: { url: string; pedido: PedidoMinimo }[] = [];
  const corposDaRenovacao: unknown[] = [];
  const fetch: FetchInjetavel = async (url, pedido) => {
    chamadas.push({ url, pedido });
    if (url === URL_DA_RENOVACAO) {
      const corpo: unknown = pedido.body === undefined ? undefined : JSON.parse(pedido.body);
      corposDaRenovacao.push(corpo);
      if (opcoes.renovacao) return opcoes.renovacao();
      const lido = renovarSessaoSchema.safeParse(corpo);
      if (!lido.success) return json(400, { ...PROBLEMA_401, status: 400, codigo: 'invalido' });
      return lido.data.tokenRenovacao === SESSAO_1.tokenRenovacao
        ? json(200, SESSAO_2)
        : json(401, PROBLEMA_401);
    }
    return pedido.headers['Authorization'] === `Bearer ${SESSAO_2.tokenAcesso}`
      ? json(200, { nome: 'Conta' })
      : json(401, PROBLEMA_401);
  };
  const para = (url: string) => chamadas.filter((c) => c.url === url);
  return { fetch, chamadas, corposDaRenovacao, para };
}

function montar(
  api: ReturnType<typeof criarApi>,
  extras: { modo?: ModoDeRenovacao; ajustes?: Record<string, unknown> } = {},
) {
  let guardada: unknown = SESSAO_1;
  const armazenamento: ArmazenamentoDeSessao = {
    ler: () => Promise.resolve(guardada as Sessao | null),
    gravar: (sessao) => {
      guardada = sessao;
      return Promise.resolve();
    },
    limpar: () => {
      guardada = null;
      return Promise.resolve();
    },
  };
  const revogacaoPendente: ArmazenamentoDeRevogacao = {
    ler: () => Promise.resolve(null),
    gravar: () => Promise.resolve(),
    limpar: () => Promise.resolve(),
  };
  const encerramentos: MotivoDoEncerramento[] = [];
  const opcoes = {
    cliente: criarClienteApi({ baseUrl: BASE, fetch: api.fetch }),
    armazenamento,
    revogacaoPendente,
    modoDeRenovacao: extras.modo ?? 'token',
    clienteDoApp: 'app_lojista',
    aoEncerrarSessao: (motivo: MotivoDoEncerramento) => encerramentos.push(motivo),
    ...extras.ajustes,
  } as unknown as OpcoesDoClienteAutenticado;
  const autenticado = criarClienteAutenticado(opcoes);
  const pedir = (extra: { renovarEm401?: boolean } = {}) =>
    autenticado.requisitar({ caminho: '/v1/conta', esquema: contaSchema, ...extra });
  return { autenticado, pedir, encerramentos, guardada: () => guardada, opcoes };
}

/** Deixa as promessas pendentes andarem (o fetch falso responde em microtarefas). */
const esvaziar = () => new Promise<void>((resolver) => setTimeout(resolver, 0));
declare function setTimeout(funcao: () => void, ms: number): unknown;

describe('renovarEm401 com requisições concorrentes (S9)', () => {
  it('uma renovação só serve as requisições comuns; as com `false` recebem o 401 e não entram na fila', async () => {
    const liberarRenovacao = adiada<RespostaMinima>();
    const api = criarApi({ renovacao: () => liberarRenovacao.promessa });
    const { pedir, encerramentos, guardada } = montar(api);

    const comuns = [pedir(), pedir(), pedir()];
    const semRenovar = [pedir({ renovarEm401: false }), pedir({ renovarEm401: false })];
    const resultadoDosSemRenovar = Promise.allSettled(semRenovar);
    await esvaziar();

    // As que não renovam já voltaram com o 401, enquanto a renovação ainda está no ar.
    const liquidadas = await resultadoDosSemRenovar;
    for (const liquidada of liquidadas) {
      expect(liquidada.status).toBe('rejected');
      const erro = (liquidada as PromiseRejectedResult).reason as unknown;
      expect(erro).toBeInstanceOf(ErroDeApi);
      expect((erro as ErroDeApi).status).toBe(401);
    }
    expect(api.para(URL_DA_RENOVACAO)).toHaveLength(1);
    expect(encerramentos).toEqual([]);

    liberarRenovacao.resolver(json(200, SESSAO_2));
    await expect(Promise.all(comuns)).resolves.toEqual([
      { nome: 'Conta' },
      { nome: 'Conta' },
      { nome: 'Conta' },
    ]);
    expect(api.para(URL_DA_RENOVACAO)).toHaveLength(1);
    expect(api.corposDaRenovacao).toEqual([
      { tokenRenovacao: SESSAO_1.tokenRenovacao, cliente: 'app_lojista' },
    ]);
    expect(guardada()).toMatchObject({ tokenAcesso: SESSAO_2.tokenAcesso });
  });

  it('só requisições com `false` e 401: nenhuma renovação, nenhum encerramento, a sessão fica como estava', async () => {
    const api = criarApi();
    const { pedir, autenticado, encerramentos, guardada } = montar(api);

    const resultados = await Promise.allSettled(
      Array.from({ length: 6 }, () => pedir({ renovarEm401: false })),
    );

    expect(resultados.every((r) => r.status === 'rejected')).toBe(true);
    expect(api.para(URL_DA_RENOVACAO)).toHaveLength(0);
    expect(api.chamadas).toHaveLength(6);
    expect(encerramentos).toEqual([]);
    expect(guardada()).toEqual(SESSAO_1);
    await expect(autenticado.obterSessao()).resolves.toMatchObject({
      tokenAcesso: SESSAO_1.tokenAcesso,
    });
  });

  it('um 401 com `false` que chega depois da renovação de outra requisição não repete com o token novo', async () => {
    const segurada = adiada<RespostaMinima>();
    const api = criarApi();
    const original = api.fetch;
    let primeiraDaConta = true;
    // A primeira ida à conta (a do polling) fica presa; as demais seguem o contrato normal.
    const fetch: FetchInjetavel = (url, pedido) => {
      if (url !== URL_DA_RENOVACAO && primeiraDaConta) {
        primeiraDaConta = false;
        return segurada.promessa.then((resposta) => {
          api.chamadas.push({ url, pedido });
          return resposta;
        });
      }
      return original(url, pedido);
    };
    const { pedir, guardada } = montar({ ...api, fetch });

    const polling = pedir({ renovarEm401: false }).catch((e: unknown) => e);
    await esvaziar();
    // Outra requisição comum já renovou a sessão enquanto o polling esperava.
    await expect(pedir()).resolves.toEqual({ nome: 'Conta' });
    expect(guardada()).toMatchObject({ tokenAcesso: SESSAO_2.tokenAcesso });

    segurada.resolver(json(401, PROBLEMA_401));
    const erro = await polling;

    expect(erro).toBeInstanceOf(ErroDeApi);
    expect((erro as ErroDeApi).status).toBe(401);
    // O 401 do polling não renovou de novo, nem repetiu a ida com o token novo.
    expect(api.para(URL_DA_RENOVACAO)).toHaveLength(1);
    expect(api.para(`${BASE}/v1/conta`)).toHaveLength(3);
  });

  it('um 401 comum que chega depois de outra requisição já ter renovado repete com o token novo, sem renovar de novo', async () => {
    const segurada = adiada<RespostaMinima>();
    const api = criarApi();
    const original = api.fetch;
    let primeiraDaConta = true;
    const fetch: FetchInjetavel = (url, pedido) => {
      if (url !== URL_DA_RENOVACAO && primeiraDaConta) {
        primeiraDaConta = false;
        return segurada.promessa.then((resposta) => {
          api.chamadas.push({ url, pedido });
          return resposta;
        });
      }
      return original(url, pedido);
    };
    const { pedir, guardada } = montar({ ...api, fetch });

    const lenta = pedir();
    await esvaziar();
    await expect(pedir()).resolves.toEqual({ nome: 'Conta' });
    expect(guardada()).toMatchObject({ tokenAcesso: SESSAO_2.tokenAcesso });

    // A requisição lenta foi enviada com o token velho: o 401 dela já não pede outra renovação.
    segurada.resolver(json(401, PROBLEMA_401));
    await expect(lenta).resolves.toEqual({ nome: 'Conta' });
    expect(api.para(URL_DA_RENOVACAO)).toHaveLength(1);
  });

  it('renovação recusada com várias requisições: uma chamada, um encerramento e todas recebem o 401', async () => {
    const api = criarApi({ renovacao: () => json(401, PROBLEMA_401) });
    const { pedir, encerramentos, guardada } = montar(api);

    const resultados = await Promise.allSettled([
      pedir(),
      pedir(),
      pedir(),
      pedir({ renovarEm401: false }),
      pedir(),
    ]);

    for (const resultado of resultados) {
      expect(resultado.status).toBe('rejected');
      expect(((resultado as PromiseRejectedResult).reason as ErroDeApi).status).toBe(401);
    }
    expect(api.para(URL_DA_RENOVACAO)).toHaveLength(1);
    expect(encerramentos).toEqual(['renovacao_recusada']);
    expect(guardada()).toBeNull();
  });

  it.each([
    ['ausente', {}],
    ['undefined', { renovarEm401: undefined }],
    ['true', { renovarEm401: true }],
    // Só um `false` explícito desliga a renovação: valor torto não vira atalho para pular a
    // renovação (e, no painel, a inatividade segue o servidor).
    ['null', { renovarEm401: null }],
    ['0', { renovarEm401: 0 }],
    ['"false"', { renovarEm401: 'false' }],
  ])('com `renovarEm401` %s, o 401 renova', async (_nome, extra) => {
    const api = criarApi();
    const { pedir } = montar(api);

    await expect(pedir(extra as { renovarEm401?: boolean })).resolves.toEqual({ nome: 'Conta' });
    expect(api.para(URL_DA_RENOVACAO)).toHaveLength(1);
  });

  it.each(['token', 'cookie'] as const)(
    'modo %s: o 401 da repetição depois da renovação não renova de novo',
    async (modo) => {
      // Renovação devolve um token que a conta também recusa: a repetição falha e não faz laço.
      const api = criarApi({
        renovacao: () => json(200, { ...SESSAO_1, tokenAcesso: 'ruim.zzz' }),
      });
      const { pedir, encerramentos } = montar(api, { modo });

      const erro = await pedir().catch((e: unknown) => e);

      expect((erro as ErroDeApi).status).toBe(401);
      expect(api.para(URL_DA_RENOVACAO)).toHaveLength(1);
      expect(api.para(`${BASE}/v1/conta`)).toHaveLength(2);
      expect(encerramentos).toEqual([]);
    },
  );
});

describe('clienteDoApp inválido em tempo de execução (S16)', () => {
  const INVALIDOS: [string, unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['número', 0],
    ['objeto', {}],
    ['lista', ['app_lojista']],
    ['painel', 'painel'],
    ['maiúsculas', 'APP_LOJISTA'],
    ['espaço antes', ' app_lojista'],
    ['espaço depois', 'app_lojista '],
    ['quebra de linha', 'app_lojista\n'],
    ['vazio', ''],
    ['chave do protótipo', 'constructor'],
    ['__proto__', '__proto__'],
    ['toString', 'toString'],
    ['símbolo', Symbol('app_lojista')],
  ];

  it.each(INVALIDOS)('modo token com %s lança TypeError na criação', (_nome, valor) => {
    const api = criarApi();
    expect(() => montar(api, { ajustes: { clienteDoApp: valor } })).toThrow(TypeError);
    expect(api.chamadas).toHaveLength(0);
  });

  it('a mensagem do erro não repete o valor recebido (pode ser um token mandado por engano)', () => {
    const api = criarApi();
    const segredo = 'renovacao-9_segredo-que-nao-pode-vazar';
    let erro: unknown;
    try {
      montar(api, { ajustes: { clienteDoApp: segredo } });
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(TypeError);
    const texto =
      JSON.stringify(erro) + String((erro as Error).message) + String((erro as Error).stack);
    expect(texto).not.toContain(segredo);
    expect((erro as Error).cause).toBeUndefined();
  });

  it('o valor é lido na criação: mudar a opção depois não troca o `cliente` do corpo', async () => {
    const api = criarApi();
    const { pedir, opcoes } = montar(api);
    (opcoes as unknown as { clienteDoApp: unknown }).clienteDoApp = 'painel';

    await expect(pedir()).resolves.toEqual({ nome: 'Conta' });
    expect(api.corposDaRenovacao).toEqual([
      { tokenRenovacao: SESSAO_1.tokenRenovacao, cliente: 'app_lojista' },
    ]);
  });

  it('modo cookie ignora o clienteDoApp, mesmo inválido: sem corpo, com X-Cliente: painel', async () => {
    for (const valor of ['app_lojista', 'lixo', null, 42]) {
      const api = criarApi({
        renovacao: () => json(200, { ...SESSAO_2, tokenRenovacao: undefined }),
      });
      const { autenticado } = montar(api, { modo: 'cookie', ajustes: { clienteDoApp: valor } });

      await expect(autenticado.renovarSessao()).resolves.toMatchObject({
        tokenAcesso: SESSAO_2.tokenAcesso,
      });

      const [renovacao] = api.para(URL_DA_RENOVACAO);
      expect(renovacao?.pedido.body, String(valor)).toBeUndefined();
      expect(renovacao?.pedido.headers['X-Cliente'], String(valor)).toBe('painel');
      expect(renovacao?.pedido.headers['Authorization']).toBeUndefined();
    }
  });

  it('o corpo da renovação tem exatamente tokenRenovacao e cliente, e passa no contrato estrito', async () => {
    for (const cliente of ['app_consumidor', 'app_lojista'] as const) {
      const api = criarApi();
      const { pedir } = montar(api, { ajustes: { clienteDoApp: cliente } });
      await pedir();
      const corpo = api.corposDaRenovacao[0] as Record<string, unknown>;
      expect(Object.keys(corpo).sort()).toEqual(['cliente', 'tokenRenovacao']);
      expect(renovarSessaoSchema.safeParse(corpo).success).toBe(true);
    }
  });

  it('com o `cliente` fora do contrato a API daria 400, e o 400 encerraria a sessão: por isso a criação lança', async () => {
    // Documenta o motivo da checagem: sem ela, um app mal configurado perderia a sessão a cada 401.
    const api = criarApi();
    const { pedir, encerramentos } = montar(api);
    await pedir();
    expect(encerramentos).toEqual([]);
    const falso = vi.fn();
    expect(() =>
      montar(api, { ajustes: { clienteDoApp: 'painel', aoEncerrarSessao: falso } }),
    ).toThrow(TypeError);
    expect(falso).not.toHaveBeenCalled();
  });
});
