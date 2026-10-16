---
name: docs-comandos-verificados
description: Comandos de CLI conferidos ao escrever as docs da fundação (etapa 14 do 01a) e armadilhas de Prettier e do EAS
metadata:
  type: project
---

Conferido em 2026-10-16:
- `pnpm --filter api exec node --env-file=.env.example ...` falha com "not found" (o arquivo existe); de dentro de `apps/api`, `node --env-file=.env ./node_modules/prisma/build/index.js migrate status` funciona. Por isso as docs mandam `cd apps/api` antes de chamar a CLI do Prisma.
- Num clone limpo, só a API compilada (`node dist/...`) lê `@bairrin/*` pelo `dist`: `pnpm --filter "@bairrin/*" run build` antes de `api dev`/`worker`. Lint, typecheck, testes e o painel leem o fonte.
- Cópia limpa real para provar CA-F1: `git ls-files --cached --others --exclude-standard -z | tar --null -T - -cf - | tar -xf - -C <dest>`, copiar os `.env.example` à parte se o filtro os tirar e `git init -q` no destino (o `fundacao.test.mjs` usa `git check-ignore`). Depois `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` (~2 min).
- `node --env-file=X --run <script>` NÃO repassa as variáveis do arquivo ao script (Node 22.23, conferido): o `migrar` só funciona com a variável já no ambiente.
- Prettier confere tabelas Markdown e alinha colunas: escreva, rode `prettier --write` nos próprios arquivos e depois `--check` (docs/produto, CLAUDE.md e .claude ficam fora).
- EAS Update com assinatura de código exige plano pago (Production/Enterprise, docs do Expo; a mensagem de erro cita só Enterprise). O custo do plano 00 supõe EAS Free.
- ADR-012 tem nome fixo `docs/adr/0012-sessao-e-autenticacao.md` (o plano 01b, etapa 20, o edita).

**How to apply:** próximas docs, etapa 20 do 01b e checklist de deploy.
