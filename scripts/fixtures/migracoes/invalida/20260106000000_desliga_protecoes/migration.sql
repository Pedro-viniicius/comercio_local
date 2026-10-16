-- reversao: nada a desfazer; fixture que reprova pelas regras de RLS, trigger, GRANT e função.
ALTER TABLE compartilhado.outbox DISABLE ROW LEVEL SECURITY;
ALTER TABLE compartilhado.auditoria DISABLE TRIGGER ALL;
GRANT SELECT ON compartilhado.outbox TO bairrin_app, anon;
GRANT SELECT, INSERT, UPDATE ON compartilhado.auditoria TO bairrin_app;
CREATE FUNCTION compartilhado.f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
CREATE EXTENSION pgcrypto;
SELECT 1 AS id INTO compartilhado.copia;
