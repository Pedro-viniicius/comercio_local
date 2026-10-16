---
name: depcruise-fronteiras
description: dependency-cruiser 18.6 neste repo (pnpm + @bairrin/fonte) — exclude derruba npm no dist, caminhos relativos nas fixtures, como o teste de fronteiras roda a CLI
metadata:
  type: project
---

Conferido em 2026-10-16 (etapa 12 do 01a, `.dependency-cruiser.cjs`, `apps/api/test/fronteiras`):
- `exclude` remove o módulo do grafo, inclusive como destino (por isso o client gerado do Prisma saiu do `exclude` e foi para o `doNotFollow`: aparece só como folha alcançada, sem dependências, e a regra `client-do-prisma-so-na-infra` dispara; a varredura de pastas não o põe como raiz). `(^|/)node_modules/` ou `(^|/)dist/` no `exclude` fazem regra de `@nestjs/*`/`@prisma/*` nunca disparar (`@prisma/adapter-pg` resolve para `.../dist/index.d.mts`). Use `doNotFollow` para node_modules e ancore o `dist` em `^(apps|packages)/[^/]+/dist/`.
- Com `conditionNames: ['@bairrin/fonte', ...]` + `tsPreCompilationDeps: true`, `@bairrin/*` resolve para `packages/<p>/src/index.ts` e `import type` conta. Sem `tsPreCompilationDeps`, a fixture de import só de tipo some.
- O pnpm resolve npm para `node_modules/.pnpm/@nestjs+common@.../node_modules/@nestjs/common/index.js`: o regex é `(^|/)node_modules/@nestjs/`.
- Rodando a CLI com `cwd` = pasta das fixtures (que repete `apps/api/src/modulos/...`), os caminhos locais saem iguais aos da raiz, mas o que está fora do cwd vem com `../../../../../` (pacotes via symlink, node_modules): regex de pacote precisa de `(\.\./)*`.
- Backreference `$1` do `from.path` funciona em `to.pathNot` (módulo só importa outro por `index.ts`).
- `dependency-cruiser/package.json` não é exportado: o teste monta o caminho do bin a partir da raiz do repo. Uma CLI por árvore (fixtures e real) em paralelo: ~1 s no total.
- `@prisma/client` 7 não exporta `PrismaClient` (client gerado em src): fixture usa `@prisma/adapter-pg`.

- Regras do núcleo: "adaptador do núcleo" = `compartilhado/(infra|http|log|observabilidade|config|saude)/`, `*.adaptador.ts` e `compartilhado.module.ts`; portas puras ficam FORA dessas pastas (`transacao/`, `tempo/`, `eventos/publicador.ts`...), sem `pathNot`.

**How to apply:** nova regra de fronteira, novo módulo em `modulos/`, subcaminho `@bairrin/contratos/validadores` (remover o `@ts-expect-error` da fixture `usa-validadores-nao-resolvido.ts`).
