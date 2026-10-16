// Cliente HTTP tipado pelos contratos (ADR-010). Usa o `fetch` global (React
// Native, navegador e Node 22), injetável nos testes. Não registra nada em log.
import {
  problemaSchema,
  saudeSchema,
  TIPO_DE_CONTEUDO_PROBLEMA,
  type Saude,
  type z,
} from '@bairrin/contratos';
import { ErroCancelado, ErroDeApi, ErroRespostaInvalida, ErroSemConexao } from './erros.ts';

export const TEMPO_LIMITE_PADRAO_MS = 10_000;

// O tsconfig da fundação não inclui os tipos de DOM nem de Node (`lib` ES2023,
// `types: []`). Estas interfaces cobrem só o que o cliente usa e valem em
// qualquer ambiente; os globais abaixo são resolvidos em tempo de execução.
export interface SinalDeCancelamento {
  readonly aborted: boolean;
  addEventListener(tipo: 'abort', ouvinte: () => void, opcoes?: { once?: boolean }): void;
  removeEventListener(tipo: 'abort', ouvinte: () => void): void;
}

interface ControladorDeCancelamento {
  readonly signal: SinalDeCancelamento;
  abort(): void;
}

export interface RespostaMinima {
  readonly status: number;
  readonly ok: boolean;
  text(): Promise<string>;
}

export interface PedidoMinimo {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: SinalDeCancelamento;
}

export type FetchInjetavel = (url: string, pedido: PedidoMinimo) => Promise<RespostaMinima>;

declare const AbortController: { new (): ControladorDeCancelamento };
declare const fetch: FetchInjetavel;
declare function setTimeout(funcao: () => void, ms: number): unknown;
declare function clearTimeout(id: unknown): void;

export interface OpcoesDoCliente {
  /** URL base da API, sem o prefixo de versão (ex.: `https://api.exemplo.com.br`). */
  baseUrl: string;
  /** Padrão: o `fetch` global. */
  fetch?: FetchInjetavel;
  /** Padrão: 10 s. Cobre a resposta inteira, corpo incluído. */
  tempoLimiteMs?: number;
}

export interface OpcoesDeRequisicao<T> {
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Caminho com o prefixo de versão, ex.: `/v1/saude`. */
  caminho: string;
  /** Esquema zod da resposta 2xx. */
  esquema: z.ZodType<T, unknown>;
  /** Corpo JSON (escritas). */
  corpo?: unknown;
  /** Ex.: `Authorization`, `Idempotency-Key`. Não são registrados em lugar nenhum. */
  cabecalhos?: Record<string, string>;
  /** Cancelamento pelo chamador (troca de tela, por exemplo). */
  sinal?: SinalDeCancelamento;
}

export interface ClienteApi {
  /** Chamada genérica; devolve o corpo validado pelo esquema ou lança `ErroDoCliente`. */
  requisitar<T>(opcoes: OpcoesDeRequisicao<T>): Promise<T>;
  /** `GET /v1/saude`. */
  consultarSaude(opcoes?: { sinal?: SinalDeCancelamento }): Promise<Saude>;
}

function juntarUrl(baseUrl: string, caminho: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${caminho.replace(/^\/+/, '')}`;
}

function lerJson(texto: string): unknown {
  if (texto.trim() === '') return undefined;
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}

/** Resolve com o resultado de `operacao` ou rejeita quando o sinal aborta, mesmo que o `fetch` ignore o sinal. */
function comAborto<T>(operacao: Promise<T>, sinal: SinalDeCancelamento): Promise<T> {
  return new Promise<T>((resolver, rejeitar) => {
    const aoAbortar = (): void => rejeitar(new ErroCancelado());
    if (sinal.aborted) {
      aoAbortar();
      return;
    }
    sinal.addEventListener('abort', aoAbortar, { once: true });
    operacao.then(
      (valor) => {
        sinal.removeEventListener('abort', aoAbortar);
        resolver(valor);
      },
      (erro: unknown) => {
        sinal.removeEventListener('abort', aoAbortar);
        rejeitar(erro instanceof Error ? erro : new Error('Falha desconhecida', { cause: erro }));
      },
    );
  });
}

export function criarClienteApi(opcoes: OpcoesDoCliente): ClienteApi {
  const { baseUrl } = opcoes;
  if (baseUrl.trim() === '') throw new Error('baseUrl do cliente da API é obrigatória');
  const tempoLimiteMs = opcoes.tempoLimiteMs ?? TEMPO_LIMITE_PADRAO_MS;
  const buscar: FetchInjetavel = opcoes.fetch ?? ((url, pedido) => fetch(url, pedido));

  async function requisitar<T>(pedido: OpcoesDeRequisicao<T>): Promise<T> {
    const { sinal } = pedido;
    if (sinal?.aborted) throw new ErroCancelado();

    const controlador = new AbortController();
    let tempoEsgotado = false;
    const aoCancelarPeloChamador = (): void => controlador.abort();
    sinal?.addEventListener('abort', aoCancelarPeloChamador, { once: true });
    const temporizador = setTimeout(() => {
      tempoEsgotado = true;
      controlador.abort();
    }, tempoLimiteMs);

    const cabecalhos: Record<string, string> = {
      Accept: `application/json, ${TIPO_DE_CONTEUDO_PROBLEMA}`,
      ...(pedido.corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...pedido.cabecalhos,
    };

    let status: number;
    let ok: boolean;
    let texto: string;
    try {
      const resposta = await comAborto(
        buscar(juntarUrl(baseUrl, pedido.caminho), {
          method: pedido.metodo ?? 'GET',
          headers: cabecalhos,
          ...(pedido.corpo === undefined ? {} : { body: JSON.stringify(pedido.corpo) }),
          signal: controlador.signal,
        }),
        controlador.signal,
      );
      status = resposta.status;
      ok = resposta.ok;
      texto = await comAborto(resposta.text(), controlador.signal);
    } catch (erro) {
      // O motivo do aborto decide o tipo: tempo limite tem prioridade só se foi ele quem disparou.
      if (tempoEsgotado) throw new ErroSemConexao('tempo_esgotado', { cause: erro });
      if (sinal?.aborted) throw new ErroCancelado();
      throw new ErroSemConexao('rede', { cause: erro });
    } finally {
      clearTimeout(temporizador);
      sinal?.removeEventListener('abort', aoCancelarPeloChamador);
    }

    const corpo = lerJson(texto);
    if (!ok) {
      const problema = problemaSchema.safeParse(corpo);
      throw new ErroDeApi({ status, ...(problema.success ? { problema: problema.data } : {}) });
    }
    const validado = pedido.esquema.safeParse(corpo);
    if (!validado.success) throw new ErroRespostaInvalida(status);
    return validado.data;
  }

  return {
    requisitar,
    consultarSaude: (extras) =>
      requisitar({
        caminho: '/v1/saude',
        esquema: saudeSchema,
        ...(extras?.sinal ? { sinal: extras.sinal } : {}),
      }),
  };
}
