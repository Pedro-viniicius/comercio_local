// API falsa para os testes do painel: um `fetch` que responde por "MÉTODO caminho", registra cada
// pedido (com `credentials` e cabeçalhos) e deixa o teste segurar uma resposta para conferir o que
// a tela mostra enquanto espera. Só usado nos testes; o build não o importa.
import type { RespostaMinima } from '@bairrin/cliente-api';
import type { FetchDoNavegador } from '../../sessao/autenticacao-do-painel.ts';

export const BASE_URL = 'https://api.teste.invalido';

export interface PedidoRegistrado {
  metodo: string;
  caminho: string;
  cabecalhos: Record<string, string>;
  corpo: unknown;
  credentials: RequestCredentials | undefined;
}

export type RespostaFalsa = { status: number; corpo?: unknown } | 'rede';
type Resposta = RespostaFalsa | Promise<RespostaFalsa>;

export interface ApiFalsa {
  fetch: FetchDoNavegador;
  pedidos: PedidoRegistrado[];
  /** Respostas em fila para a rota; a última se repete. */
  responder(rota: string, ...respostas: Resposta[]): void;
  /** Segura a próxima resposta da rota até o teste chamar a função devolvida. */
  segurar(rota: string): (resposta: RespostaFalsa) => void;
  pedidosDa(rota: string): PedidoRegistrado[];
}

export function problema(
  status: number,
  codigo: string,
  campos?: { campo: string; codigo: string; motivo: string }[],
) {
  return {
    status,
    corpo: {
      type: `urn:bairrin:erro:${codigo}`,
      title: 'Erro',
      status,
      codigo,
      idRequisicao: 'req-teste',
      ...(campos ? { campos } : {}),
    },
  };
}

export const SESSAO = {
  tokenAcesso: 'token-de-acesso-falso.abc',
  expiraEm: '2026-10-18T12:15:00Z',
  emailVerificado: true,
};

export const CONTA = { nome: 'Pedro', emailMascarado: 'p***@exemplo.com.br', perfis: ['admin'] };

function cabecalhosComoObjeto(cabecalhos: HeadersInit | undefined): Record<string, string> {
  return cabecalhos && !Array.isArray(cabecalhos) && !(cabecalhos instanceof Headers)
    ? { ...cabecalhos }
    : {};
}

export function criarApiFalsa(): ApiFalsa {
  const pedidos: PedidoRegistrado[] = [];
  const filas = new Map<string, Resposta[]>();

  const fetch: FetchDoNavegador = async (url, init) => {
    const caminho = url.slice(BASE_URL.length);
    const metodo = init.method ?? 'GET';
    pedidos.push({
      metodo,
      caminho,
      cabecalhos: cabecalhosComoObjeto(init.headers),
      corpo: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      credentials: init.credentials,
    });
    const fila = filas.get(`${metodo} ${caminho}`) ?? [];
    const proxima = fila.length > 1 ? fila.shift() : fila[0];
    const resposta = (await proxima) ?? { status: 599 };
    if (resposta === 'rede') throw new TypeError('Failed to fetch');
    const { status, corpo } = resposta;
    const final: RespostaMinima = {
      status,
      ok: status >= 200 && status < 300,
      text: () => Promise.resolve(corpo === undefined ? '' : JSON.stringify(corpo)),
    };
    return final;
  };

  return {
    fetch,
    pedidos,
    responder(rota, ...respostas) {
      filas.set(rota, respostas);
    },
    segurar(rota) {
      let liberar: (resposta: RespostaFalsa) => void = () => undefined;
      const segura = new Promise<RespostaFalsa>((resolver) => {
        liberar = resolver;
      });
      filas.set(rota, [segura, ...(filas.get(rota) ?? []).slice(-1)]);
      return (resposta) => liberar(resposta);
    },
    pedidosDa(rota) {
      return pedidos.filter((pedido) => `${pedido.metodo} ${pedido.caminho}` === rota);
    },
  };
}
