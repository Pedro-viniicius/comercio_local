---
name: pnpm12-armadilhas
description: Comportamentos do pnpm 12.4 neste monorepo que contrariam a memória do pnpm 8-10 (.npmrc, allowBuilds, minimumReleaseAge)
metadata:
  type: project
---

Conferido em 2026-10-16 com pnpm 12.4.1:
- `.npmrc` só vale para registry e autenticação. `save-exact=true` no `.npmrc` é ignorado em silêncio (testado com `pnpm add`); o que funciona é `saveExact: true` no `pnpm-workspace.yaml`.
- `onlyBuiltDependencies` não existe mais: é `allowBuilds:` (mapa `pacote: true|false`). Com `strictDepBuilds: true`, a instalação falha com `ERR_PNPM_IGNORED_BUILDS` e o pnpm REESCREVE o `pnpm-workspace.yaml` pondo `set this to true or false` em cada pacote. Releia o arquivo antes de editar de novo.
- `minimumReleaseAge` é em minutos (4320 = 3 dias) e vale também para transitivas; versão direta mais nova que isso faz a instalação falhar.
- `pnpm --filter api <script> -- x` repassa o `--` literal ao script; o Vitest ignora o que vem depois de `--`. O `vitest.integracao.config.ts` lê os trechos de `process.argv` para filtrar.
- `pnpm install --lockfile-only` atualiza o lockfile sem tocar no `node_modules` (útil com outro agente rodando testes). Tirar `tsx` do manifesto NÃO tira `tsx`/`esbuild` do lockfile: seguem resolvidos como pares opcionais do Vite (`pnpm dedupe` também não tira). Por isso `esbuild: true` fica no `allowBuilds` (conferido 2026-10-16).
- `pnpm exec`/`pnpm <script>` reinstala sozinho quando o lockfile ou um `package.json` mudou (aparece "postinstall$ prisma generate" no meio da saída): com outro `dev` mexendo em dependências em paralelo, isso acontece sem aviso e regera o client do Prisma.
- `pnpm peers check` lista problemas de peer; `pnpm audit` sai com código 1 quando acha high.

**Why:** a etapa 1 do plano 01a perdeu tempo com essas diferenças.
**How to apply:** ao mexer em dependências ou no workspace, confira com `pnpm config get <chave>` se a chave foi lida.

Conferido em 2026-10-16 (plano 01b, etapa 1a): para dependência `catalog:`, escreva a linha no `catalog` do `pnpm-workspace.yaml` antes e rode `pnpm --filter <pkg> add '<nome>@catalog:'`. `@node-rs/argon2` 2.2.2 não tem script de instalação (binários em dependências opcionais por plataforma): `allowBuilds` não mudou. `pnpm audit --prod` tem 3 achados só via `@prisma/client>prisma` (deepmerge-ts, mysql2 x2), idênticos antes e depois das dependências da identidade.
