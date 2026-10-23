// Filtro global: toda exceção vira Problem Details (RFC 9457) com `codigo` e
// `idRequisicao`. Nunca devolve pilha nem a mensagem da exceção: o texto da
// resposta sai só de `ERROS` (`@bairrin/contratos`).
//
// O 400 de validação leva no máximo `MAXIMO_DE_CAMPOS_NO_PROBLEMA` itens em
// `campos` (Q30): o zod dá um item por chave desconhecida, e um corpo de
// 100 KB cheio de chaves curtas viraria uma resposta de ~750 KB. O corte
// fica aqui, a saída de todo 400 da API, e mantém os primeiros itens, que
// são os dos campos declarados (o zod lista as chaves desconhecidas de um
// objeto depois dos campos dele).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import {
  criarProblema,
  type CampoComErro,
  type CodigoDeErro,
  ERROS,
  type Problema,
  TIPO_DE_CONTEUDO_PROBLEMA,
} from '@bairrin/contratos';
import { PinoLogger } from 'nestjs-pino';
import { obterIdRequisicao } from './id-requisicao.middleware.ts';
import { ErroDeValidacao } from './validacao-zod.pipe.ts';

/** Status HTTP de exceções do Nest e de bibliotecas que têm código próprio. */
const CODIGO_POR_STATUS: Readonly<Record<number, CodigoDeErro>> = {
  400: 'validacao',
  401: 'nao_autenticado',
  403: 'sem_permissao',
  404: 'nao_encontrado',
  409: 'conflito',
  413: 'corpo_grande_demais',
  429: 'limite_excedido',
  503: 'indisponivel',
};

/** Maior número de itens em `campos` no Problema de validação (Q30). */
export const MAXIMO_DE_CAMPOS_NO_PROBLEMA = 20;

export interface Classificacao {
  codigo: CodigoDeErro;
  campos?: CampoComErro[];
  /** Erro de programação ou de infraestrutura: vai para o log com a pilha. */
  inesperado: boolean;
  /** Segundos para o cabeçalho `Retry-After` (429 do freio, CA-04). */
  esperaEmSegundos?: number;
}

/**
 * Resposta de erro escolhida pela rota com um código de `ERROS` que o status
 * sozinho não diz (`sem_acesso_painel`, S23) ou com `Retry-After` (o freio do
 * login, da redefinição, da verificação de e-mail e do segundo fator, CA-04).
 * O texto da resposta continua saindo só de `ERROS`.
 */
export class ErroComCodigo extends HttpException {
  readonly esperaEmSegundos?: number;

  constructor(
    readonly codigo: CodigoDeErro,
    opcoes: { readonly esperaEmSegundos?: number } = {},
  ) {
    super(ERROS[codigo].title, ERROS[codigo].status);
    this.name = 'ErroComCodigo';
    if (opcoes.esperaEmSegundos !== undefined) {
      // Pelo menos 1 s: `Retry-After: 0` faria o cliente repetir na hora.
      this.esperaEmSegundos = Math.max(1, Math.ceil(opcoes.esperaEmSegundos));
    }
  }
}

/**
 * Erro do leitor de corpo do Express (pacote `http-errors`): 4xx com `type`
 * como `entity.too.large`. Não é `HttpException`, então chega cru ao filtro.
 */
function ehErroDoLeitorDeCorpo(erro: unknown): erro is Error & { status: number } {
  if (!(erro instanceof Error)) return false;
  const { status, type, expose } = erro as Error & {
    status?: unknown;
    type?: unknown;
    expose?: unknown;
  };
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    typeof type === 'string' &&
    expose === true
  );
}

/** Decide o código do Problema. Nunca lê a mensagem da exceção. */
export function classificarExcecao(excecao: unknown): Classificacao {
  if (excecao instanceof ErroDeValidacao) {
    return {
      codigo: 'validacao',
      campos: excecao.campos.slice(0, MAXIMO_DE_CAMPOS_NO_PROBLEMA),
      inesperado: false,
    };
  }
  if (excecao instanceof ErroComCodigo) {
    return {
      codigo: excecao.codigo,
      inesperado: false,
      ...(excecao.esperaEmSegundos === undefined
        ? {}
        : { esperaEmSegundos: excecao.esperaEmSegundos }),
    };
  }
  if (excecao instanceof HttpException) {
    const status = excecao.getStatus();
    const codigo = CODIGO_POR_STATUS[status];
    // Status com código próprio é lançado de propósito (o 503 do `/pronto`, por exemplo).
    if (codigo) return { codigo, inesperado: false };
    // 5xx sem código próprio é falha; 4xx sem código (405, 415, 422...) vira `validacao`.
    if (status >= 500) return { codigo: 'erro_interno', inesperado: true };
    return { codigo: 'validacao', inesperado: false };
  }
  if (ehErroDoLeitorDeCorpo(excecao)) {
    return {
      codigo: excecao.status === 413 ? 'corpo_grande_demais' : 'validacao',
      inesperado: false,
    };
  }
  return { codigo: 'erro_interno', inesperado: true };
}

@Catch()
export class FiltroDeErros implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(FiltroDeErros.name);
  }

  catch(excecao: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<IncomingMessage & { log?: unknown }>();
    const res = http.getResponse<ServerResponse & { err?: Error }>();
    const idRequisicao = obterIdRequisicao(req, res);
    const { codigo, campos, inesperado, esperaEmSegundos } = classificarExcecao(excecao);
    const erro = inesperado ? comoErro(excecao) : undefined;
    // Com o pino-http ativo, o erro vai em `res.err` e sai no registro de
    // conclusão da requisição (uma linha só).
    if (erro && req.log !== undefined) res.err = erro;

    if (res.headersSent) {
      // Resposta já começou: não há como trocar status nem corpo.
      if (req.log === undefined) this.registrarSemLogDaRequisicao(req, res, idRequisicao, erro);
      res.destroy();
      return;
    }
    const problema: Problema = criarProblema({
      codigo,
      idRequisicao,
      ...(campos ? { campos } : {}),
    });
    res.statusCode = problema.status;
    if (req.log === undefined) this.registrarSemLogDaRequisicao(req, res, idRequisicao, erro);
    if (esperaEmSegundos !== undefined) res.setHeader('Retry-After', String(esperaEmSegundos));
    res.setHeader('Content-Type', `${TIPO_DE_CONTEUDO_PROBLEMA}; charset=utf-8`);
    res.end(JSON.stringify(problema));
  }

  /**
   * A requisição falhou antes do middleware do pino-http (no leitor de corpo,
   * por exemplo: 413 ou JSON malformado), então não haverá registro de
   * conclusão. Registra aqui, com os mesmos serializadores: método, URL sem
   * query, status e, se for falha, tipo e pilha do erro, nunca a mensagem.
   */
  private registrarSemLogDaRequisicao(
    req: IncomingMessage,
    res: ServerResponse,
    idRequisicao: string,
    erro: Error | undefined,
  ): void {
    const registro = { idRequisicao, req, res, ...(erro ? { err: erro } : {}) };
    if (erro) this.logger.error(registro, 'requisição com erro antes do log');
    else this.logger.warn(registro, 'requisição recusada antes do log');
  }
}

function comoErro(excecao: unknown): Error {
  return excecao instanceof Error ? excecao : new Error('Valor lançado não é um Error');
}
