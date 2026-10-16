// Identificador de cada requisição: vai no log (`idRequisicao`), no Problem
// Details e no cabeçalho da resposta, para o suporte achar o log a partir do
// erro que o usuário viu. É sempre gerado aqui: um id vindo do cliente
// poderia ser forjado ou injetar texto no log.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Cabeçalho da resposta com o id da requisição. */
export const CABECALHO_ID_REQUISICAO = 'X-Request-Id';

/**
 * Devolve o id da requisição, criando-o na primeira chamada. Usado pelo
 * middleware, pelo `genReqId` do pino-http e pelo filtro de erros, para que o
 * id seja o mesmo em qualquer ordem em que eles rodem.
 */
export function obterIdRequisicao(req: IncomingMessage, res: ServerResponse): string {
  if (typeof req.id === 'string' && req.id.length > 0) return req.id;
  const id = randomUUID();
  req.id = id;
  if (!res.headersSent) res.setHeader(CABECALHO_ID_REQUISICAO, id);
  return id;
}

/**
 * Primeiro middleware da aplicação (registrado com `app.use` antes do leitor
 * de corpo): até a requisição recusada pelo limite de corpo leva o id.
 */
export function idRequisicaoMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  proximo: () => void,
): void {
  obterIdRequisicao(req, res);
  proximo();
}
