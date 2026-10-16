# ADR-004: PostgreSQL com Prisma; migração destrutiva separada e barrada no CI

- Situação: aceita (decisão do dono, 2026-10-16).
- Origem: `docs/produto/planos/00-arquitetura.md`, abordagem 3 (acesso a dados) e `docs/produto/planos/01a-fundacao-repositorio.md`, etapas 2 e 7.

## Contexto

O produto lida com dinheiro e dados pessoais desde o primeiro pedido: precisa de transações, JSONB e migrações revisáveis. A tag `latest` do Prisma aponta para um release candidate (8.0.0-rc). Drizzle e Kysely foram descartados por serem menos difundidos.

## Decisão

- PostgreSQL 17 (a major mais recente oferecida pelo Supabase na data) e Prisma **7.10.0**, a última major estável. Nada de RC.
- O Prisma 7 usa driver adapter: `@prisma/adapter-pg`. O client é gerado em `apps/api/src/compartilhado/infra/gerado/` (fora do git) por `prisma generate`, que roda no `postinstall` da API.
- O Prisma 7 não lê `.env`. A CLI recebe `DATABASE_URL_MIGRACAO` do ambiente (`node --env-file`, segredos do Fly ou o `globalSetup` dos testes). O `apps/api/prisma.config.ts` força `schema=migracoes` nessa URL.
- Um schema por contexto (`multiSchema`). **Nada em `public`**. A tabela de controle `_prisma_migrations` vive no schema `migracoes`, sem acesso da aplicação.
- Toda tabela tem RLS ligado, com política só para o papel da aplicação.
- Dois papéis: `bairrin_migracao` (dono dos schemas; só migrações e `release_command`) e `bairrin_app` (só DML, sem CREATE). Variáveis `DATABASE_URL`, `DATABASE_URL_MIGRACAO`, `DATABASE_URL_TESTE` e `DATABASE_URL_MIGRACAO_TESTE`.
- Migrações são SQL revisado (`prisma migrate dev --create-only`), uma pasta por migração, aplicadas com `prisma migrate deploy`.
- `pnpm migracoes:verificar` (`scripts/verificar-migracoes.mjs`) reprova, entre outros: migração sem `-- reversao:` no topo; `DROP`, `RENAME`, `ALTER COLUMN ... TYPE`, `TRUNCATE` ou `DELETE FROM` fora de pasta `_destrutiva` ou sem o bloco de guarda que aborta se houver linhas; `CREATE TABLE` (inclusive `SELECT ... INTO` e SQL dinâmico) sem RLS; objeto criado em `public`; comandos que desligam RLS ou triggers; `GRANT` a `PUBLIC`/`anon`/`authenticated`/`service_role`; `SECURITY DEFINER` sem `search_path`. A lista completa fica em `apps/api/README.md`, seção "Regras do SQL".
- Sem PostGIS: a distância é haversine em SQL e em TypeScript (200 lojas bastam).

## Consequências

- Sem `prisma generate`, `typecheck`, testes e build da API quebram. Num clone limpo, `pnpm install` já o executa.
- Uma exceção às migrações do Prisma: o schema do pg-boss é criado por um passo próprio (ADR-011), porque o SQL dele tem `DROP TABLE` dinâmico e mudaria a cada versão da biblioteca.
- Índice parcial exige `previewFeatures = ["partialIndexes"]` no gerador; sem isso o `migrate dev` tenta apagar o índice.
- Reverter uma migração é uma ação manual descrita na nota `-- reversao:`; a restauração do backup é o plano B (ADR-014).
