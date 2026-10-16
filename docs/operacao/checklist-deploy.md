# Lista de verificação de deploy

Use esta lista na primeira subida de homologação, antes do piloto e antes de cada deploy em produção. Marque cada item com a data e quem conferiu, no PR ou no registro da operação.

**Situação em 2026-10-16: nada foi publicado.** O dono decidiu que nenhum serviço pago é contratado até o app ficar pronto (`docs/produto/decisoes.md`). A lista existe para que, no dia do deploy, nada de segurança dependa de memória. Itens com a marca **(obrigatório)** vêm da revisão de segurança (`docs/produto/revisoes/2026-10-16-seguranca-planos-rodada1.md`, achados S2, S12 e S21) e bloqueiam o deploy. Itens "não verificado" nunca foram testados num ambiente real; confirme em homologação.

Os arquivos de deploy já existem: API (`apps/api/Dockerfile`, `apps/api/fly.toml`, `infra/certificados/`), painel (`apps/painel/Dockerfile`, `Caddyfile` e `fly.toml`) e CI (`.github/workflows/`). Em caso de dúvida, o arquivo vale mais que esta lista.

## 1. Contas e acesso

- [ ] **(obrigatório, S21)** MFA ligado em todas as contas de fornecedores: Fly.io, Supabase, GitHub, Expo, Apple Developer, Google Play Console, Sentry, Resend e o gateway de pagamento.
- [ ] Códigos de recuperação do MFA guardados fora do repositório e de qualquer chat.
- [ ] Pelo menos duas pessoas conseguem entrar em cada conta crítica (para o caso de uma ficar indisponível).
- [ ] Registrador do domínio `bairrin.com.br` com MFA (sugestão; não consta do plano).
- [ ] As contas foram criadas pelo dono; nenhum agente cria conta nem faz deploy.

## 2. Supabase (banco)

Vale para produção e homologação.

- [ ] Projeto na região `sa-east-1`. Produção no plano Pro (backup diário); homologação pode ficar no Free.
- [ ] **(obrigatório, S2)** Data API desligada: Dashboard, integração "Data API", desligar "Enable Data API". Com ela desligada, os endpoints REST gerados não respondem, haja o que houver em privilégios e RLS.
- [ ] **(obrigatório, S2)** `anon` e `authenticated` sem privilégio algum. Rode no SQL Editor e confira que as três consultas abaixo dão **zero linhas** (a segunda, só `false`):

  ```sql
  SELECT grantee, table_schema, table_name, privilege_type
  FROM information_schema.role_table_grants
  WHERE grantee IN ('anon', 'authenticated', 'PUBLIC')
    AND table_schema IN ('public', 'migracoes', 'compartilhado', 'identidade', 'lojistas',
                         'catalogo', 'pedidos', 'pagamentos', 'entregas', 'notificacoes',
                         'avaliacoes', 'pgboss');

  SELECT r.rolname, n.nspname, has_schema_privilege(r.rolname, n.nspname, 'USAGE') AS uso
  FROM pg_roles r CROSS JOIN pg_namespace n
  WHERE r.rolname IN ('anon', 'authenticated')
    AND n.nspname IN ('public', 'migracoes', 'compartilhado', 'identidade', 'lojistas',
                      'catalogo', 'pedidos', 'pagamentos', 'entregas', 'notificacoes',
                      'avaliacoes', 'pgboss')
    AND has_schema_privilege(r.rolname, n.nspname, 'USAGE');

  SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
  ```

  **(obrigatório, S2) Antes do primeiro deploy**, rode no SQL Editor do Supabase, que conecta como `postgres`:

  ```sql
  REVOKE ALL ON SCHEMA public FROM anon, authenticated;
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  ```

  e repita as consultas acima. O `release_command` (`node --run migrar`) confere a mesma coisa depois do pg-boss e **falha o deploy** se `anon` ou `authenticated` ainda tiverem `USAGE` ou `CREATE` em algum schema do Bairrin, inclusive por herança de `PUBLIC` (`has_schema_privilege` conta o que vem de `PUBLIC`). Por isso o segundo `REVOKE` é necessário. Os schemas conferidos não dependem de lista mantida à mão (`schemasDoBairrin`, em `apps/api/src/compartilhado/infra/schemas-fechados.ts`): o piso fixo (`public`, `compartilhado`, `migracoes` e `pgboss`), todo schema cujo dono é o papel conectado e todo schema em que `bairrin_app` tem `USAGE`, fora `pg_*` e `information_schema`. Schemas novos (`identidade` e os dos planos seguintes) entram sozinhos. A checagem roda com `DATABASE_URL_MIGRACAO` (papel `bairrin_migracao`); conectada como `postgres`, ela incluiria os schemas do Supabase e pararia o deploy. Se o release parar por um schema do Supabase em que `bairrin_app` tem `USAGE` herdado de `PUBLIC` (não verificado), revogue esse `USAGE` ou leve ao `seguranca`; não afrouxe a checagem. Nos mesmos schemas, o passo confere em seguida o catálogo real depois das migrações (S33, `problemasNoCatalogo` no mesmo arquivo) e **falha o deploy** com a lista de regra e objeto se: algum schema, relação, função ou tipo tiver `bairrin_app` como dono; `bairrin_app` tiver `CREATE` em algum schema; alguma tabela comum ou particionada estiver sem RLS (a única exceção é `migracoes._prisma_migrations`); alguma política for para `PUBLIC`, `anon`, `authenticated` ou `service_role`; alguma das triggers `auditoria_sem_update_delete` e `auditoria_sem_truncate` de `compartilhado.auditoria` faltar ou tiver `tgenabled` diferente de `O`; houver regra (`CREATE RULE`) em tabela ou view além do `_RETURN` das views; `bairrin_app` tiver privilégio `WITH GRANT OPTION` (S34) em schema, relação, coluna, função, tipo, no banco ou em privilégio padrão; ou alguma view estiver sem `security_invoker=true`. Ela pega o que o verificador de migrações não enxerga no SQL. Se parar, corrija com uma migração nova; não afrouxe a checagem sem o `seguranca`. Pode parar por objeto do próprio Supabase num schema que entrou em `schemasDoBairrin` (por exemplo, as views do `pg_stat_statements` no schema `extensions`, se `bairrin_app` tiver `USAGE` nele; não verificado): leve ao `seguranca`. Valide em homologação que revogar de `PUBLIC` não quebra nenhum recurso do Supabase em uso; se quebrar, leve ao `seguranca` antes de afrouxar a checagem. Confira que nenhum dos dois `REVOKE` responde `WARNING: no privileges could be revoked`. **Nunca** rode `REVOKE CONNECT ON DATABASE postgres FROM PUBLIC`: isso desconecta Auth, Storage e a Data API do Supabase. A migração do núcleo (`apps/api/prisma/migrations/*_nucleo`) também faz esse `REVOKE`, mas roda como `bairrin_migracao`, e no Postgres um papel só revoga o que ele mesmo concedeu: o `USAGE` em `public` foi dado pelo Supabase (não por `bairrin_migracao`), então ali o `REVOKE` da migração não tem efeito (S26). Ele só vale como segunda barreira.

- [ ] Privilégios padrão do Supabase para objetos novos em `public` revogados, como segunda barreira (guia "Securing your API" do Supabase; os comandos `ALTER DEFAULT PRIVILEGES ... REVOKE` valem só para objetos futuros). Confira com `SELECT * FROM pg_default_acl;`.
- [ ] Nada no schema `public`: a terceira consulta acima dá zero linhas. A tabela de controle do Prisma fica no schema `migracoes`.
- [ ] RLS ligado em toda tabela dos schemas do Bairrin:

  ```sql
  SELECT n.nspname, c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND NOT c.relrowsecurity
    AND n.nspname IN ('compartilhado', 'identidade', 'lojistas', 'catalogo', 'pedidos',
                      'pagamentos', 'entregas', 'notificacoes', 'avaliacoes', 'pgboss');
  ```

  Deve dar zero linhas.

- [ ] **(obrigatório, S21)** "Enforce SSL on incoming connections" ligado: Dashboard, Database, Settings, "SSL Configuration" (a mudança reinicia o banco por instantes). A opção cobre a conexão direta e o pooler.
- [ ] **(obrigatório, S21)** A API conecta com `sslmode=verify-full` e o certificado da CA do Supabase (baixado na mesma tela, "Download certificate"). O certificado público fica no repositório em `infra/certificados/supabase-ca.crt`, e a imagem o copia para `/app/certificados/supabase-ca.crt`.
  - **Hoje o arquivo é um aviso, não um certificado.** Com ele, em produção, a API e o worker não sobem e o `release_command` falha antes de migrar. Troque todo o conteúdo pelo arquivo baixado, sem mudar o nome, confira com `openssl x509 -in infra/certificados/supabase-ca.crt -noout -subject -issuer -enddate` e faça um build novo da imagem.
  - As duas URLs do banco nos segredos do Fly (`DATABASE_URL` e `DATABASE_URL_MIGRACAO`) terminam exatamente com `?sslmode=verify-full&sslrootcert=/app/certificados/supabase-ca.crt`. Em produção, outra forma é recusada.
  - Teste: uma conexão com `sslmode=disable` precisa ser recusada.
- [ ] Os dois papéis existem, com senhas geradas (`openssl rand -base64 32`), nunca as senhas locais do compose:
  - `bairrin_migracao`: dono dos schemas; só migrações e `release_command`.
  - `bairrin_app`: só DML (sem CREATE, sem posse de schema, sem `UPDATE`, `DELETE` e `TRUNCATE` nas tabelas só de acréscimo, como a auditoria).

  Modelo: `infra/postgres/init/01-papeis.sql`. No Supabase os papéis são criados à mão; se o Supabase recusar algum comando do modelo (por exemplo, trocar o dono do banco), adapte e registre. Não verificado.

- [ ] Conexão da aplicação pelo pooler (Supavisor) em modo sessão, com o papel `bairrin_app`. **Não verificado**: confirme em homologação. Se o pooler recusar o papel, não improvise: leve ao dono; a alternativa é a conexão direta com o complemento de IPv4 do Supabase (custo a confirmar).
- [ ] Se o Fly tiver IP de saída fixo, restringir a rede do banco a ele (não verificado que o Fly o oferece nesta configuração).
- [ ] Latência p95 medida em homologação contra o critério de desempenho do brief (CA-39).

## 3. Fly.io (API e worker)

- [ ] Região `gru`. Dois processos, `app` (HTTP) e `worker`, a partir da mesma imagem (ver `apps/api/fly.toml`).
- [ ] Imagem sem `.env`, executando como usuário não root (ver `apps/api/Dockerfile`).
- [ ] Segredos só em `fly secrets set -c apps/api/fly.toml` (nunca no repositório, no `fly.toml` nem em chat): `DATABASE_URL`, `DATABASE_URL_MIGRACAO`, `JWT_SEGREDO`, `CHAVE_CIFRAGEM_DADOS`, `CHAVE_HMAC`, `SMTP_URL` e, se houver, `SENTRY_DSN`. O resto não é segredo e já está no `[env]` do `apps/api/fly.toml`: `NODE_ENV=production`, `PORTA`, `LOG_NIVEL`, `CORS_ORIGENS` e `EMAIL_REMETENTE`. A lista vale como está no cabeçalho do `fly.toml`.
- [ ] As três chaves (`JWT_SEGREDO`, `CHAVE_CIFRAGEM_DADOS`, `CHAVE_HMAC`) são geradas com `openssl rand -base64 32`, diferentes entre si e diferentes das de homologação. A API recusa na subida chave com menos de 32 bytes, chaves repetidas e valores que começam com `EXEMPLO`.
- [ ] `CORS_ORIGENS` contém só `https://painel.bairrin.com.br`. Em produção a API recusa origem sem `https://`.
- [ ] **(obrigatório, S3)** `DATABASE_URL_MIGRACAO` existe só para o `release_command`: o processo `app` e o processo `worker` não podem enxergá-la. Como o `fly.toml` garante isso está no próprio arquivo. Confira numa máquina em execução que a variável não existe (verifique a ausência, sem imprimir o valor).
- [ ] `release_command` (`node --run migrar`, o script `migrar` de `apps/api/package.json`) roda, nesta ordem, com o papel de migração: `prisma migrate deploy` e depois `node dist/cli/migrar-pg-boss.js`. Se falhar, o deploy para e a versão anterior continua. A aplicação sobe com o pg-boss sem migrar (`migrate: false`) e falha se o schema `pgboss` estiver na versão errada.
- [ ] `trust proxy` de 2 saltos em produção (`SALTOS_DE_PROXY_NO_FLY`). **Não verificado num Fly real**: mande uma requisição com o cabeçalho `X-Forwarded-For: 1.2.3.4` e confirme que o IP usado pelo limite de requisições é o do cliente de verdade, não o que ele enviou.
- [ ] Deploy a partir da **raiz** do repositório (o contexto do build é a raiz): `fly deploy -c apps/api/fly.toml`.
- [ ] **(S32)** Uma instância da API: o limite de requisições (300 por minuto por IP) está em memória. No primeiro deploy o Fly cria máquinas de reserva por padrão; use `fly deploy -c apps/api/fly.toml --ha=false`. Se já houver mais de uma, reduza com `fly scale count 1 --process-group app -c apps/api/fly.toml` e confira com `fly status -c apps/api/fly.toml`. Para escalar, troque o limite por armazenamento compartilhado antes.
- [ ] A verificação de saúde do Fly aponta só para `GET /v1/saude` (vivo, sem consultar o banco), de propósito: uma queda do banco não faz o Fly reciclar a máquina. `GET /v1/saude/pronto` (banco) fica para o teste de fumaça (item 13) e o monitor de uptime.

## 4. GitHub e cadeia de suprimentos

- [ ] **(obrigatório, S12)** `pnpm audit --prod --audit-level=high` bloqueante no CI e verde. Em 2026-10-16 ele falha por transitivas do Prisma 7.10.0; a correção está no 7.10.1, elegível pelo `minimumReleaseAge` em 2026-10-18.
- [ ] Workflows com `permissions: contents: read` e actions fixadas por SHA (ver `.github/workflows/`).
- [ ] Pull request de fork roda sem acesso a segredos.
- [ ] Segredos do CI só em GitHub secrets.
- [ ] Dependabot ativo (`.github/dependabot.yml`).
- [ ] `pnpm install --frozen-lockfile` sem alteração no lockfile. `saveExact`, `minimumReleaseAge` e `allowBuilds` continuam no `pnpm-workspace.yaml`.

## 5. Migrações no deploy

- [ ] `pnpm migracoes:verificar` verde.
- [ ] O SQL da migração foi lido por uma segunda pessoa, e a nota `-- reversao:` do topo está correta.
- [ ] Migração com `_destrutiva`: backup feito antes do deploy, e o bloco de guarda confirmado.
- [ ] Ordem do deploy: backup, `prisma migrate deploy`, passo do pg-boss, processos novos.
- [ ] Em caso de erro, a reversão é a da nota; em último caso, a restauração do backup diário.

## 6. Homologação

- [ ] **(obrigatório, S21)** Só dados sintéticos. Nunca restaure um backup de produção em homologação, nem copie dados reais para testar.
- [ ] Gateway no sandbox e contas de teste; nenhuma chave de produção.
- [ ] Os seeds recusam `NODE_ENV=production` (a exceção é o `seed:admin`, por CLI). Futuro, plano 01b.
- [ ] Chaves e senhas diferentes das de produção.
- [ ] Restauração de backup testada aqui antes do piloto (item 7).

## 7. Backups

- [ ] Backup diário do Supabase (plano Pro) ligado, com retenção de 7 dias. O prazo consta da política de privacidade (ADR-015).
- [ ] **(obrigatório, S21)** Cópia lógica cifrada **semanal**, guardada fora do Supabase e fora do Fly. Hoje não existe rotina no repositório; escreva e registre qual (ferramenta de cifragem, onde fica a chave, onde fica a cópia). Sugestão: `pg_dump` com um papel só de leitura e cifragem antes de sair da máquina.
- [ ] A chave que decifra a cópia não está no mesmo lugar que a cópia.
- [ ] Prazo de retenção da cópia lógica decidido e declarado na política de privacidade (em aberto: o plano fala em 7 dias para os backups).
- [ ] **(obrigatório, S21)** Decisão sobre o PITR registrada em `docs/produto/decisoes.md`. Hoje: adiado, por decisão do dono (P2 do plano 00). Custa cerca de US$ 100 por mês no Supabase. A recomendação do `seguranca` é ligar **antes do primeiro pagamento real**. Sem PITR, a perda de dados pode chegar a cerca de 24 horas.
- [ ] Restauração testada em homologação antes do piloto e a cada trimestre; o resultado e o tempo gastos registrados.

## 8. Apps Expo (consumidor e lojista)

Os apps ainda não existem; esta seção vale quando existirem.

- [ ] Identificadores definitivos: "Bairrin", `br.com.bairrin.consumidor`, scheme `bairrin`; "Bairrin Lojista", `br.com.bairrin.lojista`, scheme `bairrin-lojista`. Não mudam depois de publicados.
- [ ] `EXPO_PUBLIC_API_URL` aponta para `https://api.bairrin.com.br`. Nenhuma variável `EXPO_PUBLIC_*` leva segredo.
- [ ] **(obrigatório, S12)** Assinatura de código do EAS Update ligada nos dois apps:
  1. Gere o par de chaves e o certificado: `npx expo-updates codesigning:generate --key-output-directory ../keys --certificate-output-directory certs --certificate-validity-duration-years 10 --certificate-common-name "Bairrin"`.
  2. Configure o app: `npx expo-updates codesigning:configure --certificate-input-directory certs --key-input-directory ../keys`. Isso preenche `updates.codeSigningCertificate` e `updates.codeSigningMetadata` na configuração do app.
  3. Faça um build novo, com nova versão de runtime, para o certificado entrar no app.
  4. Publique sempre assim: `eas update --private-key-path ../keys/private-key.pem`.

  A chave privada nunca entra no repositório (o `.gitignore` bloqueia `*.pem`) e fica guardada em cofre da equipe. O certificado público pode ser versionado. **Custo:** pela documentação do Expo, a assinatura de código exige plano pago do EAS (Production ou Enterprise); o custo mensal do plano 00 contava com o EAS Free. Confirme o plano na página de preços antes de contratar.

- [ ] Contas das lojas com MFA. A conta Apple para empresas exige número D-U-N-S, que depende do CNPJ (pendência do dono).
- [ ] Deep links (`https://bairrin.com.br`) com `/.well-known/*` servido pela API (plano 03; futuro).

## 9. Painel (`painel.bairrin.com.br`)

Arquivos: `apps/painel/Dockerfile`, `apps/painel/Caddyfile` e `apps/painel/fly.toml`. Detalhes em `apps/painel/README.md`.

- [ ] Deploy a partir da **raiz** do repositório (o contexto do build é a raiz): `fly deploy -c apps/painel/fly.toml`.
- [ ] Depois do registro de `bairrin.com.br`: `fly certs add painel.bairrin.com.br -c apps/painel/fly.toml`, com o DNS apontado como o Fly indicar.
- [ ] A URL da API está fixa em dois lugares, que precisam mudar juntos: `VITE_API_URL=https://api.bairrin.com.br` no `apps/painel/Dockerfile` e o `connect-src` da CSP no `apps/painel/Caddyfile`. Um painel de homologação precisa trocar os dois, ou não fala com a API (o navegador bloqueia). O valor é público, sem segredo.
- [ ] HTTPS com HSTS. Teste: `curl -sI https://painel.bairrin.com.br | grep -i strict-transport-security`.
- [ ] HSTS hoje sai **sem `preload`**, porque a lista de preload só aceita o domínio raiz, é difícil de reverter e o domínio ainda não está registrado. Decidir `preload` no registro de `bairrin.com.br`.
- [ ] CSP sem `unsafe-inline`, com `frame-ancestors 'none'` e `connect-src` só para `https://api.bairrin.com.br`. Teste: `curl -sI https://painel.bairrin.com.br | grep -i content-security-policy`.
- [ ] Se o Sentry for ligado no painel, acrescente a origem de ingest do Sentry ao `connect-src` do `Caddyfile`; sem isso o navegador bloqueia o envio.
- [ ] Painel e API no mesmo site (`painel.` e `api.` de `bairrin.com.br`), para o cookie `SameSite=Strict` funcionar (plano 01b). A API precisa listar `https://painel.bairrin.com.br` em `CORS_ORIGENS`.

## 10. E-mail

- [ ] Resend com o domínio verificado. SPF, DKIM e DMARC de `bairrin.com.br` publicados.
- [ ] `SMTP_URL` e `EMAIL_REMETENTE` (em `bairrin.com.br`) nos segredos do Fly. O SMTP do Resend não foi verificado.
- [ ] Em dev e testes o e-mail vai ao Mailpit; confirme que nada de produção aponta para `127.0.0.1:1025`.

## 11. Observabilidade

- [ ] `SENTRY_DSN` nos segredos do Fly; vazio desliga o Sentry. No SDK 11 não existe mais `sendDefaultPii`: a API desliga cada categoria de `dataCollection` (usuário e IP, cookies, cabeçalhos, corpos, query, dados de banco, variáveis locais), sem Replay, e redige o evento com o redator do log (ver `apps/api/src/compartilhado/observabilidade/sentry.ts`).
- [ ] **(S31)** No projeto do Sentry, em Settings, "Security & Privacy": ligar "Prevent Storing of IP Addresses", "Data Scrubber" e "Use Default Scrubbers". É a barreira do lado do servidor, caso algo escape do SDK. Os nomes das opções vêm da revisão de segurança e não foram conferidos na tela; se mudarem, procure as equivalentes na mesma seção.
- [ ] Monitor de uptime externo apontando para `GET /v1/saude`.
- [ ] Leia os logs de uma sessão real de homologação e confirme que não há nome, telefone, e-mail, documento, token, senha nem corpo de requisição.

## 12. Antes do primeiro pagamento real

- [ ] Portão do plano 05 (ADR-006) fechado: webhook, tokenização e PCI, split, chaves por ambiente e teste de redação.
- [ ] CNPJ aberto e contas de produção do gateway e das lojas.
- [ ] PITR decidido (item 7).
- [ ] Política de privacidade, tabela de operadores de dado pessoal (ADR-015) e retenções revisadas por um advogado.

## 13. Depois do deploy (fumaça)

- [ ] `curl -s https://api.bairrin.com.br/v1/saude` responde `{"status":"ok"}`, sem `versao` (ela só aparece fora de produção).
- [ ] `curl -s https://api.bairrin.com.br/v1/saude/pronto` responde 200.
- [ ] Um corpo com campo desconhecido dá 400 em `application/problem+json`, com `idRequisicao` e sem pilha.
- [ ] A resposta traz `X-Request-Id` e `Cache-Control: no-store`.
- [ ] O worker está em execução, o relay não registra erro e a tarefa diária de limpeza está agendada (03h15, horário de Brasília).
- [ ] A conta `bairrin_app` não consegue `UPDATE`, `DELETE` nem `TRUNCATE` na auditoria (o teste automatizado equivalente está em `apps/api/test/integracao/migracoes.int.test.ts`).
