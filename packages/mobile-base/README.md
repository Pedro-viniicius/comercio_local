# @bairrin/mobile-base

Base compartilhada dos apps Expo (`apps/consumidor` e `apps/lojista`): sessão, fila offline, componentes e telas comuns. O pacote é privado ao monorepo.

## Situação

Plano 01b (`docs/produto/planos/01b-identidade.md`): etapa 1b (pacote e dependências), etapa 12 (sessão dos apps) e etapa 12a (componentes base, textos e a tela `EstadoDaApi`). `src/index.ts` exporta os componentes, a `EstadoDaApi`, `mensagemDoCampo`, `textos` e a sessão. O README completo (fluxos da sessão, lista permitida do persister, componentes) vem na etapa 20b.

## Dependências

- `expo-secure-store`: guarda o token da sessão (única opção em `src/sessao`).
- `@tanstack/react-query`, `react-native-svg`, `expo-file-system` e `expo-sharing` (esta dupla, para a cópia dos dados do titular).
- `@bairrin/tokens`, `@bairrin/contratos` e `@bairrin/cliente-api`.
- `expo`, `react` e `react-native` são peers: as versões são as dos apps (SDK 58), repetidas aqui como `devDependencies` só para o `tsc` e o Jest.

Versões exatas, as que o `bundledNativeModules.json` do `expo` instalado indica. Ao subir o SDK, confira de novo com `pnpm view <pacote> time` (mínimo de 3 dias).

## Sessão (resumo)

- O par de tokens só vai ao SecureStore, sempre com `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (CA-03, S18); a revogação pendente usa uma chave própria (S80).
- Na primeira abertura depois de instalar, o que ficou no Keychain de uma instalação anterior é limpo; a marca de instalação é um arquivo vazio em `src/instalacao`, porque o Keychain sobrevive à desinstalação e o FileSystem é proibido em `src/sessao`.
- Logout, expiração e troca de conta limpam o `queryClient`, o cache persistido (só a lista permitida, S11) e a fila offline.
- `urlDaApiConfigurada(valor, __DEV__)`: fora do desenvolvimento, endereço sem `https://` conta como "sem configuração" (S125).
- `app.plugin.js`: config plugin do Expo com as `dataExtractionRules` do Android 12+ (nada sai do aparelho por backup ou transferência; o SecureStore continua excluído, S119). Os apps o listam em `plugins` como `'@bairrin/mobile-base'`.

## Regra de lint

Mora no `eslint.config.mjs` da raiz (configuração única do repositório). Em `src/sessao/**` vale uma lista de permissão: só `expo-secure-store`, `react`, `@tanstack/react-query`, `@bairrin/cliente-api`, `@bairrin/contratos`, arquivos da própria pasta e a marca de instalação; `import()` e `require` são proibidos, e as regras não podem ser desligadas por comentário (S121). Qualquer outro armazenamento (AsyncStorage, FileSystem, SQLite, MMKV) reprova.

## Pastas previstas

| Pasta                                              | Camada                        |
| -------------------------------------------------- | ----------------------------- |
| `src/sessao`, `src/instalacao`, `src/fila-offline` | Regra de negócio              |
| `src/componentes`, `src/telas`, `src/textos`       | Visual (textos em `pt-BR.ts`) |

## Comandos

```bash
pnpm --filter @bairrin/mobile-base test       # Jest com jest-expo
pnpm --filter @bairrin/mobile-base typecheck
```
