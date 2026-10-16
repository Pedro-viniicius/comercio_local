-- reversao: DROP TABLE public.vazamento; só em banco sem dados.
CREATE TABLE public.vazamento (id uuid PRIMARY KEY);
ALTER TABLE public.vazamento ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS sem_schema (id uuid PRIMARY KEY);
ALTER TABLE sem_schema ENABLE ROW LEVEL SECURITY;
