---
name: verificador-migracoes-e-logs-lacunas
description: Estado do redator de logs, do verificador de migrações e do depcruise após a rodada 2 do plano 01a (2026-10-16); lacunas baixas que restam
metadata:
  type: project
---

Rodada 1 (Q1-Q4) foi corrigida e conferida na rodada 2: cópia limpa passa em install/lint/typecheck/test/build do painel sem `dist/`; redator redige instâncias, Error fora de `err`, `child`/`setBindings` (logger raiz da app é `criarLoggerDaAplicacao`, não pino puro); verificador recusa DISABLE RLS, SELECT INTO, EXECUTE dinâmico; depcruise barra domínio/aplicação importando adaptadores do núcleo (log, http, config, infra, observabilidade, saude, `.adaptador.ts`), mas libera as portas (tempo/relogio, eventos/publicador...).

Lacunas baixas que restam (sondadas em 2026-10-16, sem teste):
- `logger.info({ req: null })` lança TypeError (serializarRequisicao assume objeto); ninguém chama assim.
- Verificador aceita SQL dinâmico montado por concatenação (`'... DISABLE ' || 'ROW LEVEL SECURITY'`), `ALTER DEFAULT PRIVILEGES ... GRANT UPDATE`, `CREATE POLICY ... USING (true)`, `BYPASSRLS`/`SUPERUSER`, `SET ROLE`, `SET row_security = off`, `COPY ... PROGRAM`.
- Strings soltas (mensagem do log, itens de array de string) não são redigidas: por desenho.
- `compartilhado/email/enviador-falso.ts` não casa com a regra de adaptador do núcleo.

**How to apply:** o `fundacao.test.mjs` usa `git check-ignore`: numa cópia limpa (tar sem .git) rode `git init` antes, senão falha por artefato. Poison pill do relay segue pendência do arquiteto.
