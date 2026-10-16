// Filtro global: toda exceção vira Problem Details (RFC 9457) com `codigo` e
// `idRequisicao`. Nunca devolve pilha nem a mensagem da exceção: o texto da
// resposta sai só de `ERROS` (`@bairrin/contratos`).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import {
  criarProblema,
  type CampoComErro,
  type CodigoDeErro,
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

export interface Classificacao {
  codigo: CodigoDeErro;
  campos?: CampoComErro[];
  /** Erro de programação ou de infraestrutura: vai para o log com a pilha. */
  inesperado: boolean;
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
    return { codigo: 'validacao', campos: excecao.campos, inesperado: false };
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
    const { codigo, campos, inesperado } = classificarExcecao(excecao);
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
