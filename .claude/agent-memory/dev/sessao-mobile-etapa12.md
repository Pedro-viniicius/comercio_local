---
name: sessao-mobile-etapa12
description: Sessão dos apps no mobile-base (01b, etapa 12) — lint por lista de permissão, espiões de módulo no Jest, timers do React Query, plugin de backup do Expo, introspecção x prebuild
metadata:
  type: project
---

Conferido em 2026-10-31 (plano 01b, etapa 12):
- `no-restricted-imports.patterns.group` com `['*', '!pacote']` NÃO libera pacote com escopo (`@bairrin/x`) nem caminho relativo (`./a.ts`): o `ignore` não reinclui filho de pasta excluída. Use `patterns[].regex` com lookahead negativo e `caseSensitive: true` (o padrão é insensível: `Expo-Secure-Store` passaria).
- `linterOptions: { noInlineConfig: true }` funciona num bloco com `files` do flat config; teste com `eslint.lintText(..., { filePath: '<raiz>/.../x.js' })` (`.js` evita o projectService).
- Espião de módulo no Jest: `jest.mock('x', () => jest.requireActual<typeof import('./teste/espiao.ts')>('./teste/espiao.ts').espiao('x'), { virtual: true })` para pacote não instalado. O Proxy precisa devolver `undefined` em `then` (senão vira thenable) e `true` em `__esModule`. `jest.requireMock` lê o espião no teste sem `import`.
- `QueryClient` com `setQueryData`/mutação deixa timer de coleta de 5 min: o Jest não sai (parece travado, sem saída). Nos testes, `gcTime: Infinity` em queries e mutations.
- `expo config --type introspect` mostra o manifesto com os plugins, mas o Info.plist sai de um fallback com `NSAllowsArbitraryLoads: true`; o real (prebuild) tem `false` + `NSAllowsLocalNetworking: true`. Dangerous mods não rodam na introspecção. `npx --no-install expo prebuild --no-install --platform all` com `EXPO_OFFLINE=1 CI=1` funciona no Linux; depois apague `android/`/`ios/` e restaure o `package.json` do app.
- Plugin local por nome de pacote: `plugins: ['@bairrin/mobile-base']` acha `app.plugin.js` na raiz; ponha `"./app.plugin.js"` no `exports` (senão o Expo avisa). Precisa de override do `@typescript-eslint/no-require-imports` no ESLint.
- Outro agente rodou `prettier --write` em `packages/mobile-base/src` no meio da etapa: edite por substituição sobre o disco atual, nunca reescreva arquivo inteiro de memória.
