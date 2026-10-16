---
name: prisma7-banco
description: Prisma 7.10 neste repo (multiSchema, _prisma_migrations fora de public, client gerado em src, índice parcial) e armadilhas do node --test e do banco de teste
metadata:
  type: project
---

Conferido em 2026-10-16 (etapa 7 do 01a; prisma/@prisma/client/@prisma/adapter-pg 7.10.0, pg 8.23.1, PG 17):
- `schemas = [...]` no datasource + `@@schema` funciona sem preview. Índice parcial exige `previewFeatures = ["partialIndexes"]` e `@@index([...], where: raw("..."))`; sem ele o `migrate dev` quer apagar o índice.
- `_prisma_migrations` vai para o schema do parâmetro `?schema=` da URL de migração; o Prisma cria esse schema sozinho. `prisma.config.ts` força `schema=migracoes` (`urlDeMigracao`).
- Prisma 7 não lê `.env` (sem dotenv no repo): a CLI recebe `DATABASE_URL_MIGRACAO` do ambiente. `CHECKPOINT_DISABLE=1` cala o aviso de atualização.
- Client `prisma-client` gerado em `apps/api/src/compartilhado/infra/gerado/` (gitignored). Os arquivos trazem `/* eslint-disable */` e `@ts-nocheck`: lint e typecheck passam. O `postinstall` da API roda `prisma generate` (num deploy `--prod` ele falha: use `--ignore-scripts`, ver [[deploy-imagem-tls-sentry]]).
- Conferir drift SQL x schema: migrar o banco de teste e rodar `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` → "No difference detected".
- Erro do Prisma com o banco fora do ar ou senha errada chega como `PrismaClientKnownRequestError` código `P2010`; o adapter já trata `error` do pool (`onPoolError`).
- Limpar o banco de teste: `DROP OWNED BY CURRENT_USER CASCADE` como bairrin_migracao apaga schemas e o que caiu em public e mantém o CONNECT do bairrin_app.
- Node 22: `node --test scripts/` tenta executar a pasta como módulo (MODULE_NOT_FOUND). Use `node --test 'scripts/**/*.test.mjs'`.

**How to apply:** toda migração nova, etapas 11 e 13 do 01a (CI e release_command) e testes que tocam o banco. Ver [[infra-local-docker]] e [[nest12-runtime]].
