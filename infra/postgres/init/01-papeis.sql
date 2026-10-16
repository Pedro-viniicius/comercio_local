-- Papéis de banco do Bairrin no Postgres LOCAL (desenvolvimento e teste).
--
-- A imagem oficial do Postgres executa este arquivo uma única vez, quando o diretório de dados
-- está vazio, com o superusuário (POSTGRES_USER) conectado ao banco do serviço (POSTGRES_DB):
-- `bairrin` no Postgres de desenvolvimento e `bairrin_teste` no de teste. Para rodar de novo em
-- desenvolvimento: `docker compose -f infra/docker-compose.yml down -v` (apaga os dados locais).
--
-- SOMENTE DESENVOLVIMENTO LOCAL: as senhas abaixo são públicas, ficam no repositório de propósito
-- e não valem em nenhum outro ambiente. No Supabase os papéis são criados à mão, com senhas
-- geradas e guardadas só nos segredos do Fly.
--
-- Modelo de papéis (S2 e S3 de docs/produto/revisoes/2026-10-16-seguranca-planos-rodada1.md):
-- - bairrin_migracao: dono do banco e, por isso, do schema public e de todo schema que as
--   migrações criarem. Não é superusuário; tem CREATEDB só para o banco-sombra do
--   `prisma migrate dev`. Usado por DATABASE_URL_MIGRACAO.
-- - bairrin_app: papel da aplicação (DATABASE_URL). Faz login e só conecta: não é superusuário,
--   não é dono de nada, não cria banco, papel nem schema e não ignora RLS. USAGE nos schemas e
--   DML nas tabelas vêm dos GRANTs explícitos de cada migração (a partir da etapa 7 do plano 01a),
--   sem UPDATE, DELETE e TRUNCATE nas tabelas somente-acréscimo, como a auditoria.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bairrin_migracao') THEN
    CREATE ROLE bairrin_migracao;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bairrin_app') THEN
    CREATE ROLE bairrin_app;
  END IF;
END
$$;

ALTER ROLE bairrin_migracao WITH
  LOGIN NOSUPERUSER CREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  PASSWORD 'dev_migracao_somente_local';

ALTER ROLE bairrin_app WITH
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  PASSWORD 'dev_app_somente_local';

-- O banco passa a ser do papel de migração. Ninguém além do dono recebe privilégio por PUBLIC
-- (nem CREATE nem TEMPORARY); a aplicação recebe só CONNECT.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO bairrin_migracao', current_database());
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO bairrin_app', current_database());
END
$$;

-- Espelha o Supabase depois do checklist de deploy (`docs/operacao/checklist-deploy.md`): o
-- schema public não dá nada a PUBLIC, nem CREATE (já o padrão desde o Postgres 15) nem USAGE.
-- Assim a aplicação só enxerga os schemas em que a migração deu USAGE a ela.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
