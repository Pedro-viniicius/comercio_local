# API (`apps/api`)

API do Bairrin em NestJS 12 (Node 22, ESM), com Prisma 7 sobre PostgreSQL. São dois processos do mesmo código: o HTTP (`src/main.ts`) e o worker (`src/worker.ts`, relay da outbox, assinantes e tarefas agendadas). Decisões: ADR-003, 004, 010 e 011.

Além do núcleo (`src/compartilhado`), existe o primeiro módulo de negócio, `src/modulos/identidade` (plano 01b): contas, sessão, segundo fator do admin, recuperação de senha e privacidade, com domínio, casos de uso, repositórios Prisma, assinantes de eventos, tarefas diárias e as rotas HTTP. Rotas, fluxos, eventos, limites e prazos de retenção estão em `src/modulos/identidade/README.md`; a decisão de sessão, em `docs/adr/0012-sessao-e-autenticacao.md`. Os fakes dos testes de unidade ficam em `test/fakes/` (veja "Identidade" abaixo).

## Rodar

Pré-requisitos e primeiros passos estão no `README.md` da raiz (instalar, compilar os pacotes `@bairrin/*`, copiar o `.env.example`, subir o `docker compose`). Depois:

```bash
pnpm --filter api dev       # HTTP em http://localhost:3000 (compila e reinicia ao mudar)
pnpm --filter api worker    # worker; precisa do banco migrado e do pg-boss migrado
```

Dados de exemplo: `pnpm --filter api seed`, com o banco migrado. Grava a versão 1.0 dos Termos de Uso e da Política de Privacidade, marcadas "RASCUNHO, revisar com advogado", como o dono dos schemas (`DATABASE_URL_MIGRACAO`), porque a aplicação só lê documentos legais. Só roda com `NODE_ENV=development` ou `test` (recusa `production` e ambiente sem `NODE_ENV`); rodar de novo não muda o que já foi gravado.

Conta admin: `pnpm --filter api seed:admin` (`src/cli/seed-admin.ts`) cria a conta admin sem senha; é o único caminho que concede `admin` (nenhuma rota concede) e, ao contrário do `seed`, roda em produção, na máquina da API. Lê da entrada padrão, uma linha cada, o e-mail, o e-mail de novo, o nome e o celular (nada pessoal por argumento); depois do primeiro admin, exige `--operador <id da sua conta admin>`, gravado na auditoria. Sobe o mesmo `AppModule` da API, sem HTTP. O código para definir a senha vai para o e-mail da conta; no primeiro login no painel, ela configura o app autenticador.

Reconfigurar o segundo fator de um admin que perdeu o celular e os códigos de recuperação: `pnpm --filter api reconfigurar-segundo-fator --operador <id da sua conta admin> [--conta <id da conta>]` (`src/cli/reconfigurar-segundo-fator.ts`). Sem `--conta`, o e-mail da conta é lido da entrada padrão, nunca de argumento. Apaga o segundo fator, os códigos de recuperação e a senha, revoga todas as sessões da conta, pede a recuperação de senha pelo e-mail e grava a auditoria com o operador como ator. Em produção roda na máquina da API, como o `seed:admin`.

Os dois compilam com `tsc` e rodam `node dist/...` com `--env-file-if-exists=.env`. Rodar direto o TypeScript (por exemplo com `tsx`) **não funciona**: o `tsx` não emite os metadados de decorator e a injeção de dependência do Nest quebra.

```bash
curl http://localhost:3000/v1/saude          # {"status":"ok","versao":"..."} (versao só fora de produção)
curl http://localhost:3000/v1/saude/pronto   # 200 se o banco responde; 503 em Problem Details se não
```

## Variáveis de ambiente

Modelo em `.env.example` (valores fictícios; nunca coloque segredo real nele). A API valida tudo com zod ao subir e **não sobe** se faltar algo ou se algo estiver inválido; a mensagem cita só o nome da variável.

| Variável                                            | Uso                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                          | `development`, `test` ou `production`.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PORTA`                                             | Porta HTTP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `DATABASE_URL`                                      | Papel `bairrin_app` (só DML). É a única conexão da aplicação.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `DATABASE_URL_MIGRACAO`                             | Papel `bairrin_migracao` (dono dos schemas). Só migrações e `release_command`; a API não a lê.                                                                                                                                                                                                                                                                                                                                                                                                |
| `DATABASE_URL_TESTE`                                | `bairrin_app` no Postgres de teste (porta 5433), para os testes de integração.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `DATABASE_URL_MIGRACAO_TESTE`                       | `bairrin_migracao` no Postgres de teste. O preparo dos testes apaga os schemas; só aceita banco terminado em `_teste`.                                                                                                                                                                                                                                                                                                                                                                        |
| `CORS_ORIGENS`                                      | Origens aceitas, separadas por vírgula. Sem `*`; em produção, só `https://`.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `JWT_SEGREDO`, `CHAVE_CIFRAGEM_DADOS`, `CHAVE_HMAC` | Chaves em base64 com no mínimo 32 bytes, diferentes entre si. Gere com `openssl rand -base64 32`. Valores que começam com `EXEMPLO` são recusados em produção.                                                                                                                                                                                                                                                                                                                                |
| `SMTP_URL`, `EMAIL_REMETENTE`                       | E-mail. Em dev vai para o Mailpit (`http://127.0.0.1:8025`).                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `SENTRY_DSN`                                        | Vazio desliga o Sentry. Com valor, a API e o worker enviam erros ao Sentry (`src/compartilhado/observabilidade/sentry.ts`), com `dataCollection` todo desligado, sem Replay, sem sessões de release health e redigidos pelo mesmo redator do log. Só saem eventos de erro e relatórios do cliente (contagens de descarte). Sem cabeçalhos de trace nas requisições de saída, Spotlight e debug desligados (mesmo com `SENTRY_SPOTLIGHT`/`SENTRY_DEBUG` no ambiente) e usuário só com id uuid. |
| `SENTRY_RELEASE`                                    | Opcional. Release marcada nos eventos do Sentry (por exemplo, o SHA do commit da imagem): até 200 letras, números ou `. _ + @ -`. Vazio: sem release. O SDK não deduz a release sozinho (de `GITHUB_SHA` ou de outro CI).                                                                                                                                                                                                                                                                     |
| `SENTRY_TRACES_SAMPLE_RATE`                         | Recusada em produção (não há tracing). Vazia é ignorada.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `LOG_NIVEL`                                         | `trace`, `debug`, `info`, `warn`, `error` ou `fatal`.                                                                                                                                                                                                                                                                                                                                                                                                                                         |

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
- Nada em `public`, inclusive extensão: `CREATE EXTENSION` sempre com `WITH SCHEMA <schema>`, e o schema é um do Bairrin, não o `extensions` do Supabase. Lá o `anon` tem USAGE; se o `bairrin_app` também recebesse USAGE ali para usar a extensão, a checagem de schemas fechados do release passaria a incluir `extensions` e pararia o deploy.
- `DROP`, `RENAME`, `ALTER COLUMN ... TYPE`, `TRUNCATE` e `DELETE FROM` só em pasta `<timestamp>_<nome>_destrutiva`, separada da criação e começando por um bloco `DO $$ ... RAISE EXCEPTION ... $$` que aborta se houver linhas.
- Nunca, em pasta nenhuma: `DISABLE` ou `NO FORCE ROW LEVEL SECURITY`; `DISABLE TRIGGER`, `ENABLE REPLICA TRIGGER` ou `session_replication_role`; `GRANT` para papel que não seja `bairrin_app` nem `bairrin_migracao` (P8): `PUBLIC`, `anon`, `authenticated`, `service_role`, `postgres`, `supabase_*`, `CURRENT_USER`, `SESSION_USER`, `CURRENT_ROLE`, papel qualquer e papel montado em SQL dinâmico (`format('... TO %I', ...)`); `GRANT` de `UPDATE`, `DELETE`, `TRUNCATE` ou `ALL` em tabela só de acréscimo (`compartilhado.auditoria`); função `SECURITY DEFINER` sem `SET search_path` no mesmo comando.
- Nunca, em pasta nenhuma, também: `ALTER DEFAULT PRIVILEGES ... GRANT` (o `REVOKE` passa); `CREATE POLICY` sem `TO` ou com `TO` para `PUBLIC`, `anon`, `authenticated` ou `service_role` (`TO bairrin_app USING (true)` passa); `CREATE` ou `ALTER` de `ROLE`, `USER` ou `GROUP`, `SUPERUSER`, `BYPASSRLS`, `CREATEROLE` e `GRANT <papel> TO` sem `ON`; `SET ROLE`, `SET SESSION AUTHORIZATION` (também `SET "role" TO ...` e `SET role = ...` como opção de função ou de `ALTER DATABASE`), `set_config('role', ...)` e `row_security` (no código e em texto executado; na mensagem de `RAISE` e na descrição de `COMMENT ... IS` passa); `COPY ... PROGRAM`; `OWNER TO`, `CREATE SCHEMA ... AUTHORIZATION` e `REASSIGN OWNED BY ... TO` para papel que não seja `bairrin_migracao` nem `CURRENT_USER`. `UPDATE ... SET role = ...` é coluna e passa.
- Nunca, em pasta nenhuma, também: `GRANT CREATE` (ou `ALL`) em `SCHEMA` ou `DATABASE` para papel que não seja `bairrin_migracao`; `GRANT ... WITH GRANT OPTION`; `ALTER POLICY ... TO` para os mesmos papéis recusados no `CREATE POLICY`, que também não aceita `postgres`, `authenticator`, `pgbouncer`, `dashboard_user`, `supabase_*` nem `pg_*`; `CREATE RULE`.
- Função e tipo dão `EXECUTE` e `USAGE` a `PUBLIC` por padrão, e o primeiro `GRANT` grava isso na ACL: antes de `GRANT EXECUTE ON FUNCTION` ou `GRANT USAGE ON TYPE` para `bairrin_app`, faça `REVOKE ... FROM PUBLIC` no mesmo objeto (ou `REVOKE ... ON ALL FUNCTIONS IN SCHEMA ... FROM PUBLIC`). O verificador não vê isso no SQL; a checagem de catálogo do release (`privilegio-para-outro-papel`, em `src/compartilhado/infra/schemas-fechados.ts`) para o deploy se, em objeto de `bairrin_migracao`, sobrar privilégio para `PUBLIC` ou para outro papel que não seja `bairrin_app` ou `bairrin_migracao`. A mesma checagem reprova função `SECURITY DEFINER` sem `REVOKE ... FROM PUBLIC`, mesmo sem nenhum `GRANT` (a ACL nula dá `EXECUTE` a `PUBLIC`, S72), e relação, função ou tipo de outro dono dentro de schema do Bairrin (`dono-fora-dos-papeis`).
- Corpo `$tag$` só para código: logo depois de `DO` (ou `DO LANGUAGE <nome>`) ou de `AS` (corpo de função ou procedimento), no topo do arquivo. Texto entre `$tag$` (`SELECT $q$...$q$`, `COMMENT ... IS $q$...$q$`) e `$tag$` dentro de outro corpo são recusados: o Postgres lê esse trecho como texto, e uma aspa ou um `--` ali esconderiam o comando seguinte do verificador. Pelo mesmo motivo, texto ou comentário `/* */` não pode passar do fim do corpo (o corpo termina no primeiro delimitador igual ao que o abriu).
- SQL dinâmico: `EXECUTE` só de texto literal único (`'...'` ou `E'...'`) ou de `format('<literal>', ...)` com `%I`, `%L` e `%%` no modelo (nunca `%s`), nunca com `||` nem de variável. O texto passa pelas mesmas regras, até 4 níveis de texto dentro de texto (mais que isso reprova); tabela criada ali com nome montado (`format('%I')`) é recusada. O `EXECUTE FUNCTION` de trigger, o privilégio `GRANT EXECUTE` e uma coluna chamada `execute` fora de corpo de função não contam.

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
cli/migrar-pg-boss.ts       passo de migração do pg-boss, checagem de schemas fechados (S26) e do catálogo (S33)
cli/seed.ts                 documentos legais de rascunho para desenvolvimento e teste (recusa produção)
compartilhado/
  config/        ambiente validado com zod
  autenticacao/  porta VerificadorDeAcesso (a Identidade implementa; a guarda global a consulta)
  http/          configurarAplicacao, filtro de erros (Problem Details), pipe de validação, id da requisição,
                 limites por rota (limite-por-rota.guard.ts)
  http/autenticacao/  guarda global Autenticado, @Publico(), @Perfis(), @ExigeMfa(), @ContaAtual()
  log/           logger pino e redator de dado sensível
  saude/         /v1/saude e /v1/saude/pronto
  transacao/     porta UnidadeDeTrabalho
  tempo/         porta Relogio e relógios (sistema e fixo)
  eventos/       porta PublicadorDeEventos, relay, assinantes, tarefa de limpeza
  auditoria/     porta RepositorioDeAuditoria
  titular/       AnonimizadorDeTitular e a regra de dado pessoal
  email/         porta EnviadorDeEmail (o falso em memória fica em test/fakes/compartilhado/)
  infra/         adaptadores: PrismaService, UnidadeDeTrabalhoPrisma, PublicadorDeEventosNaOutbox,
                 RepositorioDeAuditoriaPrisma, SMTP, pg-boss, checagens de schemas fechados e do catálogo
modulos/<contexto>/{dominio,aplicacao,infra,http}
modulos/identidade/
  dominio/       Conta, Email, Telefone, Sessao, BloqueioDeLogin, CodigoDeVerificacao,
                 DesafioDeSegundoFator e as portas dos repositórios (repositorios.ts)
  aplicacao/     casos de uso, assinantes, tarefas diárias, eventos e portas de serviço
                 (hasher, cifrador, JWT, TOTP...)
  infra/         repositórios Prisma, cripto, modelos de e-mail e o VerificadorDeAcesso
  http/          controllers (contas, conta, sessões, senha, segundo fator, privacidade e a rota
                 mínima do painel `admin-conta`), cookie do painel
                 (sessao-no-http.ts), limites das rotas (limites.ts) e a lista pública de senhas
                 comuns (senha-fora-da-lista-publica.ts, dados/senhas-comuns-publicas.ts)
  identidade.module.ts, index.ts   módulo Nest e a API pública do módulo
```

Fakes dos testes de unidade, fora do build (código de produção não importa de `test/`, regra `producao-nao-importa-test`):

```
test/fakes/compartilhado/   UnidadeDeTrabalhoFalsa, PublicadorDeEventosFalso, EnviadorDeEmailFalso
test/fakes/identidade/      repositórios em memória (criarIdentidadeEmMemoria) e serviços falsos
```

### Peças do núcleo

- **Outbox.** O caso de uso grava o evento na tabela `compartilhado.outbox` na mesma transação (`PublicadorDeEventos`). O relay do worker lê em lotes com `FOR UPDATE SKIP LOCKED` e cria um job do pg-boss por assinante, com chave única evento mais assinante. Entrega pelo menos uma vez; `eventos_processados` garante o efeito no banco uma vez só. Limpeza diária: outbox publicada há mais de 30 dias e jobs há mais de 7 dias.
- **Repositórios** usam sempre `UnidadeDeTrabalhoPrisma.cliente()`, nunca o `PrismaService` direto, para participar da transação do caso de uso.
- **Auditoria.** `RepositorioDeAuditoria` só grava (a tabela é só de acréscimo, por privilégio e por trigger). `antes` e `depois` não levam dado pessoal: campo pessoal vira `{"alterado": true}`, e chaves conhecidas de dado pessoal são rejeitadas. O mesmo vale para o payload da outbox.
- **Anonimização.** Todo módulo que guarda dado pessoal implementa `AnonimizadorDeTitular` e o registra no `RegistroDeAnonimizadores`.
- **E-mail.** A porta `EnviadorDeEmail` tem o adaptador SMTP (nodemailer) e um falso em memória.
- **Erro de assinante.** O erro de um job vai para o `output` do pg-boss com mensagem e causa. Lance erro sanitizado, sem `cause`, sem dado pessoal.

### Identidade

- **Schema `identidade`.** Contas, perfis, sessões, histórico de tokens de renovação, códigos, documentos legais, consentimentos, segundo fator, freio de login e pedidos do titular. A aplicação só lê `documentos_legais` (versão nova entra por migração ou pelo `seed`) e só lê e inclui `consentimentos` e `tokens_de_renovacao_usados`. Só o expurgo de conta não verificada apaga conta: a trigger `contas_so_expurgo` recusa o resto, porque a cascata levaria junto os consentimentos.
- **Leitura com trava.** O que conta tentativas ou troca o token é lido com trava (`SELECT ... FOR UPDATE`) dentro da unidade de trabalho do caso de uso: `buscarParaAtualizar` do freio, `buscarVigenteParaAtualizar` do código, `buscarPorIdParaAtualizar` do desafio. Sem isso, duas requisições simultâneas perdem uma atualização. As regras estão no cabeçalho de `dominio/repositorios.ts`.
- **Rotação e revogação da sessão.** A rotação (`gravarRotacao`) é um UPDATE condicionado ao token antigo e à sessão não revogada (`WHERE id = $1 AND token_hash = <trocado> AND revogada_em IS NULL`) que muda só as colunas da rotação. Com 0 linhas, devolve `false`, não grava o histórico, e o caso de uso relê a sessão. A revogação (`atualizar`, `revogarDaFamilia`, `revogarDaConta`) muda só as colunas da revogação, e `atualizar` usa `coalesce`, então a primeira revogação gravada nunca volta a `NULL`. Assim, uma renovação que leu a sessão antes do logout, da redefinição de senha ou da revogação por reuso não a ressuscita, e um logout com leitura velha não rebaixa o prazo nem o par novo de uma rotação recente.
- **Reuso de token de renovação.** Todo token trocado fica em `tokens_de_renovacao_usados` até a sessão sumir. Apresentar um token antigo da família, não só o anterior imediato, revoga a família inteira. A tolerância de 60 s vale só para o anterior imediato.
- **Fakes.** `UnidadeDeTrabalhoFalsa` guarda a unidade num AsyncLocalStorage, como a real: duas unidades concorrentes são independentes, e a que falha desfaz só o que gravou. `travar` imita o `FOR UPDATE`, sem detectar deadlock, então trave sempre na mesma ordem. Os repositórios em memória imitam as restrições do banco que os casos de uso sentem.
- **Lista pública de senhas comuns.** `src/modulos/identidade/http/senha-fora-da-lista-publica.ts` aplica, além das listas escritas à mão do `@bairrin/contratos`, uma lista pública de senhas comuns. É dado de terceiros e existe só na API, que é a autoridade: painel e apps não a carregam. As rotas de cadastro e de redefinição aplicam `comSenhaForaDaListaPublica` em `criarContaSchema` (`senha`) e em `redefinirSenhaSchema` (`novaSenha`); rota nova que grave senha nova também precisa dela. Limitação do zod 4.6.7: a regra é do corpo, e o zod a pula quando outro campo tem um erro que encerra a validação (e-mail inválido, por exemplo). Nesse caso, a recusa da lista pública só aparece no envio seguinte.
- **Dado gerado.** `http/dados/senhas-comuns-publicas.ts` sai de `node scripts/gerar-senhas-comuns.mjs`, rodado à mão, e nunca é editado direto. O roteiro está no README do `@bairrin/contratos`. Fontes e licenças, com aviso no cabeçalho do arquivo: SecLists (MIT), nomes ("Fonte: IBGE") e palavras do OpenSubtitles (ODC-BY).

### Comportamento HTTP

- Erro em Problem Details (`application/problem+json`): `type`, `title`, `status`, `codigo`, `campos[{campo, codigo, motivo}]` (no máximo 20 itens; num objeto, os campos declarados vêm antes das chaves desconhecidas) e `idRequisicao`. Erro inesperado vira 500 genérico, sem pilha nem mensagem.
- `X-Request-Id` gerado sempre no servidor. `Cache-Control: no-store` por padrão. Helmet. CORS por lista de origens, com credenciais.
- Corpo JSON até 100 KB (413 acima). Limite global de 300 requisições por minuto por IP, em memória (uma instância). Rotas sensíveis têm limites próprios por IP, por conta ou por e-mail (`@LimitarRota`, valores em `modulos/identidade/http/limites.ts`), conferidos antes da validação do corpo, na ordem conta, IP e e-mail (a recusa por conta não gasta a cota do IP; um IP bloqueado não gasta o contador de nenhum e-mail); IPv6 conta pelo /64. Excesso: 429 com `Retry-After`.
- Autenticação: toda rota exige `Authorization: Bearer <token de acesso>`, menos as marcadas com `@Publico()` (guarda global `Autenticado`); em `/v1/admin`, `@Publico()` é ignorado. Só a guarda responde 401 nas rotas autenticadas. Em `/v1/admin`, a conta precisa de `admin` com segundo fator e a sessão do token é conferida a cada requisição; sem isso, 403 com log só do id da conta. Use `@Perfis('admin')` e `@ExigeMfa()` nos controllers de admin. Fora do admin, só as rotas com `@ConfereSessao()` (`GET /v1/conta` e a cópia dos dados) conferem a sessão do `sid`; as demais conferem só `contas.status`, e o token de acesso vale até vencer (15 min) mesmo depois de logout. Use `@ConfereSessao()` em rota nova que entregue dado pessoal sem pedir a senha. Exceções registradas ao "só a guarda responde 401": `sessao_invalida` na verificação de e-mail e `conta_indisponivel` na exclusão, em `GET /v1/conta` e em `GET /v1/admin/conta`.
- Painel: o token de renovação vai só no cookie `bairrin_renovacao` (`HttpOnly; Secure; SameSite=Strict`, `Path=/v1/sessoes/renovacao`). Renovação e logout pelo cookie exigem `X-Cliente: painel` e a origem do painel na lista do CORS.
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

- `/v1/docs` (OpenAPI gerado dos esquemas) e `GET /v1/app/versao-minima`.
