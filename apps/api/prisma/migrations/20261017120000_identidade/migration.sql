-- reversao: só em banco sem dados (homologação recém-criada ou desenvolvimento), como
--   bairrin_migracao: DROP SCHEMA identidade CASCADE; e apagar a linha desta migração em
--   migracoes._prisma_migrations. Em desenvolvimento, `prisma migrate reset` faz o mesmo.
--
-- Identidade (plano 01b, etapa 3): contas, perfis, sessões, histórico de tokens de renovação,
-- códigos, documentos legais, consentimentos, segundo fator, freio de login e pedidos do titular. Primeiro schema com dado
-- pessoal (nome, e-mail e telefone em `contas`); o resto guarda só hash, HMAC ou texto cifrado
-- (ADR-012, ADR-015). Sem FK para outros schemas.
-- - Mesmo modelo do núcleo (S2, S3): roda como bairrin_migracao (dono); a aplicação recebe só
--   USAGE no schema e DML sem TRUNCATE. Em `consentimentos` (prova do aceite, CA-01 e CA-10) e
--   `tokens_de_renovacao_usados` (histórico para detectar reuso, S77), só SELECT e INSERT, com uma
--   política por comando (S29). Em `documentos_legais` (versionados: versão nova é linha nova,
--   S24), só SELECT (S79): a versão nova entra por migração ou pelo seed de desenvolvimento, que
--   conecta como bairrin_migracao.
-- - RLS em toda tabela, com política só para bairrin_app (P5: USING (true)). Sem FORCE, como no
--   núcleo: o dono ignora o RLS para corrigir dados numa migração futura.
-- - As contas apagadas (não verificadas e sem login há 7 dias, P1-dono) levam junto, por
--   ON DELETE CASCADE, sessões (e o histórico de tokens delas), códigos, perfis, consentimentos,
--   2FA, pedidos e exportações. A ação da FK roda como dono da tabela filha, então vale também
--   onde a aplicação não tem DELETE. Por isso a trigger `contas_so_expurgo` (S78) recusa apagar
--   conta fora da regra do expurgo: sem ela, um DELETE em `contas` apagaria os consentimentos de
--   uma conta verificada ou anonimizada, que são só de acréscimo.
-- - Os tipos enum perdem o USAGE de PUBLIC. A aplicação não precisa dele: USAGE de tipo só
--   controla criar objeto que dependa do tipo, não usar o valor numa consulta.
-- - As restrições CHECK são a segunda barreira das regras do domínio que protegem dado ou
--   sessão: e-mail na forma normalizada (ASCII visível em minúsculas, com um `@` entre duas
--   partes não vazias, `normalizarEmail`), hash de senha não vazio, telefone E.164, conta
--   anonimizada sem senha nem telefone (S5), `mfa` só em sessão do painel (S1), painel com fim
--   absoluto (S9), par novo da tolerância com prazo (S16) e revogação sempre com motivo. O
--   Prisma não as descreve no schema.prisma e não as compara.

CREATE SCHEMA identidade;
REVOKE ALL ON SCHEMA identidade FROM PUBLIC;
GRANT USAGE ON SCHEMA identidade TO bairrin_app;

-- CreateEnum
CREATE TYPE "identidade"."status_da_conta" AS ENUM ('ativa', 'desativada', 'anonimizada');

-- CreateEnum
CREATE TYPE "identidade"."perfil" AS ENUM ('consumidor', 'lojista', 'admin');

-- CreateEnum
CREATE TYPE "identidade"."cliente_da_sessao" AS ENUM ('app_consumidor', 'app_lojista', 'painel');

-- CreateEnum
CREATE TYPE "identidade"."finalidade_do_codigo" AS ENUM ('verificacao_email', 'recuperacao_senha', 'desafio_configurar', 'desafio_verificar');

-- CreateEnum
CREATE TYPE "identidade"."tipo_de_documento_legal" AS ENUM ('termos', 'privacidade');

-- CreateEnum
CREATE TYPE "identidade"."tipo_de_bloqueio" AS ENUM ('email', 'ip', 'segundo_fator');

-- CreateEnum
CREATE TYPE "identidade"."tipo_de_solicitacao" AS ENUM ('exportacao', 'exclusao');

-- CreateEnum
CREATE TYPE "identidade"."status_da_solicitacao" AS ENUM ('pendente', 'aguardando_pendencias', 'concluida');

-- CreateTable
CREATE TABLE "identidade"."contas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "email_normalizado" TEXT NOT NULL,
    "telefone_e164" TEXT,
    "senha_hash" TEXT,
    "email_verificado_em" TIMESTAMPTZ(6),
    "ultimo_login_em" TIMESTAMPTZ(6),
    "status" "identidade"."status_da_conta" NOT NULL DEFAULT 'ativa',
    "criada_em" TIMESTAMPTZ(6) NOT NULL,
    "desativada_em" TIMESTAMPTZ(6),
    "anonimizada_em" TIMESTAMPTZ(6),

    CONSTRAINT "contas_pkey" PRIMARY KEY ("id"),
    -- Forma mínima da saída de normalizarEmail: já em minúsculas, até 254 caracteres, só ASCII
    -- visível (! a ~, sem espaço) e um único `@` entre duas partes não vazias (a faixa
    -- [!-?A-~] é o ASCII visível sem o `@`). O e-mail substituto da anonimização segue a mesma
    -- forma. As regras finas (rótulos, sufixo) ficam no domínio.
    CONSTRAINT "contas_email_normalizado_ck"
      CHECK ("email_normalizado" = lower("email_normalizado")
             AND char_length("email_normalizado") <= 254
             AND "email_normalizado" ~ '^[!-?A-~]+@[!-?A-~]+$'),
    -- Sem senha é NULL (conta da CLI antes da primeira redefinição, anonimizada); vazio, nunca.
    CONSTRAINT "contas_senha_hash_ck" CHECK ("senha_hash" ~ '[^[:space:]]'),
    CONSTRAINT "contas_telefone_e164_ck" CHECK ("telefone_e164" ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT "contas_telefone_obrigatorio_ck"
      CHECK ("telefone_e164" IS NOT NULL OR "status" = 'anonimizada'),
    CONSTRAINT "contas_desativada_ck" CHECK ("status" = 'ativa' OR "desativada_em" IS NOT NULL),
    -- Anonimizada: somem senha e telefone (nome e e-mail viram substitutos não reversíveis).
    CONSTRAINT "contas_anonimizada_ck"
      CHECK ("status" <> 'anonimizada'
             OR ("anonimizada_em" IS NOT NULL AND "senha_hash" IS NULL AND "telefone_e164" IS NULL))
);

-- CreateTable
CREATE TABLE "identidade"."perfis_conta" (
    "conta_id" UUID NOT NULL,
    "perfil" "identidade"."perfil" NOT NULL,
    "concedido_em" TIMESTAMPTZ(6) NOT NULL,
    "concedido_por" UUID,

    CONSTRAINT "perfis_conta_pkey" PRIMARY KEY ("conta_id","perfil")
);

-- CreateTable
CREATE TABLE "identidade"."sessoes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conta_id" UUID NOT NULL,
    "familia_id" UUID NOT NULL,
    "cliente" "identidade"."cliente_da_sessao" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_anterior_hash" TEXT,
    "par_novo_cifrado" TEXT,
    "par_novo_expira_em" TIMESTAMPTZ(6),
    "trocado_em" TIMESTAMPTZ(6),
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "expira_absoluto_em" TIMESTAMPTZ(6),
    "ultimo_uso_em" TIMESTAMPTZ(6) NOT NULL,
    "mfa" BOOLEAN NOT NULL DEFAULT false,
    "revogada_em" TIMESTAMPTZ(6),
    "motivo_revogacao" TEXT,
    "criada_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessoes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sessoes_mfa_so_no_painel_ck" CHECK (NOT "mfa" OR "cliente" = 'painel'),
    CONSTRAINT "sessoes_painel_com_fim_absoluto_ck"
      CHECK ("cliente" <> 'painel' OR "expira_absoluto_em" IS NOT NULL),
    CONSTRAINT "sessoes_par_novo_ck"
      CHECK (("par_novo_cifrado" IS NULL) = ("par_novo_expira_em" IS NULL)),
    CONSTRAINT "sessoes_revogacao_ck" CHECK (("revogada_em" IS NULL) = ("motivo_revogacao" IS NULL))
);

-- CreateTable
-- Todo token de renovação já trocado, até a sessão sumir (S77): o reuso de um token antigo da
-- família (não só do anterior imediato) revoga a família. Só o HMAC, como em `sessoes`.
CREATE TABLE "identidade"."tokens_de_renovacao_usados" (
    "token_hash" TEXT NOT NULL,
    "familia_id" UUID NOT NULL,
    "sessao_id" UUID NOT NULL,
    "usado_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tokens_de_renovacao_usados_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "identidade"."codigos_verificacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conta_id" UUID NOT NULL,
    "finalidade" "identidade"."finalidade_do_codigo" NOT NULL,
    "codigo_hmac" TEXT NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "usado_em" TIMESTAMPTZ(6),
    "criado_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "codigos_verificacao_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "codigos_verificacao_tentativas_ck" CHECK ("tentativas" >= 0)
);

-- CreateTable
CREATE TABLE "identidade"."documentos_legais" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" "identidade"."tipo_de_documento_legal" NOT NULL,
    "versao" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "vigente_desde" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "documentos_legais_pkey" PRIMARY KEY ("id"),
    -- Mesmo formato de versaoDeDocumentoSchema (@bairrin/contratos).
    CONSTRAINT "documentos_legais_versao_ck" CHECK ("versao" ~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$')
);

-- CreateTable
CREATE TABLE "identidade"."consentimentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conta_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "aceito_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "consentimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identidade"."segundo_fator" (
    "conta_id" UUID NOT NULL,
    "segredo_cifrado" TEXT NOT NULL,
    "confirmado_em" TIMESTAMPTZ(6),
    "ultimo_passo_usado" INTEGER,

    CONSTRAINT "segundo_fator_pkey" PRIMARY KEY ("conta_id"),
    CONSTRAINT "segundo_fator_ultimo_passo_ck" CHECK ("ultimo_passo_usado" >= 0)
);

-- CreateTable
CREATE TABLE "identidade"."codigos_recuperacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conta_id" UUID NOT NULL,
    "codigo_hmac" TEXT NOT NULL,
    "usado_em" TIMESTAMPTZ(6),

    CONSTRAINT "codigos_recuperacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identidade"."bloqueios_login" (
    "chave_hmac" TEXT NOT NULL,
    "tipo" "identidade"."tipo_de_bloqueio" NOT NULL,
    "falhas" INTEGER NOT NULL DEFAULT 0,
    "nivel" INTEGER NOT NULL DEFAULT 0,
    "janela_inicio" TIMESTAMPTZ(6) NOT NULL,
    "bloqueado_ate" TIMESTAMPTZ(6),

    CONSTRAINT "bloqueios_login_pkey" PRIMARY KEY ("chave_hmac","tipo"),
    CONSTRAINT "bloqueios_login_contadores_ck" CHECK ("falhas" >= 0 AND "nivel" >= 0)
);

-- CreateTable
CREATE TABLE "identidade"."solicitacoes_titular" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conta_id" UUID NOT NULL,
    "tipo" "identidade"."tipo_de_solicitacao" NOT NULL,
    "status" "identidade"."status_da_solicitacao" NOT NULL DEFAULT 'pendente',
    "solicitada_em" TIMESTAMPTZ(6) NOT NULL,
    "concluida_em" TIMESTAMPTZ(6),

    CONSTRAINT "solicitacoes_titular_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "solicitacoes_titular_concluida_ck"
      CHECK ("status" <> 'concluida' OR "concluida_em" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "identidade"."exportacoes_titular" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conta_id" UUID NOT NULL,
    "conteudo_cifrado" TEXT NOT NULL,
    "criada_em" TIMESTAMPTZ(6) NOT NULL,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "baixada_em" TIMESTAMPTZ(6),

    CONSTRAINT "exportacoes_titular_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contas_email_normalizado_key" ON "identidade"."contas"("email_normalizado");

-- CreateIndex
CREATE UNIQUE INDEX "sessoes_token_hash_key" ON "identidade"."sessoes"("token_hash");

-- CreateIndex
CREATE INDEX "sessoes_conta_id_idx" ON "identidade"."sessoes"("conta_id");

-- CreateIndex
CREATE INDEX "sessoes_familia_id_idx" ON "identidade"."sessoes"("familia_id");

-- CreateIndex
CREATE INDEX "sessoes_token_anterior_hash_idx" ON "identidade"."sessoes"("token_anterior_hash");

-- CreateIndex
CREATE INDEX "tokens_de_renovacao_usados_sessao_id_idx" ON "identidade"."tokens_de_renovacao_usados"("sessao_id");

-- CreateIndex
CREATE INDEX "codigos_verificacao_conta_finalidade_idx" ON "identidade"."codigos_verificacao"("conta_id", "finalidade");

-- CreateIndex
CREATE INDEX "codigos_verificacao_codigo_hmac_idx" ON "identidade"."codigos_verificacao"("codigo_hmac");

-- CreateIndex
CREATE INDEX "documentos_legais_tipo_vigente_idx" ON "identidade"."documentos_legais"("tipo", "vigente_desde" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "documentos_legais_tipo_versao_key" ON "identidade"."documentos_legais"("tipo", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "consentimentos_conta_documento_key" ON "identidade"."consentimentos"("conta_id", "documento_id");

-- CreateIndex
CREATE INDEX "codigos_recuperacao_conta_id_idx" ON "identidade"."codigos_recuperacao"("conta_id");

-- CreateIndex
CREATE INDEX "solicitacoes_titular_conta_tipo_idx" ON "identidade"."solicitacoes_titular"("conta_id", "tipo");

-- CreateIndex
CREATE INDEX "exportacoes_titular_conta_id_idx" ON "identidade"."exportacoes_titular"("conta_id");

-- AddForeignKey
ALTER TABLE "identidade"."perfis_conta" ADD CONSTRAINT "perfis_conta_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "identidade"."contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identidade"."perfis_conta" ADD CONSTRAINT "perfis_conta_concedido_por_fkey" FOREIGN KEY ("concedido_por") REFERENCES "identidade"."contas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identidade"."sessoes" ADD CONSTRAINT "sessoes_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "identidade"."contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identidade"."tokens_de_renovacao_usados" ADD CONSTRAINT "tokens_de_renovacao_usados_sessao_id_fkey" FOREIGN KEY ("sessao_id") REFERENCES "identidade"."sessoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identidade"."codigos_verificacao" ADD CONSTRAINT "codigos_verificacao_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "identidade"."contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identidade"."consentimentos" ADD CONSTRAINT "consentimentos_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "identidade"."contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identidade"."consentimentos" ADD CONSTRAINT "consentimentos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "identidade"."documentos_legais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identidade"."segundo_fator" ADD CONSTRAINT "segundo_fator_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "identidade"."contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identidade"."codigos_recuperacao" ADD CONSTRAINT "codigos_recuperacao_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "identidade"."contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identidade"."solicitacoes_titular" ADD CONSTRAINT "solicitacoes_titular_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "identidade"."contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identidade"."exportacoes_titular" ADD CONSTRAINT "exportacoes_titular_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "identidade"."contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tipos sem USAGE para PUBLIC (o padrão de tipo novo). Nenhum GRANT: a aplicação não precisa.
REVOKE USAGE ON TYPE "identidade"."status_da_conta" FROM PUBLIC;
REVOKE USAGE ON TYPE "identidade"."perfil" FROM PUBLIC;
REVOKE USAGE ON TYPE "identidade"."cliente_da_sessao" FROM PUBLIC;
REVOKE USAGE ON TYPE "identidade"."finalidade_do_codigo" FROM PUBLIC;
REVOKE USAGE ON TYPE "identidade"."tipo_de_documento_legal" FROM PUBLIC;
REVOKE USAGE ON TYPE "identidade"."tipo_de_bloqueio" FROM PUBLIC;
REVOKE USAGE ON TYPE "identidade"."tipo_de_solicitacao" FROM PUBLIC;
REVOKE USAGE ON TYPE "identidade"."status_da_solicitacao" FROM PUBLIC;

-- Permissões da aplicação (S3): DML sem TRUNCATE; nos consentimentos e no histórico de tokens,
-- só leitura e inclusão; nos documentos legais, só leitura (S79).
GRANT SELECT, INSERT, UPDATE, DELETE ON "identidade"."contas" TO bairrin_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "identidade"."perfis_conta" TO bairrin_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "identidade"."sessoes" TO bairrin_app;
GRANT SELECT, INSERT ON "identidade"."tokens_de_renovacao_usados" TO bairrin_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "identidade"."codigos_verificacao" TO bairrin_app;
GRANT SELECT ON "identidade"."documentos_legais" TO bairrin_app;
GRANT SELECT, INSERT ON "identidade"."consentimentos" TO bairrin_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "identidade"."segundo_fator" TO bairrin_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "identidade"."codigos_recuperacao" TO bairrin_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "identidade"."bloqueios_login" TO bairrin_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "identidade"."solicitacoes_titular" TO bairrin_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "identidade"."exportacoes_titular" TO bairrin_app;

-- RLS em toda tabela (S2), com política só para a aplicação. Nas tabelas só de acréscimo, uma
-- política por comando permitido (S29): um GRANT de UPDATE ou DELETE dado por engano não alcança
-- nenhuma linha.
ALTER TABLE "identidade"."contas" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contas_aplicacao" ON "identidade"."contas"
  TO bairrin_app USING (true) WITH CHECK (true);

ALTER TABLE "identidade"."perfis_conta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "perfis_conta_aplicacao" ON "identidade"."perfis_conta"
  TO bairrin_app USING (true) WITH CHECK (true);

ALTER TABLE "identidade"."sessoes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessoes_aplicacao" ON "identidade"."sessoes"
  TO bairrin_app USING (true) WITH CHECK (true);

ALTER TABLE "identidade"."tokens_de_renovacao_usados" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tokens_de_renovacao_usados_leitura" ON "identidade"."tokens_de_renovacao_usados"
  FOR SELECT TO bairrin_app USING (true);
CREATE POLICY "tokens_de_renovacao_usados_inclusao" ON "identidade"."tokens_de_renovacao_usados"
  FOR INSERT TO bairrin_app WITH CHECK (true);

ALTER TABLE "identidade"."codigos_verificacao" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "codigos_verificacao_aplicacao" ON "identidade"."codigos_verificacao"
  TO bairrin_app USING (true) WITH CHECK (true);

ALTER TABLE "identidade"."documentos_legais" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "documentos_legais_leitura" ON "identidade"."documentos_legais"
  FOR SELECT TO bairrin_app USING (true);

ALTER TABLE "identidade"."consentimentos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "consentimentos_leitura" ON "identidade"."consentimentos"
  FOR SELECT TO bairrin_app USING (true);
CREATE POLICY "consentimentos_inclusao" ON "identidade"."consentimentos"
  FOR INSERT TO bairrin_app WITH CHECK (true);

ALTER TABLE "identidade"."segundo_fator" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "segundo_fator_aplicacao" ON "identidade"."segundo_fator"
  TO bairrin_app USING (true) WITH CHECK (true);

ALTER TABLE "identidade"."codigos_recuperacao" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "codigos_recuperacao_aplicacao" ON "identidade"."codigos_recuperacao"
  TO bairrin_app USING (true) WITH CHECK (true);

ALTER TABLE "identidade"."bloqueios_login" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bloqueios_login_aplicacao" ON "identidade"."bloqueios_login"
  TO bairrin_app USING (true) WITH CHECK (true);

ALTER TABLE "identidade"."solicitacoes_titular" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "solicitacoes_titular_aplicacao" ON "identidade"."solicitacoes_titular"
  TO bairrin_app USING (true) WITH CHECK (true);

ALTER TABLE "identidade"."exportacoes_titular" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exportacoes_titular_aplicacao" ON "identidade"."exportacoes_titular"
  TO bairrin_app USING (true) WITH CHECK (true);

-- Só o expurgo apaga conta (S78). A FK em cascata apaga as filhas como dono, inclusive os
-- consentimentos, que a aplicação não pode apagar; esta trigger recusa o DELETE de conta que
-- não cumpre `Conta.deveSerExpurgada`: ativa, sem e-mail verificado, sem perfil admin nem
-- lojista e sem login (ou, sem login, criada) há mais de 7 dias. Vale para a aplicação e para o
-- dono; uma correção de dados numa migração futura remove a trigger na mesma migração.
-- SECURITY INVOKER (o padrão, explícito): lê `perfis_conta` com o papel de quem apaga.
CREATE FUNCTION "identidade"."recusar_exclusao_fora_do_expurgo"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status <> 'ativa'
     OR OLD.email_verificado_em IS NOT NULL
     OR coalesce(OLD.ultimo_login_em, OLD.criada_em) >= now() - interval '7 days'
     OR EXISTS (SELECT 1 FROM identidade.perfis_conta p
                 WHERE p.conta_id = OLD.id AND p.perfil IN ('admin', 'lojista')) THEN
    RAISE EXCEPTION 'identidade.contas: só o expurgo de conta não verificada apaga conta'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END
$$;
REVOKE ALL ON FUNCTION "identidade"."recusar_exclusao_fora_do_expurgo"() FROM PUBLIC;

CREATE TRIGGER "contas_so_expurgo"
  BEFORE DELETE ON "identidade"."contas"
  FOR EACH ROW EXECUTE FUNCTION "identidade"."recusar_exclusao_fora_do_expurgo"();
