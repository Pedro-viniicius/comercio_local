---
name: nest12-runtime
description: Como o NestJS 12 (ESM) roda neste repo — tsc para build, tsx quebra a DI, Vitest 5 lê metadados sem SWC
metadata:
  type: project
---

Sondas feitas em 2026-10-16 (Nest 12.1.3, TS 6.0.3, Vitest 5.0.4, Vite 8):
- `tsc` com `module nodenext` + `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` compila imports `./x.ts` para `./x.js` e a DI por construtor funciona em `node dist/...`.
- `tsx` (esbuild) NÃO emite metadados de decorator: a DI por construtor do Nest quebra. Não use tsx para nada que monte módulo Nest.
- Vitest 5 resolve a DI por construtor mesmo sem `unplugin-swc` (oxc do Vite 8); com `unplugin-swc` (`module: { type: 'es6' }`) também passa. A etapa 5 adotou sem SWC (`apps/api/vitest.config.ts`) e confirmou com `PinoLogger` injetado só pelo tipo.
- `mergeConfig` do Vitest concatena `include`/`exclude`: o config de integração não estende o unitário.
- Pacotes `@bairrin/*` exportam a condição `@bairrin/fonte` (código-fonte) e `default` (dist). Vite/Vitest precisam de `resolve.conditions` com `@bairrin/fonte` para usar o fonte sem build.
- Testar script com `&` em segundo plano deixa `tsc --watch` órfão; e `pkill -f <padrão>` mata o próprio shell da ferramenta se o padrão aparecer no comando. Use `ps -C node -o pid,args`.

**How to apply:** etapas 5, 7, 11 e 12 do plano 01a e tudo da API.
