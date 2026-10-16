---
name: deploy-imagem-tls-sentry
description: Armadilhas da etapa 13 do 01a — Sentry 11 sem sendDefaultPii, schema engine do Prisma rebaixa verify-full, pnpm deploy --prod sem CLI do Prisma, node --run, validação de workflows via Docker
metadata:
  type: project
---

Conferido em 2026-10-16 (etapa 13 do 01a; @sentry/nestjs 11.7.0, Prisma 7.10.0, pnpm 12.4.1, node:22.23.3-trixie-slim):
- Sentry 11 NÃO tem `sendDefaultPii`: virou `dataCollection`, e sem ele o SDK coleta TUDO (userInfo/IP, cookies, cabeçalhos, corpos, query, dados de banco, variáveis locais). `sentry.ts` desliga cada categoria. `getDefaultIntegrations` devolve `Integration[] | undefined`. O ContextLines põe ±5 linhas de código-fonte no evento: em teste de vazamento, use constantes, não literais, perto do `captureException`.
- `@sentry/nestjs` não captura exceção que o nosso `FiltroDeErros` trata (o patch de `@Catch` só cria span). Por isso `InterceptadorDoSentry` (registrado no main com `new`).
- Schema engine do Prisma (Rust) não conhece `sslmode=verify-full`: cai para `prefer` e aceita CA errada (provado com Postgres TLS local). Equivalente: `sslmode=require&sslcert=<CA>&sslaccept=strict` (confere cadeia e nome). O `pg` entende o libpq (`verify-full&sslrootcert`). `urlDeMigracao` no prisma.config.ts traduz.
- `pnpm deploy --prod` falha no postinstall `prisma generate` (prisma é dev): use `--ignore-scripts`. O CLI do Prisma vem no `.pnpm` como par de `@prisma/client`, sem link na raiz: o Dockerfile cria `node_modules/prisma` e `.bin/prisma`. O schema engine veio no deploy mesmo com `--ignore-scripts` (build limpo).
- `node --run <script>` (Node 22) põe `node_modules/.bin` no PATH: serve de `release_command` sem pnpm na imagem.
- Testar TLS do banco: Postgres 17 em container com `-c ssl=on`, certificados gerados com openssl no scratchpad, `--network host` e host `localhost` (SAN). Ver [[prisma7-banco]] e [[infra-local-docker]].
- Validar workflows sem instalar nada: `docker run --rm -v "$PWD:/repo:ro" -w /repo rhysd/actionlint:latest`; dependabot/workflows contra schema: `python:3.13-slim` + `pip install check-jsonschema` + `--builtin-schema vendor.dependabot`.
- SHAs de action: `git ls-remote --tags` (usar o `^{}` de tag anotada) e conferir com `api.github.com/repos/<r>/commits/<sha>` (data, para a regra de 3 dias).

**How to apply:** deploy, CI, Sentry nos apps/painel (01b) e qualquer conexão nova com o banco.
