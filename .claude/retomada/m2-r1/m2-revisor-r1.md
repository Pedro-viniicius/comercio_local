## Veredito: MUDANÇAS NECESSÁRIAS
## Rodada: 1

O grupo M2 põe no `mobile-base` a sessão dos apps (etapa 12) e os 13 componentes base, os textos e `mensagemDoCampo` (etapa 12a). A etapa 12 traz o cofre no SecureStore com `WHEN_UNLOCKED_THIS_DEVICE_ONLY` e a marca de instalação, a `criarSessaoDoApp`, o provedor, o persister com lista permitida, a S125, o `app.plugin.js` (S119) e o lint por lista de permissão (S121). A 12a leva o `EstadoDaApi` para o pacote, com D2, D8 e D9. A qualidade é alta. O código de sessão é cuidadoso: só a `origem` chega ao `registrarFalha`, os erros nativos perdem o detalhe e a ordem da tela de login está certa (Q18). O cliente autenticado é bem usado. Sobram três defeitos:
- um estado inconsistente quando a fila não é apagada na troca de conta (o `qa` já reproduziu);
- falta uma ação para trocar o par de tokens depois da verificação de e-mail, que a etapa 14 vai precisar;
- a pasta `src/instalacao` não tem proteção própria.

O resto é doc e registro de pendências. A integração do lead está certa: índice, `urlDaApiConfigurada(..., __DEV__)`, ícones e cópia de `assets/` no teste. O workflow já foi commitado em `eac050f`. O Q35 e o `assets/brand` estão bons, com sugestões.

## Critérios de aceite
| CA | Situação | Onde |
|---|---|---|
| CA-03 (token só no SecureStore) | ok | `sessao/armazenamento-seguro.ts`; espiões em `provedor-de-sessao.test.tsx:70` com teste de controle |
| CA-05 (renovação sem senha; logout invalida) | ok | `sessao/sessao-do-app.ts` (`carregar`, `sair`) |
| S18 (`WHEN_UNLOCKED_THIS_DEVICE_ONLY` e limpeza na 1ª abertura) | ok | `armazenamento-seguro.ts:36-129`, `instalacao/marca-de-instalacao.ts` |
| S11 (limpeza no logout, na expiração e na troca de conta; persister restrito) | parcial | `sessao-do-app.ts:165-189`, `persistencia-permitida.ts`; troca de conta com falha na fila: R8 |
| S80, Q18, `clienteDoApp`, `aoFalharEmSegundoPlano` só com a origem | ok | `sessao-do-app.ts:191-200`, `:264-277` |
| S119, `faceIDPermission`, ATS | ok | `app.plugin.js`, `app.config.ts`, `scripts/backup-android.test.mjs`; ATS conferido pelo dev no prebuild do iOS |
| S121 (lint por lista de permissão, sem desligamento inline) | parcial | `eslint.config.mjs:173-247`; a exceção para `src/instalacao` fica sem regra: R10 |
| S125 (https fora de `__DEV__`) | ok | `sessao/url-da-api.ts`, `apps/*/src/app/index.tsx` |
| CA-01, CA-06, CA-13 (parte do app) | parcial | componentes e `mensagemDoCampo` ok; a regra de senha da A2 e a troca de sessão da A3 ficaram sem dono (R9, R12) |
| 12a: 13 componentes, textos, R1, D2, D8, D9 | ok | `src/componentes/*`, `src/telas/EstadoDaApi.tsx`, `src/textos/*` |

## Achados

### ATENÇÃO
- **R8** `packages/mobile-base/src/sessao/sessao-do-app.ts:245-254` — Na troca de conta, quando a fila não é apagada, a sessão A já foi encerrada e `entrar` lança `ErroAoLimparDadosDaConta`.
  - O estado continua `com_sessao`, com o `emailVerificado` de A, mas o cliente autenticado já não tem sessão. As requisições saem sem Bearer.
  - A sessão B, recém-criada no servidor (até 30 dias), fica órfã: o token some da memória sem ser revogado. O mesmo acontece num login simples com a fila travada.
  - É a mesma causa do teste do `qa` em `sessao-do-app.corridas.test.ts:243`, que hoje falha.
  - Correção: no ramo `!fila`, chame `definirSessao(null)` (com a checagem de `versao`) e revogue `nova`. O caminho mais curto é pôr B na revogação pendente pelo próprio cliente: `iniciarSessao(nova)` e depois `encerrarSessao()`. Teste os dois casos (com e sem sessão anterior).
- **R9** `packages/mobile-base/src/sessao/sessao-do-app.ts:97-111` — `SessaoDoApp` não tem como trocar o par de tokens sem limpar os dados.
  - `POST /v1/conta/verificacao-email` devolve uma sessão nova, e a antiga recebe `substituida` (`apps/api/src/modulos/identidade/README.md:76`).
  - A tela da etapa 14 só tem `requisitar`. Sem uma ação nova, o app continua com o par antigo, a próxima renovação é recusada e a pessoa sai da conta logo depois de verificar o e-mail, com a fila apagada.
  - A linha da etapa 14 no plano não cita isso; o dev só deixou como risco.
  - Correção: crie já `substituirSessao(nova)`. Ela chama `autenticado.iniciarSessao(nova)`, não limpa nada e atualiza `emailVerificado`. Exporte pelo `useSessao`, com teste. Se preferir não mexer agora, registre como exigência na linha 14.
- **R10** `eslint.config.mjs:191` e `packages/mobile-base/src/instalacao/` — A lista de permissão da sessão abre `../instalacao/marca-de-instalacao.ts`, mas a pasta:
  - não tem regra de lint nenhuma (nem lista, nem `noInlineConfig`);
  - não está na lista "Regra de negócio" do CLAUDE.md, então fica sem dono definido entre `dev` e `designer`.

  Uma mudança futura que passe dado por esse arquivo atravessa a barreira da S121 sem nenhum aviso.

  Meu julgamento sobre o desvio: aceito. O motivo técnico é bom, porque o Keychain sobrevive à desinstalação e o FileSystem é proibido em `src/sessao`. Mas a pasta precisa da mesma proteção.

  Correção:
  1. Bloco de lint para `packages/mobile-base/src/instalacao/**`: só `expo-file-system`, sem `import()` e sem `require`, com `noInlineConfig`, mais um caso em `scripts/regra-de-sessao.test.mjs`.
  2. O lead propõe ao dono incluir `packages/mobile-base/src/instalacao/**` na lista de regra de negócio do CLAUDE.md.
- **R11** Docs desatualizadas:
  - `packages/mobile-base/README.md:7`: diz "`src/index.ts` ainda não exporta nada".
  - `packages/mobile-base/README.md:20`: descreve a regra antiga, que só proibia AsyncStorage e FileSystem; agora é lista de permissão sem `import()` e sem `require`.
  - `packages/mobile-base/README.md:22-27`: não cita `src/instalacao` nem o `app.plugin.js`.
  - `docs/adr/0012-sessao-e-autenticacao.md:3`: diz que a parte dos apps "ainda não existe".
  - `README.md:106`: chama o `mobile-base` de "hoje um esqueleto".
  - `apps/{consumidor,lojista}/README.md:50`: ensina `http://10.0.2.2:3000` sem avisar que, fora de `__DEV__` (por exemplo, o APK do perfil `preview` apontado para a máquina), `http` vira "sem configuração" (S125).
  - Correção mínima agora, sem esperar a 20b: troque essas frases. Na tabela "O que o app tem" dos apps, cite os ícones, o plugin `@bairrin/mobile-base` e o Face ID desligado.
  - ADR-012 e ADR-014: a decisão não mudou. A porta `registrarFalha` está de acordo com "Sentry só com DSN"; basta corrigir a linha de situação do 012.
- **R12** Itens da spec que não foram implementados e ficaram sem registro no plano:
  - estado de sucesso do Botão (design system, linha 101);
  - contador de caracteres;
  - regra de senha visível com check (A2);
  - posição do "Voltar ao topo";
  - área segura do Toast (`margemInferior`).

  Meu julgamento: aceito deixar fora da 12a, porque nenhuma tela existe ainda. Mas a linha 14 do plano não lista nenhum deles e vão se perder.

  Correção:
  - O lead acrescenta à linha 14 a regra de senha com check, o `margemInferior` com a área segura e a altura da navegação, e o R9, se não for feito agora.
  - O sucesso do Botão e o contador vão para o plano que primeiro os usar.
  - O `designer` confirma o "Voltar ao topo" no fim do texto: a spec 01:39 só diz "rolagem com 'Voltar ao topo'".

### SUGESTÃO
- **R13** `packages/mobile-base/src/sessao/armazenamento-seguro.ts:100-117` — Sobre o risco levantado pelo dev: hoje a limpeza da 1ª abertura apaga também a revogação pendente e o par da instalação anterior, e essas sessões vivem no servidor até 30 dias.
  - O risco real é baixo: os tokens somem do aparelho, então ninguém mais os tem.
  - Converter é barato e fecha as sessões: em `preparar()`, leia as duas chaves, grave na chave de revogação `{par antigo, anteriores}` e apague só `bairrin.sessao`. O `cliente-api` já retoma a revogação na primeira requisição.
  - Leve a decisão ao `seguranca`. Se ficar como está, registre como risco aceito no README do pacote.
- **R14** `packages/mobile-base/src/sessao/sessao-do-app.ts:87-90` — As portas `persister?`, `filaOffline?` e `registrarFalha?` são opcionais.
  - O desvio é aceito, porque a fila e o Sentry não existem. Mas o plano 02 pode montar o provedor sem a fila, e a S11 deixaria de valer em silêncio.
  - Torne-as obrigatórias com `null` explícito, ou cite no plano 02 e na etapa que ligar o Sentry nos apps que essas portas precisam ser passadas.
- **R15** `packages/mobile-base/src/textos/mensagem-do-campo.ts:26` (e a cópia no painel) — O 4º argumento `tela` é aceito e segue o painel. Tipá-lo como `keyof typeof textos.erroPorTela` faz o compilador pegar nome de tela errado.
- **R16** `apps/api/package.json:13` (Q35) — O `test:integracao` usa o mesmo `node_modules/.vitest-cache` do `test` do próprio pacote. O `qa` roda os dois em paralelo, e o ENOTEMPTY pode voltar quando o lockfile mudar. O `scripts/vitest-cache-por-pacote.test.mjs:22` só lê `scripts.test`. Use `--fsModuleCachePath=node_modules/.vitest-cache-integracao` e faça o teste olhar todo script que roda `vitest`. Fora isso, o Q35 está certo: os 5 pacotes têm caminhos distintos e o teste estrutural cobre a regra.
- **R17** `assets/brand/gerar-png.sh:11-12` — O script não é reproduzível no CI: depende do Chrome e do Pillow da máquina, e o antialiasing muda com a versão do Chrome. Versionar os PNG é a escolha certa, e os PNG devem continuar no git.
  - O `>/dev/null 2>&1` esconde erro do Chrome: se ele sair com 0 sem gravar, o PNG velho fica no lugar. Apague o alvo antes e confira depois, com o próprio Pillow, que o arquivo existe com o tamanho pedido.
  - Um teste `node:test` que lê o cabeçalho IHDR (o bloco do PNG com tamanho e tipo de cor) dos PNG citados nos `app.config.ts` garante o formato no CI sem Chrome: 1024, RGB sem alfa no iOS e RGBA na frente e no mono.
  - Hoje os formatos estão certos (conferi com `file`).
- **R18** `apps/painel/src/autenticacao/bairrin-logo-horizontal.svg` (pré-existente) — O logo do painel (viewBox 232×66, com `width` e `height`) é diferente do `assets/brand/bairrin-logo-horizontal.svg` (197×66). A pendência da spec 01:260 continua válida. Faça o `LogoBairrin.tsx` importar o asset da marca, ou crie um teste de igualdade como o `logo.test.ts` do mobile.
- **R19** `.github/workflows/android-nativo.yml:53-59` — O conserto está certo. Para recuperar o cache do Gradle, use `actions/cache` (ou `gradle/actions/setup-gradle`) depois do passo `expo prebuild`, com chave em `apps/<app>/android/**/*.gradle*`.

## Verificação
- `jest` do `@bairrin/mobile-base` → 377 passaram e 1 falhou, em 378 (linha de base: 370). A falha é do teste novo do `qa`, `sessao-do-app.corridas.test.ts` (16:26); a causa é a mesma do R8.
- `jest` do `consumidor` e do `lojista` → 21/21 cada (linha de base: 9; os extras são do `qa`).
- `pnpm lint` (eslint e prettier) → ok. `pnpm typecheck` → ok. `pnpm deps:verificar` → sem violações (531 módulos).
- `node --test` com `regra-de-sessao`, `apps-expo`, `backup-android`, `vitest-cache-por-pacote` e `instalacao-limpa` → 82 de 83. A falha é `instalacao-limpa` no `mobile-base`, causada pelos arquivos do `qa` em andamento: `corridas` e `mensagem-do-campo.bordas.test.ts:86`, com "reading 'safeParse'". O lead tinha 7/7 antes deles. Rode de novo quando o `qa` terminar.
- A integração da API não foi rodada, como pedido.

## Perguntas para o autor
1. Com `WHEN_UNLOCKED`, um app aberto em segundo plano com o aparelho bloqueado (push ou tarefa, nos planos futuros) falha em `ler_sessao` e mostra `sem_sessao` até reabrir. Vale um "tentar de novo ao voltar ao primeiro plano" quando essas funções entrarem?
2. Pergunta para o `designer`: no iOS, ao enviar com N erros, cada `Campo` chama `anunciar(erro)` e a tela ainda anuncia o total (`errosNoEnvio`). Os anúncios seguidos se cortam no VoiceOver. A etapa 14 deve suprimir o anúncio por campo no envio?

Memória atualizada em `/home/ufla/Documentos/comercio_local/.claude/agent-memory/revisor/heuristicas-de-revisao.md` (padrões do M2).
