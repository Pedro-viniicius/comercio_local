-- reversao: ALTER TABLE pedidos.pedidos ADD COLUMN nota TEXT; (os dados da coluna se perdem)
DO $guarda$
BEGIN
  IF EXISTS (SELECT 1 FROM pedidos.pedidos) THEN
    RAISE EXCEPTION 'pedidos.pedidos tem linhas: migração destrutiva abortada';
  END IF;
END
$guarda$;
ALTER TABLE pedidos.pedidos DROP COLUMN nota;
