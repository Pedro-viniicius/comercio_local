-- reversao: DROP SCHEMA identidade_qa CASCADE; só em banco sem dados.
-- Modelo do formato que a migração da identidade (01b, etapa 3) vai ter: tipo e função com
-- REVOKE ... FROM PUBLIC antes do GRANT (a ACL de função e tipo começa com PUBLIC), política só
-- para bairrin_app e nenhum GRANT para outro papel. Lido pelo verificador (scripts/) e pelo
-- catálogo do banco migrado (apps/api/test/integracao/migracoes.int.test.ts): a mesma migração
-- precisa passar nos dois. O schema leva o sufixo _qa para não colidir com o `identidade` real.
CREATE SCHEMA IF NOT EXISTS "identidade_qa";
CREATE TYPE "identidade_qa"."PapelDaConta" AS ENUM ('consumidor', 'lojista', 'admin');
CREATE TABLE "identidade_qa"."contas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email_normalizado" TEXT NOT NULL,
  "papel" "identidade_qa"."PapelDaConta" NOT NULL DEFAULT 'consumidor',
  "senha_hash" TEXT NOT NULL,
  CONSTRAINT "contas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contas_email_ck" CHECK ("email_normalizado" = lower("email_normalizado"))
);
CREATE UNIQUE INDEX "contas_email_key" ON "identidade_qa"."contas"("email_normalizado");
ALTER TABLE "identidade_qa"."contas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identidade_qa"."contas" FORCE ROW LEVEL SECURITY;
CREATE POLICY "contas_aplicacao" ON "identidade_qa"."contas" FOR ALL TO bairrin_app USING (true) WITH CHECK (true);
CREATE FUNCTION "identidade_qa"."email_da_conta"(conta UUID) RETURNS TEXT
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT email_normalizado FROM identidade_qa.contas WHERE id = conta $$;
REVOKE ALL ON SCHEMA "identidade_qa" FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA "identidade_qa" FROM PUBLIC;
REVOKE ALL ON FUNCTION "identidade_qa"."email_da_conta"(UUID) FROM PUBLIC;
REVOKE USAGE ON TYPE "identidade_qa"."PapelDaConta" FROM PUBLIC;
GRANT USAGE ON SCHEMA "identidade_qa" TO bairrin_app;
GRANT SELECT, INSERT, UPDATE ON "identidade_qa"."contas" TO bairrin_app;
GRANT EXECUTE ON FUNCTION "identidade_qa"."email_da_conta"(UUID) TO bairrin_app;
GRANT USAGE ON TYPE "identidade_qa"."PapelDaConta" TO bairrin_app;
