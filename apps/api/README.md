# API (`apps/api`)

API do Bairrin em NestJS 12 (Node 22, ESM), com Prisma 7 sobre PostgreSQL. São dois processos do mesmo código: o HTTP (`src/main.ts`) e o worker (`src/worker.ts`, relay da outbox, assinantes e tarefas agendadas). Decisões: ADR-003, 004, 010 e 011.

Hoje existe só o núcleo (`src/compartilhado`). Os módulos de negócio (`src/modulos/<contexto>`) começam no plano 01b, com Identidade.

## Rodar

Pré-requisitos e primeiros passos estão no `README.md` da raiz (instalar, compilar os pacotes `@bairrin/*`, copiar o `.env.example`, subir o `docker compose`). Depois:

```bash
pnpm --filter api dev       # HTTP em http://localhost:3000 (compila e reinicia ao mudar)
pnpm --filter api worker    # worker; precisa do banco migrado e do pg-boss migrado
```

Dados de exemplo: `pnpm --filter api seed` (citado no `CLAUDE.md`) ainda não existe; chega no plano 01b.

Os dois compilam com `tsc` e rodam `node dist/...` com `--env-file-if-exists=.env`. Rodar direto o TypeScript (por exemplo com `tsx`) **não funciona**: o `tsx` não emite os metadados de decorator e a injeção de dependência do Nest quebra.

```bash
curl http://localhost:3000/v1/saude          # {"status":"ok","versao":"..."} (versao só fora de produção)
curl http://localhost:3000/v1/saude/pronto   # 200 se o banco responde; 503 em Problem Details se não
```

## Variáveis de ambiente

Modelo em `.env.example` (valores fictícios; nunca coloque segredo real nele). A API valida tudo com zod ao subir e **não sobe** se faltar algo ou se algo estiver inválido; a mensagem cita só o nome da variável.

| Variável                                            | Uso                                                                                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                          | `development`, `test` ou `production`.                                                                                                                                                                             |
| `PORTA`                                             | Porta HTTP.                                                                                                                                                                                                        |
| `DATABASE_URL`                                      | Papel `bairrin_app` (só DML). É a única conexão da aplicação.                                                                                                                                                      |
| `DATABASE_URL_MIGRACAO`                             | Papel `bairrin_migracao` (dono dos schemas). Só migrações e `release_command`; a API não a lê.                                                                                                                     |
| `DATABASE_URL_TESTE`                                | `bairrin_app` no Postgres de teste (porta 5433), para os testes de integração.                                                                                                                                     |
| `DATABASE_URL_MIGRACAO_TESTE`                       | `bairrin_migracao` no Postgres de teste. O preparo dos testes apaga os schemas; só aceita banco terminado em `_teste`.                                                                                             |
| `CORS_ORIGENS`                                      | Origens aceitas, separadas por vírgula. Sem `*`; em produção, só `https://`.                                                                                                                                       |
| `JWT_SEGREDO`, `CHAVE_CIFRAGEM_DADOS`, `CHAVE_HMAC` | Chaves em base64 com no mínimo 32 bytes, diferentes entre si. Gere com `openssl rand -base64 32`. Valores que começam com `EXEMPLO` são recusados em produção.                                                     |
| `SMTP_URL`, `EMAIL_REMETENTE`                       | E-mail. Em dev vai para o Mailpit (`http://127.0.0.1:8025`).                                                                                                                                                       |
| `SENTRY_DSN`                                        | Vazio desliga o Sentry. Com valor, a API e o worker enviam erros ao Sentry (`src/compartilhado/observabilidade/sentry.ts`), com `dataCollection` todo desligado, sem Replay e redigidos pelo mesmo redator do log. |
| `LOG_NIVEL`                                         | `trace`, `debug`, `info`, `warn`, `error` ou `fatal`.                                                                                                                                                              |

Sem as variáveis de teste no ambiente, os testes de integração usam os valores públicos do `infra/docker-compose.yml`. Nenhum teste lê `.env`.

## Banco e migrações

O banco, os papéis e as regras estão no ADR-004. Em resumo: um schema por contexto, nada em `public`, RLS em toda tabela, a tabela de controle do Prisma no schema `migracoes`.

O Prisma 7 **não lê `.env`**. Rode a CLI de dentro de `apps/api`, passando o arquivo ao Node:

```bash
cd apps/api
node --env-file=.env ./node_modules/prisma/build/index.js migrate status
node --env-file=.env ./node_modules/prisma/build/index.js migrate deploy
```

(`pnpm --filter api exec node --env-file=...` não acha o arquivo; use o `cd`.) O `prisma.config.ts` fixa `schema=migracoes` na URL de migração, qualquer que seja o valor recebido.

**Criar uma migração.** Altere `prisma/schema.prisma`, gere o SQL sem aplicar, revise e só então aplique:

```bash
cd apps/api
node --env-file=.env ./node_modules/prisma/build/index.js migrate dev --create-only --name <nome>
```

Regras do SQL (verificadas por `pnpm migracoes:verificar` na raiz):

- Começa com um comentário `-- reversao:` que diz como desfazer.
- Toda `CREATE TABLE` (e todo `SELECT ... INTO`, que também cria tabela) tem `ENABLE ROW LEVEL SECURITY` na mesma migração, com política só para `bairrin_app`, e o `GRANT` explícito de DML.
- Nada em `public`, inclusive extensão: `CREATE EXTENSION` sempre com `WITH SCHEMA <schema>`.
- `DROP`, `RENAME`, `ALTER COLUMN ... TYPE`, `TRUNCATE` e `DELETE FROM` só em pasta `<timestamp>_<nome>_destrutiva`, separada da criação e começando por um bloco `DO $$ ... RAISE EXCEPTION ... $$` que aborta se houver linhas.
- Nunca, em pasta nenhuma: `DISABLE` ou `NO FORCE ROW LEVEL SECURITY`; `DISABLE TRIGGER`, `ENABLE REPLICA TRIGGER` ou `session_replication_role`; `GRANT` para `PUBLIC`, `anon`, `authenticated` ou `service_role`; `GRANT` de `UPDATE`, `DELETE`, `TRUNCATE` ou `ALL` em tabela só de acréscimo (`compartilhado.auditoria`); função `SECURITY DEFINER` sem `SET search_path` no mesmo comando.
- SQL dinâmico (`EXECUTE '...'`) passa pelas mesmas regras; tabela criada ali com nome montado (`format('%I')`, `||`) é recusada.

**Client do Prisma.** `pnpm install` roda `prisma generate` (`postinstall`) e gera em `src/compartilhado/infra/gerado/`, pasta fora do git. Se mudar o `schema.prisma`, rode `pnpm install` de novo ou `prisma generate` pela mesma CLI. A aplicação conecta pelo `PrismaService`, com o driver adapter `@prisma/adapter-pg` e o papel `bairrin_app`.

**pg-boss.** O schema `pgboss` não é migração do Prisma: o SQL dele tem `DROP TABLE` dinâmico. Um passo próprio o cria e migra com o papel de migração e dá ao `bairrin_app` só o necessário (USAGE, DML, EXECUTE e RLS):

```bash
pnpm --filter api build
cd apps/api && node --env-file=.env dist/cli/migrar-pg-boss.js
```

**Os dois passos de uma vez.** O script `migrar` roda `prisma migrate deploy` e, se der certo, o passo do pg-boss. É o mesmo do deploy: o `release_command` do `fly.toml` é `node --run migrar`. Ele precisa do build (`dist/cli/migrar-pg-boss.js`) e **não lê `.env`**: `DATABASE_URL_MIGRACAO` tem de estar no ambiente do processo (nem `node --env-file=.env --run migrar` a repassa ao script). Em desenvolvimento, use os comandos acima.

```bash
pnpm --filter api build
pnpm --filter api migrar     # com DATABASE_URL_MIGRACAO no ambiente
```

Os testes de integração fazem os dois passos no `globalSetup`. A aplicação sobe o pg-boss com `migrate: false`.

## Estrutura de `src`

```
main.ts, worker.ts          entradas HTTP e worker
app.module.ts, worker.module.ts
cli/migrar-pg-boss.ts       passo de migração do pg-boss e checagem de schemas fechados (S26)
compartilhado/
  config/        ambiente validado com zod
  http/          configurarAplicacao, filtro de erros (Problem Details), pipe de validação, id da requisição
  log/           logger pino e redator de dado sensível
  saude/         /v1/saude e /v1/saude/pronto
  transacao/     porta UnidadeDeTrabalho
  tempo/         porta Relogio e relógios (sistema e fixo)
  eventos/       porta PublicadorDeEventos, relay, assinantes, tarefa de limpeza
  auditoria/     porta RepositorioDeAuditoria
  titular/       AnonimizadorDeTitular e a regra de dado pessoal
  email/         porta EnviadorDeEmail e falso em memória
  infra/         adaptadores: PrismaService, UnidadeDeTrabalhoPrisma, PublicadorDeEventosNaOutbox,
                 RepositorioDeAuditoriaPrisma, SMTP, pg-boss, checagem de schemas fechados
modulos/<contexto>/{dominio,aplicacao,infra,http}   (futuro, a partir do plano 01b)
```

### Peças do núcleo

- **Outbox.** O caso de uso grava o evento na tabela `compartilhado.outbox` na mesma transação (`PublicadorDeEventos`). O relay do worker lê em lotes com `FOR UPDATE SKIP LOCKED` e cria um job do pg-boss por assinante, com chave única evento mais assinante. Entrega pelo menos uma vez; `eventos_processados` garante o efeito no banco uma vez só. Limpeza diária: outbox publicada há mais de 30 dias e jobs há mais de 7 dias.
- **Repositórios** usam sempre `UnidadeDeTrabalhoPrisma.cliente()`, nunca o `PrismaService` direto, para participar da transação do caso de uso.
- **Auditoria.** `RepositorioDeAuditoria` só grava (a tabela é só de acréscimo, por privilégio e por trigger). `antes` e `depois` não levam dado pessoal: campo pessoal vira `{"alterado": true}`, e chaves conhecidas de dado pessoal são rejeitadas. O mesmo vale para o payload da outbox.
- **Anonimização.** Todo módulo que guarda dado pessoal implementa `AnonimizadorDeTitular` e o registra no `RegistroDeAnonimizadores`.
- **E-mail.** A porta `EnviadorDeEmail` tem o adaptador SMTP (nodemailer) e um falso em memória.
- **Erro de assinante.** O erro de um job vai para o `output` do pg-boss com mensagem e causa. Lance erro sanitizado, sem `cause`, sem dado pessoal.

### Comportamento HTTP

- Erro em Problem Details (`application/problem+json`): `type`, `title`, `status`, `codigo`, `campos[{campo, codigo, motivo}]` e `idRequisicao`. Erro inesperado vira 500 genérico, sem pilha nem mensagem.
- `X-Request-Id` gerado sempre no servidor. `Cache-Control: no-store` por padrão. Helmet. CORS por lista de origens, com credenciais.
- Corpo JSON até 100 KB (413 acima). Limite global de 300 requisições por minuto por IP, em memória (uma instância).
- `trust proxy` de 2 saltos só em produção, para o Fly; esse valor ainda precisa ser confirmado num Fly real.
- Log em JSON, sem corpo de requisição, sem query na URL, com redator de chaves sensíveis. A mensagem de erro de biblioteca de banco não é registrada.

## Testes

```bash
pnpm --filter api test                                   # unitários (src e test/fronteiras)
pnpm --filter api exec vitest run src/compartilhado/log  # um arquivo ou pasta
pnpm --filter api test:integracao                        # todos os testes de integração
pnpm --filter api test:integracao -- outbox email-smtp   # só os arquivos que contêm esses trechos
```

- Os de integração exigem `docker compose -f infra/docker-compose.yml up -d --wait`. O `globalSetup` apaga os schemas do Postgres de teste e aplica as migrações a cada execução. Os arquivos rodam um de cada vez.
- O filtro por trecho existe porque o pnpm 12 repassa o `--` ao script e o Vitest ignora o que vem depois dele; `vitest.integracao.config.ts` lê o trecho de `process.argv`.
- O Vitest 5 resolve os metadados do Nest sozinho; não há `unplugin-swc` na configuração.
- `test/fronteiras` prova que cada regra de `pnpm deps:verificar` reprova uma fixture que a viola.

## Deploy

- `Dockerfile`: imagem multi-stage, sem root e sem `.env`, com o certificado da CA do Supabase em `/app/certificados/supabase-ca.crt` (hoje um aviso no lugar do certificado: veja `infra/certificados/supabase-ca.crt`).
- `fly.toml`: app `bairrin-api` em `gru`, processos `app` e `worker` da mesma imagem, `release_command = "node --run migrar"` e health check em `GET /v1/saude`. Deploy a partir da raiz: `fly deploy -c apps/api/fly.toml`.
- CI: `.github/workflows/ci.yml` (todo PR) e `android-nativo.yml` (`main`).
- Passo a passo e itens obrigatórios: `docs/operacao/checklist-deploy.md`; decisões no ADR-005.

## Futuro

- `pnpm --filter api seed` e `seed:admin` estão no `package.json`, mas os CLIs (`src/cli/seed.ts`, `seed-admin.ts`) ainda não existem (plano 01b). Seeds vão recusar `NODE_ENV=production`; o `seed:admin` é a exceção, por CLI.
- `/v1/docs` (OpenAPI gerado dos esquemas) e `GET /v1/app/versao-minima`.
