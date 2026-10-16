-- reversao: DROP SCHEMA pedidos CASCADE; só em banco sem dados.
-- Fixture que passa: tabela em schema próprio, RLS, trigger BEFORE TRUNCATE e GRANT TRUNCATE.
CREATE SCHEMA pedidos;
CREATE TABLE "pedidos"."pedidos" ("id" UUID NOT NULL, "nota" TEXT, CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id"));
ALTER TABLE "pedidos"."pedidos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos.pedidos ALTER COLUMN nota DROP NOT NULL;
ALTER TABLE pedidos.pedidos ALTER COLUMN nota DROP DEFAULT;
CREATE FUNCTION pedidos.barrar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DROP e TRUNCATE recusados: %', TG_OP; /* RENAME num comentário */
END
$$;
CREATE TRIGGER barrar BEFORE INSERT OR TRUNCATE ON pedidos.pedidos
  FOR EACH STATEMENT EXECUTE FUNCTION pedidos.barrar();
GRANT SELECT, TRUNCATE ON pedidos.pedidos TO bairrin_migracao;
COMMENT ON TABLE pedidos.pedidos IS 'Não use DROP aqui';
