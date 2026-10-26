---
name: docs-identidade-20a
description: Docs da Identidade (01b/20a) — fontes de verdade, o que o Sentry não recebe, ordem dos limites mudou na 19, armadilha de regex em tabela Markdown
metadata:
  type: project
---

Conferido em 2026-10-23 (etapa 20a, em paralelo com a 19):
- Fonte dos fatos: comentários de topo de `modulos/identidade/**` (casos de uso, `dominio/repositorios.ts`, `infra/cripto/*`, `http/*`), `compartilhado/http/*` e `compartilhado/http/autenticacao/*`; o plano só aponta. README da API (`apps/api/README.md`) já trazia parte do HTTP e do Identidade: não duplicar, citar.
- O Sentry do projeto só envia `captureException` de erro HTTP; o `warn` do pino (alerta dos 25 dias da anonimização) NÃO chega ao Sentry. Alerta desse `warn` precisa de log shipping do Fly ou de código novo (`captureMessage`). Texto do warn: `exclusão pendente há mais de 25 dias da desativação: o prazo de 30 dias está perto` (contexto `AnonimizarContasTarefa`, campos `contaId` e `prazoDeAnonimizacao`).
- A etapa 19 mudou a ordem do `LimitePorRotaGuard` para conta → IP → e-mail (era IP primeiro, S109) e criou `@ConfereSessao()` (guarda confere o `sid` fora do admin). Doc escrita com a ordem nova; reconferir contra o código final da 19.
- `GET /v1/conta` e a exclusão têm `conta_indisponivel` → 401 (exceção ao "401 só da guarda"), além de `sessao_invalida` na verificação de e-mail.
- Armadilha: `re.sub(..., r"\1200 ...")` lê `\120` como grupo 120 e corrompe a linha da tabela; use `\g<1>200`.
- `pnpm exec prettier --write` nos 3 arquivos antes do `--check`: tabela Markdown é realinhada.

**How to apply:** próximas docs de módulo (README de módulo, ADR) e reconferência da 19.
