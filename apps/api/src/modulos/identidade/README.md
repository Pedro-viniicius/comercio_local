# Módulo Identidade

Contas, perfis, sessão, segundo fator do administrador, recuperação de senha e privacidade (exportação e exclusão) do Bairrin. Plano: `docs/produto/planos/01b-identidade.md`. Decisões de sessão e de cripto: `docs/adr/0012-sessao-e-autenticacao.md`; dado pessoal e anonimização: ADR-015. Este README descreve o comportamento do código; quando o código mudar, mude os dois.

A conta é única por e-mail e tem perfis (`consumidor`, `lojista`, `admin`). O mesmo login vale nos dois apps. O painel só abre para quem tem `admin` e passou pelo segundo fator. Nenhuma rota concede `admin`.

## Camadas e pastas

```
dominio/     Conta, Email, Telefone, Sessao, BloqueioDeLogin, CodigoDeVerificacao,
             DesafioDeSegundoFator e as portas dos repositórios (repositorios.ts)
aplicacao/   casos de uso (cadastro/, sessao/, segundo-fator/, privacidade/), assinantes de
             eventos, tarefas diárias, eventos.ts e portas de serviço (portas/)
infra/       repositórios Prisma, cripto (Argon2, AES-GCM, JWT, TOTP), modelos de e-mail
             e o VerificadorDeAcesso
http/        controllers, cookie do painel (sessao-no-http.ts), limites (limites.ts) e a
             lista pública de senhas comuns
identidade.module.ts, index.ts   módulo Nest e a API pública do módulo
```

- Só `index.ts` pode ser importado por outro módulo (`pnpm deps:verificar`). Ele exporta o módulo, as tarefas agendadas e o `RegistroDePendencias`.
- Domínio e aplicação não importam `infra/` nem `http/`. As travas do banco, os fakes dos testes e a ordem de leitura estão no cabeçalho de `dominio/repositorios.ts`.
- O mesmo módulo sobe na API, no worker e nas CLIs. O worker consome as filas dos assinantes e agenda as tarefas; a API não.

## Rotas

`Autenticado` é guarda global: toda rota exige `Authorization: Bearer <token de acesso>`, menos as marcadas com `@Publico()`. Na coluna "Acesso", "sessão conferida" quer dizer que a guarda confere também a sessão do `sid` (`@ConfereSessao()`, ver Autorização). Rota sem corpo, inclusive `GET`, valida `corpoVazioSchema`: corpo que não seja `{}` dá 400 (CA-13). Toda resposta sai com `Cache-Control: no-store`. Corpo com campo desconhecido ou inválido dá 400 (CA-13).

| Método e caminho                           | Acesso                            | Resposta                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/contas`                          | público                           | 202 com mensagem fixa, exista ou não conta com o e-mail (CA-01, CA-02) · 400 se uma versão de termos ou política não é a vigente (`campos[aceites.<tipo>].invalido`, S24) · 429 com `Retry-After` (limite da rota)                                                                                |
| `POST /v1/conta/verificacao-email`         | sessão                            | 200 com a sessão nova (`emailVerificado: true`) · 400 `campos[codigo].invalido` · 401 `sessao_invalida` (exceção, abaixo) · 429 com `Retry-After` (freio por e-mail)                                                                                                                              |
| `POST /v1/conta/verificacao-email/reenvio` | sessão                            | 202, a mesma resposta com o e-mail verificado ou não · 429 com `Retry-After` (limites da rota)                                                                                                                                                                                                    |
| `POST /v1/sessoes`                         | público                           | 200 com a sessão (apps) ou `{ etapa, desafio }` (painel) · 403 `sem_acesso_painel` · 401 mensagem única · 429 com `Retry-After`                                                                                                                                                                   |
| `POST /v1/sessoes/renovacao`               | público                           | 200 com a sessão · 401 (credencial inválida, vencida, revogada ou reusada; nunca 5xx) · 403 com `X-Cliente: painel` fora da origem do painel                                                                                                                                                      |
| `DELETE /v1/sessoes/renovacao`             | público                           | 204 com `X-Cliente: painel` e a origem do painel (sem cookie ou com cookie desconhecido também); apaga o cookie · 403 sem `X-Cliente: painel` ou fora da origem, sem revogar (S80)                                                                                                                |
| `DELETE /v1/sessoes/atual`                 | sessão                            | 204, também se a sessão já estava revogada (CA-05)                                                                                                                                                                                                                                                |
| `POST /v1/senha/recuperacao`               | público                           | 202, a mesma resposta exista ou não a conta (CA-06) · 429 com `Retry-After` (limites da rota)                                                                                                                                                                                                     |
| `POST /v1/senha/redefinicao`               | público                           | 204 · 400 `campos[codigo].invalido` · 429 com `Retry-After`                                                                                                                                                                                                                                       |
| `POST /v1/segundo-fator/configuracao`      | desafio                           | 200 `{ otpauthUri, segredoBase32 }` · 401                                                                                                                                                                                                                                                         |
| `POST /v1/segundo-fator/confirmacao`       | desafio                           | 200 `{ codigosRecuperacao[10], sessao }` · 400 · 401 · 429                                                                                                                                                                                                                                        |
| `POST /v1/sessoes/segundo-fator`           | desafio                           | 200 com a sessão · 400 `campos[codigo ou codigoRecuperacao].invalido` · 401 · 429                                                                                                                                                                                                                 |
| `GET /v1/conta`                            | sessão conferida                  | 200 `{ nome, emailMascarado, perfis }` · 401 `conta_indisponivel` (exceção, abaixo)                                                                                                                                                                                                               |
| `GET /v1/privacidade`                      | sessão                            | 200 `{ politica { versao, conteudo }, termos { versao }, aceitoEm, exportacaoDisponivelAte }` (CA-10)                                                                                                                                                                                             |
| `POST /v1/privacidade/exportacao`          | sessão conferida                  | 202 (um pedido por 24 h) · 429 com `Retry-After` até poder pedir de novo                                                                                                                                                                                                                          |
| `GET /v1/privacidade/exportacao/arquivo`   | sessão conferida                  | 200 `application/json` com `Content-Disposition: attachment; filename="bairrin-meus-dados.json"` (uma vez só, até 7 dias) · 404 se não há cópia, venceu ou já foi baixada · `HEAD` → 405 `metodo_nao_permitido` com `Allow: GET`, sem gastar o uso único (Q31)                                    |
| `POST /v1/privacidade/exclusao`            | sessão (pede a senha)             | 202 · 400 `campos[senha].invalido` (senha errada) · 403 `exclusao_de_admin_so_pelo_painel` (conta `admin` fora da sessão do painel com `mfa`, S113) · 409 `exclusao_com_pendencias` (o corpo não traz a lista de pendências) · 429 com `Retry-After` · 401 `conta_indisponivel` (exceção, abaixo) |
| `GET /v1/admin/conta`                      | `admin` e `mfa`, sessão conferida | 200 `{ nome, emailMascarado, perfis }`; rota mínima do painel (CA-08) · 403 sem `admin` ou sem `mfa`, com log só do id · 401 `conta_indisponivel` (exceção, abaixo)                                                                                                                               |

"Desafio" é o token que `POST /v1/sessoes` devolve ao painel depois da senha certa de um admin: as três rotas são públicas, porque não levam Bearer. O contrato de cada corpo está em `packages/contratos/src/identidade/`.

### Erros

- **400 `validacao`**: `campos[{ campo, codigo, motivo }]`, com no máximo 20 itens (Q30: o zod dá um item por chave desconhecida, e um corpo de 100 KB cheio de chaves viraria uma resposta enorme; o corte mantém os primeiros, que são os campos declarados). O `codigo` é `obrigatorio`, `invalido`, `comum` (senha da lista) ou `desconhecido`; o texto para o usuário vem do app e do painel, e o `motivo` em português fica de reserva (CA-13).
- **401 só da guarda** (token de acesso ausente, inválido, vencido, sessão ou conta revogada): nas rotas autenticadas nenhum caso de uso devolve 401, porque o `cliente-api` renova e repete todo 401. Erro que se corrige na mesma tela é 400 (senha errada na exclusão, código errado na verificação de e-mail); falta de perfil ou de `mfa` é 403; freio e limite são 429. **Exceções registradas**, quando a sessão ou a conta acabou entre a guarda e o caso de uso: `sessao_invalida` (verificação de e-mail) e `conta_indisponivel` (exclusão da conta, `GET /v1/conta` e `GET /v1/admin/conta`). Nenhuma outra rota autenticada devolve 401 por regra de negócio. As rotas públicas do 2FA, do login e da renovação têm o 401 próprio de cada uma.
- **403**: `sem_acesso_painel` (senha certa no painel sem `admin`, sem sessão nem cookie; log só com o id da conta, S23), `sem_permissao` (sem perfil ou sem `mfa`, log só com o id, CA-08) e `exclusao_de_admin_so_pelo_painel` (exclusão da conta `admin` fora da sessão do painel com `mfa`, S113; o `title` orienta a usar o painel). A renovação e o logout do painel também dão 403 fora da origem do painel (CSRF).
- **429 `limite_excedido`**, em toda rota, com `Retry-After` em segundos, vindo do freio ou dos limites por rota (CA-04).

## Autorização

- `@Publico()` abre a rota (a saúde inclusive); esquecer o decorador fecha a rota, nunca a abre (S7).
- `/v1/admin`: a guarda exige `admin` e `mfa` e confere a sessão do `sid` a cada requisição (logout e redefinição valem na hora), mesmo que o controller esqueça `@Perfis('admin')` e `@ExigeMfa()`. O prefixo vem dos metadados do controller e da rota que o Express casou (`baseUrl` mais o caminho da rota), nunca da URL pedida, porque o Express casa sem diferenciar maiúsculas. **`@Publico()` não abre `/v1/admin`** (S110): o token é exigido do mesmo jeito.
- **Conferência da sessão (S8):** em `/v1/admin` a guarda confere a cada requisição a sessão do `sid` (da mesma conta, não revogada, dentro do prazo). Fora dele, só as rotas com `@ConfereSessao()` fazem o mesmo, sem exigir `admin`: `GET /v1/conta`, `POST /v1/privacidade/exportacao` e `GET /v1/privacidade/exportacao/arquivo`, que entregam ou movem dado pessoal sem pedir a senha. Com a sessão revogada (logout, redefinição, reconfiguração do 2FA) ou vencida, essas rotas dão 401 na hora. **Ficam de fora**: `GET /v1/privacidade` (só versões e datas), a exclusão (pede a senha) e o reenvio da verificação. Nas demais rotas a guarda confere só `contas.status` (desativada, anonimizada ou apagada perde o acesso na hora), então o token de acesso (15 min) segue valendo depois de logout ou redefinição. Rota nova que entrega dado pessoal sem senha deve usar `@ConfereSessao()`.
- `GET /v1/conta` e `GET /v1/admin/conta` leem nome, e-mail mascarado e perfis da conta no banco, menos `admin` quando a sessão não o traz (um `lojista` concedido depois do login já aparece). A conta precisa estar ativa; se sair de `ativa` entre a guarda e o caso de uso, 401 `conta_indisponivel`. Nunca devolvem o e-mail inteiro nem o telefone.
- Os perfis que a guarda entrega são os do token que a conta ainda tem. `admin` só vem de sessão do painel com segundo fator; a conta admin nos apps entra sem poderes de admin.

## Fluxos

### Cadastro e verificação do e-mail

1. `POST /v1/contas` valida o corpo; a senha passa também pela lista pública de senhas comuns, no pipe, antes de olhar o e-mail (S74). Depois confere as versões aceitas de termos e política contra as vigentes (S24).
2. O Argon2 da senha roda nos dois caminhos (e-mail novo ou em uso), fora de transação, para o tempo não separar um do outro (CA-02).
3. E-mail novo: conta com perfil `consumidor`, e-mail não verificado, consentimentos dos dois documentos e o evento `ContaCriada`. O código de 6 dígitos nasce no assinante, no envio, e o banco guarda só o HMAC.
4. E-mail que já tem conta, verificada ou não: nada muda, a resposta é a mesma e sai `CadastroRepetidoTentado` (aviso ao dono, 1 por hora por e-mail).
5. O app entra sozinho com o e-mail e a senha digitados. O login vale sem e-mail verificado (P1-dono); a sessão leva `emailVerificado`, que serve só à interface. O que exige verificação é conferido no servidor pelo plano de pedidos.
6. `POST /v1/conta/verificacao-email` vale só para a conta da sessão (o HMAC do código inclui a conta). Código errado, vencido, usado ou esgotado: sempre 400, inclusive na quinta tentativa. Cada código que não serve soma uma falha no freio por e-mail da conta (S93); com o freio ativo, 429 sem conferir o código. Código certo: e-mail verificado e sessão trocada por uma nova da mesma família (a antiga recebe `substituida`), sem `mfa`; no painel a nova herda o teto de 12 h (S101). Sessão revogada, vencida ou de outra conta: `sessao_invalida`, sem gastar tentativa.
7. `POST .../reenvio` responde 202 do mesmo jeito para conta verificada ou não (o 429 vem só dos limites de requisições) e só publica `VerificacaoReenviada` para conta ativa e ainda não verificada. Os limites são da rota (3 por hora por conta, 10 por hora por IP).
8. Conta não verificada e sem login nem renovação há mais de 7 dias é apagada pela tarefa diária (abaixo), com as sessões dela. Admin e lojista ficam fora.

Ordem das travas na verificação: freio por e-mail, código, conta (`gravarEmailVerificado`), sessões da família. Se uma exclusão ou um logout aconteceu no meio, um dos UPDATEs não muda nada e tudo é desfeito, inclusive o uso do código.

### Login

`POST /v1/sessoes` tem três passos, e a senha é conferida entre duas transações curtas (reserva da tentativa, S91):

1. **Reserva:** trava o freio por e-mail e o de origem (nessa ordem) e lê a conta. Freio ativo devolve `freado` sem conferir a senha. Senão, já conta uma falha nos dois freios. O e-mail sem conta também tem freio (S14). Sem IP válido, a origem é a chave fixa `origem:desconhecida` (falha fechada: todos esses pedidos dividem um freio só).
2. **Senha, fora de transação:** conta inexistente, fora de `ativa` ou sem senha (admin antes da primeira redefinição) gasta o mesmo tempo contra um hash fictício. A resposta é 401 com mensagem única para todos os motivos (CA-04).
3. **Conclusão, noutra transação:** trava os freios na mesma ordem e relê a conta; se ela saiu de `ativa` ou trocou de senha no meio, a senha conferida era a de antes (401, a falha reservada fica). Senão zera o freio por e-mail e devolve a falha reservada ao freio de origem. Então: painel sem `admin` → 403 `sem_acesso_painel`; painel com `admin` → desafio do 2FA, sem sessão nem login gravado; apps → grava `ultimo_login_em` e abre uma sessão de família nova.

O custo desta reserva está aceito (A-R12): com a 50ª falha da origem, ou muitos logins simultâneos atrás do mesmo CGNAT, o IP fica freado por 1 minuto para novos logins; quem tem a senha certa entra depois.

### Renovação e logout

- O token é procurado pelo HMAC na sessão (atual ou anterior imediato) e, se não estiver lá, no histórico da família (S77). Token atual, sessão válida e mesmo `cliente` → rotação (token novo, par novo cifrado por 60 s, prazo deslizante: apps 30 dias; painel 30 min até o teto de 12 h; `mfa` herdado). Token anterior imediato, dentro de 60 s e do mesmo `cliente` → devolve o par já emitido (tolerância de rede instável, S16). Token anterior fora da tolerância, ou qualquer token do histórico → reuso: revoga a família inteira. O resto (desconhecido, revogado, vencido, `cliente` trocado, conta fora de `ativa`) → 401 sem revogar nada.
- O `cliente` comparado é o da requisição: `painel` pelo cookie com `X-Cliente: painel`, ou o `cliente` do corpo nos apps. A checagem separa o canal (cookie ou corpo); entre os dois apps só recusa engano, porque quem roubou o token pode mandar o outro valor.
- **A renovação grava `ultimo_login_em`** (só em conta ativa, antes da rotação): para o expurgo de 7 dias, "último login" é "login ou renovação". Se a renovação termina recusada, a transação é desfeita para não gravar o login dela, e o reuso revoga a família numa transação nova.
- Ordem das travas na rotação: conta, depois sessões. `gravarRotacao` é um UPDATE condicionado ao token antigo e à sessão não revogada; com 0 linhas, o caso de uso relê e avalia de novo uma vez (tolerância, reuso ou inválida).
- **Logout:** nos apps, `DELETE /v1/sessoes/atual` revoga a sessão do `sid` (`logout`). No painel, `DELETE /v1/sessoes/renovacao` pelo cookie (o painel não guarda o token de acesso depois de recarregar), só com `X-Cliente: painel` e a origem do painel; revoga antes de responder 204 e apaga o cookie. É idempotente: sessão já revogada fica com a primeira data e motivo, e `sid` de outra conta ou token desconhecido não fazem nada. **Um token antigo achado só no histórico** revoga o que ainda vive da família: quem pede para sair com um cookie velho sai do mesmo jeito.

### Cookie do painel

`bairrin_renovacao`, `HttpOnly; Secure; SameSite=Strict; Path=/v1/sessoes/renovacao`, `Max-Age` de 12 horas. O token de renovação do painel nunca vai no corpo, e o de acesso fica só em memória no painel. Renovação e logout pelo cookie exigem `X-Cliente: painel` e `Origin` na lista do CORS (`CORS_ORIGENS`): senão, 403 sem revogar nada, e o 403 do logout mantém a marca de logout pendente no cliente (`packages/cliente-api`, `apps/painel`). O `cookie-parser` roda sem segredo: o valor já é o token opaco, conferido pelo HMAC no banco. A pré-verificação de CORS do painel aceita `POST` e `DELETE` com `X-Cliente` e credenciais.

### Recuperação e redefinição de senha

1. `POST /v1/senha/recuperacao` responde 202 do mesmo jeito, exista ou não a conta (o 429 vem só dos limites de requisições, abaixo). Só conta ativa gera `RecuperacaoSolicitada`, inclusive o admin criado pela CLI sem senha, que define a primeira senha por aqui. O assinante invalida os códigos de recuperação vigentes da conta, gera o novo no envio (30 min, uso único, 5 tentativas) e o manda para `contas.email_normalizado`, lido pelo id do evento.
2. `POST /v1/senha/redefinicao`: o hash da senha nova é calculado antes de tudo, em todos os caminhos, fora de transação. Depois, numa transação, na ordem das travas: freio por e-mail e freio de origem (qualquer um ativo → 429 sem conferir o código), conta lida só depois do freio travado, código de recuperação vigente travado. Código errado, vencido, usado, esgotado (ou e-mail sem conta, ou conta fora de `ativa`) soma uma falha nos dois freios e dá 400 sem distinguir o motivo; a tentativa errada fica gravada.
3. Código certo: zera o freio por e-mail (o de origem nunca zera por sucesso), **apaga os desafios do 2FA da conta** (S94: quem tinha a senha antiga não conclui o segundo fator; Q29: o teto diário de erros recomeça), grava o hash novo e o e-mail verificado (`gravarSenhaRedefinida`, só essas colunas e só em conta ativa), revoga todas as sessões da conta (`senha_redefinida`), inclusive as de quem criou a conta antes com o e-mail de outra pessoa, e publica `SenhaRedefinida`. Se a conta saiu de `ativa` no meio, tudo é desfeito e a resposta é 400.
4. Não emite sessão: a pessoa entra de novo com a senha nova, nunca com `admin` nem `mfa` vindos daqui. Não existe "alterar senha": cadastro e redefinição são as únicas rotas que gravam senha, e as duas usam `comSenhaForaDaListaPublica` (rota nova com senha nova deve fazer o mesmo).

### Segundo fator do administrador (CA-09)

1. No painel, `POST /v1/sessoes` com a senha certa de uma conta com `admin` devolve `{ etapa, desafio }` sem sessão: `configurar` se o segundo fator ainda não foi confirmado, `verificar` se foi. O desafio vale 5 minutos, uso único e 5 tentativas; emitir um novo invalida os vigentes da conta.
2. **Configurar** (sem 2FA, tudo antes de qualquer outra coisa): `.../configuracao` devolve `otpauthUri` e `segredoBase32` (o QR é gerado no navegador; o rótulo leva só o e-mail mascarado) e troca o segredo ainda não confirmado a cada chamada. `.../confirmacao` com o primeiro código confirma o segundo fator, entrega os 10 códigos de recuperação (só uma vez; o banco guarda HMAC) e abre a sessão com `mfa`.
3. **Verificar**: `.../sessoes/segundo-fator` aceita exatamente um de `codigo` (TOTP) ou `codigoRecuperacao` e abre a sessão com `mfa`. O código de recuperação é de uso único.
4. Respostas, na ordem, nas rotas com código: (1) desafio inexistente, vencido, usado, de outra etapa ou esgotado, ou conta que não pode mais concluir → 401 com o mesmo corpo para todos os motivos; (2) freio de segundo fator ativo → 429 com `Retry-After`, sem gastar tentativa; (3) código errado → soma uma falha no desafio e no freio: 400 `campos[codigo ou codigoRecuperacao].invalido` se ainda sobra tentativa, 401 na quinta (o desafio morre). A `configuracao` só tem o passo (1). No painel, 400 fica na tela, e 401 e 429 voltam ao login.
5. **O login termina aqui:** ao concluir o 2FA o caso de uso grava `ultimo_login_em` (só em conta ativa) e abre a sessão do painel com `mfa` (família nova). Conta desativada no meio desfaz tudo (inclusive o uso do código) e dá 401, sem sessão.
6. **Freio e teto:** 5 falhas de 2FA em 15 minutos levam a esperas de 1, 5 e 15 minutos, e só um 2FA concluído zera o freio. Quando ele entra numa espera, sai `SegundoFatorFreado` (e-mail de aviso ao dono). Se for acionado de novo já no nível máximo, ou se os erros de 2FA da conta nas últimas 24 h passarem de 20 (S103), a senha da conta é apagada, todas as sessões são revogadas (`segundo_fator_freado`), a auditoria registra e o aviso manda recuperar a senha (P16, S104). Toda tentativa trava antes o freio por e-mail da conta, para serializar com o login.
7. **CLI de reconfiguração** (`pnpm --filter api reconfigurar-segundo-fator --operador <id da sua conta admin> [--conta <id>]`; sem `--conta`, o e-mail vem da entrada padrão, nunca de argumento): para o admin que perdeu o celular e os códigos de recuperação. Na mesma transação: invalida os desafios, apaga o segundo fator e os códigos de recuperação, **apaga a senha** (S97: sem isso, quem tivesse só a senha configuraria o 2FA dele), revoga todas as sessões (`segundo_fator_reconfigurado`), publica `RecuperacaoSolicitada` e grava a auditoria com o operador como ator (só ids). Em produção roda na máquina da API (`fly ssh console`), com o ambiente dela: `node --env-file-if-exists=.env dist/cli/reconfigurar-segundo-fator.js --operador <id>`. A saída cita só o id e contagens.
8. **`seed:admin`** (`pnpm --filter api seed:admin`) é o único caminho que cria um admin. A conta nasce sem senha, com os perfis `consumidor` e `admin`, e o código de definir a senha vai por e-mail (`RecuperacaoSolicitada`). Os dados vêm da entrada padrão (S99, S108); depois do primeiro admin, `--operador` é obrigatório (S106).

### Exclusão e anonimização (CA-11)

1. **Conta `admin` só pelo painel** (S113, decisão do dono de 2026-10-23): conta com perfil `admin` só pede a própria exclusão numa sessão com `admin` e `mfa` (a do painel depois do 2FA). De qualquer outra sessão (o app, que não pede o segundo fator), 403 `exclusao_de_admin_so_pelo_painel`, antes de conferir a senha e sem tocar no freio por e-mail. Assim quem tem só a senha do admin não exclui a conta pelo app. Conta sem `admin` não depende da sessão.
2. `POST /v1/privacidade/exclusao` pede a senha e confere pelo mesmo desenho do login: reserva a tentativa no freio por e-mail (a senha da exclusão soma no mesmo freio do login e da redefinição), confere a senha fora de transação, e conclui noutra transação relendo a conta. Senha errada: uma falha só e 400 (nunca 401). Freio ativo: 429 sem conferir.
3. Com a senha certa, o caso de uso pergunta ao `VerificadorDePendencias` (pedido em andamento, saldo a repassar). Com pendência, a conta **não muda**, a solicitação fica `aguardando_pendencias` e a resposta é 409 `exclusao_com_pendencias` (o corpo não traz a lista de pendências). Sem pendência: desativa a conta (`gravarDesativacao`, só se ainda ativa), revoga todas as sessões (`conta_desativada`), grava a solicitação `pendente` e publica `ContaDesativada`. Hoje nenhum módulo registra pendência (o registro vazio responde sem pendências); outro módulo registra a sua `FonteDePendencias` em `RegistroDePendencias` (exportado por `index.ts`). Uma fonte que falha faz a consulta falhar: na dúvida, a exclusão não segue. **Texto do 409 no app:** a resposta não diz qual pendência existe; o app escolhe o texto da spec A6b pelos `perfis` da conta (`GET /v1/conta`): com `lojista`, o texto cita também o saldo a repassar; sem, só o pedido em andamento.
4. **Status da solicitação** (`solicitacoes_titular`): `pendente` (conta desativada esperando a anonimização), `aguardando_pendencias` (conta ainda ativa) e `concluida`. Há uma solicitação de exclusão aberta por conta: pedir de novo enquanto aguarda **reaproveita** a mesma (a data é a do primeiro pedido), e ela passa a `pendente` quando a exclusão acontece. Por isso o prazo de 30 dias conta por `contas.desativada_em`, nunca por `solicitada_em`.
5. A tarefa diária anonimiza cada exclusão `pendente` em até 30 dias da desativação (`AnonimizarContaCasoDeUso`, numa transação só): passa por todos os `AnonimizadorDeTitular` registrados, conclui a solicitação e publica `ContaAnonimizada`. Se um anonimizador falhar, nada fica e a tarefa tenta no dia seguinte.
6. **O que a anonimização apaga:** nome, e-mail, telefone, hash da senha, segundo fator e códigos de recuperação, sessões (com o histórico de tokens), códigos por e-mail, desafios e exportações. **O que preserva**, ligado só ao id: a conta (nome fixo "Conta anonimizada", e-mail substituto não reversível em `@anonimizada.invalid`, perfis, datas e status), os consentimentos e as solicitações do titular. É idempotente; conta ativa é recusada.

### Exportação dos dados (CA-10, S10)

1. `POST /v1/privacidade/exportacao` grava a solicitação e publica `ExportacaoSolicitada`. Um pedido por conta a cada 24 h, contado do último de qualquer status; dois pedidos simultâneos passam por uma trava da conta e só um segue (429 com `Retry-After` para o outro).
2. O assinante gera o arquivo na hora (o prazo de 48 h do CA-10 é o da fila), cifra com AES-GCM (a conta como AAD) e grava em `exportacoes_titular` com validade de 7 dias; as cópias anteriores ainda não baixadas são apagadas (S98). O e-mail só avisa que está pronta, sem anexo nem link com segredo.
3. A cópia sai só pela tela de Privacidade, com sessão, em `GET /v1/privacidade/exportacao/arquivo`: uso único (o UPDATE `baixada_em IS NULL` decide quem recebe, mesmo com dois downloads simultâneos) e até 7 dias. A resposta é `application/json` com `Content-Disposition: attachment; filename="bairrin-meus-dados.json"`; sem cópia, vencida ou já baixada, 404; dois downloads simultâneos dão 200 e 404. `HEAD` no mesmo caminho dá 405 com `Allow: GET` e não decifra nem marca (Q31). **O download é marcado como feito antes de a resposta chegar ao cliente** (S115): perdida a resposta, pede-se outra cópia só depois das 24 h. A tela de Privacidade deve avisar isso antes de baixar.
4. **Formato v1:** JSON com `formato: "bairrin.exportacao-do-titular"`, `versao: 1`, `geradaEm` e `identidade` com `conta` (id, nome, e-mail, telefone, status, criada em, verificado em, último login), `perfis`, `aceites` (todos, inclusive de versões fora de vigor) e `segundoFator` (configurado e confirmado em). Nunca leva hash da senha, segredo TOTP, tokens, HMACs nem id de outra conta. Mudança incompatível vira `versao` nova.

## Limites e freios

| Rota ou freio                              | Limite                                                               |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Todo IP (global)                           | 300 requisições por minuto                                           |
| `POST /v1/contas`                          | 10 por hora por IP                                                   |
| `POST /v1/sessoes`                         | 100 em 15 min por IP (conta também os acertos)                       |
| `POST /v1/senha/recuperacao`               | 3 por hora por e-mail e 10 por hora por IP                           |
| `POST /v1/senha/redefinicao`               | 20 em 15 min por IP (segura o custo do Argon2)                       |
| `POST /v1/conta/verificacao-email/reenvio` | 3 por hora por conta e 10 por hora por IP (a rota não recebe e-mail) |
| Freio de login por e-mail (CA-04)          | 5 falhas em 15 min, vale também para e-mail inexistente              |
| Freio de login por origem                  | 50 falhas em 15 min                                                  |
| Freio de 2FA por conta                     | 5 falhas em 15 min; só um 2FA concluído zera                         |
| Código por e-mail                          | 5 tentativas por código, 30 min de validade, uso único               |
| Desafio de 2FA                             | 5 tentativas, 5 min de validade, uso único                           |
| Teto de códigos por e-mail                 | 10 por conta e finalidade em 24 h (S93)                              |
| Teto de erros de 2FA                       | 20 por conta em 24 h (S103); acima, a senha é apagada                |
| Aviso de cadastro repetido                 | 1 por hora por e-mail (S15)                                          |
| Exportação                                 | 1 pedido por conta a cada 24 h                                       |

- **Limites por rota** (`http/limites.ts`, guarda `LimitePorRotaGuard`): rodam antes do pipe de validação (S82), para uma requisição que seria recusada por 429 não pagar a validação da senha contra a lista pública. A ordem de conferência é **conta, IP e e-mail**, qualquer que seja a ordem no decorador. O IP vem antes do e-mail (S109): o e-mail o cliente escolhe à vontade, então um IP bloqueado não gasta o contador de nenhum e-mail (não bloqueia a recuperação de terceiros em massa nem cria chaves na memória a cada e-mail inventado). A conta vem antes do IP: ela é a do token, que o cliente não troca à vontade, então a recusa por conta (o reenvio) não gasta a cota de 10 por hora do IP, que atrás de CGNAT é dividida com outras pessoas. A conferência para no primeiro limite estourado, e o contador já estourado não cresce.
- O IP é o `req.ip`, que segue o `trust proxy` (2 saltos em produção, para o Fly; falta confirmar num Fly real, e o checklist de deploy traz o teste decisivo). IPv6 conta pelo prefixo /64. Sem IP, uma chave só para todos (falha fechada).
- **Os contadores dos limites por rota ficam em memória, por instância**: com mais de uma máquina da API cada limite vale por máquina, e um deploy ou reinício zera as janelas. Os freios de login e de 2FA ficam no banco (`bloqueios_login`) e valem entre instâncias.
- O freio de login espera 1, 5 e 15 minutos e não passa disso (nunca bloqueio definitivo). O nível volta a zero quando uma nova janela começa 15 minutos ou mais depois do fim da última espera. O limite de cadastro por IP é a mitigação do risco aceito S100 (descobrir se um e-mail tem conta cadastrando-o e entrando com a senha escolhida).

## Eventos

Versão 1, payload só com ids (`packages/contratos/src/identidade/eventos.ts`). A aplicação monta cada evento a partir do contrato (`aplicacao/eventos.ts`): o payload passa pelo esquema estrito e o `agregadoId` é o `contaId`. O código de uso único nunca vai para a outbox. Os assinantes rodam dentro da transação da entrega (ADR-011), com o e-mail como último passo; o destinatário é sempre `contas.email_normalizado`, lido pelo id do payload. Conta que não existe mais ou saiu de `ativa` não recebe nada. E-mail para conta com e-mail ainda não verificado não leva o nome (S102).

| Evento                    | Publicado por                                                    | Assinante e efeito                                                                                  |
| ------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ContaCriada`             | cadastro                                                         | `enviar-codigo-de-verificacao`: gera o código e envia                                               |
| `VerificacaoReenviada`    | reenvio da verificação                                           | o mesmo assinante; não envia se a conta já está verificada                                          |
| `CadastroRepetidoTentado` | cadastro com e-mail já em uso                                    | `avisar-cadastro-repetido`: avisa o dono, 1 por hora por e-mail (a marca fica em `bloqueios_login`) |
| `RecuperacaoSolicitada`   | recuperação de senha, `seed:admin`, CLI de reconfiguração do 2FA | `enviar-codigo-de-recuperacao`: gera o código e envia                                               |
| `SegundoFatorFreado`      | tentativas de 2FA                                                | `avisar-segundo-fator-freado`: avisa o dono; se a senha foi apagada, manda recuperar a senha        |
| `ExportacaoSolicitada`    | pedido de exportação                                             | `gerar-exportacao`: gera a cópia e só então avisa que está pronta                                   |
| `SenhaRedefinida`         | redefinição de senha                                             | nenhum hoje                                                                                         |
| `ContaDesativada`         | exclusão da conta                                                | nenhum hoje (outros módulos assinam quando existirem)                                               |
| `ContaAnonimizada`        | anonimização                                                     | nenhum hoje                                                                                         |

Os assinantes que emitem código seguem as mesmas regras: uma trava por conta e finalidade (`travarEmissao`) serializa duas entregas simultâneas; passou do teto de 10 códigos em 24 h, não emite nem envia; cada envio invalida o código anterior, então só o último vale. O HMAC do código é `cifrador.hmac(<finalidade>, [contaId, codigo])`.

## Tarefas diárias e retenção

Agendadas pelo worker, de madrugada (fuso `America/Sao_Paulo`), depois da limpeza do núcleo (3h15) e uma de cada vez:

| Horário | Fila                                | O que faz                                                                                          |
| ------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| 3h30    | `identidade.anonimizar-contas`      | Anonimiza as exclusões `pendentes`; uma que falha não para as outras. Alerta de 25 dias (abaixo)   |
| 3h45    | `identidade.apagar-nao-verificadas` | Apaga contas não verificadas, sem `admin` nem `lojista`, sem login nem renovação há mais de 7 dias |
| 4h      | `identidade.reter-dados`            | Retenção dos freios, das sessões, dos códigos e das exportações                                    |

- **Alerta dos 25 dias:** a tarefa de anonimização registra um `warn` (`exclusão pendente há mais de 25 dias da desativação: o prazo de 30 dias está perto`, só com o id da conta e o prazo) para cada exclusão `pendente` cuja conta foi desativada há mais de 25 dias. Conta pelo `desativada_em` (`Conta.prazoDeAnonimizacao` menos 5 dias). Sai antes da tentativa, então aparece mesmo quando a anonimização dá certo. A regra de alerta em produção está no `docs/operacao/checklist-deploy.md`.
- **Expurgo (S78):** cada conta numa transação própria. Trava a conta e confere a regra de novo (quem renovou entre a listagem e a exclusão fica). A trigger `contas_so_expurgo` recusa com 23514 apagar conta fora da regra, inclusive para o dono do schema, e conta o tempo com o `now()` do banco: uma conta na fronteira dos 7 dias pode passar na aplicação e não no banco; ela vira "não apagou", sem derrubar o lote, e volta no dia seguinte. As sessões, o histórico de tokens, os códigos, os consentimentos, o 2FA, as solicitações e as exportações saem na mesma transação; o token de uma conta apagada recebe 401, não erro interno.
- **Retenção (S81):** cada item é um comando numa transação curta.

| Dado                                 | Apagado quando                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Freios de login (`bloqueios_login`)  | parados há mais de **30 minutos** (`greatest(bloqueado_ate, janela_inicio)`; apagar equivale a zerar)              |
| Sessões                              | revogadas ou vencidas há mais de **30 dias**; o histórico de tokens sai junto, pela FK em cascata                  |
| Códigos por e-mail e desafios do 2FA | usados ou vencidos há mais de **1 dia**; nunca um emitido nas últimas 24 h, então o teto diário não perde contagem |
| Cópias dos dados (exportações)       | vencidas (**7 dias** depois de geradas) ou já baixadas                                                             |
| Conta não verificada sem login       | mais de **7 dias** sem login nem renovação                                                                         |

Estes prazos entram na política de privacidade (plano das lojas, P4); o dono pode encurtá-los sem mudar o desenho.

## Banco

- Schema `identidade`, sem chave estrangeira para outros schemas; RLS em toda tabela, com política só para `bairrin_app`. A aplicação só lê `documentos_legais` (versão nova entra por migração ou pelo `seed`) e só lê e insere `consentimentos` e `tokens_de_renovacao_usados`. Só o expurgo apaga conta.
- **Ordem das travas:** o que conta tentativas ou troca o token é lido com trava dentro da unidade de trabalho, sempre na mesma ordem: freio por e-mail → (freio de origem, no login) → código ou desafios → freio de segundo fator → segundo fator → conta → sessões. Ela vale no login, na redefinição, na exclusão, na verificação de e-mail, na CLI de reconfiguração e nas tentativas de 2FA, e o cabeçalho de `dominio/repositorios.ts` explica cada degrau. Trave sempre nesta ordem: o fake dos testes não detecta deadlock.
- **Leitura que não perde atualização:** `buscarParaAtualizar` do freio é um só `INSERT ... ON CONFLICT (chave_hmac, tipo) DO UPDATE ... RETURNING`, que trava a linha existente ou nova e sempre devolve uma linha; o `inserir` da conta usa `ON CONFLICT (email_normalizado) DO NOTHING` e confere a linha gravada, para o e-mail repetido virar erro de domínio sem abortar a transação (erro do Postgres abortaria o resto do caso de uso, 25P02). As gravações condicionadas (`gravarUltimoLogin`, `gravarSenhaRedefinida`, `gravarDesativacao`, `gravarRotacao`…) mudam só as suas colunas e só com a conta ativa ou a sessão não revogada: gravar a entidade inteira lida sem trava ressuscitaria o que outra transação mudou.
- **Id que não é UUID** (o `sid`, o id do desafio, vindos de fora) dá `null` ou `false` nas consultas, nunca um erro de sintaxe do Postgres.
- O erro do banco chega à aplicação como erro de domínio só pelo código do Prisma, nunca pela mensagem, que traz os parâmetros da consulta.

## Cripto

O formato guardado e a rotação estão no ADR-012. Em uma linha: Argon2id (19 MiB, t=2, p=1) com NFKC dentro do `Hasher`; HMAC-SHA256 e AES-256-GCM com subchave por finalidade (HKDF); JWT HS256 de 15 min; TOTP SHA1 de 6 dígitos, 30 s, ±1 passo. Trocar `CHAVE_HMAC` invalida todos os tokens de renovação, códigos, freios e códigos de recuperação do 2FA.

## Dado pessoal e logs

- Nada de nome, e-mail, telefone, senha, token ou código em log, erro, auditoria, evento ou URL. Os logs trazem só o id da conta; o log de erro de banco não leva a mensagem da biblioteca.
- O módulo implementa `AnonimizadorDeTitular` (`modulo = 'identidade'`) e o registra no `IdentidadeModule`.
- Respostas de erro saem só do catálogo `ERROS` de `@bairrin/contratos`, sem pilha nem mensagem.

## Testes

```bash
pnpm --filter api exec vitest run src/modulos/identidade        # unitários do módulo
pnpm --filter api test:integracao -- sessao segundo-fator      # integração (exige o docker compose no ar)
```

Testes transversais de rotas (`test/integracao/identidade/`: `rotas-protegidas`, `autorizacao`, `revogacao`, `sem-dado-pessoal`, `validacao`):

- o catálogo `PEDIDOS_DAS_ROTAS` (`cenario-http.ts`) precisa de uma entrada por rota nova, e os testes reprovam se faltar (rota sem `@Publico()` e sem guarda, rota admin sem `ExigeMfa`, 401 fora da guarda, campo desconhecido e inválido);
- `conferirIsolamento` (`apps/api/test/helpers/autorizacao.ts`) confere que uma conta não alcança o recurso de outra, e serve a qualquer módulo novo.

Os fakes em memória ficam em `apps/api/test/fakes/identidade/`. Os testes de integração estão em `apps/api/test/integracao/identidade/` e o filtro casa com o nome do arquivo.

## Pendências conhecidas

- Nenhum módulo registra `FonteDePendencias` ainda; o registro vazio responde sem pendências.
- O relay da outbox desfaz o lote inteiro se um evento falha sempre (poison pill): os e-mails de verificação e de recuperação param até alguém corrigir. Fica obrigatório antes do primeiro deploy de produção (plano 01b, riscos).
- Os apps Expo ainda não existem: a sessão no SecureStore e a limpeza no logout vêm na trilha mobile (`packages/mobile-base`, plano 01b, etapa 20b).
