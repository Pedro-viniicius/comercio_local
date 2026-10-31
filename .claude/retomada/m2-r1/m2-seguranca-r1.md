## Veredito: SEM BLOQUEIOS
## Rodada: 1
## Resumo de risco
A sessão dos apps cumpre o CA-03. O par de tokens só vai ao SecureStore, sempre com `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, e não aparece em log, erro, estado do React, `queryClient`, persister ou fila. A revogação pendente tem chave própria. A regra de lint por lista de permissão resistiu a todas as sondagens de import que fiz. Não há achado CRÍTICO, ALTO nem MÉDIO. Fica um ponto BAIXO: a limpeza da primeira abertura esquece a credencial antiga em vez de revogá-la (S127). Os demais são pontos de endurecimento e registros para o plano 02. O `node-forge` saiu: o audit `--prod` não tem mais aviso alto.

## Achados

### S127 [BAIXA] A limpeza da primeira abertura apaga a sessão e a revogação pendente da instalação anterior sem revogar no servidor
- CWE: CWE-613 (expiração de sessão insuficiente)
- Local: `packages/mobile-base/src/sessao/armazenamento-seguro.ts:100-117` (linha 110)
- Fluxo do dado: o par fica no Keychain, que no iOS sobrevive à desinstalação → reinstalação → `preparar()` não acha a marca → `deleteItemAsync` nas duas chaves → o token de renovação continua válido no servidor por até 30 dias.
- Cenário de exploração: o usuário sai do app sem rede (a revogação fica pendente, como prevê o S80) e depois desinstala e reinstala. A pendência é apagada e o logout nunca chega ao servidor. Só tira proveito disso quem já tinha copiado o par antes, mas é exatamente esse o caso que o S80 quer fechar.
- Impacto: baixo. O token deixa de existir no aparelho e ninguém mais o tem, a não ser quem já o tinha roubado.
- Correção recomendada: converter a sessão antiga em revogação pendente. Não é decisão do dono: BAIXA é opcional pela tabela de severidade, mas o custo é pequeno e fecha o S80 de vez. Em `preparar()`, quando a instalação for nova:
  1. ler os valores brutos das duas chaves, tolerando erro e JSON quebrado;
  2. montar a lista `[par da sessão antiga, pendência antiga, ...anteriores]`, limitada a `MAXIMO_DE_REVOGACOES_PENDENTES`;
  3. gravar essa lista em `bairrin.revogacao-pendente` e apagar `bairrin.sessao`;
  4. só então criar a marca.
  
  O par antigo nunca passa por `ArmazenamentoDeSessao.ler`, então não vira sessão. O `carregar()` já chama `renovarSessao()` quando não há sessão, e isso retoma as pendências. Teste: reinstalação com sessão e pendência antigas → o DELETE de renovação sai com os dois pares, e a tela fica em `sem_sessao`.

### S128 [INFORMATIVA] Superfície da sessão maior que o necessário: exceção da marca no lint, SecureStore liberado em toda a pasta e cofre exportado pelo índice
- CWE: CWE-1188 (padrão inseguro de configuração)
- Local: `eslint.config.mjs:183-191`; `packages/mobile-base/src/sessao/index.ts:174-181`; `packages/mobile-base/src/index.ts:7`
- Fluxo do dado: o par sai do SecureStore e passa por `criarCofreDaSessao().sessao.ler()`, que qualquer código de app pode chamar, fora da regra de lint.
- Cenário de exploração: não há ataque. O risco é engano em mudança futura:
  - uma função nova em `marca-de-instalacao.ts` (arquivo fora do lint) que escreva texto vira canal para o token, sem reprovar nada;
  - um `setItemAsync` sem `OPCOES_DO_SECURE_STORE` em outro arquivo de `src/sessao` cai no padrão `WHEN_UNLOCKED`, que não é `THIS_DEVICE_ONLY`;
  - uma tela pode ler o token pelo cofre exportado.
- Impacto: nenhum hoje.
- Correção recomendada:
  - A exceção `../instalacao/marca-de-instalacao.ts` é aceitável. Reforce com um teste da superfície exportada do módulo (exatamente `ARQUIVO_DA_MARCA_DE_INSTALACAO` e `marcaDeInstalacaoNoAparelho`, com `marcar` sem parâmetro) ou injete a marca pelo índice do pacote.
  - Restrinja `expo-secure-store` a `armazenamento-seguro.ts`: um bloco de lint que o tire da lista nos outros arquivos.
  - Tire do índice público `criarCofreDaSessao`, `CHAVE_DA_SESSAO` e `criarSessaoDoApp`; os apps só precisam de `ProvedorDeSessao`, `useSessao`, `urlDaApiConfigurada`, `criarPersisterPermitido` e dos tipos.

### S129 [BAIXA] Senha visível no Android sem `visible-password`: o teclado pode aprender ou sugerir a senha
- CWE: CWE-524 (dado sensível em cache), MASVS-STORAGE (cache de teclado)
- Local: `packages/mobile-base/src/componentes/Campo.tsx:86-95`
- Fluxo do dado: a pessoa toca em "Mostrar" → `secureTextEntry` passa a `false` → o `inputType` vira texto comum com `NO_SUGGESTIONS` → o teclado de terceiros pode guardar a senha no dicionário de aprendizado.
- Cenário de exploração: a senha aparece depois como sugestão para quem usa o aparelho, ou fica no histórico do teclado.
- Impacto: baixo. Exige a pessoa mostrar a senha e um teclado que ignore `NO_SUGGESTIONS`.
- Correção recomendada: com a senha visível, use `keyboardType: Platform.OS === 'android' ? 'visible-password' : 'default'`, mais um teste. O resto está certo: `secureTextEntry`, `autoCorrect`/`spellCheck` desligados e `current-password`/`new-password` com o `textContentType` correspondente.

### S130 [INFORMATIVA] `NSAllowsLocalNetworking: true` no Info.plist do template vale também no build de produção do iOS
- CWE: CWE-319 (transmissão em texto puro)
- Local: template do `expo prebuild` (iOS). Os apps não definem `ios.infoPlist.NSAppTransportSecurity` em `apps/consumidor/app.config.ts:18` nem em `apps/lojista/app.config.ts:18`.
- Fluxo do dado: em produção, o app pode abrir `http://` para nomes `.local` e nomes sem domínio.
- Cenário de exploração: hoje nenhum, porque o S125 obriga `https://` para a API fora de `__DEV__`. Passa a importar quando o app carregar URL vinda de dado (imagens de loja, links).
- Impacto: nenhum hoje.
- Correção recomendada: no `app.config.ts`, defina `NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: <só no perfil de desenvolvimento> }`, por exemplo pelo `EAS_BUILD_PROFILE`. Confira no primeiro `prebuild -p ios` ou build do EAS. A introspecção não serve para isso: ela mostra o Info.plist de reserva, com `NSAllowsArbitraryLoads: true`.

### S131 [INFORMATIVA] Na troca de conta, se a fila não for limpa, a sessão nova fica órfã no servidor e o estado continua `com_sessao`
- CWE: CWE-613
- Local: `packages/mobile-base/src/sessao/sessao-do-app.ts:253-254`
- Fluxo do dado: `POST /v1/sessoes` cria a sessão nova → a conta anterior é encerrada → `limparDadosDaConta()` falha na fila → `throw ErroAoLimparDadosDaConta`.
  - O par novo é descartado sem revogação: fica vivo por até 30 dias, mas ninguém o tem.
  - O estado não muda para `sem_sessao`, porque `aoEncerrarSessao('logout')` não mexe no estado.
- Impacto: desprezível para segurança. Na interface, o app parece logado sem sessão.
- Correção recomendada: no caminho de erro, revogue o par novo (pelo cliente autenticado, ou deixando-o como pendência) e chame `definirSessao(null)` quando a anterior tiver sido encerrada.

### S132 [INFORMATIVA] O S119 fecha o backup só no Android; no iOS, `Documents` e `Application Support` vão para o iCloud
- CWE: CWE-530 (exposição de dado em backup)
- Local: `packages/mobile-base/app.plugin.js` (só Android); `packages/mobile-base/src/sessao/persistencia-permitida.ts` (persister futuro)
- Fluxo do dado: hoje só a marca vazia (`Paths.document`) vai para o backup do iCloud. Os itens `*_THIS_DEVICE_ONLY` do Keychain não migram para outro aparelho. No plano 02, a fila offline (dados da conta) e o cache persistido vão gravar em AsyncStorage, SQLite ou arquivo, que no iOS ficam em pastas copiadas pelo backup e pela migração de aparelho.
- Impacto: nenhum hoje.
- Correção recomendada: registre no plano 02 que a fila e o cache no iOS ficam em `Paths.cache`, ou com exclusão de backup (`NSURLIsExcludedFromBackupKey`), com teste. O mesmo vale para qualquer arquivo com dado da conta.

## Conferido sem achado (respostas ao foco)
1. **CA-03, S18, S11, S80 e S121:**
   - Token e `Authorization`: só no SecureStore e na rede. Fora do estado entregue às telas, sem `console`, e com erros nativos trocados por mensagens fixas (`semDetalhe`). O `registrarFalha` recebe só a origem. O persister é filtrado na borda: só a lista permitida, sem mutações, `meta` nem erros. O teste com espiões tem controle positivo (prova que os espiões pegam uma gravação com o token).
   - `WHEN_UNLOCKED_THIS_DEVICE_ONLY` é aplicado em get, set e delete. No Android a opção não existe (Keystore sem exigir desbloqueio); é limitação da plataforma.
   - A limpeza da primeira abertura funciona: toda operação espera por ela, uma falha refaz na próxima, a ordem é apagar e depois marcar, e há 6 testes.
   - A revogação pendente usa a chave `bairrin.revogacao-pendente`, separada da sessão.
   - Lint: sondei pela config real `import x = require(...)`, `export * from 'react-native'`, `./teste/../../`, `import type` e `require` por apelido; todos reprovam. `typeof import()` passa, mas é só tipo e não chega ao bundle. A exceção da marca é aceitável, com o reforço do S128.
2. **Risco do dev:** recomendo converter em revogação pendente (S127, BAIXA). Não precisa de aceite do dono.
3. **S119:** o XML exclui os 9 domínios com `path="."` na nuvem e na transferência e mantém `sharedpref/SecureStore`. O manifesto aponta para `@xml/bairrin_regras_de_extracao`, com `allowBackup=false` e sem `fullBackupContent`. O teste basta:
   - a introspecção prova o atributo final, depois de todos os plugins;
   - o conteúdo vem da mesma função testada;
   - se o arquivo XML não for escrito, o Gradle do `android-nativo.yml` falha (recurso ausente), ou seja, falha fechada.
   
   Opcional: um passo no workflow, depois do prebuild, que compare o XML gerado com `regrasDeExtracao()`. iOS: ver S132.
4. **S125:** `urlDaApiConfigurada` só aceita `https://` com host fora de `__DEV__`. `HTTPS://` em maiúsculas vira "sem configuração", o que é falha fechada. Os dois apps ligam a função com `__DEV__`, e é a única leitura de `EXPO_PUBLIC_API_URL`. O `juntarUrl` concatena texto, então o `caminho` não troca o host. `NSAllowsLocalNetworking`: ver S130.
5. **`registrarFalha` e o ADR-014:** recebe só a origem e não chama `setUser`, de acordo com o ADR-014. As rejeições que podem chegar a um tratador global do Sentry no futuro têm mensagem fixa: `ErroDeApi` com status e código, `ErroAoLimparDadosDaConta` e `semDetalhe`. Quando o Sentry entrar, valem os requisitos de React Native do ADR-014, como `enableAutoSessionTracking: false`, crash nativo, `beforeSend` sem `user` e `contexts.device`.
6. **Componentes:**
   - `CampoDeCodigo`: só dígitos, até 6, `one-time-code`, valor fora da árvore de acessibilidade das casas.
   - `LeitorDeTextoLegal`: só `Text`, sem link, HTML ou imagem; as expressões regulares são lineares.
   - SVG do logo: só `svg/g/path/circle/rect`, sem `script`, `href`, `image`, `foreignObject` ou `url()`. A única URL é o namespace `http://www.w3.org/2000/svg`.
7. **`gerar-png.sh`:** roda o Chrome em modo headless (sem `--no-sandbox`) sobre `file://` dos SVGs locais e o Pillow com `python3 -I`, passando o caminho por argumento. Não baixa nada e não roda no CI. Os PNGs não têm metadados de texto. Os SVGs não têm referência externa, então nada é buscado na rede.
8. **Q35:** `--fsModuleCachePath` aponta para `node_modules/.vitest-cache` de cada pacote, que está no `.gitignore` e no `.dockerignore`. Sem impacto de segurança. O commit `eac050f` só tirou o `cache: gradle`, o que reduz o risco de cache envenenado.

## A verificar
- **Aparelho iOS real:** fazer login, desinstalar, reinstalar e conferir que abre `sem_sessao` (depois do S127, que sai o DELETE de renovação). O Jest não prova o comportamento do Keychain.
- **Aparelho Android 12+:** conferir com `adb shell bmgr` que o backup e a transferência D2D do pacote saem vazios.
- **Montagem do `ProvedorDeSessao` nos apps (etapa 14):** ainda não está ligado. Conferir que usa o mesmo `urlDaApiConfigurada(..., __DEV__)`, que o `registrarFalha` só recebe a origem e que as telas da conta A desmontam antes da troca. Uma requisição em andamento da conta A que grave no `queryClient` depois do `clear()` mostraria dado de A a B.
- **Info.plist do primeiro `prebuild -p ios` ou build do EAS:** conferir o ATS (S130).

## Riscos aceitos que continuam valendo
- P2 (sem EAS Update): continua valendo. O manifesto do prebuild traz `expo.modules.updates ENABLED=false` do template, e `expo-updates` segue fora do lockfile.
- O aceite temporário do `node-forge` foi encerrado. O lockfile está no 1.4.2, dentro de `^1.4.0`, sem override, e o commit do M1 saiu em 2026-10-31, depois do prazo de 2026-10-30.

## Dependências
`pnpm audit --prod` em 2026-10-31: 2 moderadas e 1 baixa. Nenhuma vai no bundle dos apps nem na imagem da API: só aparecem no grafo de produção porque o `expo` traz o CLI e a configuração, e porque o `expo-router` arrasta o jest. Resultado: INFORMATIVA. Não faça override: as correções saltam major contra a faixa declarada pelo pacote de cima (caso do S123). Espere atualização do Expo e do jest.

| Pacote | Versão | Vulnerabilidade | Versão corrigida | Só dev? |
|---|---|---|---|---|
| minimatch | 3.1.5 / 9.0.9 / 10.2.6 | GHSA-g3hv-75wg-m249 (DoS por amplificação de globparts), moderada | >=11.0.1 | Sim na prática (`@expo/config*`, `@expo/fingerprint`, `@expo/cli`, jest, eslint) |
| glob | 7.2.3 / 10.5.0 / 13.0.6 | GHSA-3g3m-2fjr-6pw4 (cancelamento por AbortSignal contornado), moderada | >=14.0.2 | Sim na prática (`@expo/config*`, jest, `@sentry/bundler-plugins`) |
| deepmerge | 4.3.1 | GHSA-gcqx-w48m-w2h4 (poluição de protótipo no `mergeObject`), baixa | sem correção | Sim na prática (`@expo/config`, `jest-config`; a entrada é a config do próprio repositório) |
| node-forge | 1.4.2 | GHSA-86w9-cpqp-85rv resolvido | — | — |

Memória atualizada nos arquivos:
- `/home/ufla/Documentos/comercio_local/.claude/agent-memory/seguranca/areas-sensiveis.md`
- `/home/ufla/Documentos/comercio_local/.claude/agent-memory/seguranca/riscos-aceitos.md` (aceite do `node-forge` encerrado)
- `/home/ufla/Documentos/comercio_local/.claude/agent-memory/seguranca/problemas-recorrentes.md` (3 padrões novos)
- `/home/ufla/Documentos/comercio_local/.claude/agent-memory/seguranca/MEMORY.md`

Maior ID usado: S132.
