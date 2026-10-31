## Veredito: APROVADO COM RESSALVAS
Todos os CAs têm teste passando. Há 3 bugs baixos (Q36 a Q38). Os 3 testes que os reproduzem ficam vermelhos de propósito, até o `dev` corrigir. Não há bug alto nem médio.

## Rodada: 1

## Matriz de critérios de aceite
Caminho-base dos testes: `packages/mobile-base/src/` (abreviado como `mb/`). Arquivos de teste novos meus: `sessao-do-app.corridas`, `armazenamento-seguro.bordas`, `provedor-de-sessao.bordas`.

| CA ou exigência | Cenários | Teste (arquivo::nome) | Resultado |
|---|---|---|---|
| CA-03: token só no SecureStore (S18, S121) | Login com espiões em AsyncStorage, FileSystem, SQLite, fila e persister (já existia). Eu adicionei: valor do contexto sem token, erro de login sem senha, falha ao gravar no login e na renovação sem token guardado nem na falha (só a origem) | `mb/sessao/provedor-de-sessao.bordas.test.tsx::as telas recebem só o estado…`, `::login recusado chega à tela como ErroDeApi, sem token…`; `mb/sessao/sessao-do-app.corridas.test.ts::no login: a sessão vale em memória…`, `::na renovação: …o par antigo não fica guardado` | passa |
| `WHEN_UNLOCKED_THIS_DEVICE_ONLY` | Limpeza da 1ª abertura, gravar, ler, apagar, revogação pendente: toda chamada leva a opção | `mb/sessao/armazenamento-seguro.bordas.test.ts::toda chamada ao SecureStore leva WHEN_UNLOCKED_THIS_DEVICE_ONLY, em qualquer caminho`; o teste original cobre o resto | passa |
| Limpeza da 1ª abertura (falha e nova tentativa) | Falha só na revogação pendente (rejeita, não marca, o retry apaga as duas); operações concorrentes enquanto falha, sem nenhum `setItem`; reabertura mantém a sessão atual; 3 leituras concorrentes fazem 1 limpeza; `aoFalhar` que lança não muda o resultado | `mb/sessao/armazenamento-seguro.bordas.test.ts` (5 testes de "limpeza da primeira abertura…") | passa |
| Limpeza no logout, na expiração e na troca de conta, com o login só depois | Logout, expiração e troca com fila lenta ou presa: o login só aparece depois que a fila foi apagada | `mb/sessao/sessao-do-app.corridas.test.ts::logout com a fila offline lenta…`, `::expiração com a fila offline lenta…` (2 casos), `::a conta nova só é guardada depois que a fila da anterior foi apagada…` | passa |
| Corridas: logout durante a renovação | Ao abrir o app e em requisição com 401. A resposta tardia não regrava a sessão, a requisição não repete com o token novo, o login só aparece depois do DELETE | `mb/sessao/sessao-do-app.corridas.test.ts::logout durante a renovação` (3 testes, inclui toque duplo em Sair) | passa |
| Corridas: troca de conta e expiração cruzadas | Renovação da conta A (ok ou recusada) depois da troca para B não derruba nem sobrescreve B; login durante o logout anterior; SecureStore falhando ao apagar ou ler a conta A | `mb/sessao/sessao-do-app.corridas.test.ts::expiração durante outras operações`, `::login enquanto o logout anterior ainda corre…`, `::troca de conta com o SecureStore falhando` | passa |
| Troca de conta com fila não vazia, quando a limpeza falha | A conta A foi encerrada e a interface tem de refletir isso | `mb/sessao/sessao-do-app.corridas.test.ts::se a fila da conta A não puder ser apagada, a interface não fica "com sessão" sem sessão guardada` | **falha (Q36)** |
| Provedor: StrictMode, desmontagem durante a renovação | Renovação uma vez só; desmontar no meio sem erro de console | `mb/sessao/provedor-de-sessao.bordas.test.tsx` | passa |
| CA-05, `clienteDoApp`, `aoFalharEmSegundoPlano`, revogação em chave própria | Já cobertos pelo dev; confirmados por mutação (abaixo) | `mb/sessao/sessao-do-app.test.ts`, `armazenamento-seguro.test.ts` | passa |
| S125 (`urlDaApiConfigurada`) | Nos dois apps: 10 endereços sem https fora de `__DEV__` viram "sem configuração" e não chamam a API; https vale; `http` vale em `__DEV__` | `apps/{consumidor,lojista}/src/testes/rotas.https.test.tsx` (12 casos cada) | passa |
| S125 no bundle de produção | Export Android com `http://10.0.2.2:3000`: o bundle traz `urlDaApiConfigurada("http://10.0.2.2:3000",!1)`, ou seja `__DEV__` falso. Prova manual, saída apagada | (sonda) | ok |
| CA-13: `mensagemDoCampo` com esquemas reais | Cerca de 20 valores hostis por campo, em 7 esquemas reais. Texto nunca vazio, nunca em inglês, nunca repete o digitado, curto. A chave `erro.<campo>.<codigo>` vence o motivo | `mb/textos/mensagem-do-campo.bordas.test.ts` (3 testes; mais de 300 erros exercitados) | passa |
| CA-01: máscara do telefone | Diferencial contra `normalizarCelular`: 12 formatos por celular, digitação um dígito por vez, idempotência, recusados continuam recusados | `mb/componentes/mascara-de-telefone.bordas.test.ts` | passa, exceto `+54` (**Q37**) |
| CA-01: texto legal | Data de vigência, virada do dia em Brasília, HTML e link do documento como texto, fuzz de asteriscos, 5000 blocos com CRLF | `mb/componentes/texto-legal.bordas.test.ts` | passa, exceto a data impossível (**Q38**) |
| R1: `EstadoDaApi` movida | Comparei os 24 títulos de teste e as asserções com o HEAD. Nenhum teste perdido nem enfraquecido: o único trecho removido é o import de `AccessibilityInfo`, e entraram 5 testes novos | (comparação) | ok |
| S119: backup e transferência | O XML é gravado de verdade pelo plugin (`compileModsAsync`), idempotente, domínios válidos no Android, nome do recurso válido. Prebuild real numa cópia: XML, manifesto e ícones corretos | `scripts/backup-android.arquivo.test.mjs` (4 testes) | passa |
| Ícones, `assets/brand` | SVG sem script, texto, fonte nem recurso externo; PNG com tamanho e alfa certos (iOS sem alfa, adaptativo com alfa); `app.config` aponta para a variação certa; fundo igual ao SVG; pino na zona segura de 66 dp; contraste maior que 3:1. Os PNGs regenerados no Chrome saem idênticos aos commitados (diferença zero por pixel) | `scripts/assets-brand.test.mjs` (33 testes) | passa |
| Workflow Android | O `setup-java` não usa `cache:` antes do prebuild. Reprova o workflow do bfd7cee | `scripts/workflows-apps-expo.test.mjs::o setup-java não usa cache: antes do prebuild…` | passa |
| Q35 (ENOTEMPTY) | Sonda com metadado de lockfile obsoleto e 5 vitest ao mesmo tempo | ver Execução | provado |

## Testes criados ou alterados
Eu escrevi só testes. Todos passam em eslint, prettier, tsc e `pnpm deps:verificar`.
- `packages/mobile-base/src/sessao/sessao-do-app.corridas.test.ts` (novo, 15 testes) — corridas de logout, expiração e troca de conta, fila lenta ou presa, SecureStore falhando.
- `packages/mobile-base/src/sessao/armazenamento-seguro.bordas.test.ts` (novo, 6) — limpeza da 1ª abertura com falha parcial e retry.
- `packages/mobile-base/src/sessao/provedor-de-sessao.bordas.test.tsx` (novo, 4).
- `packages/mobile-base/src/textos/mensagem-do-campo.bordas.test.ts` (novo, 3).
- `packages/mobile-base/src/componentes/mascara-de-telefone.bordas.test.ts` (novo, 6) e `texto-legal.bordas.test.ts` (novo, 14).
- `apps/consumidor/src/testes/rotas.https.test.tsx` e `apps/lojista/src/testes/rotas.https.test.tsx` (novos, cópias idênticas, 12 casos cada).
- `scripts/assets-brand.test.mjs` (novo, 33), `scripts/backup-android.arquivo.test.mjs` (novo, 4).
- `scripts/workflows-apps-expo.test.mjs` (um caso novo).

Os arquivos `scripts/backup-android.test.mjs` e `scripts/vitest-cache-por-pacote.test.mjs` são do dev e do executor; não os alterei.

## Execução
Linha de base: mobile-base 370, consumidor e lojista 9, scripts 515.
- `pnpm lint`, `pnpm typecheck` e `pnpm deps:verificar` → ok (533 módulos).
- `pnpm -r --no-bail run test` → tokens 73, contratos 625, cliente-api 166, painel 478 e api 1515 passaram. mobile-base: 415 passaram, 3 falharam (418 no total).
- `pnpm --filter consumidor exec jest` e `pnpm --filter lojista exec jest` → 21 passaram cada (linha de base 9).
- `node --test "scripts/**/*.test.mjs"` → 552 passaram, 1 falhou, 553 no total. A falha é `instalacao-limpa::packages/mobile-base`, que roda os meus 3 testes vermelhos numa cópia limpa. Os outros 6 casos passam.
- `pnpm test` da raiz para no primeiro pacote que falha. Por isso rodei as partes separadas, e o `pnpm -r` pula consumidor e lojista (dependentes do mobile-base).
- **Estabilidade**, 14 núcleos, sem falha instável:
  - `pnpm -r --no-bail` sem carga: 1 vez. Com 16 laços de CPU: 1 vez (1m19, api 1515/1515 sob carga).
  - `jest` de mobile-base: 3 vezes, sempre as mesmas 2 falhas conhecidas (a terceira, Q38, entrou depois).
  - `instalacao-limpa`: 3 vezes sem carga e 3 vezes com carga. O pacote mais lento sob carga levou 47 s (limite de 120 s).
  - Logs em `/tmp/claude-1000/-home-ufla-Documentos-comercio-local/1f24ff11-019a-4a3d-9b6b-9070e2403ee4/scratchpad/m2qa/`: `estab-*.log` e `final-*.log`, mais as sondas `q35-*`.
- **Q35, sonda:**
  - Com o metadado do lockfile obsoleto em todo cache, 5 vitest ao mesmo tempo pelos scripts reais: 4 de 4 rodadas sem `ENOTEMPTY`.
  - Controle com o comportamento antigo (cache único): 3 falhas em 30. Com um cache por pacote: 0 em 30.
  - Logs: `q35-resumo.txt`, `q35-controle30.log`, `q35-pacote30.log`.
- **Mutação**, em cópia no scratchpad, com todos os mutantes restaurados:
  - Sessão, cofre, persister, provedor e url: 78 mutantes, todos mortos, menos 4 equivalentes. Cada exigência da linha da etapa 12 tem teste que falha quando a regra quebra: opções do SecureStore em cada chamada, chave própria da revogação, limpeza das duas chaves, retry da limpeza, `queryClient`/persister/fila, ordem do login, `clienteDoApp`, `aoFalharEmSegundoPlano` só com a origem, persister por lista.
  - Lint da sessão (S121): 13/13 mortos.
  - Scripts (marca, `app.config`, plugin, cache do vitest): 34 mutantes. Sobraram 3: um coberto por `apps-expo.test.mjs`, um equivalente e uma lacuna.
  - Apps: dois mutantes em `urlDaApiConfigurada`/`__DEV__`, mortos nos dois apps.
  - Antes das minhas melhorias sobreviviam 3 mutantes reais. Eram a limpeza da fila antes do login, a falha de gravação no login e a falha ao apagar a conta A na troca de conta. Escrevi testes e agora estão mortos.

## Bugs encontrados
### Q36 — Troca de conta com a limpeza da fila falhando deixa a interface "com sessão" sem sessão — severidade: baixa
- Passos: logada na conta A, `entrar(B)` com `filaOffline.limpar()` rejeitando.
- Esperado: A foi encerrada e revogada, então o estado deve ir para `sem_sessao`. A sessão B, já emitida pelo servidor, deve ser revogada, ou então não tocar em A antes de saber que a fila saiu.
- Obtido: o estado continua `com_sessao`, com `emailVerificado` da A. O SecureStore está vazio, e as telas fazem requisições sem token (401) até o usuário tocar em Sair. A sessão B fica viva no servidor (até 30 dias) sem ninguém com o token. O app recupera pelo Sair, por isso baixa. Sugestão: se `!fila`, chamar `definirSessao(null)`, ou limpar a fila antes de encerrar A, e revogar B no caminho de erro.
- Teste que reproduz: `packages/mobile-base/src/sessao/sessao-do-app.corridas.test.ts::troca de conta com fila offline não vazia › se a fila da conta A não puder ser apagada, a interface não fica "com sessão" sem sessão guardada` (falha em `expect(estado).toBe('sem_sessao')`, recebeu `com_sessao`).

### Q37 — Máscara do telefone transforma um celular de outro país em celular brasileiro válido — severidade: baixa
- Passos: colar `+54 9 11 1234 5678` (Argentina) ou `+54 9 351 123 4567` no Campo de telefone.
- Esperado: o contrato recusa outro país, e a máscara não pode fabricar um número aceito.
- Obtido: a máscara só corta o `+55`. O resto é truncado em 11 dígitos e vira `(54) 91112-3456` (DDD 54, RS, válido), que o contrato aceita como `+5554911123456`. A pessoa vê o número no campo, mas pode enviar um telefone errado. Sugestão: com `+` e código diferente de 55, não truncar nem mascarar, para o contrato recusar.
- Teste que reproduz: `packages/mobile-base/src/componentes/mascara-de-telefone.bordas.test.ts::celular argentino colado com +54 não vira um celular brasileiro válido…`

### Q38 — `formatarDataLegal` aceita data de calendário impossível — severidade: baixa
- Passos: `formatarDataLegal('2026-02-31')`, `'2026-04-31'`, `'2027-02-29'`, `'2100-02-29'`.
- Esperado: `null`, e a tela omite o "vigente desde" (a função diz que texto que não é data devolve `null`).
- Obtido: `31/02/2026`, `31/04/2026`, `29/02/2027`. Só confere mês de 1 a 12 e dia de 1 a 31. O banco não guarda isso, então só aparece se a API mandar um texto assim.
- Teste que reproduz: `packages/mobile-base/src/componentes/texto-legal.bordas.test.ts::data impossível (31/02, 31/04, 29/02 de ano comum) não vira "vigente desde": devolve null`

## Lacunas de cobertura e riscos restantes
- **Risco levantado pelo dev da etapa 12** (a limpeza da 1ª abertura apaga a revogação pendente da instalação anterior): baixo.
  - Os tokens antigos ficam ilegíveis no Keychain `ThisDeviceOnly`; só vivem no servidor até vencer.
  - Melhoria barata e opcional: não apagar `bairrin.revogacao-pendente`, porque ela só revoga e nunca autentica. E mover a sessão antiga para a pendência, para ser revogada na primeira abertura com rede. Custa trocar 2 asserções do cofre. Decisão sua.
- **Toque duplo em Sair:** envia 2 DELETE com o mesmo token. É inofensivo e o estado final está certo. Não é bug.
- **`scripts/vitest-cache-por-pacote.test.mjs`:** não detecta o mesmo caminho absoluto em dois pacotes, porque calcula `join(dir, flag)`. Baixo, sem bug hoje.
- **`apps/api` e `apps/painel` têm `dist/`:** vem do `pnpm build` do lead (ignorado pelo git). Eu não gerei `dist/`, `android/` nem `ios/` no repositório. Os exports e o prebuild foram feitos em cópia ou no scratchpad, e as cópias foram apagadas.
- **O que o Jest não prova:**
  - TalkBack e VoiceOver, e o anel de foco `outline` desenhado.
  - A fala duplicada no Android (`announceForAccessibility` mais região viva).
  - O logo em `SvgXml` no aparelho.
  - A `marca-de-instalacao` com o `expo-file-system` real. A API existe e tem tipos, mas só os mocks a exercitam.
  - Os apps ainda não montam o `ProvedorDeSessao`, só `urlDaApiConfigurada`.
  - O Campo de código não dispara `aoCompletar` ao colar um código completo sobre outro de 6 dígitos. É decisão da spec (o botão continua disponível). Não é bug.
- **Etapa 14:** a sessão ainda não tem ação para trocar a sessão sem limpar os dados (vem da verificação de e-mail).
- **Memória registrada em** `/home/ufla/Documentos/comercio_local/.claude/agent-memory/qa/grupo-m2-sessao-componentes.md`, mais uma linha em `MEMORY.md` e uma nota em `investigacao-enotempty-vitest.md`.
