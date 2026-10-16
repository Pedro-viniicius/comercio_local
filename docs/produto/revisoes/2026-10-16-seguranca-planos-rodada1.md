# Revisão de segurança dos planos 00, 01a e 01b (rodada 1)

- Data: 2026-10-16
- Revisor: agente `seguranca`
- Escopo: `docs/produto/planos/00-arquitetura.md`, `01a-fundacao-repositorio.md`, `01b-identidade.md`, spec `docs/produto/specs/01-fundacao-identidade.md`
- Veredito: **BLOQUEANTE** (S1 ALTA)

## Resumo de risco
O desenho é bom no geral: autenticação própria com Argon2id, renovação opaca rotativa guardada com hash, cookie HttpOnly/Strict no painel, contratos zod estritos, outbox só com ids, código de e-mail fora da outbox, trigger de auditoria, migração destrutiva separada, `GatewayFalso`, webhook confirmado por consulta à API e actions fixadas por SHA. O bloqueio vem de um único ponto: o fluxo de 2FA do admin (S1) não amarra o desafio à etapa e não limita tentativas. Há ainda 12 MÉDIAS de desenho que precisam entrar nos planos antes do release.

## Achados

### S1 [ALTA] Desafio de 2FA sem vínculo de etapa nem limite de tentativas
- CWE-307, CWE-287. Local: `01b-identidade.md:52`, `:57-59`, `:80` (etapa 10), `:74` (etapa 4, "reinício após sucesso"), `:99`.
- Cenário: a senha do admin vaza. (a) Se o servidor aceitar `/segundo-fator/configuracao` com um desafio de login comum, o atacante gera um segredo TOTP novo e entra com `mfa: true`. (b) Não há limite de tentativas para TOTP nem códigos de recuperação; senha correta zera o freio, então dá para testar códigos até acertar.
- Correção: desafio guarda `etapa` (`configurar` ou `verificar`); `configuracao`/`confirmacao` só aceitam desafio `configurar`, emitido só sem `segundo_fator.confirmado_em`; reconfigurar TOTP fora do painel (CLI) no MVP; 3 a 5 tentativas por desafio; falhas de TOTP e recuperação somam num contador por conta ligado ao `BloqueioDeLogin`, que só zera após o segundo fator concluído; códigos de recuperação com entropia mínima (10 caracteres base32) e `timingSafeEqual`; verificação de e-mail, redefinição e renovação nunca emitem `admin` nem `mfa` (renovação herda `mfa`); testes na etapa 16: desafio de login em `configuracao` → 401; sexta tentativa → 401 mesmo com código certo.

### S2 [MÉDIA] Tabelas no schema `public` do Supabase expostas pela Data API
- Local: `01a:58` (etapa 7, plano B "prefixo `compartilhado_`"), `:80`; `00:46`.
- Correção: desligar "Enable Data API" em produção e homologação, revogar default privileges de `anon`/`authenticated` em `public`, RLS em todas as tabelas como segunda barreira; trocar o plano B por "parar e avisar o lead"; item na lista de verificação do deploy. Fonte: https://supabase.com/docs/guides/api/securing-your-api

### S3 [MÉDIA] Imutabilidade da auditoria depende de papel de banco não separado
- Local: `01a:11` (CA-F4), `:43`, `:64` (etapa 13), `:72`.
- Correção: dois papéis (`DATABASE_URL_MIGRACAO` só no `release_command`; `DATABASE_URL` da aplicação só DML, com `REVOKE UPDATE, DELETE, TRUNCATE` em `auditoria` e tabelas somente-acréscimo); trigger `BEFORE TRUNCATE`; teste de integração com o papel da aplicação; requisito da etapa 7 (Supavisor com papel customizado: não verificado).

### S4 [MÉDIA] Auditoria imutável guarda dado pessoal em `antes`/`depois`
- Local: `01a:43`; `00:128`; CA-99; CA-11.
- Correção (regra no plano mestre antes dos planos 02 e 08a): auditoria com ids, nomes de campo e valores não pessoais; campo pessoal vira `{"alterado": true}` ou HMAC; se precisar reconstituir, cifrar com chave por titular e destruir a chave na anonimização; teste que rejeita chaves conhecidas de dado pessoal.

### S5 [MÉDIA] Anonimização só cobre Identidade
- Local: `01b:29`, `:81`, `:101`; `00:98`, `:123`, `:128`, `:147`.
- Ficam com dado pessoal: cópias em `pedidos`, `idempotencia`, jobs do pg-boss, `dispositivos_push`, autor em `avaliacoes`, Sentry, cache do app.
- Correção: porta `AnonimizadorDeTitular` com registro por módulo (molde do `VerificadorDePendencias`), cada plano entrega a sua; retenção explícita de `idempotencia` (7 dias, sem dado pessoal na resposta guardada), outbox (30 dias) e arquivo do pg-boss; backups de 7 dias na política de privacidade.

### S6 [MÉDIA] Conta não verificada permite sequestro prévio
- Local: `01b:26`, `:49-51`, `:78` (etapa 8).
- Correção: novo cadastro com e-mail de conta não verificada substitui senha, nome e telefone e invalida códigos anteriores; contas não verificadas apagadas em 7 dias; redefinição de senha conta como verificação; teste do caso de uso.

### S7 [MÉDIA] Autorização opcional por controller
- Local: `01b:86` (etapa 16); `00:120`.
- Correção: `Autenticado` como `APP_GUARD` global com `@Publico()` explícito; `Perfis(admin)` e `ExigeMfa` no prefixo `/v1/admin`; teste na etapa 19 que percorre o roteador e reprova rota sem `@Publico()` e sem guarda e rota admin sem `ExigeMfa`; helper de isolamento obrigatório nos planos 02, 04, 05, 06, 07.

### S8 [MÉDIA] Token de acesso vale até 15 min após logout, exclusão ou bloqueio
- Local: `00:120`; `01b:21`, `:54`, `:56`, `:63`; CA-11; CA-98.
- Correção: `sid` no JWT; em `/v1/admin/*` conferir revogação a cada requisição; nas demais rotas conferir `contas.status` (ou lista curta de desativadas recentes); desativar, bloquear ou excluir revoga sessões na mesma transação.

### S9 [MÉDIA] Painel sem hospedagem, domínio, CSP e local do token definidos
- Local: `00:44-49`, `:150`, `:120`; `01b:21`, `:85` (etapa 15), `:97`.
- Correção: painel e API sob o mesmo domínio (`painel.` e `api.` de `bairrin.com.br`), HTTPS e HSTS; CSP estrita sem `unsafe-inline` e `frame-ancestors 'none'`; token de acesso só em memória; inatividade medida por interação do usuário, polling não estende a sessão; máximo absoluto de 12 h no servidor.

### S10 [MÉDIA] Sentry e operadores estrangeiros
- Local: `00:72`, `:148`, `:173`; `01b:83` (etapa 13), `:100`.
- Correção: Sentry com `beforeSend`/`beforeBreadcrumb` usando o redator do pino, sem Replay, scrubbing e "scrub IP" ligados; teste do CA-12 com transport falso do Sentry; push sem nome nem endereço; ADR com tabela de operadores (dado, finalidade, país) para o advogado; exportação LGPD por download autenticado no app (validade 7 dias, uso único) em vez de anexo.

### S11 [MÉDIA] Cache persistido e fila offline com dado pessoal em claro, sobrevivem ao logout
- Local: `00:74` (ADR-009); `01b:82` (etapa 12), `:54`.
- Correção: provedor de sessão limpa cache, fila e `queryClient` no logout, expiração e troca de conta; persister só com consultas públicas (allowlist); fila offline cifra corpos ou guarda só ids; teste na etapa 12.

### S12 [MÉDIA] Cadeia de suprimentos sem audit nem trava de versão recém-publicada
- Local: `00:144`; `01a:52` (etapa 1), `:64` (etapa 13).
- Correção: `pnpm audit --prod --audit-level=high` bloqueante no CI; `minimumReleaseAge` (3 dias) e `onlyBuiltDependencies` com allowlist no `pnpm-workspace.yaml`; Dependabot ou Renovate; code signing do EAS Update; versões exatas.

### S13 [MÉDIA] ADR-006: requisitos de segurança a fechar antes do plano 05
- Local: `00:55-61`, `:173`; CA-58, CA-60, CA-68, CA-69.
- Exigir: (1) confirmação por escrito do Pagar.me sobre autenticação do webhook (a página de eventos não descreve: https://docs.pagar.me/reference/eventos-de-webhook-1); sem assinatura, levar ao dono a alternativa (Basic Auth ou segredo na URL + allowlist de IP + consulta à API) como ajuste do CA-60; (2) webhook tratado só pelo id da cobrança criada por nós, com valor e status lidos da API e comparados ao pedido, ignorando o id de pedido do payload; (3) confirmação da tokenização em app nativo e do questionário PCI DSS aplicável; (4) esclarecer "split apenas para clientes PSP" com comercial e advogado; (5) chaves por ambiente em Fly secrets, chave pública separada da secreta, teste de redação de logs dos campos do gateway.

### S14 [BAIXA] Freio de login por IP em CGNAT
- Local: `01b:66`, `:79`, `:96`; CA-04. Correção: limiar por IP bem maior que por e-mail (ex.: 50 em 15 min; confirmar com o dono); IPv6 por /64; exclusão e redefinição no mesmo freio; freio por e-mail vale para e-mail inexistente.

### S15 [BAIXA] Aviso de cadastro repetido sem limite por e-mail
- Local: `01b:49`, `:66`. Correção: 1 aviso por hora por e-mail, deduplicado no assinante.

### S16 [BAIXA] Tolerância de 60 s exige guardar o novo token de forma recuperável
- Local: `01b:28`; `00:120`. Correção: par novo cifrado (AES-GCM) com expiração de 60 s; tolerância só para o mesmo `cliente`; documentar no ADR-012.

### S17 [BAIXA] Gestão de chaves e aleatoriedade
- Local: `01a:39`; `01b:76` (etapa 6). Correção: prefixo de versão de chave no texto cifrado e rotação; subchaves por finalidade com HKDF; AAD com `conta_id`/`loja_id` e IV de 96 bits; zod exigindo ≥ 32 bytes em `JWT_SEGREDO` e chaves; códigos com `crypto.randomInt` e comparação em tempo constante; `Cache-Control: no-store` nas respostas com token, segredo TOTP e códigos.

### S18 [BAIXA] Parâmetros do SecureStore e teste do CA-03
- Local: `01b:82` (etapa 12); CA-03. Correção: `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`; limpar o Keychain na primeira abertura após instalar; teste verifica que o valor em claro não aparece em AsyncStorage nem em arquivos. Fonte: https://docs.expo.dev/versions/latest/sdk/securestore/

### S19 [BAIXA] Limites de payload e de imagem
- Local: `00:72`, `:119-122`; `01a:56` (etapa 5). Correção: limite de corpo JSON (ex.: 100 KB) e de multipart; `sharp` com `limitInputPixels` baixo; nome de arquivo gerado no servidor; original apagado do bucket privado após processado; bucket público só com versões geradas.

### S20 [BAIXA] Dado pessoal e token em query string
- Local: `00:148`, `:217`; CA-98, CA-91. Correção: serializador do pino-http e do Sentry remove a query de `req.url`; busca por dado pessoal via POST com corpo; tokens de convite em fragmento ou corpo (regra no ADR-010).

### S21 [BAIXA] Operação: TLS, homologação, contas
- Local: `00:46`, `:153`, `:173`; `01a:74`. Correção: `sslmode=verify-full` com CA do Supabase e "Enforce SSL"; restrição de rede se o Fly tiver IP fixo (não verificado); homologação só com dados sintéticos; MFA obrigatório em todas as contas de fornecedores; cópia lógica cifrada periódica fora do Supabase; recomenda PITR antes do primeiro pagamento real (P2).

### S22 [BAIXA] Senha sem checagem contra listas vazadas
- Local: `01b:72` (etapa 2). Correção: lista local de senhas comuns no cadastro e na redefinição; obrigatório para admin.

### S23 [INFORMATIVA] "Esta conta não tem acesso ao painel" após senha correta
- Veredito: aceitável, com condições: (a) `POST /v1/sessoes` com `cliente: painel` para conta sem admin responde 403 com código próprio, sem sessão nem cookie; (b) tempo de resposta igual ao do sucesso; (c) log só com id da conta; (d) conta bloqueada pelo freio recebe a mensagem genérica.

### S24 [INFORMATIVA] Itens para os próximos planos
- Polling com ETag: autorizar antes do 304. `Idempotency-Key` com escopo conta + método + rota. `/v1/saude` sem versão exata em produção. Seeds barrados em produção. Throttler em memória aceitável no MVP. Conferir versão vigente dos termos no cadastro. CA-98: registrar leitura da ficha, dados mascarados por padrão.

## A verificar
- Autenticação de webhook do Pagar.me v5; tokenização em app nativo e PCI; "split apenas para clientes PSP".
- Papel customizado via Supavisor (S3); `multiSchema` estável no Prisma escolhido (S2).
- Retenção no Resend; arquivo do pg-boss; conteúdo no Expo Push.
- IP de saída fixo no Fly.io.

## O que muda no plano antes de o dono aprovar
1. S1 (ALTA) no 01b.
2. S2 e S3 no 01a (etapas 7 e 13).
3. S4 e S5 no plano mestre.
4. S6, S7, S8 no 01b.
5. S9 a S13 no plano mestre e no 01a.

---

# Rodada 2 (2026-10-16)

- Veredito: **SEM BLOQUEIOS**. S1 (ALTA) e S2 a S13 (MÉDIAS) corrigidos nos três planos, cada um com teste ou verificação na etapa; S14 a S22 e S23/S24 atendidos. Nenhum achado novo CRÍTICO ou ALTO.
- Resíduo BAIXA de S6 (corrida no recadastro de conta não verificada): corrigido em seguida pelo arquiteto, exigindo a senha em `POST /v1/contas/verificacao` (S6-r2).
- Dependem de resposta do dono: P3 do plano 01b (exportação LGPD por download no app, muda o texto do CA-10) e P4 (limite de 50 falhas por IP em 15 min).
- A verificar na implementação: papel próprio de banco via Supavisor e `multiSchema` no Prisma estável (o plano manda parar e avisar se falhar).
