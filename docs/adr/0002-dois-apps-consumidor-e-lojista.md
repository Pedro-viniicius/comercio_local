# ADR-002: Dois apps (consumidor e lojista) com pacotes compartilhados

- Situação: aceita (decisão do dono, 2026-10-16).
- Origem: `docs/produto/planos/00-arquitetura.md`, abordagem 2.

## Contexto

Consumidor e lojista têm jornadas, permissões e urgências diferentes. As opções eram dois apps, um app com troca de perfil ou um código com duas variantes de build.

## Decisão

Dois apps Expo no monorepo, `apps/consumidor` ("Bairrin", `br.com.bairrin.consumidor`, scheme `bairrin`) e `apps/lojista` ("Bairrin Lojista", `br.com.bairrin.lojista`, scheme `bairrin-lojista`). O que for comum fica em `packages/` (`@bairrin/contratos`, `@bairrin/cliente-api`, `@bairrin/tokens` e, depois, `@bairrin/mobile-base`).

O identificador `br.com.bairrin` segue o domínio invertido de um domínio nosso (`bairrin.com.br`, a registrar). É permanente nas lojas, por isso não usa `app.bairrin`.

## Consequências

- Cada app pede só as suas permissões (câmera no lojista, localização no consumidor) e tem canal de push de alta prioridade só onde precisa (lojista).
- Releases independentes e fichas separadas nas lojas, ao custo de dois builds e duas fichas para manter.
- Código comum só entra em `packages/`. Um app nunca importa o outro, e nenhum app ou pacote importa `apps/api` (regra de `pnpm deps:verificar`).
- Situação do código: os dois apps ainda não existem; só as pastas com `.env.example`.
