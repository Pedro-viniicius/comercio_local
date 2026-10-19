// Bordas do cliente autenticado (01b, etapa 5; CA-05) que o `sessao.test.ts` não
// cobre: o segundo ciclo de expiração usa o token de renovação mais novo, a
// renovação não leva o Bearer vencido, leitura lenta do armazenamento não
// desfaz um login nem um logout, cancelamento pelo chamador durante a renovação
// e logout sem rede.
import { describe, expect, it, vi } from 'vitest';
import { z, type Sessao } from '@bairrin/contratos';
import {
  CAMINHO_DA_RENOVACAO,
  CAMINHO_DO_LOGOUT,
  criarClienteApi,
  criarClienteAutenticado,
  ErroCancelado,
  ErroDeApi,
  type ArmazenamentoDeRevogacao,
  type ArmazenamentoDeSessao,
  type FetchInjetavel,
  type ModoDeRenovacao,
  type MotivoDoEncerramento,
  type PedidoMinimo,
  type RespostaMinima,
  type SinalDeCancelamento,
} from './index.ts';

// O tsconfig do pacote não traz os tipos de DOM nem de Node.
declare const AbortController: {
  new (): { readonly signal: SinalDeCancelamento; abort(): void };
};

const BASE = 'https://api.teste';
const URL_DA_RENOVACAO = `${BASE}${CAMINHO_DA_RENOVACAO}`;
const URL_DO_LOGOUT = `${BASE}${CAMINHO_DO_LOGOUT}`;
const URL_DA_CONTA = `${BASE}/v1/conta`;
const contaSchema = z.object({ nome: z.string() });

/** Par de tokens da geração N: acesso-N e renovacao-N. */
const sessaoN = (n: number): Sessao => ({
  tokenAcesso: `acesso-${n}.aaa`,
  expiraEm: '2026-10-17T12:15:00Z',
  emailVerificado: false,
  tokenRenovacao: `renovacao-${n}_bbb`,
});

function resposta(status: number, corpo: string): RespostaMinima {
  return { status, ok: status >= 200 && status < 300, text: () => Promise.resolve(corpo) };
}
const json = (status: number, valor: unknown) => resposta(status, JSON.stringify(valor));
const nao401 = () =>
  json(401, {
    type: 'urn:bairrin:erro:nao_autenticado',
    title: 'Não autenticado',
    status: 401,
    codigo: 'nao_autenticado',
  });

function adiada<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

/**
 * Servidor de mentira com rotação: só o token de acesso e o de renovação da
 * geração corrente valem (a renovação por cookie vale sempre). Uma renovação válida passa para a geração seguinte; o
 * token de renovação já trocado dá 401. `expirarAcesso` invalida só o acesso.
 */
function servidorRotativo(geracaoInicial: number) {
  let geracao = geracaoInicial;
  let acessoValido: string | null = sessaoN(geracao).tokenAcesso;
  const chamadas: { url: string; pedido: PedidoMinimo }[] = [];
  const corposDaRenovacao: unknown[] = [];
  const fetch: FetchInjetavel = (url, pedido) => {
    chamadas.push({ url, pedido });
    if (url === URL_DA_RENOVACAO) {
      const corpo = JSON.parse(pedido.body ?? '{}') as { tokenRenovacao?: string };
      corposDaRenovacao.push(corpo);
      const porCookie = pedido.headers['X-Cliente'] === 'painel';
      if (!porCookie && corpo.tokenRenovacao !== sessaoN(geracao).tokenRenovacao) {
        return Promise.resolve(nao401());
      }
      geracao += 1;
      acessoValido = sessaoN(geracao).tokenAcesso;
      return Promise.resolve(json(200, sessaoN(geracao)));
    }
    const autorizado = pedido.headers['Authorization'] === `Bearer ${acessoValido}`;
    return Promise.resolve(autorizado ? json(200, { nome: 'Conta' }) : nao401());
  };
  return {
    fetch,
    chamadas,
    corposDaRenovacao,
    expirarAcesso: () => {
      acessoValido = null;
    },
    get geracao() {
      return geracao;
    },
  };
}

function armazenamentoEmMemoria(inicial: Sessao | null) {
  let guardado: Sessao | null = inicial;
  const gravacoes: string[] = [];
  const armazenamento: ArmazenamentoDeSessao = {
    ler: () => Promise.resolve(guardado),
    gravar: (sessao) => {
      guardado = sessao;
      gravacoes.push(sessao.tokenAcesso);
      return Promise.resolve();
    },
    limpar: () => {
      guardado = null;
      return Promise.resolve();
    },
  };
  return { armazenamento, gravacoes, guardado: () => guardado };
}

/** Revogação pendente vazia (S80): estas bordas não deixam logout sem resposta. */
function semRevogacaoPendente(): ArmazenamentoDeRevogacao {
  return {
    ler: () => Promise.resolve(null),
    gravar: () => Promise.resolve(),
    limpar: () => Promise.resolve(),
  };
}

function montar(fetch: FetchInjetavel, inicial: Sessao | null, modo: ModoDeRenovacao = 'token') {
  const guarda = armazenamentoEmMemoria(inicial);
  const encerramentos: MotivoDoEncerramento[] = [];
  const autenticado = criarClienteAutenticado({
    cliente: criarClienteApi({ baseUrl: BASE, fetch }),
    armazenamento: guarda.armazenamento,
    revogacaoPendente: semRevogacaoPendente(),
    modoDeRenovacao: modo,
    clienteDoApp: 'app_consumidor',
    aoEncerrarSessao: (motivo) => encerramentos.push(motivo),
  });
  const pedirConta = () => autenticado.requisitar({ caminho: '/v1/conta', esquema: contaSchema });
  return { ...guarda, autenticado, encerramentos, pedirConta };
}

describe('segundo ciclo de expiração (CA-05, renovação silenciosa)', () => {
  it('cada vencimento do acesso renova com o token de renovação mais novo, nunca com um já trocado', async () => {
    const servidor = servidorRotativo(1);
    const { pedirConta, guardado, encerramentos } = montar(servidor.fetch, sessaoN(1));

    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta' });
    servidor.expirarAcesso();
    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta' });
    servidor.expirarAcesso();
    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta' });

    expect(servidor.corposDaRenovacao).toEqual([
      { tokenRenovacao: 'renovacao-1_bbb', cliente: 'app_consumidor' },
      { tokenRenovacao: 'renovacao-2_bbb', cliente: 'app_consumidor' },
    ]);
    expect(guardado()).toEqual(sessaoN(3));
    expect(encerramentos).toEqual([]);
  });

  it('concorrência nos dois ciclos: 5 pedidos por vencimento geram uma renovação por vencimento', async () => {
    const servidor = servidorRotativo(1);
    const { pedirConta, guardado } = montar(servidor.fetch, sessaoN(1));

    servidor.expirarAcesso();
    await Promise.all(Array.from({ length: 5 }, pedirConta));
    servidor.expirarAcesso();
    await Promise.all(Array.from({ length: 5 }, pedirConta));

    expect(servidor.corposDaRenovacao).toEqual([
      { tokenRenovacao: 'renovacao-1_bbb', cliente: 'app_consumidor' },
      { tokenRenovacao: 'renovacao-2_bbb', cliente: 'app_consumidor' },
    ]);
    expect(guardado()).toEqual(sessaoN(3));
  });
});

describe('a renovação em si', () => {
  it('nos apps não leva Authorization nem o token de renovação em cabeçalho, só no corpo', async () => {
    const servidor = servidorRotativo(1);
    const { pedirConta } = montar(servidor.fetch, sessaoN(1));
    servidor.expirarAcesso();

    await pedirConta();

    const renovacao = servidor.chamadas.find((c) => c.url === URL_DA_RENOVACAO);
    const nomes = Object.keys(renovacao?.pedido.headers ?? {}).map((nome) => nome.toLowerCase());
    expect(nomes).not.toContain('authorization');
    expect(JSON.stringify(renovacao?.pedido.headers)).not.toContain('renovacao-1');
    expect(renovacao?.pedido.body).toBe(
      '{"tokenRenovacao":"renovacao-1_bbb","cliente":"app_consumidor"}',
    );
  });

  it('no painel (cookie) também não leva Authorization nem corpo', async () => {
    const servidor = servidorRotativo(1);
    const { pedirConta } = montar(servidor.fetch, sessaoN(1), 'cookie');
    servidor.expirarAcesso();

    await pedirConta();

    const renovacao = servidor.chamadas.find((c) => c.url === URL_DA_RENOVACAO);
    const nomes = Object.keys(renovacao?.pedido.headers ?? {}).map((nome) => nome.toLowerCase());
    expect(nomes).not.toContain('authorization');
    expect(renovacao?.pedido.body).toBeUndefined();
  });
});

describe('leitura lenta do armazenamento', () => {
  it('um login (iniciarSessao) durante a leitura não é desfeito quando a leitura antiga termina', async () => {
    const leitura = adiada<Sessao | null>();
    const gravadas: string[] = [];
    const servidor = servidorRotativo(2);
    const autenticado = criarClienteAutenticado({
      cliente: criarClienteApi({ baseUrl: BASE, fetch: servidor.fetch }),
      armazenamento: {
        ler: () => leitura.promessa,
        gravar: (sessao) => {
          gravadas.push(sessao.tokenAcesso);
          return Promise.resolve();
        },
        limpar: () => Promise.resolve(),
      },
      revogacaoPendente: semRevogacaoPendente(),
      modoDeRenovacao: 'token',
      clienteDoApp: 'app_consumidor',
    });

    const primeiro = autenticado.obterSessao();
    await autenticado.iniciarSessao(sessaoN(2));
    leitura.resolver(sessaoN(1));
    await primeiro;

    expect((await autenticado.obterSessao())?.tokenAcesso).toBe('acesso-2.aaa');
    await expect(
      autenticado.requisitar({ caminho: '/v1/conta', esquema: contaSchema }),
    ).resolves.toEqual({ nome: 'Conta' });
    expect(gravadas).toEqual(['acesso-2.aaa']);
  });

  it('um logout durante a leitura não é desfeito: a sessão lida depois não ressuscita', async () => {
    const leitura = adiada<Sessao | null>();
    const encerramentos: MotivoDoEncerramento[] = [];
    const chamadas: PedidoMinimo[] = [];
    const autenticado = criarClienteAutenticado({
      cliente: criarClienteApi({
        baseUrl: BASE,
        fetch: (_url, pedido) => {
          chamadas.push(pedido);
          return Promise.resolve(json(200, { nome: 'Conta' }));
        },
      }),
      armazenamento: {
        ler: () => leitura.promessa,
        gravar: () => Promise.resolve(),
        limpar: () => Promise.resolve(),
      },
      revogacaoPendente: semRevogacaoPendente(),
      modoDeRenovacao: 'token',
      clienteDoApp: 'app_consumidor',
      aoEncerrarSessao: (motivo) => encerramentos.push(motivo),
    });

    const primeiro = autenticado.obterSessao();
    const logout = autenticado.encerrarSessao();
    leitura.resolver(sessaoN(1));
    await Promise.all([primeiro, logout]);

    expect(await autenticado.obterSessao()).toBeNull();
    await autenticado.requisitar({ caminho: '/v1/conta', esquema: contaSchema });
    expect(chamadas.at(-1)?.headers['Authorization']).toBeUndefined();
  });
});

describe('cancelamento pelo chamador durante a renovação', () => {
  it('requisição cancelada enquanto espera a renovação devolve ErroCancelado, não repete e a sessão nova fica', async () => {
    const renovacao = adiada<RespostaMinima>();
    const chamadas: { url: string; pedido: PedidoMinimo }[] = [];
    const fetch: FetchInjetavel = (url, pedido) => {
      chamadas.push({ url, pedido });
      if (url === URL_DA_RENOVACAO) return renovacao.promessa;
      return Promise.resolve(
        pedido.headers['Authorization'] === `Bearer ${sessaoN(2).tokenAcesso}`
          ? json(200, { nome: 'Conta' })
          : nao401(),
      );
    };
    const { autenticado } = montar(fetch, sessaoN(1));
    const controlador = new AbortController();

    const pedido = autenticado
      .requisitar({ caminho: '/v1/conta', esquema: contaSchema, sinal: controlador.signal })
      .catch((erro: unknown) => erro);
    await vi.waitFor(() => expect(chamadas.some((c) => c.url === URL_DA_RENOVACAO)).toBe(true));
    controlador.abort();
    renovacao.resolver(json(200, sessaoN(2)));

    expect(await pedido).toBeInstanceOf(ErroCancelado);
    expect(chamadas.filter((c) => c.url === URL_DA_CONTA)).toHaveLength(1);
    expect((await autenticado.obterSessao())?.tokenAcesso).toBe('acesso-2.aaa');
  });
});

describe('logout sem resposta do servidor (CA-05)', () => {
  it('o aparelho esquece a sessão e avisa logout mesmo com a API fora do ar', async () => {
    const fetch: FetchInjetavel = (url) =>
      url === URL_DO_LOGOUT ? Promise.reject(new Error('offline')) : Promise.resolve(nao401());
    const { autenticado, guardado, encerramentos } = montar(fetch, sessaoN(1));

    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: false });

    expect(guardado()).toBeNull();
    expect(encerramentos).toEqual(['logout']);
  });
});

describe('401 da repetição', () => {
  it('continua sendo ErroDeApi com status 401 e o servidor viu uma só renovação', async () => {
    let renovacoes = 0;
    const fetch: FetchInjetavel = (url) => {
      if (url !== URL_DA_RENOVACAO) return Promise.resolve(nao401());
      renovacoes += 1;
      return Promise.resolve(json(200, sessaoN(2)));
    };
    const { pedirConta } = montar(fetch, sessaoN(1));

    const erro = await pedirConta().catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeApi);
    expect((erro as ErroDeApi).status).toBe(401);
    expect(renovacoes).toBe(1);
  });
});

describe('troca de conta e logout lento (S11)', () => {
  it('um logout lento da conta A não apaga a sessão da conta B iniciada enquanto o DELETE estava no ar', async () => {
    const logout = adiada<RespostaMinima>();
    const eventos: string[] = [];
    const guarda = armazenamentoEmMemoria(sessaoN(1));
    let deleteEnviado = false;
    const fetch: FetchInjetavel = (url) => {
      if (url !== URL_DO_LOGOUT) return Promise.resolve(json(200, { nome: 'Conta' }));
      deleteEnviado = true;
      return logout.promessa;
    };
    const autenticado = criarClienteAutenticado({
      cliente: criarClienteApi({ baseUrl: BASE, fetch }),
      armazenamento: guarda.armazenamento,
      revogacaoPendente: semRevogacaoPendente(),
      modoDeRenovacao: 'token',
      clienteDoApp: 'app_consumidor',
      aoEncerrarSessao: (motivo) => eventos.push(`aviso:${motivo}`),
    });

    const saindo = autenticado.encerrarSessao();
    await vi.waitFor(() => expect(deleteEnviado).toBe(true));
    eventos.push('login:B');
    await autenticado.iniciarSessao(sessaoN(7));
    logout.resolver(resposta(204, ''));
    await saindo;

    expect(await autenticado.obterSessao()).toEqual(sessaoN(7));
    expect(guarda.guardado()).toEqual(sessaoN(7));
    // O logout limpa o aparelho sem esperar o DELETE (S80): o aviso da A sai
    // antes do login da B e nenhum aviso sai depois, para a limpeza de cache
    // não apagar a B.
    expect(eventos).toEqual(['aviso:logout', 'login:B']);
  });

  it('um login da conta B durante a renovação da conta A: o 401 da B renova com o token da B e a renovação da A é descartada', async () => {
    const renovacaoDaA = adiada<RespostaMinima>();
    const corpos: string[] = [];
    const fetch: FetchInjetavel = (url, pedido) => {
      if (url === URL_DA_RENOVACAO) {
        corpos.push(pedido.body ?? '');
        return pedido.body?.includes('renovacao-1_bbb')
          ? renovacaoDaA.promessa
          : Promise.resolve(json(200, sessaoN(8)));
      }
      return Promise.resolve(
        pedido.headers['Authorization'] === `Bearer ${sessaoN(8).tokenAcesso}`
          ? json(200, { nome: 'Conta' })
          : nao401(),
      );
    };
    const { autenticado, pedirConta, guardado } = montar(fetch, sessaoN(1));

    const pedidoDaA = pedirConta().catch((erro: unknown) => erro);
    await vi.waitFor(() => expect(corpos).toHaveLength(1));
    await autenticado.iniciarSessao(sessaoN(7));
    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta' });
    renovacaoDaA.resolver(json(200, sessaoN(2)));
    await pedidoDaA;

    expect(corpos).toEqual([
      '{"tokenRenovacao":"renovacao-1_bbb","cliente":"app_consumidor"}',
      '{"tokenRenovacao":"renovacao-7_bbb","cliente":"app_consumidor"}',
    ]);
    expect(guardado()).toEqual(sessaoN(8));
  });
});

describe('abrir o app e sair sem sessão', () => {
  it('renovarSessao como primeira chamada (sem requisição antes) usa o token guardado, nos apps', async () => {
    const servidor = servidorRotativo(1);
    const { autenticado } = montar(servidor.fetch, sessaoN(1));

    const renovada = await autenticado.renovarSessao();

    expect(servidor.corposDaRenovacao).toEqual([
      { tokenRenovacao: 'renovacao-1_bbb', cliente: 'app_consumidor' },
    ]);
    expect(renovada).toEqual(sessaoN(2));
  });

  it('logout sem sessão não chama a API e não avisa o app', async () => {
    const servidor = servidorRotativo(1);
    const { autenticado, encerramentos } = montar(servidor.fetch, null);

    await autenticado.encerrarSessao();

    expect(servidor.chamadas).toEqual([]);
    expect(encerramentos).toEqual([]);
  });

  it('no painel, o token de renovação que estivesse no armazenamento não fica na sessão em memória', async () => {
    const servidor = servidorRotativo(1);
    const { autenticado } = montar(servidor.fetch, sessaoN(1), 'cookie');

    const lida = await autenticado.obterSessao();

    expect(lida?.tokenAcesso).toBe('acesso-1.aaa');
    expect(lida?.tokenRenovacao).toBeUndefined();
  });
});
