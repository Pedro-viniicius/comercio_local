---
name: expo-apps-sdk58
description: Apps Expo (SDK 58) no monorepo pnpm: versões fixadas, allowBuilds, audit do node-forge/zod, testes com jest-expo + RNTL 14, armadilhas do Router e do prebuild
metadata:
  type: project
---

Conferido em 2026-10-27 (plano 01a, etapas 8 e 9; `apps/consumidor` e `apps/lojista`):
- Versões exatas vêm de `bundledNativeModules.json` do pacote `expo` (`npm pack expo@<v>`), não de `expo install`. Usadas: expo 58.0.17, expo-router 58.0.25, react-native 0.88.0, react 19.3.0 (igual ao painel), jest 30.5.2, jest-expo 58.0.12, `@testing-library/react-native` 14.1.0 (+ `test-renderer` 1.3.0 e `@react-native/jest-preset` 0.88.0, pares). `expo` 58.0.19 (10-23) ainda não amadurecia no dia; checar `pnpm view <pkg> time`.
- Scripts de instalação novos: só `@parcel/watcher` e `unrs-resolver`, ambos `false` no `allowBuilds` (binários vêm como pares opcionais por plataforma; o script só compila/confere).
- `pnpm audit --prod` pega o `@expo/cli` (dependência do `expo`): zod 3.25.76 (corrigido com override `'@expo/cli>zod@<4.6.6': 4.6.7`, o CLI só usa API comum a v3 e v4) e node-forge 1.4.0 (GHSA-86w9-cpqp-85rv, patch 1.4.1/1.4.2 publicado em 2026-10-27, barrado pelo `minimumReleaseAge` até 2026-10-30; override com a versão nova falha com `ERR_PNPM_NO_MATURE_MATCHING_VERSION`).
- Todo arquivo de `src/app` vira rota (inclusive `*.test.tsx`): testes ficam em `src/telas` e `src/testes`. `renderRouter('./src/app')` de `expo-router/testing-library` monta o layout; o título do cabeçalho nativo só aparece como `"title":"..."` em `screen.toJSON()`.
- RNTL 14 é assíncrono (`await render`, `await fireEvent.press`, `await unmount`); `getByRole` só acha View com `accessible`; `toHaveTextContent(string)` é igualdade exata (use RegExp). `jest.isolateModulesAsync` cria 2ª cópia do React ("Invalid hook call"): leia `process.env.EXPO_PUBLIC_*` dentro do componente (`useMemo(() => ..., [])`, o Babel do Expo troca o acesso literal; conferido no .hbc com a variável definida).
- `react-hooks/use-memo` não aceita `useMemo(funcaoNomeada, [])`: use função inline.
- Jest dos apps precisa de `@babel/runtime` pelo NODE_PATH que o `pnpm run` injeta; ao chamar `node jest.js` direto (instalacao-limpa) ponha `NODE_PATH=<raiz>/node_modules/.pnpm/node_modules`.
- Teste com `setTimeout(0)` real + `await unmount()` é flaky sob carga (`pnpm test` roda tudo em paralelo): use rejeição manual dentro de `act`.
- `expo prebuild` reescreve `scripts.android/ios` do `package.json` para `expo run:*` (restaurar se rodar no repo) e avisa se `userInterfaceStyle` estiver no config sem `expo-system-ui` (omita; o padrão já é claro). `expo export` sem `--output-dir` grava `dist/` (ignorado pelo git; apague).
- `expo export` não gera `.expo/` nem `expo-env.d.ts`; tipos do Metro entram por `src/tipos.d.ts` com `/// <reference types="expo/types" />`.

Conferido em 2026-10-27 (plano 01b, etapa 1b, `packages/mobile-base`):
- Pacote sem `"type": "module"` (o `jest.config.js` usa `module.exports`), `exports` apontando para `src/index.ts` em todas as condições, sem script `build`. `expo`, `react` e `react-native` entram como peers e, em `devDependencies`, com a versão exata dos apps: o lockfile resolve o mesmo React Native (uma instância só).
- `no-restricted-imports` do ESLint 10 NÃO pega `import()` nem `require()`: precisa de `no-restricted-syntax` com `ImportExpression[source.value=/.../]` e `CallExpression[callee.name='require'][...]`. Conferido com arquivos temporários (6 formas reprovadas, SecureStore passa).
- `pnpm install --lockfile-only` com manifesto novo já escreve o importador no lockfile; `allowBuilds` não mudou com `expo-secure-store`, `expo-file-system`, `expo-sharing` e `react-native-svg`. `expo-file-system` 58.0.12 (10-27) ainda não maduro: fica a 58.0.10 do SDK.
- `scripts/instalacao-limpa.test.mjs` precisa listar todo pacote novo em `PACOTES` (os links `@bairrin/*` dos apps apontam para a cópia).
- Uma rodada de `pnpm test` falhou sem causa registrada (saída filtrada) logo depois de lint+typecheck+build; 8 rodadas seguintes passaram. Guarde o log completo ao rodar.

Conferido em 2026-10-27 (rodada 1 de correção do M1):
- Plugin de config (`['expo-secure-store', ...]`) resolve a partir do app só por acidente: o shim `expo` do pnpm injeta `NODE_PATH` com `node_modules/.pnpm/node_modules`. Declare o pacote (versão exata) também no app. O manifesto do prebuild cita `@xml/secure_store_*`, mas os XML não aparecem em `android/app/src/main/res`: vêm do `res/` da própria biblioteca e se juntam no Gradle.
- `expo-router` em `plugins` com opção vira `['expo-router', { sitemap: false }]`: testes que usam `plugins.includes('expo-router')` precisam olhar `[p].flat()[0]`. `blockedPermissions` vira `tools:node="remove"` no manifesto.
- Seletor esquery do ESLint para template literal sem expressão: `ImportExpression[source.type='TemplateLiteral'][source.expressions.length=0][source.quasis.0.value.cooked=/re/]` (idem `arguments.0` no `require`). Funciona.
- dependency-cruiser: import de pacote não declarado no importador não resolve e `resolved` vira o próprio nome do pacote (`@bairrin/mobile-base`), então a regra precisa casar o nome além do caminho `packages/...`. Fixture com isso exige `@ts-expect-error` e entra na lista de "não resolvidas" do teste.
- `pnpm audit --prod` em 2026-10-27 também lista `qs` (moderada, via express da API); o CI usa `--audit-level=high`.
