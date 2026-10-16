-- reversao: DROP TABLE pedidos.historico; só em banco sem dados.
CREATE TABLE pedidos.historico (id uuid PRIMARY KEY);
ALTER TABLE pedidos.outra ENABLE ROW LEVEL SECURITY;
