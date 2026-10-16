// Configuração HTTP comum ao `main.ts` e aos testes de integração, para que os
// testes exercitem exatamente a aplicação que sobe em produção.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NestApplicationOptions } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { Ambiente } from '../config/ambiente.ts';
import { CABECALHO_ID_REQUISICAO, idRequisicaoMiddleware } from './id-requisicao.middleware.ts';

/**
 * Opções de criação da aplicação. O leitor de corpo padrão do Nest fica
 * desligado para registrar só o de JSON, com limite, em `configurarAplicacao`.
 */
export const OPCOES_DA_APLICACAO = {
  bodyParser: false,
  bufferLogs: true,
} as const satisfies NestApplicationOptions;

/** Limite do corpo JSON (S19). Acima disso, 413 em Problem Details. */
export const LIMITE_DO_CORPO = '100kb';

/**
 * Saltos de proxy confiáveis em produção. No Fly, o `X-Forwarded-For` chega
 * como "cliente, IP do app": o último item é o IP do próprio app, posto pelo
 * Fly Proxy (https://docs.fly.io/networking/request-headers). Confiar em 2
 * saltos (o Fly Proxy, que abre a conexão, e o item que ele acrescentou) faz o
 * `req.ip` ser o cliente; o que o cliente puser à esquerda é ignorado.
 * Fora de produção não há proxy: nenhum salto é confiável.
 */
export const SALTOS_DE_PROXY_NO_FLY = 2;

/** `Cache-Control: no-store` por padrão (S17); a rota que puder ter cache troca. */
function semCache(_req: IncomingMessage, res: ServerResponse, proximo: () => void): void {
  res.setHeader('Cache-Control', 'no-store');
  proximo();
}

/**
 * Aplica, nesta ordem e antes dos middlewares dos módulos: id da requisição,
 * `no-store`, helmet, CORS e leitor de JSON com limite. Assim até a
 * requisição recusada pelo limite de corpo sai com id e cabeçalhos.
 */
export function configurarAplicacao(app: NestExpressApplication, ambiente: Ambiente): void {
  app.useLogger(app.get(Logger));
  app.set('trust proxy', ambiente.NODE_ENV === 'production' ? SALTOS_DE_PROXY_NO_FLY : false);
  app.use(idRequisicaoMiddleware);
  app.use(semCache);
  app.use(helmet());
  app.enableCors({
    // Só as origens da lista (o painel). Sem `Origin` (apps nativos, curl),
    // nenhum cabeçalho de CORS é enviado.
    origin: (
      origem: string | undefined,
      responder: (erro: Error | null, aceita: boolean) => void,
    ) => responder(null, origem !== undefined && ambiente.CORS_ORIGENS.includes(origem)),
    // Cookie de sessão do painel (01b). Só vale para as origens acima.
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    exposedHeaders: [CABECALHO_ID_REQUISICAO, 'Retry-After'],
    maxAge: 600,
  });
  app.useBodyParser('json', { limit: LIMITE_DO_CORPO });
  app.enableShutdownHooks();
}
