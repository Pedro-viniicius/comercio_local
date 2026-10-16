import { afterEach, describe, expect, it, vi } from 'vitest';
import { TIPO_DE_CONTEUDO_PROBLEMA, z } from '@bairrin/contratos';
import {
  criarClienteApi,
  ErroCancelado,
  ErroDeApi,
  ErroRespostaInvalida,
  ErroSemConexao,
  CODIGO_ERRO_GENERICO,
  TEMPO_LIMITE_PADRAO_MS,
  type FetchInjetavel,
  type PedidoMinimo,
  type RespostaMinima,
  type SinalDeCancelamento,
} from './index.ts';

// O tsconfig do pacote não traz os tipos de DOM nem de Node.
declare const AbortController: new () => { signal: SinalDeCancelamento; abort(): void };

const BASE = 'https://api.teste';

function resposta(status: number, corpo: string): RespostaMinima {
  return { status, ok: status >= 200 && status < 300, text: () => Promise.resolve(corpo) };
}

function json(status: number, valor: unknown): RespostaMinima {
  return resposta(status, JSON.stringify(valor));
}

/** Fetch falso que atende com `resposta` e guarda as chamadas. */
function fetchFalso(atendimento: RespostaMinima | (() => Promise<RespostaMinima>)) {
  const chamadas: { url: string; pedido: PedidoMinimo }[] = [];
  const falso: FetchInjetavel = (url, pedido) => {
    chamadas.push({ url, pedido });
    return typeof atendimento === 'function' ? atendimento() : Promise.resolve(atendimento);
  };
  return { fetch: falso, chamadas };
}

/** Fetch que nunca responde sozinho: só rejeita quando o sinal aborta (como o real). */
function fetchPendente() {
  const falso: FetchInjetavel = (_url, pedido) =>
    new Promise<RespostaMinima>((_resolver, rejeitar) => {
      pedido.signal.addEventListener('abort', () => rejeitar(new Error('abortado')), {
        once: true,
      });
    });
  return falso;
}

const problema = {
  type: 'urn:bairrin:erro:validacao',
  title: 'Dados inválidos',
  status: 400,
  codigo: 'validacao',
  campos: [{ campo: 'telefone', codigo: 'invalido', motivo: 'Telefone inválido' }],
  idRequisicao: 'req-123',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('consultarSaude', () => {
  it('chama GET /v1/saude e devolve o corpo validado', async () => {
    const { fetch, chamadas } = fetchFalso(json(200, { status: 'ok', versao: '0.0.0' }));
    const cliente = criarClienteApi({ baseUrl: `${BASE}/`, fetch });

    await expect(cliente.consultarSaude()).resolves.toEqual({ status: 'ok', versao: '0.0.0' });

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toBe(`${BASE}/v1/saude`);
    expect(chamadas[0]?.pedido.method).toBe('GET');
    expect(chamadas[0]?.pedido.headers['Accept']).toContain(TIPO_DE_CONTEUDO_PROBLEMA);
    expect(chamadas[0]?.pedido.body).toBeUndefined();
  });

  it('aceita saúde sem versão (produção)', async () => {
    const { fetch } = fetchFalso(json(200, { status: 'ok' }));
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });
    await expect(cliente.consultarSaude()).resolves.toEqual({ status: 'ok' });
  });

  it('2xx fora do contrato vira ErroRespostaInvalida sem expor o corpo', async () => {
    const { fetch } = fetchFalso(
      json(200, { status: 'quebrado', segredo: 'telefone 35999990000' }),
    );
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });

    const erro = await cliente.consultarSaude().catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroRespostaInvalida);
    expect((erro as ErroRespostaInvalida).status).toBe(200);
    expect(String((erro as Error).message)).not.toContain('35999990000');
  });

  it('2xx com corpo que não é JSON vira ErroRespostaInvalida', async () => {
    const { fetch } = fetchFalso(resposta(200, '<html>proxy</html>'));
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });
    await expect(cliente.consultarSaude()).rejects.toBeInstanceOf(ErroRespostaInvalida);
  });
});

describe('requisitar', () => {
  const esquema = z.object({ id: z.string() });

  it('envia corpo JSON e cabeçalhos do chamador', async () => {
    const { fetch, chamadas } = fetchFalso(json(201, { id: 'abc' }));
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });

    const resultado = await cliente.requisitar({
      metodo: 'POST',
      caminho: 'v1/coisas',
      esquema,
      corpo: { nome: 'x' },
      cabecalhos: { 'Idempotency-Key': 'chave-1' },
    });

    expect(resultado).toEqual({ id: 'abc' });
    expect(chamadas[0]?.url).toBe(`${BASE}/v1/coisas`);
    expect(chamadas[0]?.pedido.method).toBe('POST');
    expect(chamadas[0]?.pedido.body).toBe('{"nome":"x"}');
    expect(chamadas[0]?.pedido.headers['Content-Type']).toBe('application/json');
    expect(chamadas[0]?.pedido.headers['Idempotency-Key']).toBe('chave-1');
  });

  it('corpo vazio com esquema que aceita undefined resolve (ex.: 204)', async () => {
    const { fetch } = fetchFalso(resposta(204, ''));
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });
    await expect(
      cliente.requisitar({ metodo: 'DELETE', caminho: '/v1/coisas/1', esquema: z.undefined() }),
    ).resolves.toBeUndefined();
  });

  it('exige baseUrl', () => {
    expect(() => criarClienteApi({ baseUrl: ' ' })).toThrow();
  });
});

describe('erros da API', () => {
  it('Problem Details vira ErroDeApi com status, codigo, campos e idRequisicao', async () => {
    const { fetch } = fetchFalso(json(400, problema));
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });

    const erro = await cliente.consultarSaude().catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeApi);
    const api = erro as ErroDeApi;
    expect(api.status).toBe(400);
    expect(api.codigo).toBe('validacao');
    expect(api.campos).toEqual(problema.campos);
    expect(api.idRequisicao).toBe('req-123');
    expect(api.problema).toEqual(problema);
  });

  it('Problem Details de API mais nova (campos e código desconhecidos) ainda é entendido', async () => {
    const { fetch } = fetchFalso(
      json(409, { ...problema, status: 409, codigo: 'codigo_futuro', novo: { a: 1 } }),
    );
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });
    const erro = (await cliente.consultarSaude().catch((e: unknown) => e)) as ErroDeApi;
    expect(erro).toBeInstanceOf(ErroDeApi);
    expect(erro.codigo).toBe('codigo_futuro');
  });

  it('campo com código que o app não conhece mantém campos e idRequisicao (ADR-010)', async () => {
    const campos = [
      { campo: 'telefone', codigo: 'codigo_de_campo_futuro', motivo: 'Telefone já usado' },
      { campo: 'nome', codigo: 'obrigatorio', motivo: 'Campo obrigatório.', extra: true },
    ];
    const { fetch } = fetchFalso(json(400, { ...problema, campos }));
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });

    const erro = (await cliente.consultarSaude().catch((e: unknown) => e)) as ErroDeApi;

    expect(erro).toBeInstanceOf(ErroDeApi);
    expect(erro.codigo).toBe('validacao');
    expect(erro.idRequisicao).toBe('req-123');
    expect(erro.campos.map(({ campo, codigo, motivo }) => ({ campo, codigo, motivo }))).toEqual([
      { campo: 'telefone', codigo: 'codigo_de_campo_futuro', motivo: 'Telefone já usado' },
      { campo: 'nome', codigo: 'obrigatorio', motivo: 'Campo obrigatório.' },
    ]);
  });

  it('erro não JSON vira ErroDeApi genérico', async () => {
    const { fetch } = fetchFalso(resposta(502, '<html>Bad Gateway</html>'));
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });

    const erro = (await cliente.consultarSaude().catch((e: unknown) => e)) as ErroDeApi;

    expect(erro).toBeInstanceOf(ErroDeApi);
    expect(erro.status).toBe(502);
    expect(erro.codigo).toBe(CODIGO_ERRO_GENERICO);
    expect(erro.campos).toEqual([]);
    expect(erro.idRequisicao).toBeUndefined();
    expect(erro.problema).toBeUndefined();
    expect(erro.message).not.toContain('Bad Gateway');
  });

  it('erro JSON sem formato de Problem Details vira ErroDeApi genérico', async () => {
    const { fetch } = fetchFalso(json(500, { message: 'falhou', detalhe: 'x' }));
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });
    const erro = (await cliente.consultarSaude().catch((e: unknown) => e)) as ErroDeApi;
    expect(erro).toBeInstanceOf(ErroDeApi);
    expect(erro.status).toBe(500);
    expect(erro.codigo).toBe(CODIGO_ERRO_GENERICO);
  });

  it('erro com corpo vazio vira ErroDeApi genérico', async () => {
    const { fetch } = fetchFalso(resposta(503, ''));
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });
    const erro = (await cliente.consultarSaude().catch((e: unknown) => e)) as ErroDeApi;
    expect(erro).toBeInstanceOf(ErroDeApi);
    expect(erro.status).toBe(503);
  });

  it('erro de API não é "sem conexão"', async () => {
    const { fetch } = fetchFalso(json(503, { ...problema, status: 503, codigo: 'indisponivel' }));
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });
    await expect(cliente.consultarSaude()).rejects.not.toBeInstanceOf(ErroSemConexao);
  });
});

describe('sem conexão, tempo limite e cancelamento', () => {
  it('falha de rede vira ErroSemConexao (rede) e guarda a causa', async () => {
    const causa = new TypeError('Network request failed');
    const { fetch } = fetchFalso(() => Promise.reject(causa));
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });

    const erro = (await cliente.consultarSaude().catch((e: unknown) => e)) as ErroSemConexao;

    expect(erro).toBeInstanceOf(ErroSemConexao);
    expect(erro.motivo).toBe('rede');
    expect(erro.cause).toBe(causa);
  });

  it('falha ao ler o corpo vira ErroSemConexao (rede)', async () => {
    const { fetch } = fetchFalso(() =>
      Promise.resolve({ status: 200, ok: true, text: () => Promise.reject(new Error('cortou')) }),
    );
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });
    await expect(cliente.consultarSaude()).rejects.toMatchObject({ motivo: 'rede' });
  });

  it('estourar 10 s vira ErroSemConexao (tempo_esgotado) e aborta o fetch', async () => {
    vi.useFakeTimers();
    let sinal: PedidoMinimo['signal'] | undefined;
    const pendente = fetchPendente();
    const cliente = criarClienteApi({
      baseUrl: BASE,
      fetch: (url, pedido) => {
        sinal = pedido.signal;
        return pendente(url, pedido);
      },
    });

    const resultado = cliente.consultarSaude().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_PADRAO_MS - 1);
    expect(sinal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const erro = (await resultado) as ErroSemConexao;
    expect(TEMPO_LIMITE_PADRAO_MS).toBe(10_000);
    expect(erro).toBeInstanceOf(ErroSemConexao);
    expect(erro.motivo).toBe('tempo_esgotado');
    expect(sinal?.aborted).toBe(true);
  });

  it('estoura o tempo mesmo se o fetch ignorar o sinal', async () => {
    vi.useFakeTimers();
    const cliente = criarClienteApi({
      baseUrl: BASE,
      tempoLimiteMs: 500,
      fetch: () => new Promise<RespostaMinima>(() => undefined),
    });
    const resultado = cliente.consultarSaude().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(500);
    expect(await resultado).toMatchObject({ motivo: 'tempo_esgotado' });
  });

  it('estoura o tempo também durante a leitura do corpo', async () => {
    vi.useFakeTimers();
    const { fetch } = fetchFalso(() =>
      Promise.resolve({ status: 200, ok: true, text: () => new Promise<string>(() => undefined) }),
    );
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });
    const resultado = cliente.consultarSaude().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_PADRAO_MS);
    expect(await resultado).toMatchObject({ motivo: 'tempo_esgotado' });
  });

  it('resposta dentro do prazo não deixa temporizador pendente', async () => {
    vi.useFakeTimers();
    const { fetch } = fetchFalso(json(200, { status: 'ok' }));
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });
    await cliente.consultarSaude();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancelamento pelo chamador vira ErroCancelado, não tempo limite nem sem conexão', async () => {
    vi.useFakeTimers();
    const chamador = new AbortController();
    const cliente = criarClienteApi({ baseUrl: BASE, fetch: fetchPendente() });

    const resultado = cliente.consultarSaude({ sinal: chamador.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    chamador.abort();

    const erro = await resultado;
    expect(erro).toBeInstanceOf(ErroCancelado);
    expect(erro).not.toBeInstanceOf(ErroSemConexao);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sinal já cancelado não chama o fetch', async () => {
    const chamador = new AbortController();
    chamador.abort();
    const { fetch, chamadas } = fetchFalso(json(200, { status: 'ok' }));
    const cliente = criarClienteApi({ baseUrl: BASE, fetch });

    await expect(cliente.consultarSaude({ sinal: chamador.signal })).rejects.toBeInstanceOf(
      ErroCancelado,
    );
    expect(chamadas).toHaveLength(0);
  });
});
