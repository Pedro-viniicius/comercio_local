// API falsa dos testes da sessão: o `fetch` injetado no `criarClienteApi`. Registra cada pedido
// (método, caminho, cabeçalhos e corpo) e responde pelo roteiro de cada teste.
import { criarClienteApi, type ClienteApi, type FetchInjetavel } from '@bairrin/cliente-api';

export const BASE_URL = 'https://api.exemplo.com.br';

export interface PedidoRecebido {
  metodo: string;
  caminho: string;
  cabecalhos: Record<string, string>;
  corpo: unknown;
}

export interface RespostaFalsa {
  status: number;
  corpo?: unknown;
}

/** Sem resposta: a rede caiu (o cliente devolve `ErroSemConexao`). */
export const SEM_REDE = Symbol('sem rede');

type Roteiro = (
  pedido: PedidoRecebido,
) => RespostaFalsa | typeof SEM_REDE | Promise<RespostaFalsa | typeof SEM_REDE>;

export interface ApiFalsa {
  cliente: ClienteApi;
  pedidos: PedidoRecebido[];
  /** `'<MÉTODO> <caminho>'`, ex.: `'POST /v1/sessoes'`. Sem roteiro, 404. */
  responder(rota: string, roteiro: Roteiro): void;
}

export function criarApiFalsa(): ApiFalsa {
  const pedidos: PedidoRecebido[] = [];
  const roteiros = new Map<string, Roteiro>();

  const buscar: FetchInjetavel = async (url, pedido) => {
    const caminho = url.slice(BASE_URL.length);
    const recebido: PedidoRecebido = {
      metodo: pedido.method,
      caminho,
      cabecalhos: { ...pedido.headers },
      corpo: pedido.body === undefined ? undefined : (JSON.parse(pedido.body) as unknown),
    };
    pedidos.push(recebido);
    const roteiro = roteiros.get(`${pedido.method} ${caminho}`);
    const resposta = roteiro === undefined ? { status: 404 } : await roteiro(recebido);
    if (resposta === SEM_REDE) throw new TypeError('Network request failed');
    return {
      status: resposta.status,
      ok: resposta.status >= 200 && resposta.status < 300,
      text: () =>
        Promise.resolve(resposta.corpo === undefined ? '' : JSON.stringify(resposta.corpo)),
    };
  };

  return {
    cliente: criarClienteApi({ baseUrl: BASE_URL, fetch: buscar }),
    pedidos,
    responder(rota, roteiro) {
      roteiros.set(rota, roteiro);
    },
  };
}

/** Promessa que o teste resolve quando quiser (para segurar uma resposta da API). */
export function adiada<T>(): { promessa: Promise<T>; resolver(valor: T): void } {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}
