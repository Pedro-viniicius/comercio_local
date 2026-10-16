-- reversao: recriar a tabela a partir do backup.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pedidos.itens) THEN
    RAISE EXCEPTION 'pedidos.itens tem linhas';
  END IF;
END
$$;
DROP TABLE pedidos.itens;
