## Resumo
A etapa 12 (sensível: sessão) do 01b está implementada no `packages/mobile-base`. Os tokens ficam só no SecureStore, com `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (opção que só permite ler com o aparelho desbloqueado e impede que o item saia dele). Na primeira abertura depois de instalar, as chaves antigas são apagadas. Logout, expiração e troca de conta limpam `queryClient`, cache persistido e fila. A tela de login só aparece depois que a renovação ou o logout terminou. Junto vieram os pré-requisitos do M1: S119 (regras de backup próprias, com teste do manifesto gerado), `faceIDPermission: false`, S121 (lint por lista de permissão sem desligamento inline, mais o teste com espiões) e S125. Não entrou dependência nova, e o lockfile está igual ao HEAD.

## Arquivos alterados
- `packages/mobile-base/src/sessao/armazenamento-seguro.ts` (novo): `criarCofreDaSessao()` devolve o `ArmazenamentoDeSessao` (chave `bairrin.sessao`) e o `ArmazenamentoDeRevogacao` numa chave própria, `bairrin.revogacao-pendente` (S80).
  - Toda chamada ao SecureStore usa `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
  - Limpeza da primeira abertura (S18): toda operação espera por ela; se falhar, a operação rejeita e a próxima tenta de novo.
  - Os erros nativos viram mensagens sem detalhe.
- `packages/mobile-base/src/sessao/sessao-do-app.ts` (novo): `criarSessaoDoApp`, a parte sem React.
  - Monta `criarClienteAutenticado` com `modoDeRenovacao: 'token'` e o `clienteDoApp`; `aoFalharEmSegundoPlano` repassa só a `origem`.
  - Estados: `carregando`, `sem_sessao` e `com_sessao`.
  - Ações: `entrar` (login pelo cliente base; na troca de conta revoga a anterior), `sair` e `requisitar`.
  - Limpeza no logout, na expiração e na troca de conta.
  - Ao abrir o app, chama `renovarSessao()` só se o token venceu ou se não há sessão (nesse caso só retoma as revogações pendentes).
- `packages/mobile-base/src/sessao/provedor-de-sessao.tsx` (novo): `ProvedorDeSessao` e `useSessao`. Envolve o `QueryClientProvider` com o mesmo `queryClient` que é limpo. As telas recebem só o estado, `emailVerificado` e as ações, nunca o token.
- `packages/mobile-base/src/sessao/persistencia-permitida.ts` (novo): `CONSULTAS_PERSISTIDAS` (vazia, congelada), `podePersistir`, `filtrarCache` e `criarPersisterPermitido` (S11).
  - O filtro fica na borda do persister: só consultas da lista e com sucesso; nenhuma mutação, `meta`, promessa ou erro.
  - A interface é a mesma do `Persister` do TanStack.
- `packages/mobile-base/src/sessao/url-da-api.ts` (novo): `urlDaApiConfigurada(valor, emDesenvolvimento)` (S125).
- `packages/mobile-base/src/sessao/index.ts` (novo): exporta tudo da sessão.
- `packages/mobile-base/src/sessao/teste/{secure-store-falso,espiao,api-falsa,cenario}.ts` (novos): auxiliares dos testes.
- Testes novos em `packages/mobile-base/src/sessao/`: `armazenamento-seguro.test.ts`, `sessao-do-app.test.ts`, `provedor-de-sessao.test.tsx`, `persistencia-permitida.test.ts`, `url-da-api.test.ts`.
- `packages/mobile-base/src/instalacao/marca-de-instalacao.ts` e `.test.ts` (novos, fora da posse listada; ver Decisões): arquivo vazio `bairrin-instalacao` em `Paths.document`.
- `packages/mobile-base/app.plugin.js` (novo): config plugin com as regras de extração do Android 12+. Exclui os 9 domínios com `path="."` na nuvem e na transferência entre aparelhos, mantém `<exclude domain="sharedpref" path="SecureStore"/>` e grava o XML no prebuild.
- `packages/mobile-base/package.json`: `exports` ganhou `"./app.plugin.js"`.
- `apps/consumidor/app.config.ts` e `apps/lojista/app.config.ts`: `['expo-secure-store', { configureAndroidBackup: false, faceIDPermission: false }]` e o plugin `'@bairrin/mobile-base'`; comentário do `allowBackup` atualizado.
- `eslint.config.mjs`:
  - `src/sessao` passou a usar lista de permissão por `patterns[].regex` com `caseSensitive: true`. Entram só `expo-secure-store`, `react`, `@bairrin/cliente-api`, `@bairrin/contratos`, `@tanstack/react-query`, arquivos `./` da própria pasta e `../instalacao/marca-de-instalacao.ts`.
  - Testes e auxiliares podem também `@testing-library/react-native`; os auxiliares de `teste/` podem `../<arquivo>`.
  - `import()` e qualquer `require` reprovam, e `noInlineConfig` impede desligar as regras por comentário.
  - Override de `no-require-imports` só para o `app.plugin.js`.
- `scripts/regra-de-sessao.test.mjs` (do `qa`): quatro casos que antes "deixavam passar" agora reprovam (`import()` do SecureStore, `expo-file-system-extra`, `import()` e `require` com template). Entraram casos novos: `react-native`, `expo-sqlite`, `@bairrin/tokens`, `../`, `require` por apelido, a lista de testes e auxiliares, e o `noInlineConfig` testado com `lintText`.
- `scripts/apps-expo.test.mjs` (do `qa`): só o bloco do plugin do SecureStore, com as opções novas e o plugin `@bairrin/mobile-base` na config e nas dependências.
- `scripts/backup-android.test.mjs` (novo): confere o XML das regras e, pela introspecção do Expo, o manifesto dos dois apps (`dataExtractionRules` do Bairrin, sem `fullBackupContent` e sem `secure_store_*`) e o Info.plist sem `NSFaceIDUsageDescription`.

## Critérios de aceite
| CA / exigência | Onde está | Teste |
|---|---|---|
| CA-03: token só no SecureStore; nada em AsyncStorage, arquivos ou SQLite (S18, S121) | `armazenamento-seguro.ts`, `sessao-do-app.ts` | `provedor-de-sessao.test.tsx`, "login: o token só chega ao SecureStore…" (espiões em AsyncStorage, `expo-file-system`, `/legacy`, `expo-sqlite`, `kv-store`, fila e persister), mais o teste de controle dos espiões |
| `WHEN_UNLOCKED_THIS_DEVICE_ONLY` | `armazenamento-seguro.ts` | `armazenamento-seguro.test.ts` (toda chamada) e o teste de login |
| Limpeza na primeira abertura (S18) | `armazenamento-seguro.ts`, `instalacao/marca-de-instalacao.ts` | 5 testes em "primeira abertura…" e `marca-de-instalacao.test.ts` |
| Limpeza no logout, na expiração e na troca de conta (S11) | `sessao-do-app.ts` | `sessao-do-app.test.ts` ("logout", "expiração", "troca de conta") |
| Persister só com a lista permitida (S11); token e `Authorization` fora dele e da fila (S121) | `persistencia-permitida.ts` | `persistencia-permitida.test.ts` e o teste de login |
| `ArmazenamentoDeRevogacao` em chave própria (S80) | `armazenamento-seguro.ts` | "guarda a revogação pendente numa chave própria", "sem rede, mantém a revogação…", "na próxima abertura, retoma…" |
| `aoFalharEmSegundoPlano` só com a `origem` | `sessao-do-app.ts` | "registrarFalha recebe só a origem…" e "um registrarFalha que lança…" |
| `clienteDoApp` nas opções | `sessao-do-app.ts` | corpo do login e da renovação com `cliente: 'app_consumidor'` |
| Tela de login só depois de `renovarSessao()`/`encerrarSessao()` | `sessao-do-app.ts` | ordem `['requisicao terminou', 'estado:sem_sessao']`, `carregando` durante o DELETE e durante a renovação ao abrir, e o teste do provedor |
| CA-05: renovação sem senha; logout invalida | `sessao-do-app.ts` | "renova sem senha…" e "revoga no servidor e limpa…" |
| S119: regras próprias com a exclusão do SecureStore; teste do manifesto gerado | `app.plugin.js`, `app.config.ts` | `scripts/backup-android.test.mjs` |
| `faceIDPermission: false` | `app.config.ts` | `backup-android.test.mjs` (Info.plist) e `apps-expo.test.mjs` |
| S121: lint por lista de permissão, sem desligamento inline | `eslint.config.mjs` | `scripts/regra-de-sessao.test.mjs` |
| S125: fora de `__DEV__`, sem `https://` vira "sem configuração" | `url-da-api.ts` | `url-da-api.test.ts` |

## Verificação
- `pnpm --filter @bairrin/mobile-base exec jest src/sessao` → 46 passaram, 0 falharam.
- `jest src/instalacao` → 3 passaram.
- Suíte do pacote (`pnpm --filter @bairrin/mobile-base test`) → 370 passaram em 27 suítes, já com as da 12a. Linha de base: 3.
- `tsc --noEmit` do `mobile-base` → ok.
- `pnpm exec eslint packages/mobile-base eslint.config.mjs` mais os scripts e `app.config.ts` → ok. `prettier --check` → ok.
- `node --test scripts/regra-de-sessao.test.mjs scripts/apps-expo.test.mjs scripts/backup-android.test.mjs` → 75 passaram.
- `pnpm deps:verificar` → sem violações (526 módulos).
- Mutações, todas pegas e depois restauradas:
  - tirar o `noInlineConfig` derruba 1 teste da regra;
  - tirar o plugin e pôr `configureAndroidBackup: true` derruba o teste do manifesto;
  - estado imediato na expiração, erro repassado ao `registrarFalha`, `keychainAccessible` removido e login sem limpar a fila: cada um derruba de 1 a 4 testes.
- `expo prebuild --no-install --platform all` no consumidor:
  - o XML saiu certo e o manifesto aponta para `@xml/bairrin_regras_de_extracao`;
  - Info.plist sem Face ID e com ATS `NSAllowsArbitraryLoads=false`, o que fecha o item r2 do M1;
  - `android/` e `ios/` foram apagados e o `package.json` do app foi restaurado.
- `pnpm install --frozen-lockfile`: não rodei, porque não mudei dependência e o lockfile está igual ao HEAD.
- `pnpm audit --prod`: o `node-forge` não aparece mais. Aparecem 3 achados que não são da etapa (lockfile igual ao HEAD), todos vindos do `expo`: `minimatch` e `glob` (moderados, via `@expo/config-plugins` e `jest`) e `deepmerge` (baixo, via `@expo/config`). `--audit-level=high` passa.

## Decisões e desvios do plano
- **Marca de instalação em `src/instalacao/` (pasta nova, fora da posse listada):** o Keychain sobrevive à desinstalação, então a marca precisa morar num lugar que o sistema apaga junto com o app. O único disponível sem dependência nova é o FileSystem, que o lint proíbe em `src/sessao`. A marca é um arquivo vazio, sem dado nenhum, e a lista de permissão abre exatamente esse arquivo.
- **Lista de permissão por `regex`, não por `group` com `*`:** testei a forma do plano, e `!@bairrin/contratos` e `!./a.ts` continuam reprovados, porque o `ignore` não reinclui um arquivo dentro de uma pasta excluída.
- **`import()` e `require` proibidos de vez em `src/sessao`:** é mais restritivo que antes; por isso ajustei os casos "deixa passar" do teste do `qa`.
- **Sentry:** não está instalado nos apps, então ficou a porta `registrarFalha(origem)`. Ela recebe só a `origem` (origens do cliente, `marca_de_instalacao`, `ler_sessao`, `limpar_cache`, `limpar_fila`). Quando o Sentry entrar, liga-se aqui, sem `setUser` (ADR-014).
- **Fila offline e persister real ainda não existem (plano 02):** o provedor recebe `filaOffline` e `persister` como portas opcionais. Se a fila da conta anterior não for apagada, `entrar` rejeita com `ErroAoLimparDadosDaConta`, para a conta nova não enviar operações da outra. A falha do cache persistido (só dados públicos) não bloqueia o login.
- **Estado `carregando` durante o `sair()`**, e a troca de visual para `sem_sessao` na expiração por `setTimeout(0)` depois da limpeza. Os dois atendem à exigência da tela de login.
- **Abrir o app sem rede** com o token vencido deixa o app em `carregando` até a renovação falhar (até 10 s, o tempo limite do cliente) e depois segue com a sessão guardada.

## Pendências e riscos
- **Lead:** ligar `export * from './sessao/index.ts'` em `packages/mobile-base/src/index.ts`.
- **Lead:** em `apps/*/src/app/index.tsx`, usar `urlDaApiConfigurada(process.env.EXPO_PUBLIC_API_URL, __DEV__)` e montar o `ProvedorDeSessao` com o `clienteDoApp` de cada app (`app_consumidor` ou `app_lojista`).
- **README do `mobile-base` (etapa 20b):** documentar a sessão, a limpeza, a lista permitida, o `app.plugin.js` e a regra de lint. Os ADR-012 e 014 não mudaram de decisão: o 012 só precisa, mais tarde, trocar o "ainda não existe" da parte dos apps.
- **Risco:** a limpeza da primeira abertura também apaga a revogação pendente da instalação anterior, como o plano pede. Esses tokens vivem no servidor até vencer (até 30 dias). Alternativa a decidir: transformar a sessão antiga em revogação pendente em vez de apagá-la.
- **Risco:** o template iOS traz `NSAllowsLocalNetworking: true`, que permite `http` na rede local também no build de produção. O S125 cobre isso no JS.
- **Etapa 14:** a verificação de e-mail devolve a sessão renovada, e a sessão do app ainda não tem uma ação para trocar a sessão sem limpar os dados. A tela da etapa 14 vai precisar dessa ação.
- O manifesto do prebuild traz `meta-data` de `expo.modules.updates` com `ENABLED=false`, que vem do template. Só registro, não mexi.
- Os achados moderados e baixo do `audit` (`minimatch`, `glob`, `deepmerge`, todos via `expo`) são anteriores à etapa e ficam para o lead decidir.
- Registrei na memória do `dev` (`sessao-mobile-etapa12.md`) as armadilhas da lista por regex, dos timers do React Query que seguram o Jest e da introspecção versus prebuild.

