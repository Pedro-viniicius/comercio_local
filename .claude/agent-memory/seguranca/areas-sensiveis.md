---
name: areas-sensiveis
description: Onde mora dado pessoal no Bairrin, entradas públicas, autenticação e invariantes de segurança (fundação 01a revisada em 2 rodadas em 2026-10-16; identidade/01b ainda não)
metadata:
  type: project
---

Estado em 2026-10-16: fundação do 01a implementada e revisada em duas rodadas (sem commit); 01b (identidade/sessão) e apps Expo (etapas 8/9, adiadas para 2026-10-19) ainda não. Conferir no código.

**Já no código (01a):** núcleo em `apps/api/src/compartilhado` (config/ambiente com recusa em produção, log/redator + logger, http/filtro-de-erros, eventos/outbox+relay, auditoria, titular/dado-pessoal + registro de anonimizadores, observabilidade/sentry). Migração do núcleo: schema `compartilhado` (outbox, eventos_processados, auditoria, configuracoes); controle do Prisma em `migracoes`; pg-boss em `pgboss` com permissões aplicadas pelo `release_command` (`node --run migrar`), que também roda `exigirSchemasFechados` (`infra/schemas-fechados.ts`): falha o deploy se `anon`/`authenticated` tiverem USAGE/CREATE em `public`, `compartilhado`, `migracoes`, `pgboss` (lista fixa: schemas novos do 01b em diante precisam entrar). Regra de chave pessoal: `titular/dado-pessoal.ts` (`ehChaveProtegida`) é a base; o redator de log/Sentry usa ela + trechos extras (`mail`, `cpf`, `cnpj`...). Campo pessoal novo: pôr em `ehChaveProtegida`.

**Dado pessoal (planejado):** schema `identidade` (contas, consentimentos, segundo_fator cifrado), `lojistas` (lojas, dados_recebimento cifrado, convites), cópias de endereço/telefone em `pedidos`; também chegam a `compartilhado.auditoria` (antes/depois jsonb; chave pessoal só aceita `{alterado:true}`, booleano ou null), `compartilhado.idempotencia` (respostas por 7 dias), jobs do pg-boss (retenção 7 dias; `FalhaNoAssinante` já leva só tipo/código), Sentry, cache TanStack persistido e fila offline no aparelho.
**Operadores externos:** Fly.io (API), Supabase (banco e Storage), Resend (e-mail, inclui exportação LGPD em anexo), Sentry, Expo Push, Google Geocoding (endereços), ViaCEP, gateway (Pagar.me condicionado).
**Entradas públicas:** hoje só `GET /v1/saude` e `/v1/saude/pronto`. Planejadas: POST /v1/contas, /verificacao, /reenvio, /sessoes, /senha/*, /segundo-fator/*; webhook do gateway, upload de imagem, deep links `/l/` e `/p/`.
**Autenticação (planejada, 01b):** JWT HS256 15 min + renovação opaca rotativa (hash) 30 dias; painel com cookie HttpOnly SameSite=Strict; admin só com `mfa=true`; Argon2id. O freio de login depende do `req.ip` (`trust proxy` 2 no Fly, não verificado em Fly real). Rate limit em memória: uma instância só (`--ha=false`, checklist S32).

**Invariantes a cobrar sempre:**
- Perfil admin nunca concedido por rota; só `seed:admin` por CLI.
- `auditoria` e `configuracoes` (e `lancamentos`, futuro): `bairrin_app` só SELECT/INSERT, política RLS por comando (FOR SELECT / FOR INSERT); na auditoria, trigger por comando contra UPDATE/DELETE/TRUNCATE (o dono ainda pode `DISABLE TRIGGER`, barrado só pelo verificador); `DATABASE_URL_MIGRACAO` só no `release_command`.
- Produção exige `sslmode=verify-full` + `sslrootcert` na URL (falha fechada enquanto `infra/certificados/supabase-ca.crt` for o aviso).
- Anonimização via `AnonimizadorDeTitular` por módulo; cada plano novo entrega o seu.
- Login vale sem e-mail verificado (decisão do dono, 2026-10-16); `email_verificado_em` conferido antes de pagar (plano 04) e, recomendado, antes de criar loja.
- Plano 05 só depois do portão do ADR-006.
- Dado pessoal nunca em log, erro, URL, payload de outbox ou evento. O `msg` do pino não passa pelo redator (ver [[problemas-recorrentes]]).
- Cartão nunca no servidor (RN-23); webhook confirmado por consulta à API do gateway.
- Supabase: Data API desligada; `REVOKE ALL ON SCHEMA public FROM anon, authenticated` e `FROM PUBLIC` como `postgres` (doc de troubleshooting do Supabase confirma que o `postgres` pode revogar USAGE de PUBLIC em `public`); nunca revogar `CONNECT` do banco de PUBLIC (derruba Auth/Storage). O Postgres local não espelha a revogação de USAGE em `public`.
- Apps Expo (etapas 8/9): EAS Update sem assinatura (plano pago) precisa de decisão do dono antes de ligar updates.

Relacionado: [[riscos-aceitos]], [[problemas-recorrentes]]
