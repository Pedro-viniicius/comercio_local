// Sentry na API e no worker (S10): só liga se `SENTRY_DSN` existir. Tudo o que
// sai para o Sentry passa pelo mesmo redator dos logs (`log/redator.ts`), sem
// dado pessoal, sem IP, sem corpo, cabeçalhos, cookies ou query string.
//
// O SDK 11 trocou `sendDefaultPii` por `dataCollection` e, sem configuração,
// coleta TUDO (usuário e IP, cookies, cabeçalhos, corpos, query, dados de
// consulta ao banco, variáveis locais). Por isso cada categoria é desligada
// aqui de forma explícita: é o equivalente ao `sendDefaultPii: false` do plano.
// Não há Replay no SDK de Node; o teste confere que nenhuma integração com esse
// nome entra. Só erros: sem tracing (sem `tracesSampleRate`) e sem sessões de
// release health (Q12). A sessão sai num envelope à parte, sem passar pelo
// `beforeSend`, com o id do usuário (ou o e-mail, se não houver id) e o IP do
// escopo; para uma API, sessão por processo ou por requisição não interessa.
// Como defesa em profundidade, o transport só deixa sair o evento e o relatório
// do cliente (`soItensPermitidos`): um tipo novo do SDK não vaza nada.
// Sem propagação de trace: `sentry-trace` e `baggage` levariam a chave pública
// do DSN, a release e o ambiente a quem recebe as requisições de saída (S60).
// Spotlight e debug ficam desligados de forma explícita, porque o SDK os liga
// pelo ambiente (`SENTRY_SPOTLIGHT`, `SENTRY_DEBUG`): o Spotlight manda cada
// envelope a um servidor antes do transport, e o debug escreve no console,
// fora do pino (S61).
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { catchError, type Observable, throwError } from 'rxjs';
import type { Ambiente } from '../config/ambiente.ts';
import { classificarExcecao } from '../http/filtro-de-erros.ts';
import { redigir, urlSemQuery, VALOR_REDIGIDO } from '../log/redator.ts';

/**
 * Integrações padrão que ficam de fora: `Console` vira breadcrumb tudo o que
 * passa pelo `console` (o log da aplicação é o pino, já redigido),
 * `LocalVariablesAsync` anexa variáveis locais aos quadros da pilha e
 * `ProcessSession` abre a sessão de release health do processo, que leva o
 * usuário do escopo (id ou e-mail) e o IP (Q12).
 */
export const INTEGRACOES_DESLIGADAS: readonly string[] = [
  'Console',
  'LocalVariablesAsync',
  'ProcessSession',
];

/**
 * Tipos de item de envelope que podem sair do processo: o evento de erro (já
 * redigido pelo `beforeSend`) e o relatório do cliente, que só traz contagens
 * de eventos descartados por motivo e categoria. Sessão, transação, span, log,
 * check-in, anexo e qualquer tipo novo do SDK ficam retidos.
 */
export const ITENS_PERMITIDOS: readonly string[] = ['event', 'client_report'];

type FabricaDeTransport = NonNullable<Sentry.NodeOptions['transport']>;
type Integracao = Extract<NonNullable<Sentry.NodeOptions['integrations']>, unknown[]>[number];
type Envelope = Parameters<ReturnType<FabricaDeTransport>['send']>[0];
type ItemDeEnvelope = Envelope[1][number];

/**
 * Sem release configurada, o SDK a deduz sozinho do ambiente (`SENTRY_RELEASE`,
 * `GITHUB_SHA` e variáveis de outros CIs). A string vazia desliga essa dedução:
 * o evento sai sem `release` e o SDK descarta qualquer sessão antes do envio.
 */
const SEM_RELEASE = '';

/**
 * Sem release configurada, tira do contexto de amostragem (o `trace` do
 * cabeçalho do envelope) a release vazia de `SEM_RELEASE`.
 */
const SEM_RELEASE_VAZIA_NO_TRACE: Integracao = {
  name: 'BairrinSemReleaseVazia',
  setup(cliente) {
    cliente.on('createDsc', (contexto) => {
      if (contexto.release === SEM_RELEASE) delete contexto.release;
    });
  },
};

/**
 * Envolve o transport para mandar só os itens de `ITENS_PERMITIDOS`. Envelope
 * que fica vazio não é enviado.
 */
export function soItensPermitidos(fabrica: FabricaDeTransport): FabricaDeTransport {
  return (opcoesDoTransport) => {
    const transport = fabrica(opcoesDoTransport);
    return {
      send: (envelope) => {
        const itens: readonly ItemDeEnvelope[] = envelope[1];
        const permitidos = itens.filter(([cabecalho]) => ITENS_PERMITIDOS.includes(cabecalho.type));
        if (permitidos.length === 0) return Promise.resolve({});
        return transport.send([envelope[0], permitidos] as Envelope);
      },
      flush: (prazo) => transport.flush(prazo),
    };
  };
}

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

/** Forma do id pseudônimo do usuário (uuid). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mantém só o id pseudônimo do usuário, se for um uuid; o resto sai, IP incluso.
 * Id em outra forma (e-mail, telefone, número) descarta o usuário inteiro (S62).
 */
function usuarioSemDadoPessoal(usuario: Sentry.User | undefined): Sentry.User | undefined {
  const id = usuario?.id;
  return typeof id === 'string' && UUID.test(id) ? { id } : undefined;
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
 * - usuário só com o id, se for uuid, sem IP;
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

/** O que muda entre a produção e os testes (que trocam o `transport`). */
export interface ExtrasDoSentry {
  /** Release dos eventos, só de configuração explícita (`SENTRY_RELEASE`). */
  release?: string | undefined;
  transport?: FabricaDeTransport | undefined;
}

/** Opções do SDK, separadas para os testes. */
export function opcoesDoSentry(
  dsn: string,
  { release, transport }: ExtrasDoSentry = {},
): Sentry.NodeOptions {
  return {
    dsn,
    release: release ?? SEM_RELEASE,
    dataCollection: COLETA_DE_DADOS,
    integrations: (padrao) =>
      padrao
        .filter((integracao) => !INTEGRACOES_DESLIGADAS.includes(integracao.name))
        // Sem sessão por requisição (release health); o resto da integração HTTP fica.
        .map((integracao) =>
          integracao.name === 'Http' ? Sentry.httpIntegration({ sessions: false }) : integracao,
        )
        .concat(SEM_RELEASE_VAZIA_NO_TRACE),
    // Nenhuma URL de saída recebe `sentry-trace` nem `baggage` (S60).
    tracePropagationTargets: [],
    // Explícitos para o SDK não os ler do ambiente (S61).
    spotlight: false,
    debug: false,
    beforeSend: (evento) => redigirEvento(evento),
    beforeBreadcrumb: (breadcrumb) => redigirBreadcrumb(breadcrumb),
    transport: soItensPermitidos(transport ?? Sentry.makeNodeTransport),
  };
}

/**
 * Liga o Sentry se houver `SENTRY_DSN`. Devolve se ligou. Chamar logo depois
 * de validar o ambiente, antes de montar a aplicação.
 */
export function iniciarSentry(
  ambiente: Pick<Ambiente, 'SENTRY_DSN'> & Partial<Pick<Ambiente, 'SENTRY_RELEASE'>>,
  { transport }: Pick<ExtrasDoSentry, 'transport'> = {},
): boolean {
  if (ambiente.SENTRY_DSN === undefined) return false;
  Sentry.init(opcoesDoSentry(ambiente.SENTRY_DSN, { release: ambiente.SENTRY_RELEASE, transport }));
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
