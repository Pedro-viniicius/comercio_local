# Plano técnico: arquitetura do MVP (plano mestre)
- Briefs: `docs/produto/briefs/01-fundacao-identidade.md` a `08-painel-admin.md` (CA-01 a CA-110)
- Data: 2026-10-16 · Fontes externas consultadas em 2026-10-16 (lista [Sn] no fim)
- Rodada 2: incorpora S1 a S13 e as baixas S14 a S22 e as informativas S23 e S24 (aplicadas aqui ou na seção "Requisitos de segurança para os próximos planos"), de `docs/produto/revisoes/2026-10-16-seguranca-planos-rodada1.md`

## Objetivo e critérios de aceite
Definir stack, fronteiras, contratos, dados, testes e operação do MVP, para que cada brief vire um plano executável sem redecidir nada. Este plano não implementa CA; diz onde cada CA mora (roadmap) e fecha as nove decisões que o dono pediu (ADR-001 a ADR-015).
AQ1 — cada decisão tem alternativas, trade-offs e fonte; AQ2 — todo contexto tem agregados, eventos e RNs; AQ3 — todo brief tem plano previsto, ordem e sensibilidade; AQ4 — custo mensal inicial estimado; AQ5 — texto pronto da seção "Contexto do projeto" do CLAUDE.md.

## Contexto atual
- Nada de código. Repositório git sem commits (`git log` → "does not have any commits yet"); só `CLAUDE.md`, `.claude/` e `docs/produto/`.
- Decisões que este plano estende sem reabrir: DDD com 7 contextos, Clean Architecture, monólito modular, testes em quatro níveis e CI que compila os apps (`docs/produto/decisoes.md:86-94`); três interfaces (`decisoes.md:106-108`); modelo de comissão (`decisoes.md:8-13`). Premissa (não decisão) de split via gateway com subcontas: `decisoes.md:68-72`.
- Restrições: equipe pequena e custo baixo, Android + iOS + painel web, LGPD, cartão nunca no servidor, conexão instável (`visao.md:95-104`).
- Máquina local (fato, `node --version` etc.): Node 22.23, pnpm 12.4, Docker 29.8 com Compose, Java 21. Sem Flutter nem Dart.

## Abordagens consideradas
**1. Mobile (ADR-001).** Escolha clara: React Native com Expo.
| Abordagem | Prós | Contras | Risco |
|---|---|---|---|
| **Expo (SDK 58, RN 0.88 [S1])** | TypeScript igual ao backend e ao painel; EAS Build gera iOS sem Mac [S2]; Expo Router (deep links), SecureStore (Keychain/Keystore [S3]), push e OTA prontos; roda na máquina atual | Desempenho de UI abaixo do nativo em listas pesadas; dependência do ecossistema Expo | Baixo |
| Flutter | UI consistente e rápida | Dart só nos apps (duas linguagens para 1 a 3 pessoas); não instalado | Médio |
| Nativo (Kotlin + Swift) | Melhor desempenho | 2 apps × 2 plataformas = 4 bases | Alto |
Contratação: oferta de devs React/React Native no Brasil é premissa, não verificada com dado.

**2. Dois apps x um app com perfis (ADR-002).**
| Abordagem | Prós | Contras |
|---|---|---|
| **Dois apps Expo no monorepo, com pacotes compartilhados** | Cada app pede só suas permissões (câmera no lojista, localização no consumidor); canal de push de alta prioridade só no lojista (CA-76); loja de apps clara para o "Seu Carlos"; releases independentes; já é o que os briefs assumem (CA-07, CA-14) | Duas fichas nas lojas e dois builds |
| Um app com troca de perfil | Um build | Mistura jornadas e permissões; o lojista some num menu; app maior |
| Um código, duas variantes de build | Menos pastas | Configuração condicional espalhada; testes de cada variante |

**3. Backend, dados e hospedagem (ADR-003, 004, 005).**
| Backend | Prós | Contras |
|---|---|---|
| **NestJS 12 (Node 22, TS) [S4]** | Uma linguagem no projeto; contratos zod compartilhados com apps e painel; módulos Nest mapeiam contextos; DI facilita testes; muito usado no Brasil com DDD/Clean (premissa) | Decorators e "mágica"; domínio precisa ficar fora do Nest por disciplina |
| Spring Boot (Java 21) | Robusto; Spring Modulith verifica fronteiras; forte no mercado BR | Segunda linguagem; JVM pede máquinas maiores |
| Fastify puro | Leve | Estrutura de módulos e DI feitas à mão |

| Acesso a dados | Prós | Contras |
|---|---|---|
| **Prisma (última major estável; a tag `latest` aponta para `8.0.0-rc.23` [S5]: não usar RC)** | Mais conhecido; migrações SQL versionadas e revisáveis (`--create-only`); tipado | Geração de código; mapeamento manual para entidades |
| Drizzle / Kysely | SQL explícito | Menos difundidos; pré-1.0 |
Banco: **PostgreSQL** (transações, JSONB, `unaccent` e `pg_trgm` para CA-33). Sem PostGIS: haversine em SQL e em TS bastam (CA-40, 200 lojas).

| Hospedagem | Região | Custo inicial estimado | Contras |
|---|---|---|---|
| **Fly.io `gru` (API + worker) + Supabase `sa-east-1` (Postgres + Storage)** | São Paulo nos dois [S6][S7] | Fly ~US$ 17 (1 GB + 512 MB; cálculo meu com o multiplicador 1,615 de `gru` [S8]) + Supabase Pro US$ 25 [S9] | Dois fornecedores; conexão pelo pooler em modo sessão (IPv4) porque a conexão direta é IPv6 [S10] |
| Fly.io só (Managed Postgres em `gru`) | São Paulo [S6] | máquinas ~US$ 17 + MPG Basic US$ 38 [S8] | Mais caro; storage de imagens em outro serviço |
| Railway | só EUA, Europa e Singapura [S11] | US$ 20+ | Latência extra Brasil-EUA (não medida) e dados fora do país |
| GCP Cloud Run + Cloud SQL (São Paulo) | São Paulo | não verificado | Mais configuração (IAM, conector), curva maior |

**4. Gateway de pagamento (ADR-006).**
| Critério | Pagar.me | Asaas | Mercado Pago | Stripe |
|---|---|---|---|---|
| Pix | sim, com split [S12] | sim (análise, F6) | sim (não verificado com split) | sim para contas BR, com Connect [S13] |
| Cartão tokenizado no app | sim: `POST /core/v5/tokens?appId=<chave pública>` [S14]; exige domínio cadastrado, uso por app nativo **não verificado** | **não**: tokenização chamada do servidor com dados do cartão [S15]; só a fatura hospedada evita isso | card token com chave pública (não verificado) | SDK RN oficial (não verificado nesta consulta) |
| Subconta por loja + split | recebedores por API + split por cobrança, "apenas para clientes PSP" [S16][S17] | subcontas por API; conta-mãe tem de ser PJ; titular ativa por e-mail e envia documentos [S18] | cada loja precisa de conta MP + OAuth; estorno parcial se a loja não tem saldo [S19] | Connect; plataforma BR com contas BR **não verificado** |
| Webhook assinado | **não verificado** (docs não descrevem) [S20] | **não**: token fixo no header `asaas-access-token` [S21] | sim: `x-signature` HMAC [S22] | sim: `Stripe-Signature` [S23] |
| Estorno por API | não verificado | sim, estorna o split junto [S24] | sim, proporcional [S19] | sim, Pix até 90 dias [S13] |
| Sandbox sem CNPJ | **não verificado** (relato de terceiro diz que exige CNPJ) | sandbox aberto; subconta em sandbox sem PJ não verificado | contas de teste no painel, CNPJ não citado [S25] | modo de teste (não verificado) |
| Custo (análise 2.1) | Pix 0,99%; crédito 4,19% | Pix R$ 1,99; crédito 2,99% + R$ 0,49 | Pix 0,99%; crédito 3,98% a 4,98% | Pix 1,19%; crédito 3,99% + R$ 0,39 + 0,25% Connect |
Nenhum atende todos os critérios com confirmação documental. Recomendação: **Pagar.me**, condicionada a três confirmações com o comercial antes do plano 05 (autenticação do webhook; tokenização a partir de app nativo; acesso de teste e split para a nossa modalidade). Reservas, nesta ordem: Stripe (melhor encaixe técnico, maior custo para a loja) e Mercado Pago (atrito de conta MP por loja). Asaas fica fora: fere RN-23 no app. Independentemente do gateway, o webhook é tratado como aviso e o estado é confirmado por consulta à API do gateway antes de lançar (defesa contra autenticação fraca). Até o plano 05 nada depende do gateway: a porta `GatewayDePagamento` tem um `GatewayFalso` usado em dev, testes e CI.

**5. Tempo real (ADR-007, CA-74, CA-57).**
| Abordagem | Prós | Contras |
|---|---|---|
| **Polling curto com ETag** (3 s só com a tela de pedido ou de Pix em foco; 304 quando nada mudou) + push visível para app fechado | Cumpre 5 s; sem conexão longa nem estado no servidor; funciona com várias instâncias | Requisições ociosas (100 telas abertas ≈ 33 req/s, aceitável) |
| WebSocket | Instantâneo | Sessões presas à instância, adaptador para várias instâncias, reconexão em rede ruim |
| SSE | Simples no servidor | RN não tem EventSource nativo; mesmos problemas de conexão longa |
| Push silencioso | Sem custo de rede ociosa | Entrega não garantida no iOS [S26]; não cumpre 5 s |
O hook `useAcompanharPedido` esconde o mecanismo: trocar por SSE depois não muda as telas.

**6. Serviços de apoio (ADR-008).** Push: **Expo Push Service** atrás da porta `EnviadorDePush` (prioridade alta, `channelId` Android, recibos com `DeviceNotRegistered` para CA-79, token de acesso ativado [S26]; preço não publicado na página: não verificado). Mapas: `react-native-maps` (Maps SDK mobile do Google com uso ilimitado sem custo [S27]; provedor no iOS não verificado). Geocodificação: Google Geocoding no servidor, 10 mil/mês grátis e US$ 5 por mil depois [S27], chave nunca no app; CEP pelo ViaCEP (grátis, bloqueia uso abusivo [S28]) com cache. Imagens (CA-25): upload para a API → bucket privado → worker valida assinatura do arquivo, remove EXIF e gera miniatura e detalhe em WEBP com `sharp` → bucket público no Supabase Storage via S3 [S29]. E-mail: SMTP via `nodemailer`; Mailpit em dev e testes; Resend em produção (grátis até 3 mil/mês e 100/dia; US$ 20 por 50 mil [S30]; SMTP do Resend não verificado), remetente em `bairrin.com.br` com SPF, DKIM e DMARC (após o registro). Deep links (CA-37): Expo Router + App Links e Universal Links em `https://bairrin.com.br` (após o registro); a API serve `/.well-known/*` e páginas mínimas `https://bairrin.com.br/l/<loja>` e `/p/<produto>` (plano 03).

**7. Conexão instável (ADR-009, CA-24, CA-38, CA-81).** Leitura: TanStack Query com cache persistido no aparelho (CA-38). Escrita: fila própria pequena em `packages/mobile-base` (cada operação com UUID gerado no aparelho, persistida, enviada em ordem ao reconectar). Servidor: header `Idempotency-Key` guardado 7 dias por conta (mesma chave e mesmo corpo → mesma resposta; corpo diferente → 422); transição inválida → 409 com o estado atual, e o app descarta com aviso (CA-81). Mutações pausadas do TanStack foram descartadas: não dão política de descarte por operação. (S11) Só consultas de uma lista permitida (vitrine pública, sem dado pessoal) vão para o cache persistido; a fila offline guarda ids e corpos cifrados com chave do SecureStore; logout, expiração e troca de conta limpam cache, fila e `queryClient`.

**8 e 9. Testes, CI, observabilidade e backups:** ver seções abaixo (ADR-013, ADR-014).

## Decisão
TypeScript de ponta a ponta em monorepo pnpm: API NestJS (HTTP + worker) com Prisma sobre PostgreSQL; dois apps Expo; painel React + Vite; contratos zod compartilhados. Hospedagem Fly.io `gru` + Supabase `sa-east-1`. Gateway Pagar.me condicionado (ADR-006).
**Painel (S9):** build estático servido por um app Fly `bairrin-painel` (Caddy) em `painel.bairrin.com.br`; API em `api.bairrin.com.br` (mesmo site, o cookie `SameSite=Strict` funciona); HTTPS com HSTS; CSP sem `unsafe-inline` e com `frame-ancestors 'none'`, `connect-src` só da API. Domínios após o registro.
**Custo mensal inicial** (prod + homologação): Fly ~US$ 25 (com o painel; cálculo meu, não verificado), Supabase Pro US$ 25 (homologação no plano Free), EAS Free (15 builds Android e 15 iOS [S31]), Resend Free, Sentry Developer (5 mil erros, 1 usuário [S32]), geocodificação na faixa grátis ≈ **US$ 50 a 55/mês (~R$ 275)**. Com EAS Starter (US$ 19 [S31]) e Resend Pro: ~US$ 90 (~R$ 450). Mais Apple US$ 99/ano e Google US$ 25 uma vez (análise F12, F13). Cabe nos R$ 500 a 700 da análise.
**Excesso de engenharia evitado:** (a) camadas completas (domínio, aplicação, infra, http) só onde há regra: Identidade, Lojistas, Catálogo, Pedidos e Pagamentos; Entregas, Notificações e Avaliações começam com aplicação + infra; (b) Entregas fica fino (código, previsão, atraso) e a máquina de estados é única, em Pedidos (CA-52); corte possível: fundir Entregas em Pedidos no MVP; (c) sem broker de mensagens nem microsserviço: outbox em tabela; (d) e2e mobile fora do CI de PR; (e) sem Turborepo, sem GraphQL, sem PostGIS, sem Redis.

## Mapa dos contextos
| Contexto (módulo) | Agregados, entidades e VOs | Eventos principais | RNs |
|---|---|---|---|
| Identidade (`identidade`) | Conta (perfis, consentimentos, 2FA); Sessao; VOs Email, Telefone, SenhaHash | ContaCriada, CadastroRepetidoTentado, EmailVerificado, SenhaRedefinida, ContaDesativada, ContaAnonimizada, ExportacaoSolicitada, PerfilLojistaConcedido | RN-20, 21, 22 |
| Lojistas (`lojistas`) | Loja (endereço, horários, entrega, retirada, pausa, alteração pendente); DadosRecebimento; Convite; VOs Cnpj, Coordenadas, Raio | LojaEnviadaParaAnalise, LojaAprovada, LojaReprovada, LojaSuspensa, LojaPausada, AlteracaoCadastralAprovada | RN-02, 04, 24, 25 |
| Catálogo (`catalogo`) | Produto (combinações com preço e estoque, imagens); Categoria; VOs Dinheiro, Variacao | ProdutoPublicado, ProdutoPausado, EstoqueReservado, EstoqueLiberado | RN-02, 03, 05, 06 |
| Pedidos (`pedidos`) | Pedido (itens congelados, transições, modalidade); Disputa | PedidoCriado, PedidoNovo, PedidoAceito, PedidoCancelado, PedidoExpirado, ProntoParaRetirada, PedidoEntregue, PedidoRetirado, PedidoConcluido, DisputaAberta, DisputaDecidida | RN-01, 05-10, 17, 19, 26-28 |
| Pagamentos (`pagamentos`) | Cobranca; Lancamento (somente acréscimo); Repasse; PoliticaDeComissao; Conciliacao | PagamentoAprovado, PagamentoRecusado, EstornoConcluido, RepasseRealizado, RepasseFalhou, DivergenciaEncontrada | RN-10-18, 23 |
| Entregas (`entregas`) | Atendimento (código de entrega ou retirada, previsão, entregador, atraso) | PedidoAtrasado | RN-26, 27 |
| Notificações (`notificacoes`) | Dispositivo; Notificacao (única por evento e destinatário); Preferencias | — (só consome) | CA-76-79 |
| Avaliações (`avaliacoes`) | Avaliacao (resposta, moderação) | AvaliacaoPublicada, AvaliacaoOcultada | RN-19 |
Avaliações é um módulo de suporte que a lista do dono não cita; fica separado para não inchar Pedidos (pergunta P4). Auditoria, configurações e outbox ficam no núcleo `compartilhado`.

## Comunicação entre contextos e extração futura
- Padrão: eventos de domínio gravados na tabela `outbox` na mesma transação do agregado; o worker publica cada evento como job do pg-boss [S33] por assinante (retentativa e fila de falhas); cada assinante é idempotente (`eventos_processados`). Entrega pelo menos uma vez.
- Chamada síncrona, só pela API pública do módulo (`modulos/<m>/index.ts`) e só quando a consistência imediata é regra: (1) Pedidos reserva estoque no Catálogo na mesma transação (CA-47, RN-06); (2) Entregas valida código e pede a transição a Pedidos (CA-75, CA-110); (3) Identidade consulta pendências de Pedidos e Pagamentos antes da exclusão (CA-11); (4) leituras de dados de outro contexto para montar telas.
- Para extrair um serviço depois: cada módulo já tem schema Postgres próprio, sem FK entre schemas (referência só por id); eventos versionados em `packages/contratos/src/eventos`; nenhum import fora de `index.ts` (dependency-cruiser no CI); JWT verificável por qualquer serviço (trocar HS256 por ES256 na extração). As chamadas síncronas acima viram saga com compensação.

## Estrutura do repositório
```
apps/api/            NestJS: src/main.ts (HTTP), src/worker.ts (outbox, jobs), src/compartilhado/, src/modulos/<m>/{dominio,aplicacao,infra,http}/, prisma/, test/
apps/consumidor/     Expo Router (app do consumidor)
apps/lojista/        Expo Router (app do lojista)
apps/painel/         React + Vite (painel do admin), servido por Caddy no Fly
packages/contratos/  @bairrin/contratos: zod de requisições, respostas, erros, eventos (API, apps e painel)
packages/cliente-api/ @bairrin/cliente-api: fetch tipado, renovação de sessão, Problem Details
packages/mobile-base/ @bairrin/mobile-base: sessão no SecureStore, fila offline, telas de conta comuns aos dois apps
packages/tokens/     @bairrin/tokens: design tokens de docs/produto/specs/00-design-system.md em TS
infra/               docker-compose.yml (Postgres dev e teste, Mailpit), postgres/init (papéis de banco)
scripts/             verificar-migracoes.mjs
docs/adr/            ADRs materializados; docs/produto/ (produto, specs, planos)
```
Regra de negócio: `apps/api/src/modulos/*/dominio` e `*/aplicacao`, e `packages/contratos` (validações). O `designer` não toca nessas pastas nem em `apps/api`.

## Contratos da API (ADR-010)
- REST + JSON em `/v1`; mudança incompatível vira `/v2` e as duas convivem enquanto houver app antigo; `GET /v1/app/versao-minima` força atualização.
- Esquemas zod em `packages/contratos` validam no app, no painel e na API (objeto estrito: campo desconhecido → 400, CA-13; mensagens pelo locale `ptBR` do zod [S34]). OpenAPI gerado desses esquemas em `/v1/docs` (fora de produção).
- Autenticação: `Authorization: Bearer` (acesso JWT de 15 min com `sid`); renovação com token opaco de 30 dias, rotativo, guardado com hash; no painel, o token de renovação vai em cookie `HttpOnly; Secure; SameSite=Strict` e o de acesso só em memória (S9). Perfis no token; checagem de dono do recurso no caso de uso.
- Autorização (S7): guarda `Autenticado` global (`APP_GUARD`); rota aberta só com `@Publico()` explícito; `Perfis(admin)` e `ExigeMfa` em todo o prefixo `/v1/admin`; teste que percorre o roteador reprova exceções. Todo plano com recurso de loja ou de conta usa o helper de isolamento do 01b.
- Revogação (S8): em `/v1/admin/*` a sessão (`sid`) é conferida a cada requisição; nas demais, `contas.status`. Desativar, bloquear ou excluir revoga as sessões na mesma transação.
- Dado pessoal e tokens nunca em query string ou caminho (S20): busca por e-mail ou telefone é `POST` com corpo; token de convite vai no corpo ou no fragmento; logs e Sentry gravam `req.url` sem a query.
- Erros: RFC 9457 (`application/problem+json`) com `codigo`, `title` em português, `campos: [{campo, codigo, motivo}]` e `idRequisicao`; nunca pilha, SQL ou dado pessoal.
- Paginação por cursor (`?cursor=&limite=`, máximo 20, CA-39). Dinheiro em centavos inteiros (`...EmCentavos`). Datas ISO 8601 UTC. IDs UUID.
- Idempotência: `Idempotency-Key` obrigatório em criação de pedido, pagamento e operações da fila offline (a partir do plano 02), com escopo conta + método + rota (S24) e resposta guardada sem dado pessoal (S5).

## Esquema central (por schema Postgres; convenção snake_case em português)
| Schema | Tabelas essenciais |
|---|---|
| compartilhado | outbox, eventos_processados, auditoria (somente acréscimo por trigger), configuracoes (com histórico), idempotencia |
| identidade | contas, perfis_conta, sessoes, codigos_verificacao, consentimentos, documentos_legais, segundo_fator, codigos_recuperacao, bloqueios_login, solicitacoes_titular, exportacoes_titular |
| lojistas | lojas, horarios_loja, alteracoes_pendentes, dados_recebimento (cifrado), convites |
| catalogo | categorias, produtos, combinacoes, movimentos_estoque, reservas_estoque, imagens |
| pedidos | pedidos, itens_pedido, transicoes_pedido, disputas, mensagens_disputa |
| pagamentos | cobrancas, tentativas_pagamento, eventos_gateway, lancamentos, repasses, politicas_comissao, isencoes, conciliacoes, cartoes_salvos |
| entregas / notificacoes / avaliacoes | atendimentos · dispositivos_push, notificacoes, preferencias · avaliacoes, respostas, denuncias, termos_bloqueados |
Migrações: Prisma Migrate, uma pasta por migração, SQL revisado (`prisma migrate dev --create-only`), aplicadas com `prisma migrate deploy` no deploy. Migração com `DROP`, `RENAME` ou `ALTER ... TYPE` só em pasta com sufixo `_destrutiva`, separada da de criação, começando por um bloco que aborta se houver dados; `scripts/verificar-migracoes.mjs` barra no CI. Toda migração tem nota de reversão no cabeçalho.
Banco (S2, S3): nada no schema `public`; toda tabela com RLS ligado e política só para o papel da aplicação; "Data API" do Supabase desligada em produção e homologação, com `anon` e `authenticated` sem privilégios. Dois papéis: `DATABASE_URL_MIGRACAO` (dono dos schemas, usado só no `release_command`) e `DATABASE_URL` da aplicação (só DML, sem `UPDATE`, `DELETE` e `TRUNCATE` nas tabelas somente-acréscimo).

## Testes e CI (ADR-013)
| Nível | Ferramenta | Onde | Meta |
|---|---|---|---|
| Unitário (domínio, aplicação, pacotes) | Vitest | PR | linhas ≥ 90% em `dominio/`, ≥ 80% na API e nos pacotes |
| Integração (repositórios, casos de uso, HTTP com supertest) | Vitest + Postgres real do `infra/docker-compose.yml` (serviço no CI) | PR | todo repositório e todo endpoint |
| UI (fluxos críticos) | jest-expo + Testing Library (apps); Vitest + Testing Library (painel) | PR | ≥ 60% em `apps/*/src` |
| e2e | Maestro em emulador Android com API local e serviços falsos | noturno e antes de release | cadastro, compra, aceite, pagamento |
CI de PR (GitHub Actions): `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` → `pnpm deps:verificar` → `pnpm migracoes:verificar` → `pnpm test` → `pnpm test:integracao` → `pnpm build` (API, painel e `expo export` dos dois apps). Na `main`: build Android nativo; iOS por EAS Build manual. Sem serviços externos: `GatewayFalso`, `EnviadorDePushFalso`, Mailpit, geocodificador falso. Teste de propriedade (fast-check) só em dinheiro (plano 05). Cadeia de suprimentos (S12): `pnpm audit --prod --audit-level=high` bloqueante no CI; versões exatas; `minimumReleaseAge` de 3 dias e `onlyBuiltDependencies` com lista permitida no `pnpm-workspace.yaml`; Dependabot; EAS Update com assinatura de código.

## Segurança e LGPD transversais
- Dado pessoal mora em `identidade.contas`, `lojistas.lojas` e `dados_recebimento`, endereços e telefones copiados em `pedidos`. Dados bancários e segredo TOTP cifrados (AES-256-GCM, chave em segredo de ambiente).
- Logs: pino com `redact` e sem corpo de requisição; erros do Prisma registrados só pelo código; teste que provoca erros e procura dado pessoal em log e resposta (CA-12). Sentry (S10): `sendDefaultPii: false`, `beforeSend` e `beforeBreadcrumb` com o mesmo redator do pino, sem Replay, scrubbing e "scrub IP" ligados; o teste do CA-12 usa um transport falso do Sentry. Push e e-mail sem endereço nem dado de terceiros.
- Auditoria sem dado pessoal (S4): `antes` e `depois` guardam ids, nomes de campo e valores não pessoais; campo pessoal vira `{"alterado": true}`; se um caso exigir reconstituir o valor, cifrar com chave por titular e destruir a chave na anonimização. Teste no repositório de auditoria rejeita chaves conhecidas de dado pessoal.
- Anonimização em todos os contextos (S5): porta `AnonimizadorDeTitular`, com registro por módulo (molde do `VerificadorDePendencias`); cada plano que guarda dado pessoal entrega a sua implementação e teste (pedidos, dispositivos de push, autor de avaliação, convites). Retenções: `idempotencia` 7 dias; `outbox` publicada 30 dias; jobs concluídos do pg-boss 7 dias; exportações do titular 7 dias; backups 7 dias (constar na política de privacidade).
- Segredos só em variáveis de ambiente (Fly secrets, GitHub secrets); `.env*` no `.gitignore`, só `.env.example` versionado. Senhas com Argon2id (19 MiB, 2 iterações, paralelismo 1 [S35]). Chaves com versão no texto cifrado, subchaves por finalidade (HKDF) e mínimo de 32 bytes validado ao subir (S17).
- Helmet, CORS só para o domínio do painel, limite de requisições por IP nas rotas públicas, freio progressivo de login (CA-04), limite de corpo JSON de 100 KB (S19), `Cache-Control: no-store` por padrão (S17).
- Operação (S21): conexão com o Supabase com `sslmode=verify-full` e "Enforce SSL"; homologação só com dados sintéticos; MFA obrigatório nas contas de todos os fornecedores (Fly, Supabase, GitHub, Expo, Apple, Google, Sentry, Resend, gateway).
- Operadores de dado pessoal (S10, ADR-015): Supabase (todos os dados; São Paulo), Fly.io (processamento; São Paulo), Resend (e-mail e nome; país não verificado), Expo Push (token e texto do aviso; EUA, não verificado), Sentry (erros sem dado pessoal; região não verificada), Google Geocoding (endereço; EUA, não verificado), ViaCEP (CEP; Brasil), gateway (pagamento; Brasil). Tabela para o advogado.

## Observabilidade, backups e operação (ADR-014)
`/v1/saude` (vivo) e `/v1/saude/pronto` (banco); logs JSON com `idRequisicao`; Sentry na API, nos apps e no painel; monitor de uptime externo grátis. Backups: diários com 7 dias no Supabase Pro [S9]; PITR custa US$ 100/mês [S9] (pergunta P2; o `seguranca` recomenda ligar antes do primeiro pagamento real, S21); cópia lógica cifrada semanal fora do Supabase (S21); restauração testada em homologação antes do piloto e a cada trimestre.

## Convenções
Domínio em português sem acento (`Pedido`, `criarConta`, `valorEmCentavos`); termos de framework em inglês. Arquivos em kebab-case (`criar-conta.caso-de-uso.ts`, `*.test.ts`, `*.int.test.ts`). ESLint (typescript-eslint, `eslint-config-expo` nos apps) + Prettier. Commits Conventional Commits em português (`feat(identidade): ...`). README por módulo e por pacote. ADR curto em `docs/adr/NNNN-titulo.md`.

## Roadmap de planos
| Plano | Brief | Módulos | Ordem | Sensível | Quando escrever |
|---|---|---|---|---|---|
| 01a fundação do repositório | 01 | raiz, api base, apps, painel, CI | 1 | sim | agora |
| 01b identidade | 01 (CA-01 a 13) | identidade, compartilhado, mobile-base, painel | 2 | sim | agora |
| 02 loja e catálogo | 02 | lojistas, catalogo, imagens, fila offline, idempotência | 3 | sim (upload, CNPJ, dados bancários) | após aprovar 01, com a spec 02 |
| 08a aprovação e configurações | 08 (CA-89, 91, 97, 99, 101) | lojistas, compartilhado, painel | 4 | sim | junto com o 02 |
| 03 descoberta | 03 | catalogo (vitrine geo, busca), deep links | 5 | parcial (rotas públicas) | após o 02 |
| 04 pedidos | 04 | pedidos, catalogo (reserva), entregas | 6 | sim (concorrência, idempotência) | após o 03 |
| 05 pagamentos | 05 | pagamentos | 7 | sim | só depois do portão do ADR-006 (S13), abaixo |
| 06 entregas e notificações | 06 | entregas, notificacoes | 8 | sim (tokens de push, contato) | após o 05 |
| 07 avaliações | 07 | avaliacoes | 9 | parcial (CA-87) | após o 06 |
| 08b painel restante | 08 | todos | 10 | sim | após o 06 |
**Portão do plano 05 (S13):** (1) confirmação por escrito do Pagar.me sobre a autenticação do webhook; sem assinatura, levar ao dono a alternativa (Basic Auth ou segredo na URL + lista de IPs + consulta à API) como ajuste do CA-60; (2) webhook tratado só pelo id da cobrança que nós criamos, com valor e status lidos da API e comparados ao pedido, ignorando o id de pedido do payload; (3) tokenização a partir de app nativo confirmada e questionário PCI DSS aplicável identificado; (4) "split apenas para clientes PSP" esclarecido com comercial e advogado; (5) chaves por ambiente em Fly secrets, chave pública separada da secreta e teste de redação dos campos do gateway nos logs. Sem os cinco, o plano 05 não é escrito.

## Requisitos de segurança para os próximos planos
| ID | Requisito | Plano |
|---|---|---|
| P1-dono | Exigir `email_verificado_em` no servidor antes de criar loja ou conceder o perfil lojista (CA-07) | 02 |
| S19 | Upload: limite de multipart; `sharp` com `limitInputPixels` baixo; nome de arquivo gerado no servidor; original apagado do bucket privado depois de processado; bucket público só com versões geradas | 02 |
| S20 | Busca de usuário no painel por `POST`; convite com token no corpo ou no fragmento | 08a, 08b |
| S21 | Restringir a rede do Supabase ao IP de saída do Fly, se for fixo (não verificado) | deploy do piloto |
| S24 | Polling com ETag autoriza antes de devolver 304 | 04, 06 |
| S24 | Seeds de dados recusam `NODE_ENV=production` (o `seed:admin` é a exceção, por CLI) | 01b e seguintes |
| S24 | Throttler em memória aceito no MVP (uma instância); trocar por armazenamento compartilhado ao escalar | operação |
| S24 | CA-98: abrir ficha registra leitura na auditoria; dados mascarados por padrão | 08b |
| S5 | Cada plano entrega o `AnonimizadorDeTitular` e as retenções do seu módulo | 02 a 08b |
| S7 | Helper de isolamento obrigatório por recurso | 02, 04, 05, 06, 07 |

## Pontos para o seguranca
Rodada 2: conferir S2 a S5 e S7 a S13 nas seções acima (banco, auditoria, anonimização, contratos, painel, Sentry, cadeia de suprimentos e portão do plano 05) e a tabela de requisitos futuros. Continua valendo: ADR-006 (webhook confirmado por consulta à API), ADR-012 (sessão, rotação, cookie do painel), cifragem de dados bancários e TOTP.

## Riscos e como reverter
| Risco | Mitigação | Reversão |
|---|---|---|
| Gateway escolhido falha uma confirmação | Porta `GatewayDePagamento` + `GatewayFalso`; decisão só antes do plano 05 | Trocar o adaptador (Stripe ou Mercado Pago) sem mexer em Pedidos |
| Fly e Supabase em fornecedores diferentes (latência, IPv4) | Pooler em modo sessão; medir p95 em homologação contra CA-39 | Mover a API para Fly MPG ou o banco para o Fly; a imagem Docker é a mesma |
| Migração errada em produção | Revisão, `_destrutiva` separada, backup antes do deploy | Migração de reversão escrita na nota; restauração do backup diário |
| Expo ou RN quebra em atualização de SDK | Versões fixas, atualização planejada uma vez por SDK | Manter SDK anterior; EAS Update para correções de JS |
| Polling pesa com volume | ETag/304, intervalo só com a tela em foco | Trocar por SSE atrás do mesmo hook |
| Push atrasado no Android (economia de bateria) | Canal de alta prioridade, e-mail de alerta (CA-76) | — (risco operacional aceito no brief 06) |

## Perguntas em aberto e premissas adotadas
- P1 — respondida em 2026-10-16: CNPJ só quando o app estiver pronto. O portão do plano 05 (S13) segue valendo; o comercial do gateway e as contas de produção ficam para depois do CNPJ.
- P2 — respondida em 2026-10-16: nada de PITR por enquanto; volta à decisão antes do primeiro pagamento real (recomendação S21).
- P3 — respondida em 2026-10-16: dois fornecedores (Fly + Supabase) aceitos para quando houver deploy.
- P4 — respondida em 2026-10-16: Avaliações como módulo próprio, aceito.
- Premissa (decisão do dono, 2026-10-16): **nenhum serviço pago até o app ficar pronto.** O desenvolvimento é só local (Docker Compose, serviços falsos, Mailpit); sem Fly, Supabase pago, PITR nem contas de produção; homologação adiada. As etapas de deploy do 01a (13 e 15) entregam imagem e configuração verificadas localmente, sem publicar. O custo mensal estimado vale a partir da homologação.
- Premissas: equipe de 1 a 3 pessoas a contratar; sem CNPJ, só sandbox e contas de teste; cidade piloto parametrizável; câmbio R$ 5/US$ (análise F17); repositório no GitHub (minutos do Actions grátis não verificados).

## ADR (o `dev` materializa em `docs/adr/` no plano 01a)
| ADR | Decisão | Consequência principal |
|---|---|---|
| 001 | Apps em React Native com Expo, TypeScript | EAS para builds; Flutter e nativo descartados |
| 002 | Dois apps (consumidor e lojista) com pacotes compartilhados | Duas fichas nas lojas; código comum em `packages/` |
| 003 | API NestJS, monólito modular, domínio sem framework, fronteiras checadas por dependency-cruiser | Um módulo por contexto, schema Postgres próprio |
| 004 | PostgreSQL + Prisma; migração destrutiva separada e barrada no CI | Script `verificar-migracoes.mjs` |
| 005 | Fly.io `gru` (API, worker e painel) + Supabase `sa-east-1`; Data API desligada, dois papéis de banco (S2, S3, S9) | ~US$ 50-55/mês no início |
| 006 | Pagar.me condicionado ao portão de cinco itens (S13); webhook confirmado por consulta | Plano 05 só depois do portão |
| 007 | Polling curto com ETag para tempo real | Troca por SSE sem mudar telas |
| 008 | Expo Push, Google Geocoding + ViaCEP, sharp + Supabase Storage, SMTP (Resend), App/Universal Links | Todos atrás de portas com falsos para teste |
| 009 | Cache persistido só com consultas públicas + fila offline cifrada + `Idempotency-Key`; limpeza no logout (S11) | Tabela `idempotencia` com retenção de 7 dias |
| 010 | REST `/v1`, contratos zod, Problem Details, cursor; guarda global, sem dado pessoal na URL (S7, S20) | `packages/contratos` é fonte única |
| 011 | Outbox + pg-boss, pelo menos uma vez, assinantes idempotentes | Sem broker; worker separado |
| 012 | Sessão: JWT de 15 min com `sid` + renovação opaca rotativa de 30 dias; Argon2id; TOTP no admin com desafio por etapa e limite de tentativas (S1, S8, S16) | Revogação no servidor (CA-05) |
| 013 | Pirâmide de testes da seção "Testes e CI"; audit de dependências bloqueante (S12) | e2e fora do PR |
| 014 | Sentry com redator + logs com redact + uptime; backup diário + cópia lógica, PITR a decidir (S10, S21) | Restauração testada |
| 015 | Tabela de operadores de dado pessoal; auditoria sem dado pessoal; `AnonimizadorDeTitular` e retenções (S4, S5, S10) | Revisão do advogado antes do piloto |

## Texto para a seção "Contexto do projeto" do CLAUDE.md (após aprovação)
```
- **Produto:** Bairrin, marketplace mobile do comércio local (visão em `docs/produto/visao.md`; arquitetura em `docs/produto/planos/00-arquitetura.md`).
- **Stack:** TypeScript, Node 22, pnpm (monorepo). API NestJS + Prisma + PostgreSQL; worker com outbox + pg-boss. Apps Expo (React Native) `apps/consumidor` e `apps/lojista`; painel React + Vite `apps/painel`. Pacotes compartilhados no escopo `@bairrin/*` (contratos zod em `packages/contratos`, `@bairrin/contratos`). Hospedagem Fly.io (gru) + Supabase (sa-east-1). Domínio previsto `bairrin.com.br` (após o registro).
- **Camadas e pastas:** `apps/api/src/modulos/<contexto>/{dominio,aplicacao,infra,http}`; núcleo em `apps/api/src/compartilhado`. Regra de negócio (o `designer` não toca): `apps/api/**`, `packages/contratos/**`, `packages/cliente-api/**`, `packages/mobile-base/src/fila-offline/**` e `packages/mobile-base/src/sessao/**`. Visual: `apps/*/src/{app,componentes,telas}`, `apps/painel/src/{autenticacao,textos}`, `packages/mobile-base/src/{componentes,telas,textos}`, `packages/tokens`, `assets/brand`. Texto de interface em `textos/pt-BR.ts` (app e painel); erro de campo mostrado por `erro.<campo>.<codigo>`, com o `motivo` da API como reserva.
- **Verificação:** `pnpm lint`, `pnpm typecheck`, `pnpm deps:verificar`, `pnpm migracoes:verificar`, `pnpm test`, `pnpm test:integracao` (exige `docker compose -f infra/docker-compose.yml up -d`), `pnpm build`. Um arquivo: `pnpm --filter <pacote> exec vitest run <caminho>` (apps: `pnpm --filter <app> exec jest <caminho>`).
- **Dados de teste:** Postgres e Mailpit do `infra/docker-compose.yml`; gateway, push e geocodificação falsos por padrão (`*_PROVEDOR=falso` no `.env`); seed com `pnpm --filter api seed`.
- **Dado pessoal (LGPD):** schemas `identidade`, `lojistas` (inclui dados bancários cifrados) e cópias de contato em `pedidos`. Nunca em logs, erros, URLs, auditoria ou eventos não cifrados. Todo módulo com dado pessoal implementa `AnonimizadorDeTitular`.
- **Segredos:** nunca leia nem imprima `.env*` (exceto `.env.example`) nem arquivos de senha.
- **Docs que acompanham a mudança:** `README.md`, README do módulo ou pacote alterado, `docs/adr/` quando a decisão mudar.
```

## Fontes (consultadas em 2026-10-16)
[S1] https://docs.expo.dev/versions/latest/ · [S2] https://docs.expo.dev/build/setup/ · [S3] https://docs.expo.dev/versions/latest/sdk/securestore/ · [S4] https://registry.npmjs.org/@nestjs/core/latest · [S5] https://registry.npmjs.org/prisma/latest · [S6] https://docs.fly.io/reference/regions · [S7] https://supabase.com/docs/guides/platform/regions · [S8] https://docs.fly.io/about/pricing · [S9] https://supabase.com/pricing · [S10] https://supabase.com/docs/guides/database/connecting-to-postgres · [S11] https://docs.railway.com/reference/deployment-regions · [S12] https://docs.pagar.me/reference/pix-2 · [S13] https://docs.stripe.com/payments/pix · [S14] https://docs.pagar.me/reference/criar-token-cart%C3%A3o-1 · [S15] https://docs.asaas.com/reference/tokenizacao-de-cartao-de-credito · [S16] https://docs.pagar.me/docs/split-1 · [S17] https://docs.pagar.me/reference/criar-recebedor-1 · [S18] https://docs.asaas.com/docs/criacao-de-subcontas · [S19] https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace · [S20] https://docs.pagar.me/reference/eventos-de-webhook-1 · [S21] https://docs.asaas.com/docs/sobre-os-webhooks · [S22] https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks · [S23] https://docs.stripe.com/webhooks/signature · [S24] https://docs.asaas.com/docs/split-de-pagamentos · [S25] https://www.mercadopago.com.br/developers/pt/docs/your-integrations/test/accounts · [S26] https://docs.expo.dev/push-notifications/sending-notifications/ · [S27] https://developers.google.com/maps/billing-and-pricing/pricing · [S28] https://viacep.com.br/ · [S29] https://supabase.com/docs/guides/storage/s3/compatibility · [S30] https://resend.com/pricing · [S31] https://expo.dev/pricing · [S32] https://sentry.io/pricing/ · [S33] https://registry.npmjs.org/pg-boss/latest · [S34] https://zod.dev/error-customization · [S35] https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
