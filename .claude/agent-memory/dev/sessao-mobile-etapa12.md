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

Rodada 1 do M2 (2026-10-31):
- `Identifier[name='require']` não pega `import x = require('m')` (vira `TSExternalModuleReference`): só o `no-restricted-imports` pelo nome do módulo reprova. Teste o import-equals com um módulo fora da lista, não com um permitido.
- Bloco de lint só para um arquivo (`files: ['.../armazenamento-seguro.ts']`) depois do bloco da pasta troca a regra inteira daquele arquivo; os `*.test.*` não casam com ele.
- Sonda de lint contra a config do HEAD sem mexer na real: `git show HEAD:eslint.config.mjs > .eslint-head-tmp.mjs` NA RAIZ (os imports resolvem dali) + `new ESLint({ cwd, overrideConfigFile })`; apague depois.
- Vermelho antes de código já corrigido: copie o arquivo para o scratchpad, `git show HEAD:<arq> > <arq>`, rode o jest, restaure.
- V8 `Date.parse('2026-02-31T10:00:00Z')` e `('2026-02-30')` rolam para março em vez de NaN: confira a data com `setUTCFullYear` antes.
- `scripts/workflows-apps-expo.test.mjs` só aceita `hashFiles` em linha `key:` (cache). `actions/cache` v6.1.0 = `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` (tag leve); actionlint por Docker passou.
- `assets/brand/gerar-png.sh` numa cópia no scratchpad gera PNG idênticos byte a byte aos versionados (Chrome e Pillow 12 da máquina).
- O cliente autenticado só revoga a sessão em uso: para revogar uma sessão recebida que não vai ficar, `iniciarSessao(nova)` + `encerrarSessao()` (só sem outra sessão em uso).
