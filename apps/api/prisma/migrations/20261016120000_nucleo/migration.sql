-- reversao: só em banco sem dados (homologação recém-criada ou desenvolvimento), como
--   bairrin_migracao: DROP SCHEMA compartilhado CASCADE; e apagar a linha desta migração
--   em migracoes._prisma_migrations. Em desenvolvimento, `prisma migrate reset` faz o mesmo.
--
-- Núcleo do Bairrin (plano 01a, etapa 7; S2 e S3 da revisão de segurança de 2026-10-16):
-- schema `compartilhado` com outbox, eventos processados, auditoria e configurações.
-- - Nada em `public`: o Prisma guarda o controle de migrações no schema `migracoes`
--   (parâmetro `schema` da DATABASE_URL_MIGRACAO), onde a aplicação não tem acesso.
-- - Roda como bairrin_migracao (dono). A aplicação (bairrin_app) recebe só USAGE no schema
--   e DML nas tabelas, sem UPDATE, DELETE e TRUNCATE na auditoria.
-- - RLS ligado em toda tabela, com política só para bairrin_app. O dono ignora RLS (sem
--   FORCE) de propósito: migrações futuras podem precisar corrigir dados.

-- Supabase: anon e authenticated sem nenhum privilégio no schema public (S2). Os papéis só
-- existem lá; no Postgres local o bloco não faz nada.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA public FROM authenticated;
  END IF;
END
$$;

CREATE SCHEMA compartilhado;
REVOKE ALL ON SCHEMA compartilhado FROM PUBLIC;
GRANT USAGE ON SCHEMA compartilhado TO bairrin_app;

-- Outbox: eventos gravados na transação do caso de uso e publicados pelo relay do worker.
CREATE TABLE "compartilhado"."outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "agregado_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "ocorrido_em" TIMESTAMPTZ(6) NOT NULL,
    "publicado_em" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- Só os pendentes interessam ao relay.
CREATE INDEX "outbox_pendentes_idx" ON "compartilhado"."outbox"("ocorrido_em") WHERE (publicado_em IS NULL);

-- Deduplicação: um evento por assinante.
CREATE TABLE "compartilhado"."eventos_processados" (
    "evento_id" UUID NOT NULL,
    "assinante" TEXT NOT NULL,
    "processado_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "eventos_processados_pkey" PRIMARY KEY ("evento_id","assinante")
);

-- Auditoria: somente acréscimo. `antes` e `depois` sem dado pessoal (S4, regra no repositório).
CREATE TABLE "compartilhado"."auditoria" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ator_tipo" TEXT NOT NULL,
    "ator_id" UUID,
    "acao" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "recurso_id" TEXT NOT NULL,
    "antes" JSONB,
    "depois" JSONB,
    "origem" TEXT NOT NULL,
    "ocorrido_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- Configurações versionadas: o valor vigente é o mais recente com vigente_desde <= now().
CREATE TABLE "compartilhado"."configuracoes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "vigente_desde" TIMESTAMPTZ(6) NOT NULL,
    "autor_id" UUID,
    "criado_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "configuracoes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "configuracoes_chave_vigente_idx" ON "compartilhado"."configuracoes"("chave", "vigente_desde" DESC);

-- Imutabilidade da auditoria até para o dono (S3). Por comando (FOR EACH STATEMENT), para
-- falhar mesmo quando nenhuma linha é afetada. Fica no schema compartilhado, nunca em public.
CREATE FUNCTION "compartilhado"."impedir_alteracao_da_auditoria"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'compartilhado.auditoria é somente acréscimo: % recusado', TG_OP;
END
$$;
REVOKE ALL ON FUNCTION "compartilhado"."impedir_alteracao_da_auditoria"() FROM PUBLIC;

CREATE TRIGGER "auditoria_sem_update_delete"
  BEFORE UPDATE OR DELETE ON "compartilhado"."auditoria"
  FOR EACH STATEMENT EXECUTE FUNCTION "compartilhado"."impedir_alteracao_da_auditoria"();

CREATE TRIGGER "auditoria_sem_truncate"
  BEFORE TRUNCATE ON "compartilhado"."auditoria"
  FOR EACH STATEMENT EXECUTE FUNCTION "compartilhado"."impedir_alteracao_da_auditoria"();

-- Permissões da aplicação (S3): DML, sem TRUNCATE. Na auditoria e nas configurações
-- (versionadas: valor novo é linha nova), só leitura e inclusão (S28).
GRANT SELECT, INSERT, UPDATE, DELETE ON "compartilhado"."outbox" TO bairrin_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "compartilhado"."eventos_processados" TO bairrin_app;
GRANT SELECT, INSERT ON "compartilhado"."configuracoes" TO bairrin_app;
GRANT SELECT, INSERT ON "compartilhado"."auditoria" TO bairrin_app;

-- RLS em toda tabela (S2), com política só para a aplicação. Nas tabelas somente
-- acréscimo, uma política por comando permitido (S29): mesmo que um GRANT de UPDATE ou
-- DELETE apareça por engano, o RLS não deixa nenhuma linha ser alterada ou apagada.
ALTER TABLE "compartilhado"."outbox" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outbox_aplicacao" ON "compartilhado"."outbox"
  TO bairrin_app USING (true) WITH CHECK (true);

ALTER TABLE "compartilhado"."eventos_processados" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eventos_processados_aplicacao" ON "compartilhado"."eventos_processados"
  TO bairrin_app USING (true) WITH CHECK (true);

ALTER TABLE "compartilhado"."auditoria" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auditoria_leitura" ON "compartilhado"."auditoria"
  FOR SELECT TO bairrin_app USING (true);
CREATE POLICY "auditoria_inclusao" ON "compartilhado"."auditoria"
  FOR INSERT TO bairrin_app WITH CHECK (true);

ALTER TABLE "compartilhado"."configuracoes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "configuracoes_leitura" ON "compartilhado"."configuracoes"
  FOR SELECT TO bairrin_app USING (true);
CREATE POLICY "configuracoes_inclusao" ON "compartilhado"."configuracoes"
  FOR INSERT TO bairrin_app WITH CHECK (true);
