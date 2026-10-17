// Configuração do logger (pino via nestjs-pino): JSON, um registro por
// requisição, sem corpo, sem cabeçalhos, URL sem query e redação de chaves
// sensíveis em todo objeto registrado e em todo vínculo de logger filho
// (CA-F3; S20). O texto do registro é só o que o código escreveu: sem a
// mensagem do erro nem argumentos interpolados (Seg-1), e trocado por um fixo
// quando tem cara de dado pessoal (S70).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import pino, {
  type Bindings,
  type DestinationStream,
  type LevelWithSilent,
  type LogFn,
  type Logger,
  type LoggerOptions,
} from 'pino';
import type { Options } from 'pino-http';
import type { Ambiente } from '../config/ambiente.ts';
import { obterIdRequisicao } from '../http/id-requisicao.middleware.ts';
import { redigir, resumirErro, type ResumoDeErro, urlSemQuery } from './redator.ts';

/** Nome do campo com o id da requisição em todo registro feito durante ela. */
export const CAMPO_ID_REQUISICAO = 'idRequisicao';

/**
 * Requisição como aparece no log: lista fechada, sem corpo nem cabeçalhos.
 * Valor que não é objeto (`{ req: null }`, `{ req: 'texto' }`) vira `{}`: o
 * serializador não lança e o valor não chega à linha.
 */
export function serializarRequisicao(req: unknown): { metodo?: string; url?: string } {
  if (typeof req !== 'object' || req === null) return {};
  const { method, url, originalUrl } = req as Partial<IncomingMessage> & { originalUrl?: unknown };
  const caminho = typeof originalUrl === 'string' ? originalUrl : url;
  return {
    metodo: typeof method === 'string' ? method : undefined,
    url: typeof caminho === 'string' ? urlSemQuery(caminho) : undefined,
  };
}

/**
 * Resposta como aparece no log: só o status (cabeçalhos podem ter `set-cookie`).
 * Valor que não é objeto vira `{}`, como em `serializarRequisicao`.
 */
export function serializarResposta(res: unknown): { status?: number } {
  if (typeof res !== 'object' || res === null) return {};
  const { statusCode } = res as Partial<ServerResponse>;
  return { status: typeof statusCode === 'number' ? statusCode : undefined };
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

/** Texto do registro feito sem texto (só com objeto ou só com erro). */
export const TEXTO_SEM_MENSAGEM = 'sem mensagem';

/**
 * Texto do registro que tem cara de dado pessoal (S70): defesa em profundidade
 * para o texto montado antes da chamada, que a regra de lint não vê
 * (`const texto = ...; logger.info(texto)`). Pega três formas:
 * - `@`, de e-mail;
 * - 6 dígitos ou mais, seguidos ou separados só por espaço, `(`, `)`, `.`, `/`
 *   ou `-`: telefone (`(35) 99876-5432`, `+55 35 99876 5432`), CPF
 *   (`123.456.789-09`), CNPJ, CEP sem hífen e código de verificação
 *   (`12 34 56`). Data com hífen (`2026-10-16`) também cai aqui: descartar um
 *   texto fixo é aceitável, vazar o dado não;
 * - quebra de linha (`\n`, `\r`, U+2028 e U+2029): texto fixo tem uma linha
 *   só, e a pilha de um erro (`erro.stack`) começa pela mensagem dele.
 * Nome, endereço e documento escrito por extenso não são pegos: ficam com a
 * regra de lint e com a revisão.
 *
 * Sem ReDoS: dígito e separador são classes disjuntas, então cada caractere
 * do texto só tem um jeito de ser lido, e a busca é linear no tamanho dele.
 */
export const TEXTO_DESCARTADO = 'texto descartado';
const TEXTO_COM_CARA_DE_DADO = /@|\d(?:[\s()./-]*\d){5,}|[\n\r\u2028\u2029]/;

/** O texto como vai para a linha: o recebido, ou `TEXTO_DESCARTADO`. */
function textoDoLog(texto: string): string {
  return TEXTO_COM_CARA_DE_DADO.test(texto) ? TEXTO_DESCARTADO : texto;
}

/**
 * Contexto do nestjs-pino (chave `context`) que não é um nome curto de
 * identificador. Os hooks de encerramento do Nest chamam
 * `Logger.error(erro, erro.stack)` sem contexto, e o nestjs-pino toma o último
 * argumento (a pilha, com a mensagem) como contexto (S35b); um contexto de uma
 * linha também pode trazer um dado (`fulano@exemplo.com`, um telefone), P8.
 */
export const CONTEXTO_DESCARTADO = 'contexto descartado';
const TAMANHO_MAXIMO_DO_CONTEXTO = 80;
/**
 * Nome de classe ou de módulo (`ExceptionsHandler`, `Identidade.Sessoes:renovar`):
 * começa com letra e só tem letra, dígito, `_`, `.`, `:` e `-`. Sem a flag `m`,
 * o `$` só casa no fim do texto, então quebra de linha também fica de fora.
 */
const FORMATO_DO_CONTEXTO = /^[A-Za-z][\w.:-]*$/;

/**
 * Contexto aceito como veio: ausente ou nome de identificador com até 80
 * caracteres. Vale para o objeto do registro e para os vínculos de filho
 * (`child`, `setBindings`), Q16.
 */
function ehContextoAceito(contexto: unknown): boolean {
  return (
    contexto === undefined ||
    (typeof contexto === 'string' &&
      contexto.length <= TAMANHO_MAXIMO_DO_CONTEXTO &&
      FORMATO_DO_CONTEXTO.test(contexto))
  );
}

/**
 * Objeto do registro, sem alterar o recebido (só copia quando precisa mexer):
 * - `Error` vira `{ err }` e vai para `serializarErro`;
 * - a chave própria `msg` sai: o pino a escreveria crua, ao lado do texto,
 *   e a linha teria dois `"msg"` (R12). A `message` fica com o redator;
 * - `context` que não passa em `ehContextoAceito` vira `CONTEXTO_DESCARTADO`.
 * A cópia leva só as propriedades próprias enumeráveis, as mesmas que o
 * redator percorre. Objeto que não pode ser lido vira `{}`: o log não lança.
 */
function objetoDoLog(objeto: object): object {
  if (objeto instanceof Error) return { err: objeto };
  try {
    const comMsg = Object.hasOwn(objeto, 'msg');
    const contextoRecusado =
      Object.hasOwn(objeto, 'context') &&
      !ehContextoAceito((objeto as { context?: unknown }).context);
    if (!comMsg && !contextoRecusado) return objeto;
    const copia: Record<string, unknown> = { ...objeto };
    delete copia['msg'];
    if (contextoRecusado) copia['context'] = CONTEXTO_DESCARTADO;
    return copia;
  } catch {
    // Getter que lança ou proxy revogado: o registro sai só com o texto.
    return {};
  }
}

/**
 * Argumentos de toda chamada de log, antes do pino (Seg-1). O texto (`msg`)
 * não passa pelo redator; sem esta troca, o pino põe nele `erro.message`
 * quando o registro vem sem texto (`error(erro)`, `error({ err })` e o
 * `isWrongExceptionsHandlerContract` do nestjs-pino) e interpola nele os
 * argumentos que vêm depois (`info('conta %s', email)`).
 * - o objeto do primeiro argumento passa por `objetoDoLog` (`Error`, `msg`
 *   e `context`);
 * - sem texto, ou com texto que não é string, o texto é `TEXTO_SEM_MENSAGEM`;
 * - texto com cara de dado pessoal vira `TEXTO_DESCARTADO` (`textoDoLog`);
 * - argumentos depois do texto são descartados.
 * O texto montado antes da chamada continua com quem escreve (regra de lint);
 * esta troca só pega o que tem cara de e-mail, de número ou de pilha.
 */
function normalizarArgumentosDoLog(
  argumentos: readonly unknown[],
): [objeto: object, texto: string] | [texto: string] {
  const [primeiro, segundo] = argumentos;
  if (typeof primeiro === 'object' && primeiro !== null) {
    return [
      objetoDoLog(primeiro),
      typeof segundo === 'string' ? textoDoLog(segundo) : TEXTO_SEM_MENSAGEM,
    ];
  }
  // `info(null, 'texto')` e `info(undefined, 'texto')`: o pino usa o segundo.
  const texto = primeiro === undefined || primeiro === null ? segundo : primeiro;
  return [typeof texto === 'string' ? textoDoLog(texto) : TEXTO_SEM_MENSAGEM];
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
    hooks: {
      // Vale para a raiz e para todo filho (o pino guarda o gancho na raiz).
      logMethod(argumentos, metodo) {
        metodo.apply(this, normalizarArgumentosDoLog(argumentos) as Parameters<LogFn>);
      },
    },
  };
}

/**
 * Vínculos de logger filho como vão para a linha: redigidos e com `context`
 * fora de `ehContextoAceito` trocado por `CONTEXTO_DESCARTADO` (Q16), como no
 * objeto do registro. O redator devolve cópia de objeto comum: ler `context`
 * dela não chama getter de quem registrou.
 */
function vinculosDoLog(vinculos: Bindings): Bindings {
  const redigidos = redigirParaLog(vinculos);
  if (
    typeof redigidos !== 'object' ||
    redigidos === null ||
    !Object.hasOwn(redigidos, 'context') ||
    ehContextoAceito(redigidos['context'])
  ) {
    return redigidos;
  }
  return { ...redigidos, context: CONTEXTO_DESCARTADO };
}

/**
 * O pino só passa pelo formatador `bindings` os vínculos do logger raiz: os de
 * `child()` (o id da requisição, o `assign` do nestjs-pino) e os de
 * `setBindings()` num filho vão direto para a linha. Os dois métodos são
 * trocados no logger raiz por versões que passam antes por `vinculosDoLog`;
 * os filhos são criados com `Object.create(pai)` e herdam a troca.
 */
function redigirVinculosDosFilhos(raiz: Logger): void {
  // Os originais do pino são chamados com o `this` de quem os chama (o filho,
  // o neto...), não com o da raiz: por isso não vão com `bind`.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const filhoDoPino = raiz.child;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const vincularDoPino = raiz.setBindings;
  raiz.child = function (this: Logger, vinculos: Bindings, opcoes?: object) {
    return filhoDoPino.call(this, vinculosDoLog(vinculos), opcoes);
  } as Logger['child'];
  raiz.setBindings = function (this: Logger, vinculos: Bindings) {
    vincularDoPino.call(this, vinculosDoLog(vinculos));
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
