---
name: areas-sensiveis
description: Onde mora dado pessoal no Bairrin, entradas públicas, autenticação e invariantes de segurança (01a revisado em 2 rodadas; grupo 0 do 01b revisado em 2 rodadas, SEM BLOQUEIOS em 2026-10-16; identidade ainda não)
metadata:
  type: project
---

Estado em 2026-10-16: 01a implementado e revisado em duas rodadas (sem commit); grupo 0 do 01b (etapas 0a e 0b) revisado em duas rodadas, S33 a S36 corrigidos; identidade (etapas 1+) e apps Expo (etapas 8/9 do 01a) ainda não. Conferir no código.

**Já no código (01a + grupo 0 do 01b):** núcleo em `apps/api/src/compartilhado` (config/ambiente com recusa em produção, log/redator + logger, http/filtro-de-erros, eventos/outbox+relay, auditoria, titular/dado-pessoal + registro de anonimizadores, observabilidade/sentry). Migração do núcleo: schema `compartilhado` (outbox, eventos_processados, auditoria com trigger `impedir_alteracao_da_auditoria`, configuracoes); controle do Prisma em `migracoes`; pg-boss em `pgboss`. O `release_command` (`prisma migrate deploy && node dist/cli/migrar-pg-boss.js`) roda, depois das migrações, `exigirSchemasFechados` e `exigirCatalogoNasRegras` (`infra/schemas-fechados.ts`). O catálogo confere: dono/membro `bairrin_app`, CREATE de `bairrin_app` em schema, tabela r/p sem RLS (exceto `migracoes._prisma_migrations`), política para PUBLIC/anon/authenticated/service_role, as duas triggers da auditoria presentes e `tgenabled='O'`, `pg_rewrite` fora do `_RETURN` de view, GRANT OPTION para `bairrin_app` (inclusive banco e `pg_default_acl`), view sem `security_invoker`. O teste de integração "passa no banco migrado" roda a mesma checagem no CI. **Não confere:** corpo da função da trigger, GRANT de tabela para PUBLIC ou para papel fora de `bairrin_app`, privilégios de `bairrin_app` na auditoria, CREATE no banco, view materializada, atributos e `pg_db_role_setting` de `bairrin_app`. É detecção: a migração já foi aplicada quando o release para. Só vale rodando como `bairrin_migracao`. Regra de chave pessoal: `titular/dado-pessoal.ts` (`ehChaveProtegida`) + trechos extras do redator + `message`/`msg` por chave inteira (`mensagem` ainda não).

**Dado pessoal (planejado):** schema `identidade` (contas, consentimentos, segundo_fator cifrado), `lojistas` (lojas, dados_recebimento cifrado, convites), cópias de endereço/telefone em `pedidos`; também chegam a `compartilhado.auditoria` (antes/depois jsonb; chave pessoal só aceita `{alterado:true}`, booleano ou null), `compartilhado.idempotencia` (respostas por 7 dias), jobs do pg-boss (retenção 7 dias; `FalhaNoAssinante` já leva só tipo/código), Sentry, cache TanStack persistido e fila offline no aparelho.
**Operadores externos:** Fly.io (API), Supabase (banco e Storage), Resend (e-mail, inclui exportação LGPD em anexo), Sentry, Expo Push, Google Geocoding (endereços), ViaCEP, gateway (Pagar.me condicionado).
**Entradas públicas:** hoje só `GET /v1/saude` e `/v1/saude/pronto`. Planejadas: POST /v1/contas, /verificacao, /reenvio, /sessoes, /senha/*, /segundo-fator/*; webhook do gateway, upload de imagem, deep links `/l/` e `/p/`.
**Autenticação (planejada, 01b):** JWT HS256 15 min + renovação opaca rotativa (hash) 30 dias; painel com cookie HttpOnly SameSite=Strict; admin só com `mfa=true`; Argon2id. O freio de login depende do `req.ip` (`trust proxy` 2 no Fly, não verificado em Fly real). Rate limit em memória: uma instância só (`--ha=false`, checklist S32).

**Invariantes a cobrar sempre:**
- Perfil admin nunca concedido por rota; só `seed:admin` por CLI.
- `auditoria` e `configuracoes` (e `lancamentos`, futuro): `bairrin_app` só SELECT/INSERT, política RLS por comando (FOR SELECT / FOR INSERT); na auditoria, trigger por comando contra UPDATE/DELETE/TRUNCATE (desligar ou remover a trigger é pego pelo catálogo; trocar o corpo da função só pelo teste de integração de comportamento); `DATABASE_URL_MIGRACAO` só no `release_command`.
- Produção exige `sslmode=verify-full` + `sslrootcert` na URL (falha fechada enquanto `infra/certificados/supabase-ca.crt` for o aviso).
- Anonimização via `AnonimizadorDeTitular` por módulo; cada plano novo entrega o seu.
- Login vale sem e-mail verificado (decisão do dono, 2026-10-16); `email_verificado_em` conferido antes de pagar (plano 04) e, recomendado, antes de criar loja.
- Plano 05 só depois do portão do ADR-006.
- Dado pessoal nunca em log, erro, URL, payload de outbox ou evento. O `msg` do pino não passa pelo redator: `hooks.logMethod` em `log/logger.ts` troca texto ausente por `sem mensagem`, descarta interpolação, tira a chave própria `msg` e troca `context` longo ou com quebra por `contexto descartado`. O que sobra está em [[problemas-recorrentes]].
- Cartão nunca no servidor (RN-23); webhook confirmado por consulta à API do gateway.
- Supabase: Data API desligada; `REVOKE ALL ON SCHEMA public FROM anon, authenticated` e `FROM PUBLIC` como `postgres`; nunca revogar `CONNECT` do banco de PUBLIC (derruba Auth/Storage). O Postgres local espelha (`infra/postgres/init/01-papeis.sql`). Não verificado em Supabase real: schema `extensions` e views do `pg_stat_statements` podem parar o release (falha fechada).
- Apps Expo (etapas 8/9): EAS Update sem assinatura (plano pago) precisa de decisão do dono antes de ligar updates.

Relacionado: [[riscos-aceitos]], [[problemas-recorrentes]]
