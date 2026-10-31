# Bairrin

Marketplace mobile do comércio local: o consumidor compra de lojas da própria cidade e a loja entrega ou deixa o pedido para retirada. A cidade piloto é São Sebastião do Paraíso (MG).

- Visão e briefs: `docs/produto/visao.md` e `docs/produto/briefs/`.
- Arquitetura aprovada: `docs/produto/planos/00-arquitetura.md`.
- Decisões de engenharia: `docs/adr/` (ADR-001 a ADR-015).
- Convenções de código: `docs/CONVENCOES.md`.
- Lista de verificação de deploy: `docs/operacao/checklist-deploy.md`.

## Estado da fundação

Plano `docs/produto/planos/01a-fundacao-repositorio.md`, situação em 2026-10-16, com os apps Expo atualizados em 2026-10-27.

| Parte                                                                          | Situação                                                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Raiz do monorepo, lint, typecheck, testes                                      | Pronta                                                                           |
| `infra/` (Postgres de desenvolvimento e de teste, Mailpit)                     | Pronta                                                                           |
| `apps/api` (HTTP, worker, banco, outbox, auditoria, e-mail)                    | Pronta (sem módulos de negócio; eles vêm a partir do plano 01b)                  |
| `packages/contratos`, `packages/cliente-api`, `packages/tokens`                | Prontos                                                                          |
| `apps/painel`                                                                  | Mínimo pronto (página com o estado da API)                                       |
| `apps/consumidor`, `apps/lojista`                                              | Mínimos prontos (Expo SDK 58, tela com o estado da API; ver o README de cada um) |
| Hospedagem do painel (`Dockerfile`, `Caddyfile` e `fly.toml` em `apps/painel`) | Pronta, sem publicar (etapa 15)                                                  |
| CI, `Dockerfile` e `fly.toml` da API, Sentry                                   | Prontos, sem publicar (etapa 13)                                                 |
| `packages/mobile-base`                                                         | Esqueleto (dependências e lint; sessão e telas vêm no plano 01b)                 |

## Estrutura

```
apps/api/            API NestJS (src/main.ts) e worker (src/worker.ts)
apps/consumidor/     app Expo do consumidor (Expo Router em src/app)
apps/lojista/        app Expo do lojista (Expo Router em src/app)
apps/painel/         painel do administrador, React + Vite
packages/contratos/  @bairrin/contratos: esquemas zod compartilhados
packages/cliente-api/ @bairrin/cliente-api: cliente HTTP tipado
packages/tokens/     @bairrin/tokens: tokens de design
packages/mobile-base/ @bairrin/mobile-base: base dos apps Expo (esqueleto)
infra/               docker-compose.yml e papéis do Postgres local
scripts/             verificar-migracoes.mjs e seus testes
docs/                adr/, operacao/, produto/ e CONVENCOES.md
```

`packages/mobile-base` receberá a sessão, a fila offline e as telas comuns dos dois apps (plano 01b). Ainda sem pasta: `assets/brand`.

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

| Parte          | Comando                          | Observação                                                          |
| -------------- | -------------------------------- | ------------------------------------------------------------------- |
| API            | `pnpm --filter api dev`          | Compila, observa mudanças e sobe em `http://localhost:3000`         |
| Worker         | `pnpm --filter api worker`       | Relay da outbox, assinantes e limpeza; precisa do pg-boss migrado   |
| Painel         | `pnpm --filter painel dev`       | Vite em `http://localhost:5173` (origem já liberada no CORS da API) |
| Consumidor     | `pnpm --filter consumidor start` | Expo; ver `apps/consumidor/README.md` (endereço da API, emulador)   |
| Lojista        | `pnpm --filter lojista start`    | Expo; ver `apps/lojista/README.md`                                  |
| E-mails de dev | abrir `http://127.0.0.1:8025`    | Mailpit                                                             |

Conferir a API: `curl http://localhost:3000/v1/saude` e `curl http://localhost:3000/v1/saude/pronto` (este consulta o banco).

## Autenticação

Conta única por e-mail, com os perfis `consumidor`, `lojista` e `admin`. O mesmo login vale nos dois apps; o painel só abre para `admin` com segundo fator (TOTP). A API é a autoridade: valida cada corpo, revoga sessão no servidor e nunca confia no perfil que o cliente diz ter. Decisão completa em `docs/adr/0012-sessao-e-autenticacao.md`; rotas, fluxos, eventos, limites e prazos de retenção em `apps/api/src/modulos/identidade/README.md`.

- **Token de acesso:** JWT de 15 minutos. Nos apps vai em `Authorization: Bearer`; no painel fica só em memória.
- **Renovação:** token opaco rotativo, guardado no servidor só como HMAC. Nos apps dura 30 dias deslizantes e vai no corpo; no painel vai em cookie `HttpOnly; Secure; SameSite=Strict` (`bairrin_renovacao`), com 30 minutos de inatividade e 12 horas no máximo, conferidos no servidor. Logout e troca de senha revogam a sessão no servidor na hora: a renovação deixa de valer, e o token de acesso já emitido cai na hora em `/v1/admin` e nas rotas com `@ConfereSessao()` (dados da conta e cópia dos dados); nas demais, ele vale até completar os 15 minutos. A exclusão da conta também revoga as sessões e desativa a conta, e o token de acesso cai na hora em qualquer rota.
- **Admin:** senha e depois código do app autenticador (TOTP). A conta admin só pede a própria exclusão pelo painel, com o segundo fator (S113). Quem ainda não tem 2FA o configura antes de qualquer outra coisa, no próprio painel. Quem perde o celular e os códigos de recuperação usa a CLI de reconfiguração (`pnpm --filter api reconfigurar-segundo-fator`).
- **API e painel:** `packages/cliente-api/README.md` (renovação em 401, fila única, revogação pendente) e `apps/painel/README.md` (telas de entrada, inatividade e várias abas).
- **Apps Expo:** guardam a sessão no SecureStore e limpam tudo no logout; o resumo está em `packages/mobile-base/README.md` (sessão em `src/sessao`, plano 01b, etapa 12); o texto completo vem na etapa 20b.

Para ter um admin em desenvolvimento, com o banco migrado, o `seed` rodado (grava os termos e a política que o cadastro exige) e a API e o worker no ar:

```bash
pnpm --filter api seed
pnpm --filter api seed:admin
```

O `seed:admin` pergunta e-mail (duas vezes), nome e celular e cria a conta sem senha. O código para definir a senha chega pelo worker ao Mailpit (`http://127.0.0.1:8025`): use o link "Esqueci minha senha" da tela de entrada do painel (abre a tela "Recuperar senha"), entre e configure o app autenticador. Sem o worker rodando, nenhum e-mail (verificação, recuperação, aviso) é enviado.

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

Os apps Expo usam o Jest (`jest-expo`): `pnpm --filter @bairrin/mobile-base exec jest src/telas/EstadoDaApi.test.tsx` (o mesmo vale para `consumidor` e `lojista`, com os testes de rota em `src/testes`).

Os testes de integração apagam e recriam os schemas do Postgres de teste (porta 5433) a cada execução; nunca apontam para o banco de desenvolvimento.

## Cadeia de suprimentos

No pnpm 12, as regras ficam no `pnpm-workspace.yaml`, não no `.npmrc` (este só serve para o registry):

- `saveExact: true`: dependência nova entra com versão exata.
- `minimumReleaseAge: 4320`: em minutos, ou seja, 3 dias. Vale também para as transitivas.
- `allowBuilds` com `strictDepBuilds: true`: só os pacotes listados rodam script de instalação. Pacote novo com script faz a instalação falhar até alguém decidir `true` ou `false`.
- Versões compartilhadas (`typescript`, `vitest`, `zod`, `@types/node`) ficam no `catalog:` do mesmo arquivo.
- `overrides`: só para correção de segurança em transitiva que o pacote de cima fixa sem faixa. Cada linha cita o GHSA e usa o seletor `pai>filho@<versão corrigida>`, que deixa de valer sozinho quando o pacote de cima subir; revise a lista a cada atualização desse pacote (hoje: multer sob `@nestjs/platform-express`).

O plano falava em `save-exact` no `.npmrc` e em `onlyBuiltDependencies`; no pnpm 12 esses nomes não valem mais (ADR-013).

## Integração contínua e deploy

Nenhum serviço pago é contratado até o app ficar pronto (decisão do dono), então nada está publicado. O roteiro para o dia do deploy está em `docs/operacao/checklist-deploy.md`.

- Painel: `apps/painel/Dockerfile` (build do Vite servido pelo Caddy, sem root), `apps/painel/Caddyfile` (CSP estrita e HSTS) e `apps/painel/fly.toml`. Detalhes em `apps/painel/README.md`.
- API: `apps/api/Dockerfile` (imagem sem root) e `apps/api/fly.toml` (processos `app` e `worker`, migração no `release_command` `node --run migrar`). Primeiro deploy: `fly deploy -c apps/api/fly.toml --ha=false`. O Sentry entra quando houver `SENTRY_DSN`. Detalhes em `apps/api/README.md` e no checklist de deploy.
- CI: `.github/workflows/ci.yml` (os comandos de verificação, `pnpm audit` bloqueante, integração e build em todo PR) e `.github/workflows/android-nativo.yml` (build Android nativo na `main`; o `expo export` dos dois apps roda em todo PR). Os dois passos dos apps não têm atalho: se a pasta ou o `app.config.ts` de um app sumir, o CI falha. Dependências: `.github/dependabot.yml`.
- Esses arquivos são a fonte da verdade; este resumo só aponta para eles.

## Documentação

- `docs/adr/README.md`: índice das decisões de arquitetura.
- `docs/CONVENCOES.md`: nomes, camadas, commits, testes e logs.
- Um README em cada app, pacote e módulo da API (o de Identidade: `apps/api/src/modulos/identidade/README.md`).
