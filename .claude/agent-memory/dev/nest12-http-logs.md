---
name: nest12-http-logs
description: Armadilhas da base HTTP da API (Nest 12 + Express 5 + nestjs-pino 5.3 + pino 10) — ordem de middlewares, erros do body-parser, singleton do pino-http
metadata:
  type: project
---

Conferido em 2026-10-16 (etapa 5 do plano 01a):
- nestjs-pino 5.3 cria o pino-http UMA vez por processo (`dist/esm/rootLogger.js`, `resetRootLogger` não é exportado). Em teste com várias apps no mesmo arquivo, a 2ª app escreve no destino da 1ª: use um destino único por arquivo e limpe as linhas a cada app.
- Nest 12 registra o body-parser no `init()`, ANTES dos middlewares de módulo (o do nestjs-pino incluso). `app.use` chamado antes do `init` roda antes de tudo. Por isso id da requisição, no-store, helmet e CORS ficam em `configurarAplicacao` com `app.use`.
- Erro do body-parser chega CRU ao filtro global (`PayloadTooLargeError` com `status`/`type`/`expose`), não como HttpException; só `SyntaxError` vira `BadRequestException` (com a mensagem que traz trecho do corpo). Requisição recusada ali não tem `req.log`.
- pino: `formatters.log` e `formatters.bindings` rodam ANTES dos serializadores (recebem `IncomingMessage` e `Error` crus). Por isso o redator percorre tudo menos as chaves `req`/`res`/`err` do 1º nível (`chavesIntactas`).
- pino 10: `formatters.bindings` só vale para a RAIZ. `child()` troca o formatador por identidade (`resetChildingsFormatter` em `lib/proto.js`) e `setBindings()` usa o do próprio logger: vínculos de filho (id da requisição, `PinoLogger.assign` do nestjs-pino) vão crus. Solução adotada (2026-10-16): o logger raiz é criado por nós (`criarLoggerDaAplicacao`) com `child`/`setBindings` trocados como propriedade própria (filhos são `Object.create(pai)` e herdam) e entregue ao pino-http por `opcoesDoPinoHttp({ logger })`. `redact` com `'*'` não serve: o censor recebe o símbolo, não a chave.
- pino: `logger.error(erro)` ou `logger.error({ err })` SEM mensagem põe `erro.message` no `msg` (`lib/proto.js`, `write`). Sempre passe mensagem fixa.
- Nest 12 tem `app.useSecurityHeaders()`/`enableCsrfProtection()` nativos; o plano usa helmet.
- Fly: `X-Forwarded-For` termina com o IP do app; `trust proxy` = 2 saltos em produção (não verificado num Fly real).

**How to apply:** etapas 7, 11, 13 do 01a e o 01b (freio por IP, Sentry com o redator). Ver [[nest12-runtime]].
