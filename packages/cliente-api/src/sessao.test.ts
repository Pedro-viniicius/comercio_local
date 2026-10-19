import { describe, expect, it, vi } from 'vitest';
import { z, type Sessao } from '@bairrin/contratos';
import {
  CAMINHO_DA_RENOVACAO,
  CAMINHO_DO_LOGOUT,
  criarClienteApi,
  criarClienteAutenticado,
  ErroDeApi,
  ErroRespostaInvalida,
  ErroSemConexao,
  MAXIMO_DE_REVOGACOES_PENDENTES,
  type ArmazenamentoDeRevogacao,
  type ArmazenamentoDeSessao,
  type CredencialPendente,
  type FalhaEmSegundoPlano,
  type FetchInjetavel,
  type ModoDeRenovacao,
  type MotivoDoEncerramento,
  type OpcoesDoClienteAutenticado,
  type PedidoMinimo,
  type RespostaMinima,
  type RevogacaoPendente,
} from './index.ts';

// O tsconfig do pacote não traz os tipos de DOM nem de Node.
declare function setTimeout(funcao: () => void, ms: number): unknown;

const BASE = 'https://api.teste';
const URL_DA_RENOVACAO = `${BASE}${CAMINHO_DA_RENOVACAO}`;
const URL_DO_LOGOUT = `${BASE}${CAMINHO_DO_LOGOUT}`;
const URL_DA_CONTA = `${BASE}/v1/conta`;

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
const TODOS_OS_TOKENS = [
  SESSAO_1.tokenAcesso,
  SESSAO_1.tokenRenovacao,
  SESSAO_2.tokenAcesso,
  SESSAO_2.tokenRenovacao,
] as string[];

const PROBLEMA_401 = {
  type: 'urn:bairrin:erro:nao_autenticado',
  title: 'Não autenticado',
  status: 401,
  codigo: 'nao_autenticado',
};

function resposta(status: number, corpo: string): RespostaMinima {
  return { status, ok: status >= 200 && status < 300, text: () => Promise.resolve(corpo) };
}

function json(status: number, valor: unknown): RespostaMinima {
  return resposta(status, JSON.stringify(valor));
}

const nao401 = (): RespostaMinima => json(401, PROBLEMA_401);

/** Promessa resolvida por fora, para segurar uma resposta até o teste liberar. */
function adiada<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

type Atendimento = (url: string, pedido: PedidoMinimo) => RespostaMinima | Promise<RespostaMinima>;

/** Fetch falso que guarda as chamadas e responde pelo `atendimento`. */
function fetchFalso(atendimento: Atendimento) {
  const chamadas: { url: string; pedido: PedidoMinimo }[] = [];
  const fetch: FetchInjetavel = async (url, pedido) => {
    chamadas.push({ url, pedido });
    return atendimento(url, pedido);
  };
  const para = (url: string) => chamadas.filter((c) => c.url === url);
  return { fetch, chamadas, para };
}

/** Atende a API: a conta só com o token válido; renovação devolve `renovada`. */
function apiComToken(
  tokenValido: () => string,
  renovada: () => RespostaMinima | Promise<RespostaMinima>,
): Atendimento {
  return (url, pedido) => {
    if (url === URL_DA_RENOVACAO) return renovada();
    if (url === URL_DO_LOGOUT) {
      return pedido.headers['Authorization'] === `Bearer ${tokenValido()}`
        ? resposta(204, '')
        : nao401();
    }
    return pedido.headers['Authorization'] === `Bearer ${tokenValido()}`
      ? json(200, { nome: 'Conta' })
      : nao401();
  };
}

/** Armazenamento em memória que registra cada operação, na ordem. */
function armazenamentoFalso(inicial: unknown = null) {
  let guardado: unknown = inicial;
  const operacoes: string[] = [];
  const armazenamento: ArmazenamentoDeSessao = {
    ler: vi.fn(() => {
      operacoes.push('ler');
      return Promise.resolve(guardado as Sessao | null);
    }),
    gravar: vi.fn((sessao: Sessao) => {
      operacoes.push(`gravar:${sessao.tokenAcesso}`);
      guardado = sessao;
      return Promise.resolve();
    }),
    limpar: vi.fn(() => {
      operacoes.push('limpar');
      guardado = null;
      return Promise.resolve();
    }),
  };
  return { armazenamento, operacoes, guardado: () => guardado };
}

/** Revogação pendente em memória (S80), separada da sessão. */
function revogacaoFalsa(inicial: unknown = null) {
  let guardada: unknown = inicial;
  const operacoes: string[] = [];
  const armazenamento: ArmazenamentoDeRevogacao = {
    ler: () => {
      operacoes.push('ler');
      return Promise.resolve(guardada as RevogacaoPendente | null);
    },
    gravar: (pendente) => {
      operacoes.push('gravar');
      guardada = pendente;
      return Promise.resolve();
    },
    limpar: () => {
      operacoes.push('limpar');
      guardada = null;
      return Promise.resolve();
    },
  };
  return { armazenamento, operacoes, guardada: () => guardada };
}

function montar(entrada: {
  atendimento: Atendimento;
  inicial?: unknown;
  modo?: ModoDeRenovacao;
  pendente?: unknown;
  /** Troca opções do cliente (armazenamento que falha, aviso que lança). */
  ajustes?: Partial<OpcoesDoClienteAutenticado>;
}) {
  const api = fetchFalso(entrada.atendimento);
  const guarda = armazenamentoFalso(entrada.inicial ?? null);
  const revogacao = revogacaoFalsa(entrada.pendente ?? null);
  const encerramentos: MotivoDoEncerramento[] = [];
  const falhas: FalhaEmSegundoPlano[] = [];
  const autenticado = criarClienteAutenticado({
    cliente: criarClienteApi({ baseUrl: BASE, fetch: api.fetch }),
    armazenamento: guarda.armazenamento,
    revogacaoPendente: revogacao.armazenamento,
    modoDeRenovacao: entrada.modo ?? 'token',
    aoEncerrarSessao: (motivo) => encerramentos.push(motivo),
    aoFalharEmSegundoPlano: (falha) => falhas.push(falha),
    ...entrada.ajustes,
  });
  const pedirConta = () => autenticado.requisitar({ caminho: '/v1/conta', esquema: contaSchema });
  return { ...api, ...guarda, revogacao, autenticado, encerramentos, falhas, pedirConta };
}

/** Tudo o que um erro deixa ver: mensagem, pilha, JSON e a cadeia de causas. */
function textoDoErro(erro: unknown): string {
  const partes: string[] = [];
  let atual: unknown = erro;
  for (let nivel = 0; atual !== undefined && nivel < 5; nivel += 1) {
    if (atual instanceof Error) {
      partes.push(atual.message, atual.stack ?? '', JSON.stringify(atual));
      atual = atual.cause;
    } else {
      partes.push(JSON.stringify(atual) ?? '');
      atual = undefined;
    }
  }
  return partes.join('\n');
}

describe('Bearer', () => {
  it('injeta o token de acesso da sessão guardada', async () => {
    const { pedirConta, chamadas, operacoes } = montar({
      atendimento: () => json(200, { nome: 'Conta' }),
      inicial: SESSAO_1,
    });

    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta' });
    await pedirConta();

    expect(chamadas[0]?.pedido.headers['Authorization']).toBe(`Bearer ${SESSAO_1.tokenAcesso}`);
    expect(operacoes.filter((o) => o === 'ler')).toHaveLength(1);
  });

  it('sem sessão, vai sem Authorization e um 401 não tenta renovar', async () => {
    const { pedirConta, chamadas, para, encerramentos } = montar({ atendimento: nao401 });

    const erro = await pedirConta().catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeApi);
    expect(chamadas[0]?.pedido.headers['Authorization']).toBeUndefined();
    expect(para(URL_DA_RENOVACAO)).toHaveLength(0);
    expect(encerramentos).toEqual([]);
  });

  it('troca qualquer Authorization do chamador pelo da sessão', async () => {
    const { autenticado, chamadas } = montar({
      atendimento: () => json(200, { nome: 'Conta' }),
      inicial: SESSAO_1,
    });

    await autenticado.requisitar({
      caminho: '/v1/conta',
      esquema: contaSchema,
      cabecalhos: { authorization: 'Bearer outro', 'Idempotency-Key': 'k-1' },
    });

    const cabecalhos = chamadas[0]?.pedido.headers ?? {};
    expect(cabecalhos['authorization']).toBeUndefined();
    expect(cabecalhos['Authorization']).toBe(`Bearer ${SESSAO_1.tokenAcesso}`);
    expect(cabecalhos['Idempotency-Key']).toBe('k-1');
  });

  it('valor fora do formato no armazenamento conta como sem sessão', async () => {
    const { pedirConta, chamadas } = montar({
      atendimento: () => json(200, { nome: 'Conta' }),
      inicial: { tokenAcesso: 123 },
    });
    await pedirConta();
    expect(chamadas[0]?.pedido.headers['Authorization']).toBeUndefined();
  });

  it.each([
    ['rejeita', () => Promise.reject(new Error('Keychain indisponível'))],
    [
      'lança na hora',
      () => {
        throw new Error('Keychain indisponível');
      },
    ],
  ])('leitura que %s devolve o erro e a próxima requisição lê de novo', async (_nome, falha) => {
    const { fetch, chamadas } = fetchFalso(() => json(200, { nome: 'Conta' }));
    let leituras = 0;
    const autenticado = criarClienteAutenticado({
      cliente: criarClienteApi({ baseUrl: BASE, fetch }),
      armazenamento: {
        ler: () => {
          leituras += 1;
          return leituras === 1 ? falha() : Promise.resolve(SESSAO_1);
        },
        gravar: () => Promise.resolve(),
        limpar: () => Promise.resolve(),
      },
      revogacaoPendente: revogacaoFalsa().armazenamento,
      modoDeRenovacao: 'token',
    });
    const pedirConta = () => autenticado.requisitar({ caminho: '/v1/conta', esquema: contaSchema });

    await expect(pedirConta()).rejects.toThrow('Keychain indisponível');
    expect(chamadas).toHaveLength(0);
    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta' });
    expect(chamadas[0]?.pedido.headers['Authorization']).toBe(`Bearer ${SESSAO_1.tokenAcesso}`);
  });

  it('403 não renova', async () => {
    const { pedirConta, para } = montar({
      atendimento: (url) =>
        url === URL_DA_CONTA
          ? json(403, { ...PROBLEMA_401, status: 403, codigo: 'proibido' })
          : json(200, SESSAO_2),
      inicial: SESSAO_1,
    });
    await expect(pedirConta()).rejects.toMatchObject({ status: 403 });
    expect(para(URL_DA_RENOVACAO)).toHaveLength(0);
  });
});

describe('renovação em 401', () => {
  it('renova uma vez, grava a sessão nova e repete com o token novo', async () => {
    const { pedirConta, para, operacoes, guardado, encerramentos } = montar({
      atendimento: apiComToken(
        () => SESSAO_2.tokenAcesso,
        () => json(200, SESSAO_2),
      ),
      inicial: SESSAO_1,
    });

    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta' });

    const renovacoes = para(URL_DA_RENOVACAO);
    expect(renovacoes).toHaveLength(1);
    expect(renovacoes[0]?.pedido.method).toBe('POST');
    expect(renovacoes[0]?.pedido.body).toBe(
      JSON.stringify({ tokenRenovacao: SESSAO_1.tokenRenovacao }),
    );
    expect(renovacoes[0]?.pedido.headers['Authorization']).toBeUndefined();
    const contas = para(URL_DA_CONTA);
    expect(contas.map((c) => c.pedido.headers['Authorization'])).toEqual([
      `Bearer ${SESSAO_1.tokenAcesso}`,
      `Bearer ${SESSAO_2.tokenAcesso}`,
    ]);
    expect(operacoes).toEqual(['ler', `gravar:${SESSAO_2.tokenAcesso}`]);
    expect(guardado()).toEqual(SESSAO_2);
    expect(encerramentos).toEqual([]);
  });

  it('repete a escrita com o mesmo método, corpo e Idempotency-Key', async () => {
    const { autenticado, para } = montar({
      atendimento: (url, pedido) => {
        if (url === URL_DA_RENOVACAO) return json(200, SESSAO_2);
        return pedido.headers['Authorization'] === `Bearer ${SESSAO_2.tokenAcesso}`
          ? json(201, { nome: 'Criado' })
          : nao401();
      },
      inicial: SESSAO_1,
    });

    await autenticado.requisitar({
      metodo: 'POST',
      caminho: '/v1/coisas',
      esquema: contaSchema,
      corpo: { valor: 1 },
      cabecalhos: { 'Idempotency-Key': 'chave-1' },
    });

    const envios = para(`${BASE}/v1/coisas`);
    expect(envios).toHaveLength(2);
    for (const { pedido } of envios) {
      expect(pedido.method).toBe('POST');
      expect(pedido.body).toBe('{"valor":1}');
      expect(pedido.headers['Idempotency-Key']).toBe('chave-1');
    }
  });

  it('fila única: requisições concorrentes com 401 disparam uma só renovação', async () => {
    const renovacao = adiada<RespostaMinima>();
    const { pedirConta, para } = montar({
      atendimento: apiComToken(
        () => SESSAO_2.tokenAcesso,
        () => renovacao.promessa,
      ),
      inicial: SESSAO_1,
    });

    const pedidos = [pedirConta(), pedirConta(), pedirConta(), pedirConta()];
    await vi.waitFor(() => expect(para(URL_DA_RENOVACAO)).toHaveLength(1));
    renovacao.resolver(json(200, SESSAO_2));

    await expect(Promise.all(pedidos)).resolves.toHaveLength(4);
    expect(para(URL_DA_RENOVACAO)).toHaveLength(1);
    const repeticoes = para(URL_DA_CONTA).filter(
      (c) => c.pedido.headers['Authorization'] === `Bearer ${SESSAO_2.tokenAcesso}`,
    );
    expect(repeticoes).toHaveLength(4);
  });

  it('401 que chega depois da renovação concluída repete com o token novo, sem renovar de novo', async () => {
    const atrasada = adiada<RespostaMinima>();
    let primeira = true;
    const { pedirConta, para } = montar({
      atendimento: (url, pedido) => {
        if (url === URL_DA_RENOVACAO) return json(200, SESSAO_2);
        if (pedido.headers['Authorization'] === `Bearer ${SESSAO_2.tokenAcesso}`) {
          return json(200, { nome: 'Conta' });
        }
        if (primeira) {
          primeira = false;
          return atrasada.promessa;
        }
        return nao401();
      },
      inicial: SESSAO_1,
    });

    const lenta = pedirConta();
    await vi.waitFor(() => expect(para(URL_DA_CONTA)).toHaveLength(1));
    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta' });
    expect(para(URL_DA_RENOVACAO)).toHaveLength(1);

    atrasada.resolver(nao401());
    await expect(lenta).resolves.toEqual({ nome: 'Conta' });
    expect(para(URL_DA_RENOVACAO)).toHaveLength(1);
  });

  it('a repetição que falha com 401 não renova de novo nem encerra a sessão', async () => {
    // Uma segunda renovação seria recusada e encerraria a sessão: o teste falha em vez de travar.
    let renovacoes = 0;
    const { pedirConta, para, encerramentos, guardado } = montar({
      atendimento: (url) => {
        if (url !== URL_DA_RENOVACAO) return nao401();
        renovacoes += 1;
        return renovacoes === 1 ? json(200, SESSAO_2) : nao401();
      },
      inicial: SESSAO_1,
    });

    const erro = await pedirConta().catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeApi);
    expect((erro as ErroDeApi).status).toBe(401);
    expect(para(URL_DA_RENOVACAO)).toHaveLength(1);
    expect(para(URL_DA_CONTA)).toHaveLength(2);
    expect(encerramentos).toEqual([]);
    expect(guardado()).toEqual(SESSAO_2);
  });

  it('a repetição que falha por outro motivo devolve esse erro', async () => {
    let tentativa = 0;
    const { pedirConta, para } = montar({
      atendimento: (url) => {
        if (url === URL_DA_RENOVACAO) return json(200, SESSAO_2);
        tentativa += 1;
        return tentativa === 1
          ? nao401()
          : json(503, { ...PROBLEMA_401, status: 503, codigo: 'indisponivel' });
      },
      inicial: SESSAO_1,
    });
    await expect(pedirConta()).rejects.toMatchObject({ status: 503 });
    expect(para(URL_DA_RENOVACAO)).toHaveLength(1);
  });
});

describe('renovação recusada encerra a sessão', () => {
  it.each([400, 401, 403])(
    'recusa %i: limpa o armazenamento, avisa uma vez e a fila recebe o 401 original',
    async (status) => {
      const renovacao = adiada<RespostaMinima>();
      const { pedirConta, para, operacoes, guardado, encerramentos } = montar({
        atendimento: (url) => (url === URL_DA_RENOVACAO ? renovacao.promessa : nao401()),
        inicial: SESSAO_1,
      });

      const pedidos = [pedirConta(), pedirConta(), pedirConta()].map((p) =>
        p.catch((e: unknown) => e),
      );
      await vi.waitFor(() => expect(para(URL_DA_RENOVACAO)).toHaveLength(1));
      renovacao.resolver(json(status, { ...PROBLEMA_401, status }));

      const erros = await Promise.all(pedidos);
      for (const erro of erros) {
        expect(erro).toBeInstanceOf(ErroDeApi);
        expect((erro as ErroDeApi).status).toBe(401);
      }
      expect(para(URL_DA_RENOVACAO)).toHaveLength(1);
      expect(para(URL_DA_CONTA)).toHaveLength(3);
      expect(encerramentos).toEqual(['renovacao_recusada']);
      expect(operacoes).toEqual(['ler', 'limpar']);
      expect(guardado()).toBeNull();
    },
  );

  it('depois de encerrada, a próxima requisição vai sem token e não renova', async () => {
    const { pedirConta, para, chamadas, autenticado } = montar({
      atendimento: nao401,
      inicial: SESSAO_1,
    });

    await pedirConta().catch(() => undefined);
    await pedirConta().catch(() => undefined);

    expect(para(URL_DA_RENOVACAO)).toHaveLength(1);
    expect(chamadas.at(-1)?.pedido.headers['Authorization']).toBeUndefined();
    await expect(autenticado.obterSessao()).resolves.toBeNull();
  });

  it('app sem tokenRenovacao guardado encerra sem chamar a API', async () => {
    const semRenovacao: Sessao = { ...SESSAO_1 };
    delete semRenovacao.tokenRenovacao;
    const { pedirConta, para, encerramentos } = montar({
      atendimento: nao401,
      inicial: semRenovacao,
    });

    await expect(pedirConta()).rejects.toBeInstanceOf(ErroDeApi);
    expect(para(URL_DA_RENOVACAO)).toHaveLength(0);
    expect(encerramentos).toEqual(['renovacao_recusada']);
  });
});

describe('renovação que falha sem recusa mantém a sessão', () => {
  it('falha de rede: a fila recebe ErroSemConexao, nada é limpo e a próxima tenta de novo', async () => {
    let rede = false;
    const { pedirConta, para, operacoes, encerramentos } = montar({
      atendimento: apiComToken(
        () => SESSAO_2.tokenAcesso,
        () =>
          rede ? json(200, SESSAO_2) : Promise.reject(new TypeError('Network request failed')),
      ),
      inicial: SESSAO_1,
    });

    const erros = await Promise.all(
      [pedirConta(), pedirConta()].map((p) => p.catch((e: unknown) => e)),
    );
    for (const erro of erros) expect(erro).toBeInstanceOf(ErroSemConexao);
    expect(para(URL_DA_RENOVACAO)).toHaveLength(1);
    expect(encerramentos).toEqual([]);
    expect(operacoes).toEqual(['ler']);

    rede = true;
    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta' });
    expect(para(URL_DA_RENOVACAO)).toHaveLength(2);
  });

  it.each([429, 500, 503])('status %i na renovação não encerra', async (status) => {
    const { pedirConta, encerramentos, guardado } = montar({
      atendimento: (url) =>
        url === URL_DA_RENOVACAO
          ? json(status, { ...PROBLEMA_401, status, codigo: 'x' })
          : nao401(),
      inicial: SESSAO_1,
    });
    await expect(pedirConta()).rejects.toMatchObject({ status });
    expect(encerramentos).toEqual([]);
    expect(guardado()).toEqual(SESSAO_1);
  });

  it('2xx fora do contrato vira ErroRespostaInvalida e não encerra', async () => {
    const { pedirConta, encerramentos, guardado } = montar({
      atendimento: (url) => (url === URL_DA_RENOVACAO ? json(200, { tokenAcesso: 1 }) : nao401()),
      inicial: SESSAO_1,
    });
    await expect(pedirConta()).rejects.toBeInstanceOf(ErroRespostaInvalida);
    expect(encerramentos).toEqual([]);
    expect(guardado()).toEqual(SESSAO_1);
  });
});

describe('leitura tolerante e o que é guardado', () => {
  it('aceita campo a mais e data com deslocamento, e guarda só os campos do contrato', async () => {
    const { pedirConta, guardado } = montar({
      atendimento: apiComToken(
        () => SESSAO_2.tokenAcesso,
        () => json(200, { ...SESSAO_2, expiraEm: '2026-10-17T09:30:00-03:00', novidade: 'x' }),
      ),
      inicial: SESSAO_1,
    });

    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta' });
    expect(guardado()).toEqual({ ...SESSAO_2, expiraEm: '2026-10-17T09:30:00-03:00' });
  });

  it('iniciarSessao guarda só os campos do contrato', async () => {
    const { autenticado, guardado } = montar({ atendimento: nao401 });
    await autenticado.iniciarSessao({ ...SESSAO_1, extra: 'x' } as Sessao);
    expect(guardado()).toEqual(SESSAO_1);
    await expect(autenticado.obterSessao()).resolves.toEqual(SESSAO_1);
  });
});

describe('painel (renovação por cookie)', () => {
  const SESSAO_DO_PAINEL: Sessao = {
    tokenAcesso: SESSAO_1.tokenAcesso,
    expiraEm: SESSAO_1.expiraEm,
    emailVerificado: true,
  };

  it('renova sem corpo, com X-Cliente: painel, e nunca guarda tokenRenovacao', async () => {
    const { pedirConta, para, guardado } = montar({
      atendimento: apiComToken(
        () => SESSAO_2.tokenAcesso,
        () => json(200, SESSAO_2),
      ),
      inicial: SESSAO_DO_PAINEL,
      modo: 'cookie',
    });

    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta' });

    const renovacao = para(URL_DA_RENOVACAO)[0]?.pedido;
    expect(renovacao?.body).toBeUndefined();
    expect(renovacao?.headers['X-Cliente']).toBe('painel');
    expect(renovacao?.headers['Content-Type']).toBeUndefined();
    expect(guardado()).toEqual({
      tokenAcesso: SESSAO_2.tokenAcesso,
      expiraEm: SESSAO_2.expiraEm,
      emailVerificado: true,
    });
  });

  it('iniciarSessao no modo cookie também descarta tokenRenovacao', async () => {
    const { autenticado, guardado } = montar({ atendimento: nao401, modo: 'cookie' });
    await autenticado.iniciarSessao(SESSAO_2);
    expect(guardado()).not.toHaveProperty('tokenRenovacao');
  });

  it('renovarSessao sem sessão em memória (ao abrir) restaura pelo cookie', async () => {
    const { autenticado, para, encerramentos } = montar({
      atendimento: () => json(200, { ...SESSAO_2, tokenRenovacao: undefined }),
      modo: 'cookie',
    });

    await expect(autenticado.renovarSessao()).resolves.toMatchObject({
      tokenAcesso: SESSAO_2.tokenAcesso,
    });
    expect(para(URL_DA_RENOVACAO)).toHaveLength(1);
    expect(encerramentos).toEqual([]);
  });

  it('renovarSessao recusada ao abrir devolve null sem avisar encerramento', async () => {
    const { autenticado, encerramentos } = montar({ atendimento: nao401, modo: 'cookie' });
    await expect(autenticado.renovarSessao()).resolves.toBeNull();
    expect(encerramentos).toEqual([]);
  });
});

describe('renovarSessao', () => {
  it('entra na mesma fila das renovações automáticas', async () => {
    const renovacao = adiada<RespostaMinima>();
    const { autenticado, pedirConta, para } = montar({
      atendimento: apiComToken(
        () => SESSAO_2.tokenAcesso,
        () => renovacao.promessa,
      ),
      inicial: SESSAO_1,
    });

    const automatica = pedirConta();
    await vi.waitFor(() => expect(para(URL_DA_RENOVACAO)).toHaveLength(1));
    const explicita = autenticado.renovarSessao();
    renovacao.resolver(json(200, SESSAO_2));

    await expect(explicita).resolves.toEqual(SESSAO_2);
    await expect(automatica).resolves.toEqual({ nome: 'Conta' });
    expect(para(URL_DA_RENOVACAO)).toHaveLength(1);
  });

  it('app sem sessão devolve null sem chamar a API', async () => {
    const { autenticado, para, encerramentos } = montar({ atendimento: nao401 });
    await expect(autenticado.renovarSessao()).resolves.toBeNull();
    expect(para(URL_DA_RENOVACAO)).toHaveLength(0);
    expect(encerramentos).toEqual([]);
  });
});

describe('encerrarSessao (logout)', () => {
  it('chama DELETE /v1/sessoes/atual com o Bearer, limpa e avisa logout', async () => {
    const { autenticado, para, operacoes, encerramentos, revogacao } = montar({
      atendimento: apiComToken(
        () => SESSAO_1.tokenAcesso,
        () => json(200, SESSAO_2),
      ),
      inicial: SESSAO_1,
    });

    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: true });

    const logout = para(URL_DO_LOGOUT);
    expect(logout).toHaveLength(1);
    expect(logout[0]?.pedido.method).toBe('DELETE');
    expect(logout[0]?.pedido.headers['Authorization']).toBe(`Bearer ${SESSAO_1.tokenAcesso}`);
    expect(operacoes).toEqual(['ler', 'limpar']);
    // Lê as pendências anteriores (Q21), registra a nova antes do DELETE e a apaga com o 204.
    expect(revogacao.operacoes).toEqual(['ler', 'gravar', 'limpar']);
    expect(revogacao.guardada()).toBeNull();
    expect(encerramentos).toEqual(['logout']);
    await expect(autenticado.obterSessao()).resolves.toBeNull();
  });

  it('com o token de acesso vencido, renova e repete o DELETE para revogar no servidor', async () => {
    const { autenticado, para, encerramentos, guardado } = montar({
      atendimento: apiComToken(
        () => SESSAO_2.tokenAcesso,
        () => json(200, SESSAO_2),
      ),
      inicial: SESSAO_1,
    });

    await autenticado.encerrarSessao();

    expect(para(URL_DA_RENOVACAO)).toHaveLength(1);
    expect(para(URL_DO_LOGOUT).map((c) => c.pedido.headers['Authorization'])).toEqual([
      `Bearer ${SESSAO_1.tokenAcesso}`,
      `Bearer ${SESSAO_2.tokenAcesso}`,
    ]);
    expect(guardado()).toBeNull();
    expect(encerramentos).toEqual(['logout']);
  });

  it('renovação recusada durante o logout: conta como revogada, limpa e avisa logout uma vez só', async () => {
    const { autenticado, para, guardado, encerramentos, revogacao } = montar({
      atendimento: nao401,
      inicial: SESSAO_1,
    });

    // O aparelho é limpo antes do DELETE (S80): o motivo é o do usuário.
    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: true });

    expect(para(URL_DA_RENOVACAO)).toHaveLength(1);
    expect(guardado()).toBeNull();
    expect(encerramentos).toEqual(['logout']);
    expect(revogacao.guardada()).toBeNull();
  });

  it('se o armazenamento falhar ao limpar, avisa do mesmo jeito e devolve o erro', async () => {
    const { fetch } = fetchFalso(() => resposta(204, ''));
    const encerramentos: MotivoDoEncerramento[] = [];
    const autenticado = criarClienteAutenticado({
      cliente: criarClienteApi({ baseUrl: BASE, fetch }),
      armazenamento: {
        ler: () => Promise.resolve(SESSAO_1),
        gravar: () => Promise.resolve(),
        limpar: () => Promise.reject(new Error('Keychain indisponível')),
      },
      revogacaoPendente: revogacaoFalsa().armazenamento,
      modoDeRenovacao: 'token',
      aoEncerrarSessao: (motivo) => encerramentos.push(motivo),
    });

    await expect(autenticado.encerrarSessao()).rejects.toThrow('Keychain indisponível');
    expect(encerramentos).toEqual(['logout']);
    await expect(autenticado.obterSessao()).resolves.toBeNull();
  });

  it('sem resposta da API, limpa do mesmo jeito e diz que não revogou', async () => {
    const { autenticado, guardado, encerramentos, revogacao } = montar({
      atendimento: () => Promise.reject(new TypeError('Network request failed')),
      inicial: SESSAO_1,
    });
    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: false });
    expect(guardado()).toBeNull();
    expect(encerramentos).toEqual(['logout']);
    expect(revogacao.guardada()).toEqual({
      tokenAcesso: SESSAO_1.tokenAcesso,
      tokenRenovacao: SESSAO_1.tokenRenovacao,
    });
  });
});

describe('troca de sessão durante a renovação', () => {
  it('logout no meio da renovação: o resultado é descartado e nada volta ao armazenamento', async () => {
    const renovacao = adiada<RespostaMinima>();
    const { autenticado, pedirConta, para, operacoes, guardado } = montar({
      atendimento: (url) => {
        if (url === URL_DA_RENOVACAO) return renovacao.promessa;
        if (url === URL_DO_LOGOUT) return resposta(204, '');
        return nao401();
      },
      inicial: SESSAO_1,
    });

    const pendente = pedirConta().catch((e: unknown) => e);
    await vi.waitFor(() => expect(para(URL_DA_RENOVACAO)).toHaveLength(1));
    // O DELETE leva o token antigo; responde 204 e o logout termina antes da renovação.
    await autenticado.encerrarSessao();
    renovacao.resolver(json(200, SESSAO_2));

    expect(await pendente).toBeInstanceOf(ErroDeApi);
    expect(guardado()).toBeNull();
    expect(operacoes).not.toContain(`gravar:${SESSAO_2.tokenAcesso}`);
    expect(para(URL_DA_CONTA)).toHaveLength(1);
  });

  it('troca de conta com a requisição no ar: o 401 da conta antiga não repete com a nova', async () => {
    const atrasada = adiada<RespostaMinima>();
    const OUTRA: Sessao = { ...SESSAO_2, tokenAcesso: 'acesso-outra.eee' };
    const { autenticado, pedirConta, para } = montar({
      atendimento: (url) => (url === URL_DA_CONTA ? atrasada.promessa : json(200, SESSAO_2)),
      inicial: SESSAO_1,
    });

    const pendente = pedirConta().catch((e: unknown) => e);
    await vi.waitFor(() => expect(para(URL_DA_CONTA)).toHaveLength(1));
    await autenticado.iniciarSessao(OUTRA);
    atrasada.resolver(nao401());

    expect(await pendente).toBeInstanceOf(ErroDeApi);
    expect(para(URL_DA_CONTA)).toHaveLength(1);
    expect(para(URL_DA_RENOVACAO)).toHaveLength(0);
  });

  it('troca de conta no meio da renovação: a requisição antiga não repete com a conta nova', async () => {
    const renovacao = adiada<RespostaMinima>();
    const OUTRA: Sessao = { ...SESSAO_2, tokenAcesso: 'acesso-outra.eee' };
    const { autenticado, pedirConta, para, guardado } = montar({
      atendimento: (url) => (url === URL_DA_RENOVACAO ? renovacao.promessa : nao401()),
      inicial: SESSAO_1,
    });

    const pendente = pedirConta().catch((e: unknown) => e);
    await vi.waitFor(() => expect(para(URL_DA_RENOVACAO)).toHaveLength(1));
    await autenticado.iniciarSessao(OUTRA);
    renovacao.resolver(json(200, SESSAO_2));

    expect(await pendente).toBeInstanceOf(ErroDeApi);
    expect(guardado()).toEqual(OUTRA);
    expect(para(URL_DA_CONTA).map((c) => c.pedido.headers['Authorization'])).toEqual([
      `Bearer ${SESSAO_1.tokenAcesso}`,
    ]);
  });

  it('escritas em ordem: limpar espera o gravar anterior terminar', async () => {
    const gravacao = adiada<undefined>();
    const operacoes: string[] = [];
    const armazenamento: ArmazenamentoDeSessao = {
      ler: () => Promise.resolve(null),
      gravar: async () => {
        operacoes.push('gravar:inicio');
        await gravacao.promessa;
        operacoes.push('gravar:fim');
      },
      limpar: () => {
        operacoes.push('limpar');
        return Promise.resolve();
      },
    };
    const { fetch, para } = fetchFalso(() => resposta(204, ''));
    const autenticado = criarClienteAutenticado({
      cliente: criarClienteApi({ baseUrl: BASE, fetch }),
      armazenamento,
      revogacaoPendente: revogacaoFalsa().armazenamento,
      modoDeRenovacao: 'token',
    });

    const inicio = autenticado.iniciarSessao(SESSAO_1);
    const fim = autenticado.encerrarSessao();
    await vi.waitFor(() => expect(para(URL_DO_LOGOUT)).toHaveLength(1));
    // Deixa o logout correr até o fim: o limpar só pode sair depois do gravar.
    await new Promise<void>((resolver) => setTimeout(resolver, 20));
    expect(operacoes).toEqual(['gravar:inicio']);
    gravacao.resolver(undefined);
    await Promise.all([inicio, fim]);

    expect(operacoes).toEqual(['gravar:inicio', 'gravar:fim', 'limpar']);
  });
});

describe('tokens fora dos erros', () => {
  it('nenhum erro devolvido carrega token de acesso ou de renovação', async () => {
    let renovacoesDoUltimo = 0;
    const cenarios: Atendimento[] = [
      // renovação recusada
      () => nao401(),
      // renovação sem rede
      (url) =>
        url === URL_DA_RENOVACAO
          ? Promise.reject(new TypeError('Network request failed'))
          : nao401(),
      // renovação fora do contrato
      (url) =>
        url === URL_DA_RENOVACAO ? json(200, { ...SESSAO_2, emailVerificado: 'sim' }) : nao401(),
      // repetição que falha de novo (uma segunda renovação seria recusada)
      (url) => {
        if (url !== URL_DA_RENOVACAO) return nao401();
        renovacoesDoUltimo += 1;
        return renovacoesDoUltimo === 1 ? json(200, SESSAO_2) : nao401();
      },
    ];

    for (const atendimento of cenarios) {
      const { pedirConta } = montar({ atendimento, inicial: SESSAO_1 });
      const erro = await pedirConta().catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(Error);
      const texto = textoDoErro(erro);
      for (const token of TODOS_OS_TOKENS) expect(texto).not.toContain(token);
    }
  });
});

describe('logout pendente no painel (S80)', () => {
  const SESSAO_DO_PAINEL: Sessao = {
    tokenAcesso: SESSAO_1.tokenAcesso,
    expiraEm: SESSAO_1.expiraEm,
    emailVerificado: true,
  };
  const ehLogoutDoPainel = (url: string, pedido: PedidoMinimo) =>
    url === URL_DA_RENOVACAO && pedido.method === 'DELETE';

  /** Logout pelo cookie conforme `logout`; a renovação devolveria uma sessão (restauraria). */
  function apiDoPainel(logout: () => RespostaMinima | Promise<RespostaMinima>): Atendimento {
    return (url, pedido) => {
      if (ehLogoutDoPainel(url, pedido)) return logout();
      if (url === URL_DA_RENOVACAO) return json(200, { ...SESSAO_2, tokenRenovacao: undefined });
      return json(200, { nome: 'Conta' });
    };
  }

  const logoutsDoPainel = (chamadas: { url: string; pedido: PedidoMinimo }[]) =>
    chamadas.filter((c) => ehLogoutDoPainel(c.url, c.pedido));
  const renovacoesDoPainel = (chamadas: { url: string; pedido: PedidoMinimo }[]) =>
    chamadas.filter((c) => c.url === URL_DA_RENOVACAO && c.pedido.method === 'POST');

  it('logout com sessão: DELETE na rota do cookie, sem Bearer, sem corpo e sem renovar; o 204 apaga a marca', async () => {
    const { autenticado, chamadas, revogacao, encerramentos } = montar({
      atendimento: apiDoPainel(() => resposta(204, '')),
      inicial: SESSAO_DO_PAINEL,
      modo: 'cookie',
    });

    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: true });

    expect(chamadas).toHaveLength(1);
    const pedido = logoutsDoPainel(chamadas)[0]?.pedido;
    expect(pedido?.headers['X-Cliente']).toBe('painel');
    expect(pedido?.headers['Authorization']).toBeUndefined();
    expect(pedido?.body).toBeUndefined();
    expect(revogacao.operacoes).toEqual(['gravar', 'limpar']);
    expect(revogacao.guardada()).toBeNull();
    expect(encerramentos).toEqual(['logout']);
  });

  it.each([
    ['sem rede', () => Promise.reject(new TypeError('Network request failed'))],
    ['com 500', () => json(500, { ...PROBLEMA_401, status: 500, codigo: 'erro_interno' })],
    ['com 429', () => json(429, { ...PROBLEMA_401, status: 429, codigo: 'muitas_requisicoes' })],
  ])(
    'logout %s: diz que não revogou, guarda a marca sem token e limpa o aparelho',
    async (_nome, falha: () => RespostaMinima | Promise<RespostaMinima>) => {
      const { autenticado, chamadas, revogacao, encerramentos, guardado } = montar({
        atendimento: apiDoPainel(falha),
        inicial: SESSAO_DO_PAINEL,
        modo: 'cookie',
      });

      await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: false });

      expect(revogacao.guardada()).toEqual({});
      const marca = JSON.stringify(revogacao.guardada());
      for (const token of TODOS_OS_TOKENS) expect(marca).not.toContain(token);
      expect(guardado()).toBeNull();
      expect(encerramentos).toEqual(['logout']);
      expect(renovacoesDoPainel(chamadas)).toHaveLength(0);
      await expect(autenticado.obterSessao()).resolves.toBeNull();
    },
  );

  it('logout sem sessão em memória (depois de recarregar) também chama a rota do cookie', async () => {
    const { autenticado, chamadas, revogacao, encerramentos } = montar({
      atendimento: apiDoPainel(() => resposta(204, '')),
      modo: 'cookie',
    });

    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: true });

    expect(logoutsDoPainel(chamadas)).toHaveLength(1);
    expect(revogacao.guardada()).toBeNull();
    expect(encerramentos).toEqual([]);
  });

  it('abertura com marca: tenta o logout, não renova e apaga a marca com o 204', async () => {
    const { autenticado, chamadas, revogacao, pedirConta } = montar({
      atendimento: apiDoPainel(() => resposta(204, '')),
      modo: 'cookie',
      pendente: {},
    });

    await expect(autenticado.renovarSessao()).resolves.toBeNull();

    expect(logoutsDoPainel(chamadas)).toHaveLength(1);
    expect(renovacoesDoPainel(chamadas)).toHaveLength(0);
    expect(revogacao.guardada()).toBeNull();
    await expect(autenticado.obterSessao()).resolves.toBeNull();
    await pedirConta();
    expect(chamadas.at(-1)?.pedido.headers['Authorization']).toBeUndefined();
  });

  it('abertura com marca e sem rede: não restaura e mantém a marca; com rede, sai, e só a abertura seguinte renova', async () => {
    let rede = false;
    const { autenticado, chamadas, revogacao } = montar({
      atendimento: apiDoPainel(() =>
        rede ? resposta(204, '') : Promise.reject(new TypeError('Network request failed')),
      ),
      modo: 'cookie',
      pendente: {},
    });

    await expect(autenticado.renovarSessao()).resolves.toBeNull();
    expect(revogacao.guardada()).toEqual({});
    expect(renovacoesDoPainel(chamadas)).toHaveLength(0);
    await expect(autenticado.obterSessao()).resolves.toBeNull();

    rede = true;
    await expect(autenticado.renovarSessao()).resolves.toBeNull();
    expect(logoutsDoPainel(chamadas)).toHaveLength(2);
    expect(revogacao.guardada()).toBeNull();
    expect(renovacoesDoPainel(chamadas)).toHaveLength(0);

    await expect(autenticado.renovarSessao()).resolves.toMatchObject({
      tokenAcesso: SESSAO_2.tokenAcesso,
    });
    expect(renovacoesDoPainel(chamadas)).toHaveLength(1);
  });

  it.each([['x'], [{ tokenAcesso: 'acesso-guardado.zzz' }]])(
    'qualquer valor guardado conta como marca (%j), e o token que estivesse nela não vai no logout',
    async (valor) => {
      const { autenticado, chamadas } = montar({
        atendimento: apiDoPainel(() => resposta(204, '')),
        modo: 'cookie',
        pendente: valor,
      });

      await expect(autenticado.renovarSessao()).resolves.toBeNull();

      expect(renovacoesDoPainel(chamadas)).toHaveLength(0);
      expect(logoutsDoPainel(chamadas)[0]?.pedido.headers['Authorization']).toBeUndefined();
    },
  );

  it('o login apaga a marca (mesmo antes de lida), e a abertura seguinte renova normalmente', async () => {
    const { autenticado, chamadas, revogacao } = montar({
      atendimento: apiDoPainel(() => resposta(204, '')),
      modo: 'cookie',
      pendente: {},
    });

    await autenticado.iniciarSessao(SESSAO_DO_PAINEL);

    expect(revogacao.operacoes).toEqual(['limpar']);
    expect(revogacao.guardada()).toBeNull();
    await expect(autenticado.renovarSessao()).resolves.toMatchObject({
      tokenAcesso: SESSAO_2.tokenAcesso,
    });
    expect(logoutsDoPainel(chamadas)).toHaveLength(0);
  });

  it('um logout pendente que termina depois do login não apaga a marca nem a sessão novas', async () => {
    const logout = adiada<RespostaMinima>();
    const { autenticado, revogacao, guardado } = montar({
      atendimento: apiDoPainel(() => logout.promessa),
      inicial: SESSAO_DO_PAINEL,
      modo: 'cookie',
    });

    const saindo = autenticado.encerrarSessao();
    await vi.waitFor(() => expect(revogacao.guardada()).toEqual({}));
    await autenticado.iniciarSessao(SESSAO_DO_PAINEL);
    logout.resolver(resposta(204, ''));

    await expect(saindo).resolves.toEqual({ revogadaNoServidor: true });
    expect(revogacao.operacoes).toEqual(['gravar', 'limpar']);
    expect(guardado()).toEqual(SESSAO_DO_PAINEL);
  });

  it('leitura da marca que falha: renovarSessao devolve o erro e não restaura', async () => {
    const { autenticado, chamadas } = montar({
      atendimento: apiDoPainel(() => resposta(204, '')),
      modo: 'cookie',
      ajustes: {
        revogacaoPendente: {
          ler: () => Promise.reject(new Error('localStorage indisponível')),
          gravar: () => Promise.resolve(),
          limpar: () => Promise.resolve(),
        },
      },
    });

    await expect(autenticado.renovarSessao()).rejects.toThrow('localStorage indisponível');
    expect(chamadas).toHaveLength(0);
  });
});

describe('revogação pendente nos apps (S80)', () => {
  const PAR_1 = { tokenAcesso: SESSAO_1.tokenAcesso, tokenRenovacao: SESSAO_1.tokenRenovacao };
  const PAR_2 = { tokenAcesso: SESSAO_2.tokenAcesso, tokenRenovacao: SESSAO_2.tokenRenovacao };
  const autorizacoesDoLogout = (para: (url: string) => { pedido: PedidoMinimo }[]) =>
    para(URL_DO_LOGOUT).map((c) => c.pedido.headers['Authorization']);

  it('logout sem rede guarda o par numa chave separada, e a próxima chamada com rede revoga com ele', async () => {
    let rede = false;
    const { autenticado, pedirConta, para, guardado, revogacao } = montar({
      atendimento: (url, pedido) => {
        if (!rede) return Promise.reject(new TypeError('Network request failed'));
        if (url !== URL_DO_LOGOUT) return json(200, { nome: 'Conta' });
        return pedido.headers['Authorization'] === `Bearer ${SESSAO_1.tokenAcesso}`
          ? resposta(204, '')
          : nao401();
      },
      inicial: SESSAO_1,
    });

    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: false });
    expect(guardado()).toBeNull();
    expect(revogacao.guardada()).toEqual(PAR_1);

    rede = true;
    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta' });
    await vi.waitFor(() => expect(revogacao.guardada()).toBeNull());

    expect(autorizacoesDoLogout(para)).toEqual([
      `Bearer ${SESSAO_1.tokenAcesso}`,
      `Bearer ${SESSAO_1.tokenAcesso}`,
    ]);
    // A chamada do usuário foi sem sessão: o par da pendência não vira Bearer dela.
    expect(para(URL_DA_CONTA)[0]?.pedido.headers['Authorization']).toBeUndefined();
  });

  it('token de acesso vencido na nova tentativa: renova com o par guardado, guarda o par trocado e repete', async () => {
    let rede = false;
    const { pedirConta, para, revogacao } = montar({
      atendimento: (url, pedido) => {
        if (url === URL_DA_RENOVACAO) {
          return pedido.body === JSON.stringify({ tokenRenovacao: SESSAO_1.tokenRenovacao })
            ? json(200, SESSAO_2)
            : nao401();
        }
        if (url !== URL_DO_LOGOUT) return json(200, { nome: 'Conta' });
        if (pedido.headers['Authorization'] !== `Bearer ${SESSAO_2.tokenAcesso}`) return nao401();
        return rede ? resposta(204, '') : Promise.reject(new TypeError('Network request failed'));
      },
      pendente: PAR_1,
    });

    await pedirConta();
    await vi.waitFor(() => expect(autorizacoesDoLogout(para)).toHaveLength(2));
    await vi.waitFor(() => expect(revogacao.guardada()).toEqual(PAR_2));

    rede = true;
    await pedirConta();
    await vi.waitFor(() => expect(revogacao.guardada()).toBeNull());

    expect(para(URL_DA_RENOVACAO)).toHaveLength(1);
    expect(autorizacoesDoLogout(para)).toEqual([
      `Bearer ${SESSAO_1.tokenAcesso}`,
      `Bearer ${SESSAO_2.tokenAcesso}`,
      `Bearer ${SESSAO_2.tokenAcesso}`,
    ]);
  });

  it('logout e renovação recusados na nova tentativa contam como revogada e apagam a pendência', async () => {
    const { pedirConta, para, revogacao, falhas } = montar({
      atendimento: (url) => (url === URL_DA_CONTA ? json(200, { nome: 'Conta' }) : nao401()),
      pendente: PAR_1,
    });

    await pedirConta();
    await vi.waitFor(() => expect(revogacao.guardada()).toBeNull());

    expect(para(URL_DA_RENOVACAO)).toHaveLength(1);
    expect(falhas).toEqual([]);
  });

  it('a requisição não espera a nova tentativa nem herda o erro dela, e o 503 mantém a pendência', async () => {
    const logout = adiada<RespostaMinima>();
    const { pedirConta, para, revogacao, falhas } = montar({
      atendimento: (url) =>
        url === URL_DO_LOGOUT ? logout.promessa : json(200, { nome: 'Conta' }),
      pendente: PAR_1,
    });

    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta' });
    await vi.waitFor(() => expect(para(URL_DO_LOGOUT)).toHaveLength(1));
    // Chamadas enquanto a tentativa corre não abrem outra.
    await pedirConta();
    expect(para(URL_DO_LOGOUT)).toHaveLength(1);

    logout.resolver(json(503, { ...PROBLEMA_401, status: 503, codigo: 'indisponivel' }));
    await new Promise<void>((resolver) => setTimeout(resolver, 10));
    expect(revogacao.guardada()).toEqual(PAR_1);
    expect(falhas).toEqual([]);
  });

  it('encerrarSessao sem sessão tenta a pendência e devolve o resultado dela', async () => {
    const { autenticado, para, revogacao, encerramentos } = montar({
      atendimento: () => resposta(204, ''),
      pendente: PAR_1,
    });

    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: true });

    expect(autorizacoesDoLogout(para)).toEqual([`Bearer ${SESSAO_1.tokenAcesso}`]);
    expect(revogacao.guardada()).toBeNull();
    expect(encerramentos).toEqual([]);
  });

  it('uma nova tentativa que termina depois de outro logout não apaga a pendência mais nova', async () => {
    const logoutAntigo = adiada<RespostaMinima>();
    const { autenticado, pedirConta, revogacao } = montar({
      atendimento: (url, pedido) => {
        if (url !== URL_DO_LOGOUT) return json(200, { nome: 'Conta' });
        return pedido.headers['Authorization'] === `Bearer ${SESSAO_1.tokenAcesso}`
          ? logoutAntigo.promessa
          : Promise.reject(new TypeError('Network request failed'));
      },
      pendente: PAR_1,
    });

    await pedirConta();
    await vi.waitFor(() => expect(revogacao.operacoes).toContain('ler'));
    await autenticado.iniciarSessao(SESSAO_2);
    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: false });
    logoutAntigo.resolver(resposta(204, ''));
    await new Promise<void>((resolver) => setTimeout(resolver, 10));

    expect(revogacao.guardada()).toEqual(PAR_2);
  });

  it('falha ao gravar a pendência é avisada e o logout segue', async () => {
    const erroDoCofre = new Error('Keychain indisponível');
    const { autenticado, falhas, guardado, encerramentos } = montar({
      atendimento: () => Promise.reject(new TypeError('Network request failed')),
      inicial: SESSAO_1,
      ajustes: {
        revogacaoPendente: {
          ler: () => Promise.resolve(null),
          gravar: () => Promise.reject(erroDoCofre),
          limpar: () => Promise.resolve(),
        },
      },
    });

    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: false });

    expect(falhas).toEqual([{ origem: 'revogacao_pendente', erro: erroDoCofre }]);
    expect(guardado()).toBeNull();
    expect(encerramentos).toEqual(['logout']);
  });
});

describe('várias revogações pendentes nos apps (Q21)', () => {
  const PAR_1 = { tokenAcesso: SESSAO_1.tokenAcesso, tokenRenovacao: SESSAO_1.tokenRenovacao };
  const PAR_2 = { tokenAcesso: SESSAO_2.tokenAcesso, tokenRenovacao: SESSAO_2.tokenRenovacao };
  const semRede = () => Promise.reject(new TypeError('Network request failed'));
  const parN = (n: number): CredencialPendente => ({
    tokenAcesso: `acesso-${n}.xxx`,
    tokenRenovacao: `renovacao-${n}_yyy`,
  });

  it('o segundo logout sem rede guarda a mais nova no topo e a anterior em `anteriores`', async () => {
    const { autenticado, revogacao } = montar({ atendimento: semRede, inicial: SESSAO_1 });

    await autenticado.encerrarSessao();
    expect(revogacao.guardada()).toEqual(PAR_1);
    await autenticado.iniciarSessao(SESSAO_2);
    await autenticado.encerrarSessao();

    expect(revogacao.guardada()).toEqual({ ...PAR_2, anteriores: [PAR_1] });
  });

  it(`guarda no máximo ${MAXIMO_DE_REVOGACOES_PENDENTES}: o logout novo tira a mais antiga`, async () => {
    const guardadas = [2, 3, 4, 5, 6].map(parN);
    const [maisNova, ...anteriores] = guardadas;
    const { autenticado, revogacao } = montar({
      atendimento: semRede,
      inicial: SESSAO_1,
      pendente: { ...maisNova, anteriores },
    });

    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: false });

    expect(revogacao.guardada()).toEqual({ ...PAR_1, anteriores: [2, 3, 4, 5].map(parN) });
  });

  it('a nova tentativa revoga cada uma e tira só as confirmadas', async () => {
    const { pedirConta, para, revogacao } = montar({
      atendimento: (url, pedido) => {
        if (url !== URL_DO_LOGOUT) return json(200, { nome: 'Conta' });
        return pedido.headers['Authorization'] === `Bearer ${SESSAO_1.tokenAcesso}`
          ? resposta(204, '')
          : json(503, { ...PROBLEMA_401, status: 503, codigo: 'indisponivel' });
      },
      pendente: { ...PAR_2, anteriores: [PAR_1] },
    });

    await pedirConta();
    await vi.waitFor(() => expect(revogacao.guardada()).toEqual(PAR_2));

    expect(para(URL_DO_LOGOUT)).toHaveLength(2);
  });

  it('item de `anteriores` fora do formato é ignorado, e o resto é revogado', async () => {
    const { autenticado, para, revogacao } = montar({
      atendimento: () => resposta(204, ''),
      pendente: { ...PAR_2, anteriores: [{ tokenAcesso: 1 }, 'x', {}, PAR_1] },
    });

    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: true });

    expect(para(URL_DO_LOGOUT).map((c) => c.pedido.headers['Authorization'])).toEqual([
      `Bearer ${SESSAO_2.tokenAcesso}`,
      `Bearer ${SESSAO_1.tokenAcesso}`,
    ]);
    expect(revogacao.guardada()).toBeNull();
  });

  it('o logout com sessão espera só a revogação dela, não a das anteriores', async () => {
    const logoutAntigo = adiada<RespostaMinima>();
    const { autenticado, revogacao } = montar({
      atendimento: (url, pedido) =>
        pedido.headers['Authorization'] === `Bearer ${SESSAO_1.tokenAcesso}`
          ? logoutAntigo.promessa
          : resposta(204, ''),
      inicial: SESSAO_2,
      pendente: PAR_1,
    });

    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: true });
    expect(revogacao.guardada()).toEqual(PAR_1);
  });

  it('sem sessão, leitura das pendências que falha: não rejeita, avisa e diz que não revogou', async () => {
    const erroDoCofre = new Error('Keychain indisponível');
    const { autenticado, chamadas, falhas } = montar({
      atendimento: () => resposta(204, ''),
      ajustes: {
        revogacaoPendente: {
          ler: () => Promise.reject(erroDoCofre),
          gravar: () => Promise.resolve(),
          limpar: () => Promise.resolve(),
        },
      },
    });

    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: false });
    expect(falhas).toEqual([{ origem: 'revogacao_pendente', erro: erroDoCofre }]);
    expect(chamadas).toHaveLength(0);
  });

  it('com sessão, leitura das pendências que falha: o logout segue e revoga a sessão atual', async () => {
    let gravada: unknown = null;
    const { autenticado, falhas, guardado, encerramentos } = montar({
      atendimento: () => resposta(204, ''),
      inicial: SESSAO_1,
      ajustes: {
        revogacaoPendente: {
          ler: () => Promise.reject(new Error('Keychain indisponível')),
          gravar: (pendente) => {
            gravada = pendente;
            return Promise.resolve();
          },
          limpar: () => {
            gravada = null;
            return Promise.resolve();
          },
        },
      },
    });

    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: true });
    expect(falhas.map((f) => f.origem)).toEqual(['revogacao_pendente']);
    expect(guardado()).toBeNull();
    expect(encerramentos).toEqual(['logout']);
    expect(gravada).toBeNull();
  });
});

describe('falhas que não trocam o resultado da requisição (Q18)', () => {
  it('gravar que falha depois da renovação: repete com o token novo, limpa o par antigo e avisa', async () => {
    const erroDoCofre = new Error('Keychain cheio');
    const guarda = armazenamentoFalso(SESSAO_1);
    const { pedirConta, para, falhas, autenticado } = montar({
      atendimento: apiComToken(
        () => SESSAO_2.tokenAcesso,
        () => json(200, SESSAO_2),
      ),
      ajustes: {
        armazenamento: { ...guarda.armazenamento, gravar: () => Promise.reject(erroDoCofre) },
      },
    });

    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta' });

    expect(para(URL_DA_CONTA).map((c) => c.pedido.headers['Authorization'])).toEqual([
      `Bearer ${SESSAO_1.tokenAcesso}`,
      `Bearer ${SESSAO_2.tokenAcesso}`,
    ]);
    expect(falhas).toEqual([{ origem: 'gravar_sessao', erro: erroDoCofre }]);
    // O par antigo não fica guardado: na próxima abertura ele pareceria reuso.
    expect(guarda.operacoes).toEqual(['ler', 'limpar']);
    expect(guarda.guardado()).toBeNull();
    await expect(autenticado.obterSessao()).resolves.toEqual(SESSAO_2);
    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta' });
    expect(para(URL_DA_RENOVACAO)).toHaveLength(1);
  });

  it('gravar e limpar que falham: a requisição ainda repete, e as duas falhas são avisadas', async () => {
    const { pedirConta, falhas } = montar({
      atendimento: apiComToken(
        () => SESSAO_2.tokenAcesso,
        () => json(200, SESSAO_2),
      ),
      ajustes: {
        armazenamento: {
          ler: () => Promise.resolve(SESSAO_1),
          gravar: () => Promise.reject(new Error('gravar')),
          limpar: () => Promise.reject(new Error('limpar')),
        },
      },
    });

    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta' });
    expect(falhas.map((f) => f.origem)).toEqual(['gravar_sessao', 'limpar_sessao']);
  });

  it('gravar que falha depois de um login feito no meio não apaga a sessão nova', async () => {
    const OUTRA: Sessao = { ...SESSAO_2, tokenAcesso: 'acesso-outra.eee' };
    let rejeitarPrimeira!: (erro: Error) => void;
    let guardada: Sessao | null = SESSAO_1;
    let gravacoes = 0;
    const { pedirConta, autenticado, falhas } = montar({
      atendimento: apiComToken(
        () => SESSAO_2.tokenAcesso,
        () => json(200, SESSAO_2),
      ),
      ajustes: {
        armazenamento: {
          ler: () => Promise.resolve(guardada),
          gravar: (sessao) => {
            gravacoes += 1;
            if (gravacoes === 1) {
              return new Promise<void>((_resolver, rejeitar) => {
                rejeitarPrimeira = rejeitar;
              });
            }
            guardada = sessao;
            return Promise.resolve();
          },
          limpar: () => {
            guardada = null;
            return Promise.resolve();
          },
        },
      },
    });

    const pendente = pedirConta().catch((e: unknown) => e);
    await vi.waitFor(() => expect(gravacoes).toBe(1));
    const login = autenticado.iniciarSessao(OUTRA);
    rejeitarPrimeira(new Error('Keychain cheio'));
    await login;
    await pendente;

    expect(falhas.map((f) => f.origem)).toEqual(['gravar_sessao']);
    expect(guardada).toEqual(OUTRA);
  });

  it('aoEncerrarSessao que lança na renovação recusada não troca o 401 original', async () => {
    const erroDoApp = new Error('falha ao limpar o cache');
    const { pedirConta, falhas, guardado } = montar({
      atendimento: nao401,
      inicial: SESSAO_1,
      ajustes: {
        aoEncerrarSessao: () => {
          throw erroDoApp;
        },
      },
    });

    const erro = await pedirConta().catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeApi);
    expect((erro as ErroDeApi).status).toBe(401);
    expect(falhas).toEqual([{ origem: 'aviso_de_encerramento', erro: erroDoApp }]);
    expect(guardado()).toBeNull();
  });

  it('limpar que falha na renovação recusada não troca o 401 original', async () => {
    const erroDoCofre = new Error('Keychain indisponível');
    const { pedirConta, falhas, encerramentos } = montar({
      atendimento: nao401,
      ajustes: {
        armazenamento: {
          ler: () => Promise.resolve(SESSAO_1),
          gravar: () => Promise.resolve(),
          limpar: () => Promise.reject(erroDoCofre),
        },
      },
    });

    await expect(pedirConta()).rejects.toMatchObject({ status: 401 });
    expect(falhas).toEqual([{ origem: 'limpar_sessao', erro: erroDoCofre }]);
    expect(encerramentos).toEqual(['renovacao_recusada']);
  });

  it('aoFalharEmSegundoPlano que lança também é descartado', async () => {
    const { pedirConta } = montar({
      atendimento: nao401,
      inicial: SESSAO_1,
      ajustes: {
        aoEncerrarSessao: () => {
          throw new Error('aviso');
        },
        aoFalharEmSegundoPlano: () => {
          throw new Error('observador');
        },
      },
    });

    await expect(pedirConta()).rejects.toMatchObject({ status: 401 });
  });

  it('aoEncerrarSessao que lança no logout não derruba o logout', async () => {
    const { autenticado, falhas, guardado } = montar({
      atendimento: () => resposta(204, ''),
      inicial: SESSAO_1,
      ajustes: {
        aoEncerrarSessao: () => {
          throw new Error('falha ao limpar o cache');
        },
      },
    });

    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: true });
    expect(falhas.map((f) => f.origem)).toEqual(['aviso_de_encerramento']);
    expect(guardado()).toBeNull();
  });
});
