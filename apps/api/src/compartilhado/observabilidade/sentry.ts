// Sentry na API e no worker (S10): só liga se `SENTRY_DSN` existir. Tudo o que
// sai para o Sentry passa pelo mesmo redator dos logs (`log/redator.ts`), sem
// dado pessoal, sem IP, sem corpo, cabeçalhos, cookies ou query string.
//
// O SDK 11 trocou `sendDefaultPii` por `dataCollection` e, sem configuração,
// coleta TUDO (usuário e IP, cookies, cabeçalhos, corpos, query, dados de
// consulta ao banco, variáveis locais). Por isso cada categoria é desligada
// aqui de forma explícita: é o equivalente ao `sendDefaultPii: false` do plano.
// Não há Replay no SDK de Node; o teste confere que nenhuma integração com esse
// nome entra. Só erros: sem tracing (sem `tracesSampleRate`).
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { catchError, type Observable, throwError } from 'rxjs';
import type { Ambiente } from '../config/ambiente.ts';
import { classificarExcecao } from '../http/filtro-de-erros.ts';
import { redigir, urlSemQuery, VALOR_REDIGIDO } from '../log/redator.ts';

/**
 * Integrações padrão que ficam de fora: `Console` vira breadcrumb tudo o que
 * passa pelo `console` (o log da aplicação é o pino, já redigido) e
 * `LocalVariablesAsync` anexa variáveis locais aos quadros da pilha.
 */
export const INTEGRACOES_DESLIGADAS: readonly string[] = ['Console', 'LocalVariablesAsync'];

/** Nada de dado pessoal coletado pelo SDK (S10). */
export const COLETA_DE_DADOS: Sentry.NodeOptions['dataCollection'] = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

/** Mantém só o id pseudônimo do usuário (uuid, a partir do 01b); o resto sai, IP incluso. */
function usuarioSemDadoPessoal(usuario: Sentry.User | undefined): Sentry.User | undefined {
  const id = usuario?.id;
  return typeof id === 'string' || typeof id === 'number' ? { id } : undefined;
}

function redigirRegistro<T extends Record<string, unknown>>(valor: T | undefined): T | undefined {
  return valor === undefined ? undefined : redigir(valor);
}

/**
 * Breadcrumb sem dado pessoal: descarta os do `console` e tira a query de
 * qualquer URL (requisições de saída do `http` e do `fetch`).
 */
export function redigirBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (breadcrumb.category === 'console') return null;
  const dados = breadcrumb.data === undefined ? undefined : { ...breadcrumb.data };
  if (dados !== undefined) {
    if (typeof dados['url'] === 'string') dados['url'] = urlSemQuery(dados['url']);
    delete dados['http.query'];
    delete dados['http.fragment'];
  }
  return {
    ...breadcrumb,
    ...(typeof breadcrumb.message === 'string' ? { message: urlSemQuery(breadcrumb.message) } : {}),
    ...(dados === undefined ? {} : { data: redigir(dados) }),
  };
}

/**
 * Evento sem dado pessoal, na mesma linha do serializador de erro do log:
 * - requisição só com método e URL sem query (sem corpo, cabeçalhos, cookies, env);
 * - usuário só com o id, sem IP;
 * - mensagem da exceção trocada por `[REDIGIDO]` (a de biblioteca de banco traz os
 *   parâmetros da query; o tipo e a pilha bastam para agrupar e investigar);
 * - `message` e `logentry` (de `captureMessage` e das integrações de log) também
 *   trocados por `[REDIGIDO]`, sem os parâmetros (S31);
 * - quadros da pilha sem variáveis locais;
 * - `extra`, `contexts` e `tags` pelo redator; breadcrumbs pelo `redigirBreadcrumb`.
 */
export function redigirEvento<T extends Sentry.Event>(evento: T): T {
  const copia: T = { ...evento };
  if (evento.request !== undefined) {
    const { method, url } = evento.request;
    copia.request = {
      ...(method === undefined ? {} : { method }),
      ...(url === undefined ? {} : { url: urlSemQuery(url) }),
    };
  }
  const usuario = usuarioSemDadoPessoal(evento.user);
  if (usuario === undefined) delete copia.user;
  else copia.user = usuario;
  if (typeof evento.transaction === 'string') copia.transaction = urlSemQuery(evento.transaction);
  if (evento.message !== undefined) copia.message = VALOR_REDIGIDO;
  if (evento.logentry !== undefined) copia.logentry = { message: VALOR_REDIGIDO };
  if (evento.exception?.values !== undefined) {
    copia.exception = {
      ...evento.exception,
      values: evento.exception.values.map((excecao) => ({
        ...excecao,
        ...(excecao.value === undefined ? {} : { value: VALOR_REDIGIDO }),
        ...(excecao.stacktrace?.frames === undefined
          ? {}
          : {
              stacktrace: {
                ...excecao.stacktrace,
                frames: excecao.stacktrace.frames.map(({ vars: _vars, ...quadro }) => quadro),
              },
            }),
      })),
    };
  }
  copia.extra = redigirRegistro(evento.extra);
  copia.contexts = redigirRegistro(evento.contexts);
  copia.tags = redigirRegistro(evento.tags);
  if (evento.breadcrumbs !== undefined) {
    copia.breadcrumbs = evento.breadcrumbs
      .map(redigirBreadcrumb)
      .filter((breadcrumb): breadcrumb is Sentry.Breadcrumb => breadcrumb !== null);
  }
  for (const chave of ['extra', 'contexts', 'tags'] as const) {
    if (copia[chave] === undefined) delete copia[chave];
  }
  return copia;
}

/** Opções do SDK, separadas para os testes (que trocam o `transport`). */
export function opcoesDoSentry(
  dsn: string,
  extras: Pick<Sentry.NodeOptions, 'transport'> = {},
): Sentry.NodeOptions {
  return {
    dsn,
    dataCollection: COLETA_DE_DADOS,
    integrations: (padrao) =>
      padrao.filter((integracao) => !INTEGRACOES_DESLIGADAS.includes(integracao.name)),
    beforeSend: (evento) => redigirEvento(evento),
    beforeBreadcrumb: (breadcrumb) => redigirBreadcrumb(breadcrumb),
    ...extras,
  };
}

/**
 * Liga o Sentry se houver `SENTRY_DSN`. Devolve se ligou. Chamar logo depois
 * de validar o ambiente, antes de montar a aplicação.
 */
export function iniciarSentry(
  ambiente: Pick<Ambiente, 'SENTRY_DSN'>,
  extras: Pick<Sentry.NodeOptions, 'transport'> = {},
): boolean {
  if (ambiente.SENTRY_DSN === undefined) return false;
  Sentry.init(opcoesDoSentry(ambiente.SENTRY_DSN, extras));
  return true;
}

/**
 * Envia ao Sentry as exceções inesperadas das rotas (as que o `FiltroDeErros`
 * transforma em 500) e devolve a mesma exceção para o filtro responder. Erros
 * esperados (validação, 404, 429...) não vão. Registrado no `main.ts` só com
 * o Sentry ligado, com `new` (fora da injeção de dependência).
 */
export class InterceptadorDoSentry implements NestInterceptor {
  constructor(
    private readonly capturar: (erro: unknown) => unknown = (erro) =>
      Sentry.captureException(erro, { mechanism: { handled: false, type: 'auto.bairrin.http' } }),
  ) {}

  intercept(_contexto: ExecutionContext, proximo: CallHandler): Observable<unknown> {
    return proximo.handle().pipe(
      catchError((erro: unknown) => {
        if (classificarExcecao(erro).inesperado) this.capturar(erro);
        return throwError(() => erro);
      }),
    );
  }
}
