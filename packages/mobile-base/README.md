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
- Primeira abertura depois de instalar (S18, S127): o Keychain do iOS sobrevive à desinstalação. O par e as revogações pendentes da instalação anterior viram uma revogação pendente só (no máximo 5, sem repetir), e a chave da sessão é apagada antes de qualquer uso. O par antigo nunca volta como sessão; o servidor o revoga na primeira chance com rede. Um valor que não se consegue ler conta como ausente e não é revogado. A marca de instalação é um arquivo vazio em `src/instalacao`, porque o FileSystem é proibido em `src/sessao`.
- Logout, expiração e troca de conta limpam o `queryClient`, o cache persistido (só a lista permitida, S11) e a fila offline.
- Troca de conta com a fila da conta anterior sem apagar (R8): a conta nova não entra. A sessão recebida é revogada no servidor (ou fica como revogação pendente, sem rede), nenhum token fica no aparelho, o estado vai para `sem_sessao` e `entrar` rejeita com `ErroAoLimparDadosDaConta`.
- `useSessao()` entrega às telas só `estado`, `emailVerificado` e as ações `entrar`, `sair`, `requisitar` e `substituirSessao`.
- `substituirSessao(pedido)` (R9): faz a requisição que devolve uma sessão nova da mesma conta (hoje, `POST /v1/conta/verificacao-email`, etapa 14) e troca o par guardado sem limpar os dados. A API marca a sessão anterior como `substituida`; sem a troca, a próxima renovação seria recusada e a pessoa sairia da conta. O token não passa pela tela. Se houve logout no meio, a sessão recebida é revogada; se outra conta entrou no meio, a dela fica.
- O índice público exporta só o que os apps usam (S128): `ProvedorDeSessao`, `useSessao`, `urlDaApiConfigurada`, `criarPersisterPermitido` e os tipos. O cofre (`criarCofreDaSessao`, as chaves do SecureStore) e a `criarSessaoDoApp` ficam dentro do pacote.
- `urlDaApiConfigurada(valor, __DEV__)`: fora do desenvolvimento, endereço sem `https://` conta como "sem configuração" (S125).
- `app.plugin.js`: config plugin do Expo com as `dataExtractionRules` do Android 12+ (nada sai do aparelho por backup ou transferência; o SecureStore continua excluído, S119). Os apps o listam em `plugins` como `'@bairrin/mobile-base'`.

## Regra de lint

Mora no `eslint.config.mjs` da raiz (configuração única do repositório) e é provada por `scripts/regra-de-sessao.test.mjs`. Nas duas pastas, as regras não podem ser desligadas por comentário (`noInlineConfig`), e `import()` e `require` são proibidos (S121).

- `src/sessao/**`: lista de permissão com `react`, `@tanstack/react-query`, `@bairrin/cliente-api`, `@bairrin/contratos` e arquivos da própria pasta. O `expo-secure-store` e a marca de instalação (`../instalacao/marca-de-instalacao.ts`) só entram em `armazenamento-seguro.ts`, que aplica `WHEN_UNLOCKED_THIS_DEVICE_ONLY` em toda chamada (S128). Os testes acrescentam a Testing Library. Qualquer outro armazenamento (AsyncStorage, FileSystem, SQLite, MMKV) reprova.
- `src/instalacao/**` (R10): só o `expo-file-system` e arquivos da própria pasta. A marca não recebe nem grava dado.

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
