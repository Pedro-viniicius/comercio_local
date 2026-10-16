---
name: pgboss-eventos-email
description: pg-boss 12.37 com papel sem CREATE, outbox/relay, nodemailer 10 e Mailpit — armadilhas conferidas na etapa 11 do 01a
metadata:
  type: project
---

Conferido em 2026-10-16 (etapa 11 do 01a; pg-boss 12.37.1, schema 45; nodemailer 10.1.0; Mailpit 1.31):
- pg-boss NÃO vai em migração Prisma: o SQL de construção tem `DROP TABLE` dinâmico (`delete_queue`) e o `migracoes:verificar` reprova. Decisão: passo próprio `migrarPgBoss` (`src/compartilhado/infra/pg-boss.ts`) roda a CLI `pg-boss migrate` (URL por env `PGBOSS_DATABASE_URL`, não argv) como `bairrin_migracao` e depois GRANT DML + EXECUTE + RLS com política `aplicacao` em toda tabela do schema `pgboss`. O `globalSetup` chama; o deploy chama `dist/cli/migrar-pg-boss.js`.
- Runtime com `migrate: false` só faz `check()` (falha "requires migrations" se a versão não bater). `bairrin_app` funciona só com DML se: `reindex: false`, `registerInstance: false`, `persistWarnings/persistQueueStats: false`, filas sem `partition: true` (`create_queue` só faz INSERT).
- `getMigrationPlans` junta índices `CONCURRENTLY` no mesmo texto: não rode como uma query só; a CLI separa.
- `singletonKey` em fila `exclusive` só barra duplicata enquanto pendente/ativa; a unicidade final é `eventos_processados`. Nomes de fila e chave: `^[\w.\-/]+$` (sem `:`).
- `send(..., { db: fromPrisma(tx) })` grava o job na transação do Prisma (rollback some com ele).
- Erro do handler vai para `job.output` via serialize-error (mensagem, pilha e `cause`!): lance erro sanitizado sem `cause`.
- `retryDelayMax` só com `retryBackoff: true` (assert no createQueue). Sem ouvinte de `error`, o EventEmitter derruba o processo.
- nodemailer 10 é ESM com tipos próprios (`@types/nodemailer` fica sem uso). Mailpit: `GET/DELETE /api/v1/search?query=to:"x"`, `GET /api/v1/message/{ID}`; não tem STARTTLS (`requireTLS` falha).
- Lint: `noImplicitOverride` exige `override` ao implementar método abstrato; `preserve-caught-error` reprova `throw new Error` em catch sem `cause`; `prefer-const` pega `let` atribuído uma vez depois.
- Teste que segura trava e chama código que pode bloquear: use `Promise.race` com prazo e libere no `finally`, senão a mutação trava o Vitest em vez de falhar.
- `vitest run --reporter=json` grava `apps/api/.vitest/json/output.json`: apague depois.

**How to apply:** 01b (assinantes, anonimizador, e-mail), etapa 13 (release_command precisa rodar o passo do pg-boss depois do Prisma). Ver [[prisma7-banco]] e [[nest12-runtime]].
