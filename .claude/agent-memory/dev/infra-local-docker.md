---
name: infra-local-docker
description: Armadilhas do Postgres/Mailpit do infra/docker-compose.yml — teste de senha, healthcheck, psql ausente no host, versão do Supabase
metadata:
  type: project
---

Conferido em 2026-10-16 (etapa 2 do plano 01a; postgres:17.11-trixie, mailpit v1.31.5):
- Dentro do container, o pg_hba da imagem dá `trust` para 127.0.0.1 e socket: `psql -h 127.0.0.1` no `exec` NÃO prova senha nem papel. Teste login a partir do host (a conexão chega pela ponte do Docker e cai em `scram-sha-256`).
- O host não tem `psql`. Para sondar o banco do host, use o `pg` de `apps/api` (`node` com `createRequire` a partir de `apps/api/package.json`), lendo as URLs do `.env.example`.
- Healthcheck do Postgres é `pg_isready -h 127.0.0.1` (TCP) de propósito: durante os scripts de init o servidor só escuta no socket, então TCP pronto = papéis criados.
- `postgres-teste` usa tmpfs: `docker compose restart postgres-teste` zera o banco e roda `01-papeis.sql` de novo. O de dev só reroda o init com `down -v`.
- Desde 01b/0a o init faz `REVOKE ALL ON SCHEMA public FROM PUBLIC` (acl vira `{pg_database_owner=UC/pg_database_owner}`). Recriar o dev: `down -v && up -d --wait`, depois, de `apps/api`, `node --env-file=.env.example ./node_modules/prisma/build/index.js migrate deploy` e `node --env-file=.env.example dist/cli/migrar-pg-boss.js` (não há `apps/api/.env`; o `.env.example` aponta para o dev local). `down -v` derruba também Mailpit e o banco de teste.
- `bairrin_migracao` NÃO consegue `ALTER ... OWNER TO bairrin_app` nem `CREATE SCHEMA ... AUTHORIZATION bairrin_app` ("must be able to SET ROLE"). Para teste de objeto com dono = app: `GRANT CREATE` no schema de teste, o cliente `app` cria, `REVOKE` antes de conferir; o dono do schema apaga tudo com `DROP SCHEMA ... CASCADE`. Estado ruim no catálogo (trigger desligada, política, view): `BEGIN` → SQL → conferir no MESMO cliente → `ROLLBACK`. `migracoes._prisma_migrations` não tem RLS (exceção da checagem S33).
- Script avulso que importa `src/*.ts` com `node` puro falha (strip-only não aceita parameter properties): `pnpm --filter api build` e importe de `dist/`.
- Supabase oferecia no máximo Postgres 17 nessa data (18 não confirmado); a imagem local acompanha a major do Supabase.

**How to apply:** etapas 7, 11 e 13 do 01a e qualquer teste de papéis/privilégios.
