# Painel do administrador (`apps/painel`)

Painel web do Bairrin, em React 19 e Vite 8. Hoje tem a entrada do administrador (senha e segundo fator, plano 01b, etapa 15) e uma área protegida mínima com a conta do admin e o estado da API ("API disponível", "Sem conexão" ou erro da API), usando `@bairrin/cliente-api`. As demais telas do administrador vêm no plano 08.

## Rodar

O `vite.config.ts` lê `@bairrin/tokens` pelo fonte (condição `@bairrin/fonte`, via `runnerImport` do Vite), então `dev`, `build` e testes funcionam num clone limpo, sem compilar os pacotes antes.

```bash
cp apps/painel/.env.example apps/painel/.env
pnpm --filter painel dev                 # http://localhost:5173
```

A API precisa estar no ar (`pnpm --filter api dev`) com `http://localhost:5173` em `CORS_ORIGENS`, que é o valor do `apps/api/.env.example`. As rotas de sessão e de segundo fator chegam na etapa 16 do plano 01b; até lá a abertura recebe 404 da renovação e o painel mostra o erro inesperado em P1.

## Variáveis

| Variável       | Uso                                                                |
| -------------- | ------------------------------------------------------------------ |
| `VITE_API_URL` | Endereço da API. Vai embutida no build: **nunca coloque segredo.** |

Sem `VITE_API_URL`, a página mostra só o aviso de configuração (sem login).

## Comandos

```bash
pnpm --filter painel dev
pnpm --filter painel build        # tsc -b e vite build; saída em dist/
pnpm --filter painel typecheck
pnpm --filter painel test
pnpm --filter painel exec vitest run src/App.test.tsx
```

## Estrutura

```
src/main.tsx            monta a sessão do admin (criarAutenticacaoDoPainel) e renderiza
src/App.tsx             aviso de configuração ou o fluxo de autenticação
src/EstadoDaApi.tsx     seção "Estado da API" (Início e página sem configuração)
src/sessao/             regras da sessão do admin, sem tela: autenticacao-do-painel.ts (cliente, cookie,
                        marca de logout, renovação por interação), inatividade.ts (relógio de 30 min)
                        e entre-abas.ts (sinais entre abas)
src/autenticacao/       telas P1 a P1c, área protegida (Inicio) e autenticacao.css
src/componentes/        componentes base: Botao, Campo, Banner, Cartao, IndicadorDePassos e componentes.css
src/textos/pt-BR.ts     textos de interface (único idioma do MVP)
src/textos/mensagem-do-campo.ts   texto de erro de campo: chave `erro.<campo>.<codigo>` ou o `motivo` da API
src/estilos/            tokens.css.ts (variáveis CSS a partir de @bairrin/tokens) e pagina.css
```

- **Textos de interface** ficam em `src/textos/pt-BR.ts`, nunca soltos no componente. Erro de campo da API é mostrado por `erro.<campo>.<codigo>`.
- **Erro de campo (CA-13).** `mensagemDoCampo(campo, codigo, motivo, tela?)` devolve `textos.erro[campo][codigo]` (antes, `textos.erroPorTela[tela][campo][codigo]` se a tela passar o nome dela: o passo 2 da configuração do 2FA usa isso para `codigo.invalido`, pois a API devolve o mesmo campo nas duas telas) e, sem essa chave, o `motivo` em português que a API mandou (e, sem ele, "Confira este campo"). Serve ao 400 da API e à validação local, que usam os mesmos esquemas de `@bairrin/contratos`. Não há chave onde o `motivo` já é o texto final e varia (`senha.invalido`, `novaSenha.invalido` e `novaSenha.comum`: curta, longa, caractere que não pode, só dígitos e símbolos, senha comum). Nos apps, a 12a segue a mesma regra. Código novo de uma API mais nova cai no `motivo`.
- **Componentes base** (`src/componentes/`, importe o arquivo do componente; ele carrega o `componentes.css`). Estilo só com variáveis de tokens, classes com prefixo `ui-`.
  - `Botao`: `variante` (`primario`, `secundario`, `terciario`, `destrutivo`), `carregando` (não usa `disabled`: segue focável, ignora clique e Enter e diz "Enviando…" ao leitor de tela), `larguraTotal`. É `type="button"` por padrão.
  - `Campo`: rótulo sempre visível, `ajuda` e `erro` ligados por `aria-describedby`, `aria-invalid` no erro, região educada para o erro surgir anunciado; `tipo` `texto`, `email` ou `senha` (com "Mostrar senha"). O `autoComplete` certo (`current-password`, `new-password`, `one-time-code`) é da tela. Sem máscara de telefone: o painel não tem esse campo.
  - `Banner`: `tom` `informacao`, `sucesso`, `aviso` ou `erro` (o erro é `role="alert"`; os demais, `role="status"`), `titulo`, `acao` e `aoFechar` (o "Fechar" tem nome acessível "Fechar aviso", com o título quando há).
  - `Cartao`: cartão de autenticação de 400 px (`centralizado` o põe no meio da janela). Abaixo de 432 px enche a janela e perde a sombra.
  - `IndicadorDePassos`: "Passo N de M" mais o título do passo (`refDoTitulo` para levar o foco ao trocar de passo; `nivelDoTitulo` 2 por padrão, 1 se ele for o título da página; o título é descrito pelo "Passo N de M").
- **Tokens como CSS de arquivo.** Um plugin do Vite (`vite.config.ts`) entrega as variáveis como o módulo virtual `virtual:bairrin-tokens.css`. No build vira um arquivo `.css`, sem `<style>` nem `style=""` em tempo de execução, para a CSP não precisar de `unsafe-inline`.
- Os testes usam Vitest com jsdom e Testing Library. O Vitest esvazia arquivos `.css`; os testes que leem `pagina.css` e `componentes.css` os liberam em `test.css.include` (`vite.config.ts`).
- `import.meta.env.VITE_API_URL` é declarado em `src/env.d.ts`.

## Autenticação do admin (plano 01b, etapa 15)

Telas da spec 01 (`docs/produto/specs/01-fundacao-identidade.md`): P1 Entrar, P1a Segundo fator, P1b Configurar 2FA e P1c Recuperar senha, todas no `Cartao` com o logo no `cabecalho`. Depois de entrar, `Inicio` (área protegida mínima) chama `GET /v1/admin/conta`.

- **Sessão** (`sessao/autenticacao-do-painel.ts`): `criarClienteApi` com um `fetch` que manda `credentials: 'include'` (sem isso o cookie da renovação não vai) e `criarClienteAutenticado` no modo `cookie`. O token de acesso fica só em memória; recarregar a página renova pelo cookie `HttpOnly`.
- **Abertura e corrida do cookie:** ao abrir, o painel chama `renovarSessao()` e mostra "Carregando o painel…". P1 só aparece depois que ela termina, e depois de "Sair" só depois que `encerrarSessao()` termina: um login que corresse junto com o logout pelo cookie poderia ter o cookie da sessão nova apagado (README do `cliente-api`, "Revogação pendente"). Sem rede na abertura, P1 mostra o erro inesperado com "Tentar de novo".
- **Logout pendente (S80, P14):** a marca fica em `localStorage` (`bairrin.painel.logoutPendente`), sempre `{}`, sem token nem id. Cada acesso ao `localStorage` fica num try/catch; uma leitura recusada conta como marca (o painel sai pelo cookie antes de restaurar). Se a API não confirmou o "Sair", P1 mostra "Não foi possível sair. Verifique a conexão e tente de novo." com "Tentar de novo".
- **401 e 403:** renovação recusada, 401 ou 403 na rota protegida e 30 min sem interação levam a P1 com "Sua sessão terminou. Entre de novo para continuar." A URL não muda durante o login, então a pessoa volta à página em que estava.
- **Inatividade (S9, CA-101; `sessao/inatividade.ts`):** 30 min medidos só por interação (tecla, clique, toque, rolagem), com aviso aos 28 min e "Continuar conectado". Requisição não conta para o relógio do painel. **Todo polling que entrar no painel passa `renovarEm401: false`**, porque a renovação do 401 estende a sessão no servidor.
  - Com o aviso aberto, interação na página (Tab, clique, tecla) não fecha o aviso nem recomeça o relógio (D2): só "Continuar conectado", que chama `renovarSessao()`. O aviso sai quando a renovação dá certo; se ela falhar (rede, 5xx), aparece o Banner "Não foi possível continuar conectado…" e o aviso fica. Renovação recusada leva a P1.
  - **A interação chega ao servidor (R1):** o servidor conta os 30 min desde a última renovação. A cada interação, `registrarInteracao()` renova se a última sessão gravada (login, renovação pedida ou a do 401) tem mais de **10 min** (`RENOVAR_NA_INTERACAO_APOS_MS`), com no máximo uma tentativa a cada 10 min, na fila única do `cliente-api`. Quem usa o painel sem parar renova uma vez a cada 10 min, no máximo. Limite: quem interage só nos 10 min seguintes a uma renovação e para fica com 20 a 30 min no servidor, não 30; depois disso, o próximo pedido leva a P1 com "Sua sessão terminou".
  - No passo 3 da P1b (códigos de recuperação), o mesmo relógio de 30 min roda sem aviso (S88, `comAviso: false`): como não há aviso na tela, toda interação conta até o último instante (R8), e a atividade de outra aba também (R10). Ao fim, os códigos saem do estado e a sessão é encerrada, com "Sua sessão terminou".
- **Várias abas (R2, S89; `sessao/entre-abas.ts`):** as abas dividem o cookie, então a sessão é uma só. Elas trocam dois sinais pelo `BroadcastChannel('bairrin.painel.atividade')`, só a palavra, sem dado algum: `atividade` (a pessoa interagiu; no máximo um a cada 10 s) e `saiu` (o logout terminou, confirmado ou não, ou a renovação foi recusada). A aba que recebe `atividade` conta a hora do recebimento como a interação mais recente (e fecha o aviso), então a aba ociosa não encerra a sessão da aba em uso; quem recebe `saiu` na área protegida vai a P1 com "Sua sessão terminou", sem pedir outro logout, e esquece a sessão só na memória (`descartarSessaoLocal`: o token de acesso antigo não fica no cliente). Sem `BroadcastChannel`, a reserva é o evento `storage` da marca de logout pendente (vira `saiu`), com dois limites: a `atividade` não chega às outras abas, e o `saiu` chega quando a marca é gravada, **antes** de o DELETE terminar (R9). Nesse intervalo curto, um login feito na outra aba pode ter o cookie novo apagado pela resposta do DELETE, e a pessoa precisa entrar de novo.
- **Respostas do 2FA (P1a e P1b):** 400 fica na tela com o erro no campo; 401 volta a P1 com o e-mail e "O tempo para digitar o código acabou. Entre de novo."; 429 volta a P1 com a mensagem genérica (CA-04). O passo 2 da P1b chama `mensagemDoCampo(..., 'configuracaoDoSegundoFator')`, e a P1c usa `'recuperacaoDeSenha'` ("Código inválido ou expirado. Peça um novo.").
- **QR e códigos de recuperação:** o QR é desenhado no navegador (`autenticacao/qr.ts`: o `qrcode` só calcula a matriz e a tela desenha um `<path>` de SVG), sem serviço externo, sem `data:` e sem canvas, por causa da CSP (`img-src 'self'`). O rótulo do TOTP vem mascarado da API (`Bairrin:<emailMascarado>`). Segredo, desenho do QR e códigos ficam só no estado do componente: nada em `localStorage`, `sessionStorage`, URL ou cache. O download dos códigos (`bairrin-codigos-recuperacao.txt`) usa um endereço `blob:` revogado 1 s depois (R5).
- **Aviso de fim de sessão (R4):** o Banner fica em `.aut-aviso-fixo` (`position: sticky`, no topo da janela), para não sair da tela numa página longa. O texto vem de `textos.autenticacao.inicio.expirando`, com os minutos calculados de `AVISO_ANTES_DO_FIM_MS`. Ao entrar no Início, o foco vai ao título (`h1`).
- **Sair no passo 3 (D1, S88):** sem a caixa "Guardei os códigos" marcada, "Sair" abre um Banner de confirmação em linha ("Sair sem guardar os códigos?"), com o foco em "Voltar aos códigos"; "Sair mesmo assim" limpa os códigos e sai. Com a caixa marcada, e nos passos 1 e 2, "Sair" sai direto.
- **Falhas em segundo plano:** `registrarFalha` recebe só a `origem` (`avisoSoComOrigem`). O painel ainda não tem Sentry; quando tiver, ligue em `main.tsx` e acrescente a origem de ingest ao `connect-src` do `Caddyfile`.
- **Anúncios (D9):** cada tela tem a própria região `role="status"` para o envio e o resultado (erros de campo, "Chave copiada"); o Banner de erro se anuncia sozinho.
- **Logo:** `autenticacao/bairrin-logo-horizontal.svg` (o SVG da identidade, seção 2.7) importado com `?no-inline`, para o Vite emitir arquivo em vez de `data:`.
- Testes: `App.test.tsx` roda o fluxo inteiro com o cliente real e uma API falsa no `fetch` (`autenticacao/teste/api-falsa.ts`). `sessao/renovacao-por-interacao.test.tsx` usa uma API falsa que conta a janela de 30 min desde a renovação, e `sessao/abas.test.tsx` simula a outra aba com um barramento falso (`sessao/teste/abas-falsas.ts`).
- **CSP e zod (S87):** `@bairrin/contratos` liga `z.config({ jitless: true })` no navegador antes de qualquer esquema, para o zod não sondar `new Function` (a CSP não tem `unsafe-eval`). `src/contratos-sem-eval.test.ts` confere que carregar o pacote não chama `Function`.

## Hospedagem (Fly.io, ADR-005)

Nada está publicado: o dono decidiu não contratar serviço pago até o app ficar pronto. Os arquivos estão prontos (etapa 15 do plano 01a).

- `Dockerfile`: constrói o painel e o serve com Caddy, sem root, na porta interna 8080. O contexto do build é a **raiz** do repositório.
- `Caddyfile`: arquivos estáticos, fallback de SPA para `index.html`, cache imutável só para `/assets/*` e os cabeçalhos de segurança (CSP sem `unsafe-inline`, `frame-ancestors 'none'`, HSTS e outros).
- `fly.toml`: app `bairrin-painel`, região `gru`, TLS no proxy do Fly.

Construir e testar a imagem localmente:

```bash
docker build -f apps/painel/Dockerfile -t bairrin-painel .
docker run -d --rm -p 127.0.0.1:8080:8080 bairrin-painel
curl -sI http://127.0.0.1:8080 | grep -i content-security-policy
```

Deploy, a partir da raiz do repositório:

```bash
fly deploy -c apps/painel/fly.toml
fly certs add painel.bairrin.com.br -c apps/painel/fly.toml   # só depois do registro de bairrin.com.br
```

Atenção:

- **A URL da API está fixa em dois lugares**: `VITE_API_URL=https://api.bairrin.com.br` no `Dockerfile` e o `connect-src` da CSP no `Caddyfile`. Trocar um exige trocar o outro. Um painel de homologação precisa mudar os dois.
- **HSTS sem `preload`** até o registro do domínio. Decida o `preload` no registro de `bairrin.com.br` (a lista de preload é difícil de reverter).
- **Sentry no painel** exigirá a origem de ingest dele no `connect-src` do `Caddyfile`.
- Um pacote `@bairrin/*` novo usado pelo painel precisa entrar nos `COPY` do `Dockerfile`.
- Lista completa para o dia do deploy: `docs/operacao/checklist-deploy.md`.
