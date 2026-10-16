# ADR-014: Observabilidade, backups e operação

- Situação: aceita (decisão do dono, 2026-10-16). Logs e rotas de saúde existem; Sentry, uptime e backups dependem do deploy.
- Origem: `docs/produto/planos/00-arquitetura.md`, seção "Observabilidade, backups e operação (ADR-014)", S10 e S21.

## Contexto

Com uma equipe pequena, é preciso achar um erro a partir do que o usuário viu, sem registrar dado pessoal, e conseguir restaurar o banco. O dono respondeu (P2) que não há PITR por enquanto e que a decisão volta antes do primeiro pagamento real.

## Decisão

- Saúde: `GET /v1/saude` (vivo, sem consultar o banco) e `GET /v1/saude/pronto` (consulta o banco; 503 em Problem Details se falhar). `versao` só aparece fora de produção.
- Logs em JSON (pino) com `idRequisicao`, redator de chaves sensíveis, **sem corpo de requisição** e com a URL sem query string. A mensagem de erro de biblioteca de banco não vai para o log: só tipo, código e pilha.
- Sentry na API, nos apps e no painel, só quando `SENTRY_DSN` existe, com `beforeSend` e `beforeBreadcrumb` usando o mesmo redator, sem Replay e sem coleta de dado pessoal pelo SDK. O plano previa `sendDefaultPii: false`; o SDK 11 (`@sentry/nestjs`) trocou essa opção por `dataCollection`, que sem configuração coleta tudo, então a API desliga cada categoria (usuário e IP, cookies, cabeçalhos, corpos, query, dados de banco, variáveis locais). Na API, as sessões de release health (do processo e por requisição) ficam desligadas: a sessão vai num envelope à parte, sem passar pelo `beforeSend`, com o id do usuário (ou o e-mail, sem id) e o IP. Por defesa em profundidade, o transport só deixa sair o evento de erro e o relatório do cliente; qualquer outro tipo de item, inclusive um tipo novo do SDK, fica retido. A release vem só de `SENTRY_RELEASE`, validada no ambiente; o SDK não a deduz de `GITHUB_SHA` nem de outras variáveis de CI. Sem propagação de trace (`tracePropagationTargets: []`): os cabeçalhos `sentry-trace` e `baggage` levariam a chave pública do DSN, a release e o ambiente a quem recebe as requisições de saída (S60). Spotlight e debug ficam desligados de forma explícita, porque o SDK os liga pelo ambiente (`SENTRY_SPOTLIGHT`, `SENTRY_DEBUG`), e em produção a API recusa `SENTRY_TRACES_SAMPLE_RATE`, que ligaria o tracing (S61). Do usuário, só sai o id quando é um uuid; id em outra forma descarta o usuário do evento (S62). No projeto do Sentry, o descarte de IP e a limpeza de dados do lado do servidor ficam ligados (`docs/operacao/checklist-deploy.md`). Monitor de uptime externo grátis.
- Backups: o plano Pro do Supabase faz backup diário com 7 dias de retenção. Além disso, uma cópia lógica cifrada semanal fora do Supabase. O PITR (cerca de US$ 100 por mês) fica adiado; a recomendação é ligar antes do primeiro pagamento real.
- A restauração é testada em homologação antes do piloto e a cada trimestre. Os backups de 7 dias constam da política de privacidade.

## Requisitos para os SDKs dos apps e do painel

Para quem ligar o Sentry nos apps (React Native) ou no painel (navegador), no 01b ou depois. Valem as mesmas regras da API (redator no `beforeSend` e no `beforeBreadcrumb`, sem tracing, transport só com `event` e `client_report`), mais estas. Os nomes das opções não foram conferidos nos SDKs de React Native e de navegador: confira na versão instalada.

- **React Native:** `enableAutoSessionTracking: false`; `sendDefaultPii: false` (o SDK de React Native não tem `dataCollection`); `attachScreenshot` e `attachViewHierarchy` desligados; sem Replay. O crash e a sessão do SDK nativo (Android e iOS) saem pelo transport nativo, sem passar pelo `beforeSend` nem pelo transport do JS: aplique a configuração equivalente na camada nativa (sessão nativa desligada, sem id de instalação, sem screenshot) ou desligue o tratamento de crash nativo (`enableNativeCrashHandling: false`, nome a conferir), e prove em aparelho, com transport interceptado, antes de preencher a tabela de privacidade. Se o SDK nativo preencher `user.id` com um id de instalação quando o app não chama `setUser`, o `beforeSend` do app tira `user` e os identificadores de `contexts.device`, com teste; senão o diagnóstico fica vinculado a um id de aparelho (ver `docs/produto/planos/publicacao-nas-lojas.md`, S41). Os apps não chamam `setUser` (ver `docs/produto/planos/publicacao-nas-lojas.md`, S41). Se um dia chamarem, só com o uuid, e `setUser(null)` no logout; isso muda o App Privacy e o Data Safety para "vinculado".
- **Navegador (painel):** sem `browserSessionIntegration` e sem Replay; redigir `data.from` e `data.to` e o fragmento dos breadcrumbs de navegação (o token de convite vai no fragmento, S20). `setUser`, se houver, como na API: só o uuid.
- **Nos dois:** `tracePropagationTargets` só com o domínio da API, e o transport com a mesma lista de permissão de itens da API. Se a correlação app → API não for necessária, `[]` também nos clientes é mais simples. Se houver propagação, `sentry-trace` e `baggage` entram nos cabeçalhos permitidos do CORS da API (o painel é outra origem), e o `baggage` do cliente vai para o cabeçalho `trace` do envelope da API, fora do `beforeSend`: confira na versão fixada que ele só leva chaves `sentry-*`, sem dado pessoal.
- **Integração com o ViaCEP (futura):** redigir o caminho do breadcrumb da requisição de saída (o CEP vai no caminho), ou usar `ignoreOutgoingRequests`.

## Consequências

- Um suporte consegue achar o log pelo `idRequisicao` que o usuário viu no erro.
- Sem PITR, a perda de dados pode chegar a cerca de 24 horas (intervalo do backup diário). Risco aceito até o primeiro pagamento real.
- Todos os itens operacionais estão em `docs/operacao/checklist-deploy.md`.
- Nada disso foi contratado ainda (decisão do dono: nenhum serviço pago antes do app pronto).
