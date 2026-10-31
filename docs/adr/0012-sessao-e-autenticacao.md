# ADR-012: Sessão com JWT curto e renovação opaca rotativa

- Situação: aceita (decisão do dono, 2026-10-16). Implementada na API (`apps/api/src/modulos/identidade`) e no painel (`apps/painel`) pelo plano 01b. Nos apps Expo, a sessão (SecureStore, limpeza no logout, na expiração e na troca de conta) está em `packages/mobile-base/src/sessao` (plano 01b, etapa 12); as telas de conta vêm nas etapas 14, 17 e 18, e a fila offline no plano 02.
- Origem: `docs/produto/planos/00-arquitetura.md` (ADR-012) e `docs/produto/planos/01b-identidade.md`. Este texto traz os detalhes finais; o passo a passo de cada fluxo, os eventos e os limites estão em `apps/api/src/modulos/identidade/README.md`.

## Contexto

O brief exige revogar o acesso no servidor (CA-05), a conta de administrador precisa de segundo fator, e o painel guarda a sessão num navegador. Um JWT longo e sem estado não permite revogar. A revisão de segurança (S1, S8 e S16) apontou como pontos de risco o desafio de segundo fator, o acesso depois da revogação e o token recém-trocado em rede instável.

## Decisão

### Token de acesso

- JWT HS256 de 15 minutos (900 s). Claims: `sub` (id da conta), `sid` (id da sessão), `perfis`, `mfa`, `emailVerificado`, `iat`, `exp`, mais `iss` e `aud` fixos (`bairrin-api`). Algoritmo, validade, emissor, público e segredo vão em cada chamada, sem padrão de módulo.
- A verificação aceita só HS256 e confere `iss`, `aud`, `exp` (sem tolerância de relógio) e a forma das claims, inclusive `exp - iat = 900`. HS512 com o mesmo segredo e `alg: none` são recusados.
- `mfa` e o perfil `admin` só existem em token de sessão do painel que passou pelo segundo fator. A conta admin que entra por um app recebe um token sem `admin`. `emailVerificado` serve só para a interface: o que exige e-mail verificado é conferido no servidor, pela conta.
- Nos apps o token vai em `Authorization: Bearer`; no painel fica só em memória.

### Renovação

- Token opaco de 256 bits aleatórios (base64url), rotativo, guardado só como HMAC (`token_hash`). Cada renovação troca o token na mesma linha de `identidade.sessoes`, então o `sid` não muda.
- Apps: 30 dias deslizantes, sem teto. Painel: cada renovação empurra o fim da sessão por 30 minutos, até o teto absoluto de 12 horas contado do login, tudo conferido no servidor. O painel mede a inatividade por interação do usuário e sinaliza as abas entre si (README do painel).
- Cookie do painel: `bairrin_renovacao`, `HttpOnly; Secure; SameSite=Strict; Path=/v1/sessoes/renovacao`, `Max-Age` de 12 horas. O `Path` cobre só a renovação (`POST`) e o logout do painel (`DELETE`, S80), que usa o mesmo caminho.
- Defesa contra CSRF: renovação e logout pelo cookie exigem `X-Cliente: painel` e `Origin` na lista do CORS. Fora disso, 403 sem revogar nada, e o 403 do logout mantém a marca de logout pendente no cliente (`cliente-api`, README do pacote).
- O `cliente` que a tolerância e a renovação comparam vem sempre da requisição, nunca da sessão: `painel` pelo cookie com `X-Cliente: painel`, ou o campo `cliente` do corpo nos apps. A checagem separa com força o canal (cookie ou corpo); entre os dois apps ela só recusa engano, porque quem roubou o token pode mandar o outro valor.
- Tolerância de 60 s (S16): o par novo (token de acesso e de renovação) fica cifrado em `par_novo_cifrado` pelo prazo e só volta ao mesmo `cliente` que apresentar o token recém-trocado.
- Histórico (S77): todo token trocado vai para `identidade.tokens_de_renovacao_usados` até a sessão sumir. Qualquer token do histórico apresentado fora da tolerância (só o último trocado tem os 60 s) revoga a família inteira (`reuso_detectado`). A busca é primeiro na sessão (token atual ou anterior), depois no histórico.
- A renovação grava `ultimo_login_em` (só em conta ativa): para o expurgo de contas não verificadas, "último login" quer dizer "login ou renovação".

### Revogação (S8)

- A sessão (`sid`) é conferida a cada requisição em `/v1/admin/*` e nas rotas marcadas com `@ConfereSessao()` (hoje `GET /v1/conta` e a cópia dos dados: pedido e download), que entregam ou movem dado pessoal sem pedir a senha: da mesma conta, não revogada e dentro do prazo; senão, 401. Nas demais rotas (a exclusão, que pede a senha, e o resumo de `GET /v1/privacidade` entre elas), a guarda confere só `contas.status`, então um token de acesso (15 min) sobrevive a um logout até vencer. Rota nova que entrega dado pessoal sem senha deve usar `@ConfereSessao()`.
- Logout nos apps: `DELETE /v1/sessoes/atual` com o Bearer. No painel: `DELETE /v1/sessoes/renovacao` pelo cookie, sempre 204 com a origem do painel (sem cookie ou com token desconhecido também) e apaga o cookie. Um token antigo achado só no histórico revoga o que ainda vive da família.
- Redefinição de senha, exclusão da conta, reconfiguração do segundo fator pela CLI e a senha apagada pelo freio do 2FA revogam todas as sessões da conta na mesma transação, cada uma com o seu `motivo_revogacao`.

### Senha

- Argon2id com 19 MiB (19 456 KiB), `t=2`, `p=1`, no formato PHC padrão do `@node-rs/argon2` (os parâmetros ficam dentro do hash). Um hash fictício com os mesmos parâmetros gasta o tempo de uma verificação para conta sem senha ou inexistente.
- **A senha passa por NFKC dentro do adaptador `Hasher`**, igual em `gerarHash`, `verificar` e `simularVerificacao`; o contrato mede o tamanho (8 a 128) na senha digitada e não normaliza. A NFKC faz parte do formato do hash: "café" em NFC e em NFD, ou letras de largura cheia, dão a mesma senha. Mudar a normalização depois de existirem contas tranca quem tem senha com acento ou largura cheia; só se faz com versão no hash e novo hash no próximo login. Hoje não há re-hash no login.
- Senha nova (cadastro e redefinição, as únicas rotas que gravam senha) também passa pela lista pública de senhas comuns, que só existe na API. O zod do navegador roda sem JIT (`jitless`, S87; README de `@bairrin/contratos`).

### Segundo fator do administrador (S1)

- TOTP com SHA1, 6 dígitos, passo de 30 s (RFC 6238) e janela de ±1 passo; um passo igual ou anterior ao último usado não confere. O segredo tem 160 bits, é guardado cifrado e o rótulo do app autenticador leva só o e-mail mascarado.
- Desafio pós-senha: token `<id>.<segredo>`, 5 minutos, uso único, 5 tentativas, guardado só como HMAC ligado à conta e à etapa. A etapa é `configurar` (só se o segundo fator ainda não foi confirmado) ou `verificar`; `configuracao` e `confirmacao` só aceitam `configurar`. A confirmação entrega 10 códigos de recuperação de 10 caracteres base32, mostrados uma vez e guardados como HMAC, de uso único.
- Respostas do 2FA (nas rotas com código, nesta ordem): (1) desafio inexistente, vencido, usado, de outra etapa ou já com 5 falhas, ou conta que não pode mais concluir → 401 `nao_autenticado`, com o mesmo corpo para todos os motivos; (2) freio de segundo fator da conta ativo → 429 `limite_excedido` com `Retry-After`, sem gastar tentativa; (3) código errado → soma uma falha no desafio e no freio; se ainda sobra tentativa, 400 `validacao` com `campos[codigo]` ou `campos[codigoRecuperacao]` (o que veio) e `codigo: invalido`; se era a quinta, 401 e o desafio morre. A `configuracao` só tem o passo (1). A diferença entre 400 e 401 só aparece para quem já passou da senha.
- O freio do 2FA é por conta (5 falhas em 15 minutos, esperas de 1, 5 e 15 minutos) e só zera depois do segundo fator concluído; a senha certa não o zera. Acionado de novo já no nível máximo, ou com mais de 20 erros de 2FA em 24 horas (S103), a senha da conta é apagada, as sessões são revogadas e o dono recebe um e-mail para recuperar a senha (P16, S104). A redefinição de senha apaga os desafios e recomeça a contagem dos 20 (Q29).
- Reconfigurar o segundo fator no MVP é só pela CLI `reconfigurar-segundo-fator`, rodada na máquina da API por um operador admin: apaga o segundo fator, os códigos de recuperação e a senha (S97), invalida os desafios, revoga todas as sessões e pede a recuperação de senha pelo e-mail. A conta define a senha nova e configura o autenticador de novo no próximo login no painel.
- O login do painel só termina no segundo fator: `ultimo_login_em` é gravado e a sessão (com `mfa`) é criada ao concluí-lo, não na senha. O perfil `admin` nasce só pela CLI `seed:admin` (conta sem senha até a primeira redefinição); nenhuma rota concede `admin`.

### Chaves e formatos de cripto (S17)

- `JWT_SEGREDO`, `CHAVE_CIFRAGEM_DADOS` e `CHAVE_HMAC` com no mínimo 32 bytes, diferentes entre si, validadas na subida (`apps/api/src/compartilhado/config/ambiente.ts`). Cada finalidade tem a sua subchave, derivada por HKDF-SHA256 de 32 bytes, sem sal.
- HMAC-SHA256 com a subchave `bairrin/identidade/hmac/<finalidade>`. As partes entram com o tamanho na frente (4 bytes, big-endian) e saem em base64url, sem prefixo de versão. Finalidades: `verificacao_email`, `recuperacao_senha`, `desafio_configurar`, `desafio_verificar`, `token_renovacao`, `codigo_recuperacao_segundo_fator`, `bloqueio_email`, `bloqueio_ip` e `bloqueio_segundo_fator`. O código por e-mail e o desafio ligam a conta ao HMAC (`[contaId, codigo]`), então um código só confere na conta e na finalidade que o emitiram.
- AES-256-GCM com a subchave `bairrin/identidade/cifragem/<versão>/<finalidade>` (`par_novo_da_sessao`, `segredo_totp`, `exportacao_titular`). Formato guardado: `v1.<base64url(iv | tag | cifrado)>`, IV aleatório de 96 bits, tag de 128 bits e o id da conta como AAD. Cifrado alterado, de outra finalidade, de outra conta ou de versão desconhecida não decifra.
- Rotação da chave de cifragem: acrescentar `v2` ao mapa do `CifradorAesGcm` (hoje só `v1`, lida de `CHAVE_CIFRAGEM_DADOS`; a rotação pede uma variável de ambiente nova para a chave `v2`), apontar `VERSAO_DA_CHAVE` para `v2` e manter `v1` para decifrar.
- **Trocar `CHAVE_HMAC` invalida todos os HMACs guardados:** todo token de renovação (todas as sessões acabam), códigos e desafios pendentes, freios, marcas de aviso e os códigos de recuperação do 2FA (os admins ficam só com o app autenticador, ou com a CLI). Trocar `CHAVE_CIFRAGEM_DADOS` sem manter a antiga deixa de decifrar os segredos TOTP (reconfiguração por CLI), as exportações pendentes e o par da tolerância. Trocar `JWT_SEGREDO` derruba os tokens de acesso vivos (15 minutos), que os clientes renovam sozinhos.

### Concorrência e freio

- O banco roda em READ COMMITTED. O que conta tentativas ou troca o token só é alterado depois de lido com trava dentro da unidade de trabalho, e a ordem das travas é sempre a mesma: freio por e-mail, freio de origem (no login), código ou desafios, freio de segundo fator, segundo fator, conta e, por último, as sessões. A ordem completa e a razão de cada degrau estão no cabeçalho de `modulos/identidade/dominio/repositorios.ts`.
- O freio é gravado por `INSERT ... ON CONFLICT (chave_hmac, tipo) DO UPDATE ... RETURNING`, que trava a linha existente ou a nova num comando só. O cadastro usa `ON CONFLICT (email_normalizado) DO NOTHING` e confere a linha gravada: o e-mail repetido vira um erro de domínio sem erro do Postgres, e a transação segue usável. Id que não é UUID (o `sid`, o id do desafio) dá `null` ou `false` nas consultas, nunca erro de sintaxe do banco.
- Reserva da tentativa (S91): o login e a exclusão registram a falha antes de conferir a senha, numa transação curta, e conferem a senha (Argon2id) fora de qualquer transação. No sucesso, outra transação curta zera o freio de e-mail e devolve a falha reservada ao freio de origem. Nenhuma tentativa confere a senha depois do limiar, e o hash não segura conexão do banco.
- Freio de login (CA-04, S14): 5 falhas em 15 minutos por e-mail, exista ou não a conta, e 50 por origem (IPv6 agrupado por /64); esperas de 1, 5 e 15 minutos, nunca bloqueio definitivo. Sem IP válido na requisição, a origem é a chave fixa `origem:desconhecida` (falha fechada).

### 401 só da guarda

Nas rotas autenticadas, só a guarda global devolve 401 (token ausente, inválido ou vencido, sessão ou conta revogada), porque o `cliente-api` renova e repete todo 401, e uma senha errada contaria duas vezes no freio. Erro que se corrige na mesma tela é 400 com `campos`; falta de perfil ou de `mfa` é 403; freio é 429. Exceções registradas, quando a sessão ou a conta acabou entre a guarda e o caso de uso: `sessao_invalida` na verificação de e-mail e `conta_indisponivel` na exclusão da conta, em `GET /v1/conta` e em `GET /v1/admin/conta`. As rotas públicas do 2FA seguem o 401 da seção anterior, porque não levam Bearer e o `cliente-api` não renova requisição sem sessão.

### Prefixo `/v1/admin`

`/v1/admin` fica fechado pela guarda global por metadados e pela rota que o Express casou (nunca pela URL pedida): exige `admin` e `mfa`, mesmo que o controller esqueça os decoradores, e `@Publico()` não o abre (S110). Sem isso, 403 com log só do id da conta.

### Exclusão da conta admin (S113)

Conta com perfil `admin` só pede a própria exclusão numa sessão com `admin` e `mfa`, a do painel depois do segundo fator (decisão do dono de 2026-10-23). De outra sessão, inclusive a do app, que não pede o segundo fator, a resposta é 403 `exclusao_de_admin_so_pelo_painel`, antes de conferir a senha e sem gastar o freio. Assim o 2FA protege a conta do admin, não só o painel: quem tem só a senha não exclui a conta pelo app.

## Consequências

- A revogação passa a existir no servidor; o custo é uma consulta da sessão por requisição no prefixo admin e nas três rotas com `@ConfereSessao()` (`GET /v1/conta` e o pedido e o download da cópia dos dados).
- Trocar HS256 por ES256 é o caminho para que outro serviço verifique o JWT, se um serviço for extraído (ADR-003).
- O freio de login e o aviso de cadastro repetido têm limites próprios, descritos no README do módulo Identidade. Os contadores dos limites por rota ficam em memória, por instância: mais de uma máquina da API divide cada limite, e um deploy os zera (checklist de deploy).
- A NFKC no `Hasher` e os formatos de HMAC e de cifrado são contratos com o que já está gravado: mudá-los exige migração de dados.
- O cookie `SameSite=Strict` pede painel e API no mesmo site (`bairrin.com.br`); painel em outro domínio (a Vercel de teste) não faz login.
- O login antes da verificação do e-mail (P1-dono) deixa descobrir se um e-mail tem conta cadastrando-o e entrando com a senha escolhida (S100). O dono aceitou o risco; a mitigação é o limite de 10 cadastros por hora por IP, que depende de o `trust proxy` de 2 saltos acertar o IP no Fly (conferir em homologação).
