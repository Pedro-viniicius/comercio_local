---
name: config-claude-code
description: Como revisar mudança em CLAUDE.md, .claude/agents, hooks, settings e statusline do Bairrin (escopo lead x subagente, hooks dos agentes, deny quebrado no settings do usuário)
metadata:
  type: project
---

Pontos que renderam achado na revisão da configuração de modelos (2026-10-21, rodada 1):

- Seção `##` nova no CLAUDE.md fica fora de "Equipe de agentes" (a única que diz "subagente, siga o seu arquivo"); regra escrita para o lead (ler trechos, rodar só testes relacionados, resumo curto) passa a valer para revisor/qa/dev e contradiz os arquivos deles.
- `arquiteto.md` tem hook PreToolUse que só deixa gravar em `docs/produto/planos/` e na memória dele: qualquer regra que mande o arquiteto gravar em outro lugar (ex. `docs/planos/`) falha.
- Agente novo que edita precisa entrar na regra do lead de "não editar arquivos em comum ao mesmo tempo"; `pnpm format` é `prettier --write .` (repo inteiro).
- `~/.claude/settings.json` do dono: `permissions.deny` é UMA string com `\r` no meio (inválida), então não há deny de `.env` efetivo; `apps/painel/.env.local` existe. Decisão do dono (r2, 2026-10-21): o projeto tem `permissions.deny` próprio em `.claude/settings.json` (`**/.env`, `.env.local`, `.env.*.local`, `.env.production`); o global fica com o dono, não reabrir como achado. O `statusLine` do usuário mostra rate_limits (5h/semana); o do projeto sobrescreve.
- `.claude/` e `CLAUDE.md` estão no `.prettierignore`; `*.log` cobre `.claude/logs/`.

**Why:** CA "sem contradizer o restante do CLAUDE.md" é o que mais falha nesse tipo de mudança.
**How to apply:** em mudança de configuração, cruze cada regra nova com os arquivos dos agentes (inclusive hooks no frontmatter) e com o settings do usuário (só chaves, nunca `env`). Ver [[heuristicas-de-revisao]].
