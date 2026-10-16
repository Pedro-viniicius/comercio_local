---
name: como-rodar-testes
description: Comandos para rodar testes isolados, sondas e cópia limpa neste monorepo (Bairrin), com armadilhas já encontradas
metadata:
  type: reference
---

- Unitário de um arquivo da API: `pnpm --filter api exec vitest run <caminho>`. Integração: `pnpm --filter api test:integracao -- <trecho-do-nome>` (exige `docker compose -f infra/docker-compose.yml up -d --wait`; o globalSetup recria o banco de teste, então não rode contra dados que importem). Scripts da raiz: `node --test scripts/<arquivo>.test.mjs`.
- `pnpm test` na raiz para no primeiro pacote que falha (`pnpm -r` sem `--no-bail`): rode cada `pnpm --filter <pacote> test` e `node --test "scripts/**/*.test.mjs"` separados para ver tudo.
- Sonda fora do repo com decorators do Nest: vitest com `--config` no scratchpad (`root` no scratchpad, `include: ['*.sonda.test.ts']`, `resolve.conditions: ['@bairrin/fonte']`), `node_modules` do scratchpad como symlink para `apps/api/node_modules`, `tsconfig.json` local com `experimentalDecorators` e `emitDecoratorMetadata`, e `--disableConsoleIntercept` para ver `console.log`. tsx NÃO serve para código com decorators (sem metadados).
- Pacotes `@bairrin/*` resolvem por `dist/` fora do vitest da API; testes passam na máquina do dev só porque `dist/` existe. Cópia limpa: `git ls-files -co --exclude-standard | tar` para o scratchpad e `pnpm install --frozen-lockfile` (cria `/tmp/.pnpm-store`; apague depois). `scripts/instalacao-limpa.test.mjs` reproduz isso sem reinstalar.
- Imagem da API: `docker run --rm --network host -e NODE_ENV=development -e DATABASE_URL_MIGRACAO=<url teste 5433> <img> node --run migrar` valida o release_command (em produção exige verify-full).
