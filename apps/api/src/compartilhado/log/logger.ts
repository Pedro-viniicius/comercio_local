// Configuração do logger (pino via nestjs-pino): JSON, um registro por
// requisição, sem corpo, sem cabeçalhos, URL sem query e redação de chaves
// sensíveis em todo objeto registrado e em todo vínculo de logger filho
// (CA-F3; S20).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import pino, {
  type Bindings,
  type DestinationStream,
  type LevelWithSilent,
  type Logger,
  type LoggerOptions,
} from 'pino';
import type { Options } from 'pino-http';
import type { Ambiente } from '../config/ambiente.ts';
import { obterIdRequisicao } from '../http/id-requisicao.middleware.ts';
import { redigir, resumirErro, type ResumoDeErro, urlSemQuery } from './redator.ts';

/** Nome do campo com o id da requisição em todo registro feito durante ela. */
export const CAMPO_ID_REQUISICAO = 'idRequisicao';

/** Requisição como aparece no log: lista fechada, sem corpo nem cabeçalhos. */
export function serializarRequisicao(req: IncomingMessage): { metodo?: string; url?: string } {
  const original = (req as IncomingMessage & { originalUrl?: unknown }).originalUrl;
  const url = typeof original === 'string' ? original : req.url;
  return { metodo: req.method, url: url === undefined ? undefined : urlSemQuery(url) };
}

/** Resposta como aparece no log: só o status (cabeçalhos podem ter `set-cookie`). */
export function serializarResposta(res: ServerResponse): { status: number } {
  return { status: res.statusCode };
}

/**
 * Erro como aparece no log: tipo, código e quadros da pilha (`resumirErro`).
 * A mensagem fica de fora de propósito: a de biblioteca de banco costuma
 * trazer os parâmetros da query, e a do `JSON.parse` traz trecho da entrada.
 */
export function serializarErro(erro: unknown): ResumoDeErro {
  return resumirErro(erro);
}

/**
 * Chaves com serializador próprio, de lista fechada. Os formatadores do pino
 * rodam antes dos serializadores (recebem `IncomingMessage` e `Error` crus):
 * por isso essas chaves, só no primeiro nível, passam intactas pelo redator.
 */
const CHAVES_COM_SERIALIZADOR = ['req', 'res', 'err'] as const;

/** Redator aplicado a todo objeto registrado e a todo vínculo de logger. */
function redigirParaLog<T>(objeto: T): T {
  return redigir(objeto, { chavesIntactas: CHAVES_COM_SERIALIZADOR });
}

/** 5xx e erro viram `error`; 4xx, `warn`; o resto, `info`. */
function nivelDaRequisicao(
  _req: IncomingMessage,
  res: ServerResponse,
  erro?: Error,
): LevelWithSilent {
  if (erro || res.statusCode >= 500) return 'error';
  if (res.statusCode >= 400) return 'warn';
  return 'info';
}

/** Opções do pino (logger raiz), separadas para os testes. */
export function opcoesDoPino(ambiente: Pick<Ambiente, 'LOG_NIVEL'>): LoggerOptions {
  return {
    level: ambiente.LOG_NIVEL,
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: {
      level: (rotulo) => ({ level: rotulo }),
      bindings: (vinculos) => redigirParaLog(vinculos),
      log: (objeto) => redigirParaLog(objeto),
    },
    serializers: { req: serializarRequisicao, res: serializarResposta, err: serializarErro },
  };
}

/**
 * O pino só passa pelo formatador `bindings` os vínculos do logger raiz: os de
 * `child()` (o id da requisição, o `assign` do nestjs-pino) e os de
 * `setBindings()` num filho vão direto para a linha. Os dois métodos são
 * trocados no logger raiz por versões que redigem antes; os filhos são criados
 * com `Object.create(pai)` e herdam a troca.
 */
function redigirVinculosDosFilhos(raiz: Logger): void {
  // Os originais do pino são chamados com o `this` de quem os chama (o filho,
  // o neto...), não com o da raiz: por isso não vão com `bind`.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const filhoDoPino = raiz.child;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const vincularDoPino = raiz.setBindings;
  raiz.child = function (this: Logger, vinculos: Bindings, opcoes?: object) {
    return filhoDoPino.call(this, redigirParaLog(vinculos), opcoes);
  } as Logger['child'];
  raiz.setBindings = function (this: Logger, vinculos: Bindings) {
    vincularDoPino.call(this, redigirParaLog(vinculos));
  };
}

/**
 * Logger raiz da aplicação. `destino` só é passado nos testes, para capturar
 * as linhas; sem ele, o pino escreve na saída padrão.
 */
export function criarLoggerDaAplicacao(
  ambiente: Pick<Ambiente, 'LOG_NIVEL'>,
  destino?: DestinationStream,
): Logger {
  const opcoes = opcoesDoPino(ambiente);
  const raiz = destino ? pino(opcoes, destino) : pino(opcoes);
  redigirVinculosDosFilhos(raiz);
  return raiz;
}

/** Opções do pino-http sobre o logger raiz já montado. */
export function opcoesDoPinoHttp(logger: Logger): Options {
  return {
    logger,
    // Serializadores próprios recebem o objeto cru (sem o `req` padrão do
    // pino-std-serializers, que traz cabeçalhos, query e IP).
    wrapSerializers: false,
    genReqId: (req, res) => obterIdRequisicao(req, res),
    customAttributeKeys: { reqId: CAMPO_ID_REQUISICAO },
    // Registros feitos durante a requisição levam só o id; o de conclusão
    // leva também método, URL, status e tempo.
    quietReqLogger: true,
    customLogLevel: nivelDaRequisicao,
    customSuccessMessage: () => 'requisição concluída',
    customErrorMessage: () => 'requisição com erro',
  };
}

/** Parâmetros do `LoggerModule`. `destino` só é passado nos testes. */
export function parametrosDoLogger(
  ambiente: Pick<Ambiente, 'LOG_NIVEL'>,
  destino?: DestinationStream,
): Params {
  return { pinoHttp: opcoesDoPinoHttp(criarLoggerDaAplicacao(ambiente, destino)) };
}
