# ADR-005: Fly.io (gru) e Supabase (sa-east-1), com banco isolado da Data API

- Situação: aceita (decisão do dono, 2026-10-16), **sem nada publicado**. O dono decidiu que nenhum serviço pago é contratado até o app ficar pronto.
- Origem: `docs/produto/planos/00-arquitetura.md`, abordagem 3 (hospedagem) e seção "Painel (S9)".

## Contexto

Os dados e os usuários estão no Brasil e a latência importa. Railway só tem EUA, Europa e Singapura. Fly.io tem `gru` (São Paulo) e o Supabase tem `sa-east-1`. Fly Managed Postgres sai mais caro, e o Cloud Run com Cloud SQL pede mais configuração. O dono aceitou ter dois fornecedores.

## Decisão

- Fly.io na região `gru`: dois apps do Fly. A API, com os processos `app` (HTTP) e `worker` (mesma imagem), e o painel (app `bairrin-painel`, Caddy servindo o build estático).
- Supabase `sa-east-1` para PostgreSQL e Storage. A API conecta pelo pooler em modo sessão, porque a conexão direta é IPv6.
- Domínios previstos, após o registro de `bairrin.com.br`: `api.bairrin.com.br` e `painel.bairrin.com.br` (mesmo site, o que permite o cookie `SameSite=Strict`).
- A "Data API" do Supabase fica desligada em produção e homologação, e `anon` e `authenticated` ficam sem privilégio algum. Dois papéis de banco (ADR-004). O `DATABASE_URL_MIGRACAO` só existe no `release_command`.
- Conexão com `sslmode=verify-full`, o certificado da CA do Supabase e "Enforce SSL" ligado.
- O painel recebe HTTPS com HSTS e CSP sem `unsafe-inline`, com `frame-ancestors 'none'` e `connect-src` só para a API.

## Consequências

- Custo mensal inicial estimado em US$ 50 a 55 (cálculo do arquiteto, não verificado no Fly nem no Supabase), valendo a partir da homologação.
- Dois fornecedores significam dois lugares de MFA, segredos e backup. Tudo isso está na lista de `docs/operacao/checklist-deploy.md`.
- Risco aberto: o pooler (Supavisor) com papel próprio e o `trust proxy` de 2 saltos no Fly ainda não foram verificados num ambiente real. Se o pooler recusar o papel, a alternativa é a conexão direta com o complemento de IPv4 do Supabase.
- A imagem Docker é a mesma em qualquer provedor; mover a API para o Fly Managed Postgres, ou o banco para o Fly, é possível se a latência não servir.
- Situação do código: `apps/painel/{Dockerfile,Caddyfile,fly.toml}` existem (etapa 15 do plano 01a), sem publicar. `apps/api/Dockerfile` e `apps/api/fly.toml` também existem (etapa 13), sem publicar. Leia os arquivos, não este texto, para os detalhes.
- O HSTS do painel sai sem `preload` até o registro do domínio; decidir `preload` no registro de `bairrin.com.br`.
