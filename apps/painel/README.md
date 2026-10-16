# Painel do administrador (`apps/painel`)

Painel web do Bairrin, em React 19 e Vite 8. Hoje é a versão mínima da fundação: uma página que mostra se a API responde ("API disponível", "Sem conexão" ou erro da API), usando `@bairrin/cliente-api`. As telas do administrador vêm nos planos 01b e 08.

## Rodar

O `vite.config.ts` lê `@bairrin/tokens` pelo fonte (condição `@bairrin/fonte`, via `runnerImport` do Vite), então `dev`, `build` e testes funcionam num clone limpo, sem compilar os pacotes antes.

```bash
cp apps/painel/.env.example apps/painel/.env
pnpm --filter painel dev                 # http://localhost:5173
```

A API precisa estar no ar (`pnpm --filter api dev`) com `http://localhost:5173` em `CORS_ORIGENS`, que é o valor do `apps/api/.env.example`.

## Variáveis

| Variável       | Uso                                                                |
| -------------- | ------------------------------------------------------------------ |
| `VITE_API_URL` | Endereço da API. Vai embutida no build: **nunca coloque segredo.** |

Sem `VITE_API_URL`, a página mostra o aviso de configuração.

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
src/main.tsx            monta o cliente da API e renderiza
src/App.tsx             página do estado da API
src/textos/pt-BR.ts     textos de interface (único idioma do MVP)
src/estilos/            tokens.css.ts (variáveis CSS a partir de @bairrin/tokens) e pagina.css
```

- **Textos de interface** ficam em `src/textos/pt-BR.ts`, nunca soltos no componente. Erro de campo da API é mostrado por `erro.<campo>.<codigo>`.
- **Tokens como CSS de arquivo.** Um plugin do Vite (`vite.config.ts`) entrega as variáveis como o módulo virtual `virtual:bairrin-tokens.css`. No build vira um arquivo `.css`, sem `<style>` nem `style=""` em tempo de execução, para a CSP não precisar de `unsafe-inline`.
- Os testes usam Vitest com jsdom e Testing Library. O Vitest esvazia arquivos `.css`; o teste que lê `pagina.css` o libera em `test.css.include`.
- `import.meta.env.VITE_API_URL` é declarado em `src/env.d.ts`.

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
