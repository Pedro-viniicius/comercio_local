# Plano técnico: publicação automatizada nas lojas (App Store e Google Play)
- Brief: não há. O pedido do dono (2026-10-16) foi repassado pelo lead: "Automatizar o envio do aplicativo para a Apple Store e a Play Store."
- Data: 2026-10-16 (revisado no mesmo dia com a rodada 1 do `seguranca`: S37 a S45)
- Começa depois das etapas 8 e 9 do `01a-fundacao-repositorio.md` (apps Expo, previstas para 2026-10-19).

## Objetivo e critérios de aceite
Uma tag ou um disparo manual gera o build de release de cada app e o envia à trilha de testes de cada loja. A promoção para produção continua manual. Tudo o que não depende de pagamento fica pronto agora. Numeração global: o maior CA em `docs/produto/briefs/` e `docs/produto/planos/` é o CA-110 (`06-entregas-e-notificacoes.md:47`); os CA-F1 a F9 do 01a são uma série à parte.

- CA-111 — Uma tag `consumidor/vX.Y.Z` ou `lojista/vX.Y.Z` num commit da `main`, ou um disparo manual com `github.ref == refs/heads/main` (app e plataforma por lista fechada, e se envia), inicia o workflow de publicação. Tag fora da `main` ou disparo de outra branch é recusado antes de qualquer build. No Free privado isso é guarda contra acidente, não controle de acesso (S38; ver CA-114 e CA-116).
- CA-112 — O build só começa depois de o CI do mesmo commit passar (o `ci.yml` inteiro), de a verificação de release aprovar (versão da tag igual à do app, seção da versão no CHANGELOG, nenhum EAS Update, `ascAppId` preenchido quando há envio para iOS) e de o `pnpm audit --audit-level=high`, com as dependências de desenvolvimento, passar no job de build.
- CA-113 — O build de produção (AAB e IPA) sai pelo EAS Build, com o perfil `production`. Com "enviar", vai sozinho ao teste interno da Google Play e ao TestFlight (grupo interno). Nada vai à produção sem ação manual. O perfil `preview` usa `br.com.bairrin.<app>.preview`, com credenciais próprias, e nunca vai às lojas.
- CA-114 — Nenhuma credencial do CI publica em produção. A promoção (teste fechado ou externo e produção) é manual, no console, feita pelo dono depois de conferir que o `gitCommitHash` do build no EAS é o commit da tag e está na `main`. **Play:** a conta de serviço tem permissão só nos dois apps, e nenhuma no nível da conta: "Ver informações do app" e "Lançar apps em faixas de teste", sem "Gerenciar faixas de teste e editar listas de testadores", e sem papel IAM no Google Cloud. O teste aberto não é ativado. **Apple:** a chave da API é criada à mão no App Store Connect com o papel Developer e enviada ao EAS, porque o `eas credentials` só gera chave Admin ou App Manager. Se o Developer não enviar ao TestFlight, a chave passa a App Manager, que também envia para revisão e publica; isso fica no ADR-016 e na P3. A etapa 6 confere as duas telas.
- CA-115 — A versão de marketing vem do `package.json` do app, e a tag precisa ser igual a ela. O número de build (`versionCode` e `buildNumber`) é incrementado pelo EAS (fonte remota), sem commit de volta no repositório. Dois builds nunca repetem número.
- CA-116 — Nenhum segredo fica no repositório nem no arquivo enviado ao EAS. O `.gitignore` e o `.easignore` barram `.env*`, chaves, `credentials.json`, `credentials/` e `*service-account*.json`, e o `.easignore` também tira `.claude/` e `docs/`. O único segredo no GitHub é o `EXPO_TOKEN`, de um robô do Expo ou, se o Free não tiver robô, de uma conta Expo usada só pelo CI, com MFA. Token pessoal, nunca. Ele é lido só no passo de build do `lojas.yml`, e nenhum job de PR lê segredo. As credenciais das lojas ficam no EAS, com cópia no cofre do dono. **Limite assumido (P3):** no repositório privado do plano Free, quem tem escrita no repositório pode publicar nas trilhas de teste. Por isso só recebe escrita quem já teria esse poder, e a promoção confere o commit (CA-114).
- CA-117 — Cada versão tem uma seção em `apps/<app>/CHANGELOG.md`, em português, com até 500 caracteres. Esse texto vira a nota da versão nas lojas, copiado na promoção.
- CA-118 — Não há EAS Update: os apps não usam `expo-updates` e os perfis de build não têm `channel`. A verificação de release reprova se algum dos dois aparecer.
- CA-119 — `docs/operacao/publicacao-nas-lojas.md` traz:
  - os pré-requisitos do dono e quanto custam;
  - a configuração única, com o GitHub (2FA, colaboradores e Settings → Actions) e as permissões das lojas;
  - o fluxo de cada versão e a detecção (e-mails das lojas, conferência de cada build com a tag);
  - a promoção, com a conferência do commit;
  - a rotação e a resposta a vazamento, inclusive da chave de upload.

  `docs/operacao/privacidade-nas-lojas.md` traz a tabela de dados por app para o App Privacy e o Data Safety, coerente com `docs/produto/`, com o ADR-014 e com o ADR-015. O `seguranca` a revisa antes da primeira revisão nas lojas.
- CA-120 — Sem nenhuma conta paga, o disparo manual com `plataforma=android` e `enviar=false` gera o AAB de produção no EAS Free. Com `ios` ou `enviar=true` antes de as contas existirem, a verificação falha com uma mensagem que diz o que falta.
- CA-121 — Nenhum job do GitHub Actions roda em macOS. O `android-nativo.yml` só roda quando muda algo em `apps/consumidor`, `apps/lojista`, `packages/` ou no lockfile.

## Contexto atual
- Os apps ainda não existem: `apps/consumidor` e `apps/lojista` só têm `.env.example` e README (`apps/consumidor/README.md:5-9`). A etapa 8 do 01a cria o `app.config.ts`, o `eas.json` (perfis development, preview e production) e o jest (`01a-fundacao-repositorio.md:62-63`).
- Identificadores definitivos: `br.com.bairrin.consumidor` e `br.com.bairrin.lojista` (`docs/adr/0002-dois-apps-consumidor-e-lojista.md:13`). As releases dos dois apps são independentes (`:21`).
- CI: o `ci.yml` roda em PR e na `main` sem segredos (`.github/workflows/ci.yml:1-4`, `:9-12`). O `concurrency` agrupa por PR ou por `github.ref` (`:17-20`). O job `auditoria` já usa `package-manager-cache: false` (`:110-118`). O `ci.yml` faz o `expo export` dos apps quando eles existirem (`:78-90`). O `android-nativo.yml` roda em todo push na `main`, com `expo prebuild` + Gradle, chave de debug e sem segredos (`android-nativo.yml:1-4`, `:12-16`). Cada execução gasta dois jobs de até 60 min (`:29-36`).
- ADR-013: "Na `main`, o build Android nativo; o iOS é manual pelo EAS Build" (`docs/adr/0013-piramide-de-testes-e-ci.md:21`). ADR-001: correções por EAS Update, com assinatura, que exige plano pago (`0001-apps-react-native-com-expo.md:18-20`). O checklist exige a assinatura do EAS Update (S12) (`docs/operacao/checklist-deploy.md:136-142`).
- Sentry: o ADR-014 já decidiu Sentry na API, nos apps e no painel (`0014-observabilidade-backups-e-operacao.md:14`). A API desliga o `ProcessSession` e passa `sessions: false` à integração HTTP (Q12) (`apps/api/src/compartilhado/observabilidade/sentry.ts:30-34`, `:207-209`). O transport só deixa sair `event` e `client_report` (`:42`). A coleta de dados está toda desligada (`:89-100`). A API mantém o id pseudônimo do usuário (`:102-106`). O plano que instala o SDK nos apps não está definido (não verificado).
- Dados que entram nos formulários das lojas: GPS no primeiro acesso (`briefs/03-consumidor-descoberta.md:34`, CA-29); endereço salvo (`:35`, CA-30); métricas de interação (`03:52`, `02-lojista-loja-e-catalogo.md:58`); avaliações (`07-avaliacoes.md:32`, CA-82); nome do entregador (`06-entregas-e-notificacoes.md:35`, CA-71); disputas com anexos (`08-painel-admin.md:41`, CA-96). Exclusão com retenção: CA-11 (`01-fundacao-identidade.md:44`) e backups de 7 dias (`docs/adr/0015-dado-pessoal-auditoria-e-anonimizacao.md:16`). Dado pessoal nunca em query string (`00-arquitetura.md:125`).
- Cadeia de suprimentos: `minimumReleaseAge: 4320`, `strictDepBuilds` e `allowBuilds` (`pnpm-workspace.yaml:7-28`). O `.gitignore` barra `.env*`, `*.jks`, `*.keystore`, `*.p8`, `*.p12`, `*.key`, `*.pem` e `*.mobileprovision`, mas não barra `credentials.json` nem `*service-account*.json`. Não há `.easignore`.
- Os testes dos scripts rodam com `node --test "scripts/**/*.test.mjs"` (`package.json`, script `test`). O padrão a seguir é `scripts/verificar-migracoes.mjs` com o seu `.test.mjs`.
- Decisões do dono: nenhum serviço pago por enquanto; CNPJ só quando o app estiver pronto; a conta Apple de empresa exige D-U-N-S (`docs/produto/decisoes.md`). Custos das lojas: US$ 99 por ano e US$ 25 uma vez (`analise-comissao.md:48-49`), a R$ 5,00/US$ (`:51`).
- O CA-11 (exclusão no app) atende à Apple 5.1.1(v) e ao Google. O Google também pede um link na web para o pedido de exclusão [F9]. Política e termos passam por advogado (`briefs/01-fundacao-identidade.md:61`).

## Abordagens consideradas
Fontes consultadas em 2026-10-16 (lista no fim). Valores a R$ 5,00/US$, sem IOF.

| Abordagem | Custo | Limites atuais | Prós | Contras | Risco |
|---|---|---|---|---|---|
| **A. EAS Build + EAS Submit no Expo Free, disparados pelo GitHub Actions em Linux** | US$ 0 no Expo; poucos minutos de Linux por versão, da franquia de 2.000 min/mês | 15 builds Android e 15 iOS por mês; fila de baixa prioridade; timeout de 45 min; 1 macOS por vez; com a cota esgotada, só no dia 1º [F1][F2]. O Submit está no Free [F1] | iOS sem Mac; mesma ferramenta do ADR-001; credenciais no EAS; um segredo no GitHub | Fila lenta; uns 7 releases por app por mês; o Expo recebe o código e guarda as credenciais (S45) | Baixo |
| B. fastlane no GitHub Actions (macOS para o iOS) | macOS a US$ 0,062/min [F3]; build iOS de 30 a 45 min (estimativa) a US$ 1,86-2,79 | A doc atual não diz quanto o macOS consome da franquia; o 10× é histórico [F4][F5] | Nenhum terceiro com as credenciais | Ruby, fastlane e match são stack nova; `expo prebuild` no CI; muito mais YAML | Médio |
| C. Build local e envio pelo CI | US$ 0 | iOS exige macOS com Xcode; a máquina do projeto é Linux | Sem fila | Não cumpre o CA-111; credenciais na máquina de alguém | Alto |
| D. EAS Workflows | Mesma cota; cobrança dos jobs que não são build não verificada [F6] | Igual a A | Build e envio num lugar só | Segundo CI ao lado do Actions (ADR-013); app do Expo com acesso ao repositório | Médio |

## Decisão
**A**, mantida depois da rodada 1 do `seguranca`. Nenhum achado a inviabiliza: S37 e S40 pedem menor privilégio e detecção, S41 pede documentação, e o resto é endurecimento do YAML e dos arquivos de exclusão. O GitHub Actions continua sendo o único CI (ADR-013): ele valida, confere a versão e chama `eas build --auto-submit`. Não há fallback automático: se a cota acabar, o runbook traz o Android local (`eas build --local` no runner Linux, depois `eas submit --path`). Um job para isso seria excesso de engenharia.

- **Gatilho:** push da tag `<app>/vX.Y.Z` ou `workflow_dispatch` com `app` e `plataforma` (`type: choice`) e `enviar` (boolean, padrão `true`). A tag precisa estar na `main`, e o disparo só vale em `refs/heads/main`. No Free privado não há rulesets nem proteção de branch, e quem tem escrita pode mover a `main` e criar tags. Por isso essa checagem é guarda contra acidente. A garantia está na promoção, que confere o commit (S38).
- **Trilhas:** teste interno da Play (`track: internal`) e TestFlight, grupo interno. Só o perfil `production` vai às lojas. O `preview` (distribuição interna) tem outro identificador e outras credenciais, para nunca usar a chave de upload de produção (S43).
- **Promoção:** manual no console, depois da conferência do commit (CA-114). Play: interno → fechado → produção, com lançamento gradual. Apple: TestFlight externo → revisão → liberação manual ou faseada.
- **Versionamento:** `version` do `package.json`, lida pelo `app.config.ts`. `appVersionSource: "remote"` e `autoIncrement: true` [F7]. Versão inicial `0.1.0` (P5).
- **Changelog:** `## X.Y.Z — AAAA-MM-DD` em `apps/<app>/CHANGELOG.md`, com até 500 caracteres (P6), colado no console na promoção.
- **`android-nativo.yml`:** continua como verificação de que o nativo compila, sem segredos, e ganha filtro de `paths` (CA-121). Desde 2026-09-30, no Brasil, APK com chave de debug só se instala pelo fluxo avançado ou por `adb` [F10]. Para testador humano, use o `preview`.
- **EAS Update: não entra.** Com assinatura, exige o plano Production, de US$ 199/mês [F1]. Sem assinatura, viola o S12. Reavaliar quando houver receita (P2).
- **Segredos:** credenciais no EAS, e só o `EXPO_TOKEN` no GitHub. Montar `credentials.json` com vários secrets em base64 daria mais segredos num repositório sem environments [F8].
- **Play App Signing:** a Play gera e guarda a chave do app. O EAS guarda só a chave de upload, que pode ser trocada pelo suporte [F17] (S43).

## Esquema e contratos
Não há banco nem API.

- `apps/<app>/package.json`: `"version": "0.1.0"`; `eas-cli` em `devDependencies` como `catalog:`, com versão exata no `catalog`.
- `apps/<app>/app.config.ts`:
  - `version` do `package.json`, `owner` (P7), `extra.eas.projectId` (não é segredo) e `ios.config.usesNonExemptEncryption: false` (premissa: só HTTPS);
  - com `APP_VARIANT=preview`, `android.package` e `ios.bundleIdentifier` ganham o sufixo `.preview`;
  - sem `android.versionCode`, `ios.buildNumber`, `runtimeVersion` e `updates`.
- `apps/<app>/eas.json`:
  - `cli`: `{ "version": ">= <versão do catálogo>", "appVersionSource": "remote" }`.
  - `build.preview.env.APP_VARIANT`: `"preview"`. `build.production`: `{ "autoIncrement": true, "env": { "EXPO_PUBLIC_API_URL": "https://api.bairrin.com.br" } }`. Nenhum perfil tem `channel`.
  - `submit.production.android`: `{ "track": "internal", "releaseStatus": "draft" }` (app não publicado só aceita rascunho; não verificado na doc). Passa a `"completed"` depois da primeira produção.
  - `submit.production.ios`: `{ "ascAppId": "", "groups": ["Equipe Bairrin"] }`.
- `.gitignore`: mais `credentials.json`, `credentials/` e `*service-account*.json`. `.easignore` na raiz: substitui o `.gitignore` no envio ao EAS. Por isso repete tudo dele e acrescenta `.claude/` e `docs/`. Não exclui pastas de workspace, porque o `pnpm install` do EAS precisa delas (premissa). Premissa não verificada: em monorepo, o EAS lê o `.easignore` da raiz do repositório. A etapa 6 confere.
- `node scripts/lojas/verificar-release.mjs --app <consumidor|lojista> --plataforma <android|ios|all> [--tag <tag>] [--enviar]`:
  - sai com código 1 e mensagem em português quando:
    - o app não existe;
    - a tag não casa com `^(consumidor|lojista)/v\d+\.\d+\.\d+$`, é de outro app ou difere da `version`;
    - a seção do CHANGELOG falta, está vazia ou passa de 500 caracteres;
    - há `expo-updates` nas dependências ou `channel` em algum perfil;
    - há envio para iOS e o `ascAppId` está vazio.
  - Com `GITHUB_OUTPUT`, grava `versao=X.Y.Z`. Lê só arquivos e não chama a rede.
- `.github/workflows/ci.yml`: ganha `workflow_call`. O `concurrency` passa a `group: ci-${{ github.event.pull_request.number || github.run_id }}`. Assim, o PR continua cancelando a execução anterior, e fora de PR cada execução tem o próprio grupo (a `main` já não cancelava). Antes, chamado pelo `lojas.yml` num disparo na `main`, ele caía no mesmo grupo do CI da `main` (S44). Premissa: no workflow chamado, `github.run_id` é o da execução que chama.
- `.github/workflows/lojas.yml` ("Publicação nas lojas"):
  - Topo: `permissions: {}` e `concurrency` por app, sem cancelamento. Cada job declara `permissions: contents: read`.
  - Nenhum `${{ inputs.* }}` nem `${{ github.ref_name }}` dentro de `run`: os valores entram por `env:` e são usados como `"$VAR"` (S44).
  - Job `origem`: checkout com `fetch-depth: 0` e `persist-credentials: false`. No disparo, recusa `GITHUB_REF` diferente de `refs/heads/main`. Na tag, recusa commit fora da `main` (`git merge-base --is-ancestor "$GITHUB_SHA" origin/main`). Depois roda o script.
  - Job `verificar`: `uses: ./.github/workflows/ci.yml`, **sem** `secrets: inherit`.
  - Job `build` (`needs` dos dois, `ubuntu-24.04`, `timeout-minutes: 20`, sem cache, S39):
    - setup do Node com `package-manager-cache: false` e sem `cache: pnpm`, como no `ci.yml:110-114`;
    - `pnpm install --frozen-lockfile --ignore-scripts --filter <app>...`;
    - `pnpm audit --audit-level=high`, sem `--prod`, para pegar o `eas-cli`;
    - `pnpm --filter <app> exec eas build --platform <p> --profile production --non-interactive --no-wait [--auto-submit]`, com `EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}` só nesse passo.

    Se o `--ignore-scripts` quebrar o `eas` ou o `expo config`, pare e leve ao lead.
  - Só as actions já fixadas por SHA. `expo/expo-github-action` fica de fora: instala o `eas-cli` fora do lockfile.
- `docs/operacao/privacidade-nas-lojas.md` (S41): uma tabela por app, com as colunas dado, tipo na Apple e no Google, coletado ou compartilhado (e com quem), finalidade, opcional, efêmero, vinculado à conta e fonte (CA, ADR ou plano). Linhas mínimas:
  - **Os dois apps:**
    - nome, e-mail e telefone (CA-01);
    - token do Expo Push e o identificador de instalação do FCM no Android (ADR-008);
    - diagnóstico do Sentry (ADR-014): o SDK do app segue a configuração da API. Ele não chama `setUser`, nem com o id: a API guarda o id (`sentry.ts:102-106`), mas no app isso tornaria o diagnóstico vinculado. Também fica sem IP, **sem sessões de release health** (o equivalente do Q12, `sentry.ts:30-34`, `:207-209`; no SDK React Native, `enableAutoSessionTracking: false`, nome não verificado), sem Replay e sem tracing. A coleta de dados fica desligada, eventos e breadcrumbs passam pelas regras do redator e o transport só deixa sair `event` e `client_report`. A verificar na versão do SDK que for fixada: se o Sentry nativo (Android e iOS) preenche `user.id` com um id de instalação quando o app não chama `setUser`, e se `enableAutoSessionTracking: false` desliga também a sessão nativa. Se preencher, o `beforeSend` do app tira `user` e os identificadores de `contexts.device`, com teste; senão o diagnóstico fica vinculado a um id de aparelho ("Device ID" na Apple, "Device or other IDs" no Google);
    - exclusão com retenção: CA-11 e backups de 7 dias.
  - **Consumidor:**
    - localização precisa por GPS (CA-29; guardada ou efêmera, P8);
    - endereço salvo (CA-30);
    - histórico de pedidos;
    - avaliações e comentários (CA-82);
    - disputas, com mensagens e anexos (CA-73, CA-96);
    - histórico de busca (P9) e métricas de interação (P10);
    - compartilhado com o lojista do pedido: nome, telefone e endereço (cópias em `pedidos`);
    - pagamento: em aberto até o plano 05.
  - **Lojista:**
    - CNPJ, razão social, endereço da loja e posição no mapa;
    - dados bancários, cifrados e compartilhados com o gateway;
    - fotos (CA-25, sem EXIF);
    - nome do entregador, dado de terceiro mostrado ao consumidor (CA-71);
    - disputas;
    - diagnóstico e push.

  Sem rastreamento nem anúncios, e tudo cifrado em trânsito. A tabela lista à parte o que ainda diverge dos briefs (os itens acima com P8 a P10) e os operadores (ADR-015, `00-arquitetura.md:160`).

## Etapas
| # | Etapa | Arquivos | Verificação | Responsável | Grupo | Sensível | CAs |
|---|---|---|---|---|---|---|---|
| 1 | `eas-cli` com versão exata no `catalog` e nos dois apps; `version` 0.1.0; `app.config.ts` (com a variante `preview`) e `eas.json` conforme os contratos; CHANGELOG inicial (`## 0.1.0`). Se o `strictDepBuilds` barrar algum script, pare e leve ao lead; não acrescente nada ao `allowBuilds` | `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `apps/consumidor/package.json`, `apps/lojista/package.json`, `apps/consumidor/app.config.ts`, `apps/lojista/app.config.ts`, `apps/consumidor/eas.json`, `apps/lojista/eas.json`, `apps/consumidor/CHANGELOG.md`, `apps/lojista/CHANGELOG.md` | `pnpm install --frozen-lockfile && pnpm --filter consumidor exec eas --version && pnpm --filter consumidor exec expo config --type public --json \| grep '"version": "0.1.0"' && APP_VARIANT=preview pnpm --filter consumidor exec expo config --type public --json \| grep 'br.com.bairrin.consumidor.preview' && pnpm --filter consumidor exec expo export --platform android` (repetir com `lojista`) && `pnpm lint` | dev | A | não | 113, 115, 117, 118 |
| 2 | Verificação de release (contrato acima), com testes de cada recusa e do caminho feliz, sobre fixtures | `scripts/lojas/verificar-release.mjs`, `scripts/lojas/verificar-release.test.mjs`, `scripts/fixtures/lojas/**` | `node --test scripts/lojas/verificar-release.test.mjs` | dev | A | não | 112, 115, 117, 118, 120 |
| 3 | `ci.yml` aceita `workflow_call` (aditivo, sem segredos) e troca o grupo do `concurrency` (contrato); `android-nativo.yml` ganha `paths` (`apps/consumidor/**`, `apps/lojista/**`, `packages/**`, `pnpm-lock.yaml`, o próprio arquivo) e o comentário do topo aponta para o `lojas.yml` | `.github/workflows/ci.yml`, `.github/workflows/android-nativo.yml` | `pnpm exec prettier --check .github/workflows/ci.yml .github/workflows/android-nativo.yml && rg -n 'secrets\.' .github/workflows/ci.yml .github/workflows/android-nativo.yml` (nenhuma linha) `&& rg -n 'run_id' .github/workflows/ci.yml` (uma linha); o lead confere o CI verde no PR | dev | A | sim (CI e fronteira de segredos) | 112, 121 |
| 7 | `.gitignore` e `.easignore` conforme o contrato (S42, S45) | `.gitignore`, `.easignore` | `git check-ignore -q credentials.json && git check-ignore -q apps/lojista/credentials/a.json && git check-ignore -q play-service-account.json && rg -n '^(\.claude/\|docs/\|\.env\*\|credentials\.json\|\*\.p8)$' .easignore` (5 linhas) | dev | A | sim (segredos) | 116 |
| 4 | Workflow de publicação conforme o contrato | `.github/workflows/lojas.yml` | `pnpm exec prettier --check .github/workflows/lojas.yml && rg -n 'secrets\.' .github/workflows` (só a linha do `EXPO_TOKEN` no `lojas.yml`) `&& rg -n 'pull_request\|macos\|secrets: inherit\|cache: pnpm' .github/workflows/lojas.yml` (nenhuma) `&& rg -n 'type: choice\|ignore-scripts\|audit-level=high\|refs/heads/main' .github/workflows/lojas.yml` (todas presentes) `&& node scripts/lojas/verificar-release.mjs --app consumidor --plataforma android`; o `revisor` confere que nenhum `run` tem `${{` | dev | B | sim (segredo, assinatura) | 111, 112, 113, 116, 120, 121 |
| 5 | Documentação. **Runbook**: pré-requisitos e custos; configuração única (passos do GitHub, robô ou conta do CI, permissões da Play e chave manual da Apple, Play App Signing, SHA-256 da chave de upload e da chave do app, esta para o `assetlinks` do plano 03); credenciais baixadas fora do repositório e apagadas depois de ir ao cofre; fluxo e detecção; promoção com a conferência do commit; rotação; vazamento, inclusive da chave de upload; fallback Android. **Tabela de privacidade** (contrato). **ADR-016** (seção ADR). **ADR-013** (linha 21) e **ADR-001** (linhas 18-20) apontando para o 016. **ADR-014**: uma linha dizendo que o SDK dos apps segue o da API (tabela). **Checklist**, seção 8: EAS Update fora (a assinatura volta a ser obrigatória se ele entrar), contas e credenciais das lojas. **READMEs** dos apps e da raiz: como publicar; config plugin novo roda no job com o `EXPO_TOKEN` no ambiente e passa pelo `seguranca` (S39) | `docs/operacao/publicacao-nas-lojas.md`, `docs/operacao/privacidade-nas-lojas.md`, `docs/operacao/checklist-deploy.md`, `docs/adr/0016-publicacao-nas-lojas.md`, `docs/adr/README.md`, `docs/adr/0013-piramide-de-testes-e-ci.md`, `docs/adr/0001-apps-react-native-com-expo.md`, `docs/adr/0014-observabilidade-backups-e-operacao.md`, `apps/consumidor/README.md`, `apps/lojista/README.md`, `README.md` | `pnpm exec prettier --check docs/operacao/*.md "docs/adr/*.md" "apps/*/README.md" README.md && rg -n 'gitCommitHash' docs/operacao/publicacao-nas-lojas.md && rg -n 'release health' docs/operacao/privacidade-nas-lojas.md` | dev | B | sim (declaração de dado pessoal e credenciais) | 114, 116, 119 |
| 6 | Ponta a ponta e telas (lista abaixo) | nenhum (consoles e Actions) | O lead registra no checklist o link da execução, o id do build no EAS e cada item conferido | lead + dono | C | sim (credenciais) | 111, 113, 114, 115, 116, 120 |

Ordem: A (1, 2, 3 e 7 em paralelo) → B (4 e 5 em paralelo) → C. A etapa 1 mexe em `apps/*/package.json` e no `pnpm-lock.yaml`, como a etapa 1 do `01b-identidade.md`, e as duas nunca rodam juntas. O ADR-014 tem mudanças locais ainda sem commit (Q12): a etapa 5 começa depois de elas entrarem.

**Etapa 6, o que se confere.** Itens que o `seguranca` deixou em "A verificar":
1. **Sem pagar.** Se o Expo Free tem robô; sem robô, a conta do CI tem MFA e é membro da organização com o papel Developer. Disparo `android` com `enviar=false` → AAB. Disparo `ios` → recusa clara. `eas build:inspect --platform android --profile production --stage archive --output <pasta fora do repositório>` não traz `.claude/`, `docs/`, `.env*` nem chaves. `eas build:view <id> --json`: o `gitCommitHash` é o commit da tag.
2. **GitHub.** Lista atual de colaboradores, cada um com 2FA. Em Settings → Actions:
   - workflows de PR de fork desligados, sem envio de secrets;
   - "Workflow permissions" só leitura;
   - "Allow GitHub Actions to create and approve pull requests" desligado.
3. **Play.** A tela da conta de serviço mostra só as duas permissões, por app, sem papel IAM. O teste aberto está inativo. Se "Lançar apps em faixas de teste" cobre também o aberto, registrar no runbook. O envio ao teste interno chega e chega o e-mail de build processado. Se `--no-wait` com `--auto-submit` não enviar, tirar o `--no-wait`.
4. **Apple.** A chave Developer envia ao TestFlight. Se o envio falhar por causa do `groups`, tire o `groups` e repita. Se ainda falhar, use App Manager e ajuste o ADR-016 e a P3. Chega o e-mail de build processado.

## Pré-requisitos que só o dono pode fazer
| Item | Custo | Bloqueia | Pode adiar? |
|---|---|---|---|
| Expo com MFA, organização `bairrin`, dois projetos (`projectId` ao lead), robô com o papel Developer (o menor que faz build) ou conta Expo só do CI com MFA, e o token em `EXPO_TOKEN`. Token pessoal, nunca | US$ 0 | etapa 6 | Não |
| GitHub: 2FA de todos, colaboradores revistos e Settings → Actions (etapa 6, item 2) | US$ 0 | etapa 6 | Não |
| Google Play Console: conta pessoal agora ou de organização depois do CNPJ (D-U-N-S grátis, até 30 dias) [F11] | US$ 25 uma vez (R$ 125) | qualquer envio à Play | Sim. O AAB já sai sem a conta |
| Conta **pessoal** criada depois de 2023-11-13: teste fechado com **12 testadores ativos por 14 dias** antes da produção; análise de até uns 7 dias [F12]. Premissa: vale para cada app | Tempo e testadores | produção na Play | Não se aplica a organização |
| Apple Developer Program: pessoa física mostra o **nome civil**. Empresa exige D-U-N-S, site e e-mail no domínio. Empresário individual entra como pessoa física [F13][F14]. A troca é pelo suporte, e a transferência mantém avaliações e bundle ID [F15] | US$ 99 por ano (R$ 495) | todo o iOS | Sim |
| Política de privacidade em URL pública e página para o pedido de exclusão [F9][F16] | Domínio e advogado | revisão e produção | Até a primeira revisão |
| App Privacy e Data Safety a partir da tabela da etapa 5, já revisada pelo `seguranca` | — | revisão e produção | Até a primeira revisão |
| API hospedada para testadores e revisão (a Apple pede conta de demonstração) | Fly ~US$ 25/mês | teste fechado útil, revisão | Bloqueado pela decisão de não pagar |
| Fichas, capturas (designer), classificação, criação dos apps, conta de serviço com as permissões do CA-114 e chave do App Store Connect criada à mão; as duas vão ao EAS por `eas credentials` | US$ 0 | envio automático | Junto com as contas |

**Sem pagar, fica pronto:** etapas 1 a 5 e 7, a configuração do Expo e do GitHub, o AAB de produção, o runbook e a tabela de privacidade. **Espera o dono:** as contas de loja (US$ 124 no primeiro ano), a hospedagem e o vendedor (P1).

## Pontos para o seguranca
- **S37, P3.** No repositório privado do Free não há environments nem rulesets [F8]. O `EXPO_TOKEN` é secret do repositório. Num repositório de conta pessoal, todo colaborador tem escrita e pode ler o token por um workflow numa branch. Também pode mudar o `eas.json` e escolher trilha e código. A frase honesta: **quem tem escrita no repositório pode publicar nas trilhas de teste**. Mitigações:
  - robô ou conta do CI com MFA, sem token pessoal;
  - só convidar quem já teria esse poder; colaborador só de leitura exige mover o repositório para uma organização Free;
  - 2FA e Settings → Actions;
  - detecção: os e-mails de build processado das duas lojas vão ao dono, e o runbook confere cada build com uma tag e com o log de uma execução do `lojas.yml`;
  - na promoção, conferir o `gitCommitHash`. Ele é declarado pelo cliente, então pega engano e descuido, mas não quem tem o token e quer enganar. Contra esse, vale a conferência do log da execução;
  - rotação do `EXPO_TOKEN` a cada 6 meses, na saída de alguém e sob suspeita.
- **Papel Developer do Expo.** Premissa não verificada: ele baixa e apaga a chave de upload. Mitigações: cópia no cofre, reset pelo suporte da Play [F17] e a chave do app, que fica no Google (S43).
- **S40.** Play: permissão por app, só as duas do CA-114, sem papel IAM e com o teste aberto inativo. Premissa, de fonte de terceiros: "Lançar apps em faixas de teste" cobre interno, fechado e aberto. Apple: chave Developer criada à mão; se falhar, App Manager, que publica (P3). O plano não usa `eas metadata:push`: as fichas são preenchidas no console, então o papel que ele exigiria não importa.
- **S38, S39, S44.** As checagens de `main` e de tag são guarda contra acidente. `workflow_call` sem `secrets: inherit` e nenhum `pull_request_target`. O job de build não tem cache, instala com `--ignore-scripts` e roda o `pnpm audit` com as dependências de desenvolvimento. Inputs `choice` entram por `env`, e as permissões são por job.
- **S41.** A tabela de privacidade é revisada por você antes da primeira revisão nas lojas. Confira o Sentry do app (sem `setUser`, sem sessões) quando o plano do SDK existir. Pelo mesmo motivo, vale olhar as sessões do SDK de navegador no painel.
- **S42, S43, S45.** Credenciais baixadas fora do repositório e apagadas. Play App Signing com chave gerada pelo Google. `preview` com identificador e credenciais próprios. SHA-256 das duas chaves registrados. Cópia da chave de upload com o alias e as duas senhas. Prazo do reset pelo suporte não verificado. O Expo é fornecedor crítico: recebe o monorepo e guarda as credenciais. O `.easignore` substitui o `.gitignore`.
- Mantido: `eas-cli` pelo lockfile, com `minimumReleaseAge`, versão exata e `strictDepBuilds`. `EXPO_PUBLIC_*` só com a URL pública. Certificado Apple, chave do App Store Connect e chave da conta de serviço giram a cada ano, na saída de alguém e sob suspeita. A chave de upload só gira se houver comprometimento.
- Rodada 2, por ID:
  - S37: CA-116, CA-114, etapas 4, 5 e 6, P3;
  - S38: CA-111, Decisão, ADR;
  - S39 e S44: contratos de `lojas.yml` e `ci.yml`, etapas 3 e 4;
  - S40: CA-114, etapa 6;
  - S41: tabela, etapa 5, P8 a P10;
  - S42 e S45: etapa 7, ADR;
  - S43: etapa 1, runbook.

## Riscos e como reverter
| Risco | Reversão |
|---|---|
| Fila lenta ou cota esgotada | Esperar o dia 1º; Android local pelo runbook; Starter a US$ 19/mês, se o dono decidir [F1] |
| `--no-wait` com `--auto-submit` não envia | Tirar o `--no-wait` (mais minutos de Linux); etapa 6 |
| Quem tem escrita publica algo nas trilhas de teste (P3) | Não promover; expirar o build no TestFlight e desativar a release no teste interno; tirar a escrita da pessoa; girar o `EXPO_TOKEN` |
| Token usado para baixar ou apagar a chave de upload | Reenviar a cópia do cofre ao EAS; se vazou, reset da chave de upload pelo suporte da Play. A chave do app não sai do Google |
| `.easignore` não lido ou incompleto | Visto pelo `build:inspect` da etapa 6; apagar o build no EAS (apagar o arquivo enviado não foi verificado) e girar o que tiver ido |
| `--ignore-scripts` quebra o build | Parar e levar ao lead; tirar a flag só com o aval do `seguranca` |
| Chave Developer não envia ao TestFlight | Sem `groups`; senão App Manager, registrado no ADR-016 e na P3 |
| Build ruim na trilha de teste ou em produção | Não promover. Em produção: interromper o lançamento gradual (Play) ou usar liberação faseada e remover da venda (Apple). Corrigir com build novo |
| Vazamento do `EXPO_TOKEN` ou de uma credencial | Runbook: revogar no expo.dev, no App Store Connect ou no Google Cloud, gerar outra e trocar; chave de upload pelo reset |
| Número de build dessincronizado | `eas build:version:set` [F7] |
| `workflow_call` ou o novo `concurrency` quebram o CI | Reverter o commit da etapa 3 (aditivo) |
| Conta pessoal e troca para a empresa | Apple: suporte ou transferência [F15]. Play: transferência (não verificado) |
| Regras das lojas mudam | Reconferir F11 a F14 no dia de criar as contas |

Nenhuma migração de banco.

## Perguntas em aberto e premissas adotadas
- P1 (dono): contas pessoais agora ou de organização depois do CNPJ? **Recomendo organização.** Sem API hospedada, publicar não adianta. Com organização, o nome civil não aparece, a regra dos 12 testadores não se aplica e não há transferência. Peça o D-U-N-S logo depois do CNPJ e confirme com o contador o tipo de empresa (empresário individual, e ao que parece o MEI, entra como pessoa física na Apple).
- P2 (dono): EAS Update fica fora? **Recomendo que sim**, até haver receita para o Production. Sem assinatura, não.
- P3 (dono): aceitar o `EXPO_TOKEN` como secret do repositório (Free sem environments)? **Recomendo aceitar**, com estas condições:
  - token de robô, ou de uma conta Expo só do CI com MFA, nunca pessoal;
  - entender que **quem tem escrita no repositório pode publicar nas trilhas de teste**, e convidar só quem já teria esse poder (para dar só leitura, mova o repositório para uma organização Free, sem custo);
  - 2FA de todos e Settings → Actions como no runbook;
  - detecção que não depende do `gitCommitHash` (que é declarado por quem envia): os e-mails de build processado das duas lojas vão para você, e cada build no EAS e nas lojas casa 1:1 com o id de build impresso no log de uma execução do `lojas.yml` numa tag da `main`. Build sem execução, ou execução com dois builds, é incidente: gira o `EXPO_TOKEN` e expira o build (CA-119). Na promoção, você também confere o commit do build;
  - menor privilégio nas lojas mantido como no CA-114 (Play por app, sem "Gerenciar faixas de teste", sem papel IAM, teste aberto inativo; chave da Apple com papel Developer). O aceite só vale enquanto isso for verdade;
  - rotação a cada 6 meses, na saída de alguém e sob suspeita.

  **Fatos que reabrem o aceite** (registrados também no ADR-016): entrar colaborador novo; token pessoal ou robô com papel acima de Developer; a conta de serviço da Play ganhar produção, gestão de trilhas ou papel IAM; outro secret no repositório; o repositório ficar público; a chave da Apple virar App Manager.

  Se a chave da Apple tiver que ser App Manager, ela também envia para revisão e publica na App Store, e quem tem escrita passa a alcançar a produção da Apple. Isso pede nova decisão sua, não só registro. Alternativa sem custo: tirar o `--auto-submit` do iOS e você mesmo enviar com `eas submit`, com a chave App Manager fora das credenciais do EAS (não verificado: se o `eas submit` com `ascApiKeyPath` local deixa de guardar a chave). Alternativa paga: GitHub Pro (preço não verificado).
- P4 (dono): onde publicar a política de privacidade sem pagar? **Recomendo decidir junto com o registro de `bairrin.com.br`.** Nada bloqueia as etapas 1 a 5 e 7.
- P8 (dono): a localização do GPS é guardada ou efêmera? **Recomendo efêmera.** A posição fica no aparelho e só vai à API para a consulta, sem ser gravada. Só o endereço que o usuário salva (CA-30) é guardado. A declaração fica menor, e um vazamento não expõe por onde a pessoa andou. Requisito para o plano 03: a posição não vai em query string (`00-arquitetura.md:125`).
- P9 (dono): o histórico de busca é registrado? **Recomendo que não.** Para a métrica de buscas sem resultado (`03:52`), bastam contadores agregados, sem o termo e sem a conta.
- P10 (dono): as métricas de interação dos briefs 02 e 03 (`02:58`, `03:52`) existem no MVP? **Recomendo, no MVP, só as que o servidor já vê, contadas de forma agregada e sem a conta**: tempo de criação da loja, produtos publicados e com foto, buscas sem resultado e deep links. As de sessão e de tela (% de sessões até o produto, tempo até a primeira interação, concessão de localização) ficam fora, porque exigiriam um SDK de analytics, mais um operador e mais declaração.
- Premissas:
  - P5: versão `0.1.0` nas trilhas e `1.0.0` no lançamento;
  - P6: nota da Play com até 500 caracteres;
  - P7: organização do Expo `bairrin`; robô no Free não verificado (etapa 6, item 1).
- Não verificado: `eas submit --path`; Submit sem custo em qualquer volume; o multiplicador do macOS; o nome da opção de sessão no SDK React Native; o prazo do reset da chave de upload.

## ADR
ADR-016, publicação nas lojas:
- EAS Build e Submit no Expo Free, disparados pelo GitHub Actions por tag `<app>/vX.Y.Z` ou por disparo manual; envio só às trilhas de teste; promoção manual com conferência do commit.
- As checagens de `main` e de tag são guarda contra acidente: o Free privado não tem proteção de branch. Quem tem escrita pode publicar nas trilhas de teste (risco aceito na P3).
- Versão no `package.json`; número de build remoto no EAS.
- Credenciais no EAS, com cópia no cofre. No GitHub, só o `EXPO_TOKEN`, de robô ou de conta do CI. Menor privilégio nas lojas: na Play, permissão por app; na Apple, chave Developer (ou App Manager, se for preciso, registrado aqui).
- Play App Signing, com a chave do app no Google; `preview` com identificador próprio.
- O Expo é fornecedor crítico: recebe o monorepo (filtrado pelo `.easignore`) e guarda as credenciais.
- Sem EAS Update até o plano pago.
- Aceite do risco do `EXPO_TOKEN` no repositório (P3), com as condições da P3. Reabre o aceite: colaborador novo; token pessoal ou robô acima de Developer; a conta de serviço da Play com produção, gestão de trilhas ou IAM; outro secret no repositório; repositório público; chave da Apple como App Manager.

Descartados: fastlane no macOS (custo e stack nova), build local (sem iOS, fora do CI) e EAS Workflows (segundo CI). Complementa o ADR-013 e muda a mitigação do ADR-001, que deixa de corrigir JavaScript pelo ar.

Fontes (consultadas em 2026-10-16): [F1] https://expo.dev/pricing · [F2] https://docs.expo.dev/billing/faq.md · [F3] https://docs.github.com/en/billing/reference/actions-runner-pricing · [F4] https://docs.github.com/en/billing/concepts/product-billing/github-actions · [F5] https://github.community/t/can-included-minutes-be-used-on-macos-instances/16148 (2022) · [F6] https://docs.expo.dev/eas/workflows/introduction/ · [F7] https://docs.expo.dev/build-reference/app-versions/ e https://docs.expo.dev/eas/json.md · [F8] https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments · [F9] https://support.google.com/googleplay/android-developer/answer/13327111 · [F10] https://developer.android.com/developer-verification/guides · [F11] https://support.google.com/googleplay/android-developer/answer/13628312 · [F12] https://support.google.com/googleplay/android-developer/answer/14151465 · [F13] https://developer.apple.com/programs/enroll/ · [F14] https://developer.apple.com/support/enrollment/ · [F15] https://developer.apple.com/help/app-store-connect/transfer-an-app/overview-of-app-transfer/ · [F16] https://developer.apple.com/app-store/review/guidelines/ (5.1.1) · [F17] https://support.google.com/googleplay/android-developer/answer/9842756 · EAS Submit: https://docs.expo.dev/submit/android/ e https://docs.expo.dev/submit/ios/
