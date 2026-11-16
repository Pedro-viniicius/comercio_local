# syntax=docker/dockerfile:1
# Imagem da API e do worker (o mesmo código; o processo sai do fly.toml), sem root e sem `.env`.
# Contexto = raiz do monorepo: docker build -f apps/api/Dockerfile -t bairrin-api .
#
# A imagem final leva só: package.json, node_modules de produção (pnpm deploy --prod), dist (com
# o client do Prisma gerado), as migrações (prisma/ e prisma.config.ts, para o release_command) e
# a CA do Supabase. Nenhuma variável de ambiente com valor real: os segredos chegam pelo Fly.

# ---- 1. Build ----
FROM node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS construcao

# pnpm na versão do campo `packageManager` do package.json da raiz, via corepack.
# CHECKPOINT_DISABLE: o Prisma não consulta o servidor de versões no build.
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CHECKPOINT_DISABLE=1
RUN corepack enable

WORKDIR /repo

# Só os manifestos da API e dos pacotes de que ela depende: a camada de dependências fica em cache
# enquanto eles não mudam. A cópia é por arquivo (e não da pasta) para nunca levar `.env`,
# `node_modules` ou `dist` da máquina de quem constrói. Novo pacote `@bairrin/*` usado pela API
# precisa entrar aqui e no bloco do código-fonte abaixo. O schema e o prisma.config.ts entram
# antes da instalação porque o postinstall da API roda `prisma generate`.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
COPY packages/contratos/package.json packages/contratos/

# `api...` instala a API e as dependências dela (o painel e os apps ficam de fora). O lockfile
# não muda (`--frozen-lockfile`) e as regras de cadeia de suprimentos do pnpm-workspace.yaml
# (idade mínima, allowBuilds) valem aqui como na máquina de quem desenvolve.
RUN pnpm install --frozen-lockfile --filter api...

COPY packages/contratos/src packages/contratos/src
COPY packages/contratos/tsconfig.json packages/contratos/tsconfig.build.json packages/contratos/
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/
COPY apps/api/src apps/api/src

# Ordem topológica: `@bairrin/contratos` (a API importa o dist dele em produção), depois a API.
RUN pnpm --filter api... run build

# Dependências de produção num diretório próprio, com `@bairrin/contratos` copiado (não ligado).
# `--ignore-scripts`: o postinstall da API (`prisma generate`) já rodou acima e o client gerado
# está no dist; no deploy de produção ele falharia, porque `prisma` é dependência de dev.
#
# O CLI do Prisma (o `release_command` roda `prisma migrate deploy`) já vem no deploy como par
# de `@prisma/client`, mas sem atalho na raiz do node_modules: o passo abaixo cria
# `node_modules/prisma` e `node_modules/.bin/prisma` apontando para ele, e falha se não achar o
# CLI ou o schema engine (o binário que aplica as migrações).
RUN pnpm --filter api deploy --prod --ignore-scripts /saida \
    && cd /saida \
    && CLI="$(node -e "const p=require('node:path');const c=p.dirname(require.resolve('@prisma/client/package.json'));process.stdout.write(p.relative('node_modules',p.dirname(require.resolve('prisma/package.json',{paths:[c]}))))")" \
    && ln -s "$CLI" node_modules/prisma \
    && ln -s ../prisma/build/index.js node_modules/.bin/prisma \
    && node node_modules/prisma/build/index.js --version \
    && ls node_modules/.pnpm/@prisma+engines@*/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x

# ---- 2. Execução ----
FROM node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc

ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1

WORKDIR /app

# Tudo de root e só leitura para o usuário do processo: a aplicação não altera o próprio código.
COPY --from=construcao /saida/package.json ./package.json
COPY --from=construcao /saida/node_modules ./node_modules
COPY --from=construcao /repo/apps/api/dist ./dist
COPY --from=construcao /repo/apps/api/prisma ./prisma
COPY --from=construcao /repo/apps/api/prisma.config.ts ./prisma.config.ts
# CA do Supabase para `sslmode=verify-full` (S21). Enquanto o arquivo do repositório for o aviso,
# a API, o worker e o release_command recusam subir em produção.
COPY infra/certificados/supabase-ca.crt /app/certificados/supabase-ca.crt

# Usuário sem privilégio da imagem oficial do Node (uid 1000).
USER node

EXPOSE 3000
# Processo padrão: a API HTTP. O fly.toml define os processos `app` e `worker` e o
# `release_command` (`node --run migrar`).
CMD ["node", "--enable-source-maps", "dist/main.js"]
