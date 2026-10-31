# @bairrin/mobile-base

Base compartilhada dos apps Expo (`apps/consumidor` e `apps/lojista`): sessão, fila offline, componentes e telas comuns. O pacote é privado ao monorepo.

## Situação

Esqueleto da etapa 1b do plano 01b (`docs/produto/planos/01b-identidade.md`): só as dependências, o `tsconfig.json`, o `jest.config.js` e a regra de lint de `src/sessao`. `src/index.ts` ainda não exporta nada. O README completo vem na etapa 20b.

## Dependências

- `expo-secure-store`: guarda o token da sessão (única opção em `src/sessao`).
- `@tanstack/react-query`, `react-native-svg`, `expo-file-system` e `expo-sharing` (esta dupla, para a cópia dos dados do titular).
- `@bairrin/tokens`, `@bairrin/contratos` e `@bairrin/cliente-api`.
- `expo`, `react` e `react-native` são peers: as versões são as dos apps (SDK 58), repetidas aqui como `devDependencies` só para o `tsc` e o Jest.

Versões exatas, as que o `bundledNativeModules.json` do `expo` instalado indica. Ao subir o SDK, confira de novo com `pnpm view <pacote> time` (mínimo de 3 dias).

## Regra de lint

Em `src/sessao/**` é proibido importar `@react-native-async-storage/async-storage` e `expo-file-system` (por `import`, `import()` ou `require`): gravam em texto puro. A regra mora no `eslint.config.mjs` da raiz (configuração única do repositório).

## Pastas previstas

| Pasta                                        | Camada                        |
| -------------------------------------------- | ----------------------------- |
| `src/sessao`, `src/fila-offline`             | Regra de negócio              |
| `src/componentes`, `src/telas`, `src/textos` | Visual (textos em `pt-BR.ts`) |

## Comandos

```bash
pnpm --filter @bairrin/mobile-base test       # Jest com jest-expo
pnpm --filter @bairrin/mobile-base typecheck
```
