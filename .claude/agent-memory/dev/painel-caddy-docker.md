---
name: painel-caddy-docker
description: Imagem do painel (Caddy 2.11 + build Vite) — handle_errors para cabeçalhos em 404/405, capability do binário, contexto do fly.toml, teste de CSP no Chrome headless
metadata:
  type: project
---

Conferido em 2026-10-16 (etapa 15 do 01a; caddy:2.11.7-alpine, node:22.23.3-trixie-slim, flyctl main):
- Caddy: sem `handle_errors`, respostas de erro (404 do file_server, 405 de POST) saem SEM os cabeçalhos do `header` e COM `Server: Caddy` (o `-Server` adiado não se aplica). Solução: snippet de cabeçalhos importado no site e no `handle_errors` com `respond "{err.status_code} {err.status_text}" {err.status_code}`.
- `header @m Cache-Control ...` com `@m file` dentro de `handle /assets/*` evita gravar `immutable` num 404.
- O binário da imagem oficial tem `cap_net_bind_service=ep`: `cp` + `mv` tira o xattr (busybox não preserva). Assim roda com `--cap-drop ALL --security-opt no-new-privileges --read-only` (só um log de erro de limpeza do storage TLS em /data, inofensivo). /data/caddy e /config/caddy já são 1777.
- `caddy validate`/`caddy fmt` rodam na própria imagem com o Caddyfile montado.
- Vite carrega `vite.config.ts` SEM a condição `@bairrin/fonte`. Desde 2026-10-16 o config lê os tokens pelo fonte (`runnerImport`, ver [[painel-vite-vitest]]) e `pnpm --filter painel build` passa num clone limpo; o Dockerfile ainda usa `pnpm --filter painel... run build` (topológico), o que não atrapalha.
- flyctl resolve `[build] dockerfile` relativo à pasta do fly.toml; o contexto é o diretório do `fly deploy` (raiz). `fly deploy -c apps/painel/fly.toml` a partir da raiz.
- Prova de CSP sem navegador de teste no repo: o log `INFO:CONSOLE` do `--enable-logging` parou de sair no Chrome 152 (2026-10-19); use a sonda `securitypolicyviolation` descrita em [[painel-vite-vitest]]. Faça sempre um controle negativo para provar que a sonda pega a violação.

**How to apply:** imagem da API (etapa 13), mudanças no painel que mexam em CSP (fontes, imagens, Sentry: `connect-src` precisa do ingest), homologação com outra URL de API. Ver [[painel-vite-vitest]].
