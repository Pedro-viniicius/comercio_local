# syntax=docker/dockerfile:1
# Imagem do painel (S9): build estático do Vite servido pelo Caddy, sem root.
# Contexto = raiz do monorepo: docker build -f apps/painel/Dockerfile -t bairrin-painel .

# ---- 1. Build do painel ----
FROM node:26.12.1-trixie-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec AS construcao

# pnpm na versão do campo `packageManager` do package.json da raiz, via corepack.
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /repo

# Só os manifestos do painel e dos pacotes de que ele depende: a camada de dependências fica em
# cache enquanto eles não mudam. A cópia é por arquivo (e não da pasta) para nunca levar `.env`,
# `node_modules` ou `dist` da máquina de quem constrói. Novo pacote `@bairrin/*` usado pelo
# painel precisa entrar aqui e no bloco do código-fonte abaixo.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/painel/package.json apps/painel/
COPY packages/cliente-api/package.json packages/cliente-api/
COPY packages/contratos/package.json packages/contratos/
COPY packages/tokens/package.json packages/tokens/

# `painel...` instala o painel e as dependências dele; a API (e o `prisma generate` do
# postinstall dela) fica de fora.
RUN pnpm install --frozen-lockfile --filter painel...

# Código-fonte. O bundle do painel lê os pacotes pelo fonte (condição `@bairrin/fonte`), mas o
# Vite carrega o `vite.config.ts` (que importa `@bairrin/tokens`) sem essa condição, pelo `dist`:
# por isso os pacotes também são compilados, antes do painel.
COPY packages/cliente-api/src packages/cliente-api/src
COPY packages/cliente-api/tsconfig.json packages/cliente-api/tsconfig.build.json packages/cliente-api/
COPY packages/contratos/src packages/contratos/src
COPY packages/contratos/tsconfig.json packages/contratos/tsconfig.build.json packages/contratos/
COPY packages/tokens/src packages/tokens/src
COPY packages/tokens/tsconfig.json packages/tokens/tsconfig.build.json packages/tokens/
COPY apps/painel/index.html apps/painel/vite.config.ts apps/painel/tsconfig.json apps/painel/tsconfig.app.json apps/painel/tsconfig.node.json apps/painel/
COPY apps/painel/src apps/painel/src

# Endereço da API embutido no bundle (não é segredo). Fixo: a CSP do Caddyfile só libera esta
# origem em `connect-src`; trocar um exige trocar o outro.
ENV VITE_API_URL=https://api.bairrin.com.br
# `painel...` roda o build em ordem topológica: tokens, contratos e cliente-api, depois o painel.
RUN pnpm --filter painel... run build

# ---- 2. Servidor ----
FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f

# O binário da imagem oficial traz a capability `cap_net_bind_service` (para portas < 1024).
# A porta é 8080, então a cópia sem atributos estendidos tira a capability: o processo roda sem
# nenhum privilégio, inclusive com `--cap-drop ALL` e `no-new-privileges`.
RUN cp /usr/bin/caddy /tmp/caddy \
    && mv /tmp/caddy /usr/bin/caddy \
    && addgroup -S -g 10001 painel \
    && adduser -S -D -H -u 10001 -G painel -s /sbin/nologin painel

COPY apps/painel/Caddyfile /etc/caddy/Caddyfile
COPY --from=construcao /repo/apps/painel/dist /srv

USER 10001:10001
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
