---
name: prisma7-banco
description: Prisma 7.10 neste repo (multiSchema, _prisma_migrations fora de public, client gerado em src, índice parcial, diff offline, enum sem USAGE, CASCADE como dono) e armadilhas do node --test e do banco de teste
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

- Etapa 3 do 01b (2026-10-17): SQL da migração sem banco-sombra: `prisma migrate diff --from-schema <schema antigo (git show HEAD:...)> --to-schema prisma/schema.prisma --script`. O diff ignora CHECK (não acusa drift). O teste `identidade/migracao.int.test.ts` roda o diff `--from-config-datasource --exit-code` contra o banco de teste (spawn com `DATABASE_URL_MIGRACAO`).
- Enum do Postgres: `bairrin_app` NÃO precisa de USAGE no tipo para DML nem para cast (`$1::identidade.x`); `REVOKE USAGE ON TYPE ... FROM PUBLIC` sem GRANT funciona. `INSERT ... ON CONFLICT DO NOTHING` passa com só a política `FOR INSERT`.
- FK `ON DELETE CASCADE`/`SET NULL` roda como dono da tabela filha e ignora RLS: apaga filhas onde a aplicação não tem DELETE (consentimentos). Provado no teste.
- Node 22.23 roda `src/cli/*.ts` direto (type stripping) se o arquivo só importa pacotes npm: o teste de integração faz spawn de `node src/cli/seed.ts` com env mínimo (PATH + variáveis), sem build.
- Teste de integração que importa `@bairrin/contratos` quebra enquanto outro dev edita `packages/contratos` (o Vitest lê o fonte pela condição `@bairrin/fonte`): em etapa paralela, evite o import ou fixe os valores.

**How to apply:** toda migração nova, etapas 11 e 13 do 01a (CI e release_command) e testes que tocam o banco. Ver [[infra-local-docker]] e [[nest12-runtime]].
