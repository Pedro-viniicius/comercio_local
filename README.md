# Bairrin

Marketplace mobile do comércio local: o consumidor compra de lojas da própria cidade e a loja entrega ou deixa o pedido para retirada. A cidade piloto é São Sebastião do Paraíso (MG).

- Visão e briefs: `docs/produto/visao.md` e `docs/produto/briefs/`.
- Arquitetura aprovada: `docs/produto/planos/00-arquitetura.md`.
- Decisões de engenharia: `docs/adr/` (ADR-001 a ADR-015).
- Convenções de código: `docs/CONVENCOES.md`.
- Lista de verificação de deploy: `docs/operacao/checklist-deploy.md`.

## Estado da fundação

Plano `docs/produto/planos/01a-fundacao-repositorio.md`, situação em 2026-10-16.

| Parte                                                                          | Situação                                                                    |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Raiz do monorepo, lint, typecheck, testes                                      | Pronta                                                                      |
| `infra/` (Postgres de desenvolvimento e de teste, Mailpit)                     | Pronta                                                                      |
| `apps/api` (HTTP, worker, banco, outbox, auditoria, e-mail)                    | Pronta (sem módulos de negócio; eles vêm a partir do plano 01b)             |
| `packages/contratos`, `packages/cliente-api`, `packages/tokens`                | Prontos                                                                     |
| `apps/painel`                                                                  | Mínimo pronto (página com o estado da API)                                  |
| `apps/consumidor`, `apps/lojista`                                              | **Ainda não criados**: só existe o `.env.example` (ver o README de cada um) |
| Hospedagem do painel (`Dockerfile`, `Caddyfile` e `fly.toml` em `apps/painel`) | Pronta, sem publicar (etapa 15)                                             |
| CI, `Dockerfile` e `fly.toml` da API, Sentry                                   | Prontos, sem publicar (etapa 13)                                            |
| `packages/mobile-base`                                                         | Futuro (plano 01b)                                                          |

Dois avisos de hoje, que somem sozinhos com o tempo:

- `pnpm audit --prod --audit-level=high` falha por dependências transitivas do Prisma 7.10.0. A correção está no 7.10.1, que só pode ser instalado a partir de 2026-10-18 por causa do `minimumReleaseAge`.
- O Expo SDK 58 estável (`expo` 58.0.11, React Native 0.88.0) fica elegível no `minimumReleaseAge` em 2026-10-19. Até lá os apps não podem ser criados.

## Estrutura

```
apps/api/            API NestJS (src/main.ts) e worker (src/worker.ts)
apps/consumidor/     app Expo do consumidor (futuro; hoje só .env.example)
apps/lojista/        app Expo do lojista (futuro; hoje só .env.example)
apps/painel/         painel do administrador, React + Vite
packages/contratos/  @bairrin/contratos: esquemas zod compartilhados
packages/cliente-api/ @bairrin/cliente-api: cliente HTTP tipado
packages/tokens/     @bairrin/tokens: tokens de design
infra/               docker-compose.yml e papéis do Postgres local
scripts/             verificar-migracoes.mjs e seus testes
docs/                adr/, operacao/, produto/ e CONVENCOES.md
```

Também previstos, ainda sem pasta: `packages/mobile-base` (sessão, fila offline e telas comuns dos dois apps) e `assets/brand`.

## Pré-requisitos

- Node 22 (`.nvmrc`; o `package.json` aceita `>=22.22.2 <23`).
- pnpm 12.4.1 (campo `packageManager` do `package.json`).
- Docker com Compose (Postgres e Mailpit locais).
- Git.

Nada depende de serviço externo para desenvolver: banco, e-mail, gateway, push e geocodificação são locais ou falsos.

## Primeiros passos

```bash
pnpm install
pnpm --filter "@bairrin/*" run build
cp apps/api/.env.example apps/api/.env
docker compose -f infra/docker-compose.yml up -d --wait
```

- `pnpm --filter "@bairrin/*" run build` compila os três pacotes compartilhados para `dist/`. Num clone limpo, a API compilada (`node dist/main.js`) lê `@bairrin/contratos` pelo `dist`, então `pnpm --filter api dev` e `pnpm --filter api worker` falham sem esse passo. `pnpm build` na raiz também o faz. Lint, typecheck, testes e o painel (`dev` e `build`) leem os pacotes pelo código-fonte (condição `@bairrin/fonte`) e não precisam dele.

- `pnpm install` roda `prisma generate` na API (`postinstall`). O client é gerado em `apps/api/src/compartilhado/infra/gerado/`, pasta fora do git. Sem ele, `typecheck`, testes e build da API quebram.
- O `.env` fica fora do git e o `.env.example` traz só valores fictícios, próprios de desenvolvimento. Os apps e o painel também têm o seu `.env.example`.
- O compose sobe, só em `127.0.0.1`: Postgres de desenvolvimento (5432), Postgres de teste (5433, em memória) e Mailpit (web em 8025, SMTP em 1025). Os papéis `bairrin_migracao` e `bairrin_app` são criados na primeira subida. Para recriá-los, ou zerar o banco de desenvolvimento: `docker compose -f infra/docker-compose.yml down -v`.
- Na mesma primeira subida, `infra/postgres/init/01-papeis.sql` tira de `PUBLIC` todo privilégio no schema `public` (`REVOKE ALL`, como no Supabase): a aplicação só enxerga os schemas em que as migrações lhe dão `USAGE`. **Banco de desenvolvimento criado antes de 2026-10-16 (plano 01b, etapa 0a) ainda dá `USAGE` em `public` a todos:** rode, sem perder dados, `docker compose -f infra/docker-compose.yml exec postgres psql -U postgres -d bairrin -c 'REVOKE ALL ON SCHEMA public FROM PUBLIC'` (o superusuário `postgres` da imagem). Ou recrie do zero com `docker compose -f infra/docker-compose.yml down -v` (apaga os dados locais), suba de novo e reaplique as migrações (abaixo). O Postgres de teste guarda os dados em memória e volta limpo com `docker compose -f infra/docker-compose.yml up -d --force-recreate --wait postgres-teste`.

### Banco de desenvolvimento

O Prisma 7 não lê `.env`. Rode a CLI dentro de `apps/api`, passando o arquivo ao Node:

```bash
cd apps/api
node --env-file=.env ./node_modules/prisma/build/index.js migrate deploy
pnpm build
node --env-file=.env dist/cli/migrar-pg-boss.js
```

O segundo passo cria o schema do pg-boss. O primeiro usa o papel `bairrin_migracao` (`DATABASE_URL_MIGRACAO`); a aplicação usa só `bairrin_app` (`DATABASE_URL`). Detalhes e como criar uma migração nova: `apps/api/README.md`.

O script `pnpm --filter api migrar` faz os dois passos na ordem do deploy (é o `release_command` do `fly.toml`, `node --run migrar`). Ele não lê `.env`: só funciona com `DATABASE_URL_MIGRACAO` no ambiente do processo. Em desenvolvimento, prefira os comandos acima.

## Rodar cada parte

| Parte          | Comando                       | Observação                                                          |
| -------------- | ----------------------------- | ------------------------------------------------------------------- |
| API            | `pnpm --filter api dev`       | Compila, observa mudanças e sobe em `http://localhost:3000`         |
| Worker         | `pnpm --filter api worker`    | Relay da outbox, assinantes e limpeza; precisa do pg-boss migrado   |
| Painel         | `pnpm --filter painel dev`    | Vite em `http://localhost:5173` (origem já liberada no CORS da API) |
| Consumidor     | futuro                        | Ver `apps/consumidor/README.md`                                     |
| Lojista        | futuro                        | Ver `apps/lojista/README.md`                                        |
| E-mails de dev | abrir `http://127.0.0.1:8025` | Mailpit                                                             |

Conferir a API: `curl http://localhost:3000/v1/saude` e `curl http://localhost:3000/v1/saude/pronto` (este consulta o banco).

## Verificação

Rode na raiz, nesta ordem (é a do CI de PR):

```bash
pnpm lint                  # ESLint sem avisos e Prettier
pnpm typecheck
pnpm deps:verificar        # fronteiras de camadas (dependency-cruiser)
pnpm migracoes:verificar   # regras das migrações SQL
pnpm test                  # unitários dos pacotes e testes dos scripts
pnpm test:integracao       # exige o docker compose no ar
pnpm build
```

Para rodar um arquivo ou um trecho:

```bash
pnpm --filter api exec vitest run src/compartilhado/http/filtro-de-erros.test.ts
pnpm --filter api test:integracao -- outbox        # só os arquivos *outbox*.int.test.ts
pnpm --filter painel exec vitest run src/App.test.tsx
```

Os apps Expo usarão `pnpm --filter <app> exec jest <caminho>` quando existirem.

Os testes de integração apagam e recriam os schemas do Postgres de teste (porta 5433) a cada execução; nunca apontam para o banco de desenvolvimento.

## Cadeia de suprimentos

No pnpm 12, as regras ficam no `pnpm-workspace.yaml`, não no `.npmrc` (este só serve para o registry):

- `saveExact: true`: dependência nova entra com versão exata.
- `minimumReleaseAge: 4320`: em minutos, ou seja, 3 dias. Vale também para as transitivas.
- `allowBuilds` com `strictDepBuilds: true`: só os pacotes listados rodam script de instalação. Pacote novo com script faz a instalação falhar até alguém decidir `true` ou `false`.
- Versões compartilhadas (`typescript`, `vitest`, `zod`, `@types/node`) ficam no `catalog:` do mesmo arquivo.

O plano falava em `save-exact` no `.npmrc` e em `onlyBuiltDependencies`; no pnpm 12 esses nomes não valem mais (ADR-013).

## Integração contínua e deploy

Nenhum serviço pago é contratado até o app ficar pronto (decisão do dono), então nada está publicado. O roteiro para o dia do deploy está em `docs/operacao/checklist-deploy.md`.

- Painel: `apps/painel/Dockerfile` (build do Vite servido pelo Caddy, sem root), `apps/painel/Caddyfile` (CSP estrita e HSTS) e `apps/painel/fly.toml`. Detalhes em `apps/painel/README.md`.
- API: `apps/api/Dockerfile` (imagem sem root) e `apps/api/fly.toml` (processos `app` e `worker`, migração no `release_command` `node --run migrar`). Primeiro deploy: `fly deploy -c apps/api/fly.toml --ha=false`. O Sentry entra quando houver `SENTRY_DSN`. Detalhes em `apps/api/README.md` e no checklist de deploy.
- CI: `.github/workflows/ci.yml` (os comandos de verificação, `pnpm audit` bloqueante, integração e build em todo PR) e `.github/workflows/android-nativo.yml` (build Android na `main`, pulado enquanto os apps não existem). Dependências: `.github/dependabot.yml`.
- Esses arquivos são a fonte da verdade; este resumo só aponta para eles.

## Documentação

- `docs/adr/README.md`: índice das decisões de arquitetura.
- `docs/CONVENCOES.md`: nomes, camadas, commits, testes e logs.
- Um README em cada app e pacote.
