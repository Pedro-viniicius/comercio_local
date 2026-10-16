---
name: project-design-base
description: Onde ficam marca Bairrin, tokens, wireframes e specs de UI do marketplace local; decisões de marca aprovadas e pontos recorrentes (atualizado 2026-10-16)
metadata:
  type: project
---

Marca **Bairrin** escolhida e identidade aprovada pelo dono em 2026-10-16 (fonte do sistema, paleta azul `blue.600` #1F5BD1 + verde discreto, ícone pino com toldo e ponto verde). Slogan recomendado "lojas do seu bairro".
- `docs/produto/specs/00-nome-e-identidade.md`: paleta com contraste, tipografia, tom de voz, seção 2.7 com SVGs finais e lista de assets `assets/brand/bairrin-*`.
- `docs/produto/specs/00-design-system.md`: tokens neutros e componentes (inclui status de retirada e chip de modalidade).
- `docs/produto/specs/00-wireframes-apps.md` (C1–C9, L1–L5) e `00-wireframes-painel.md` (P1–P6).
- `docs/produto/specs/01-fundacao-identidade.md`: telas de conta A1–A7 e painel P1–P1c.

Stack (plano `docs/produto/planos/00-arquitetura.md`): Expo (apps), React+Vite (painel), tokens em `packages/tokens`, telas de conta em `packages/mobile-base/src/telas`. Designer não toca `apps/api`, `packages/contratos`, `packages/cliente-api`, `packages/mobile-base/src/{sessao,fila-offline}`.

Pontos recorrentes: mensagens de identidade nunca revelam se a conta existe (CA-02/04/06) — inclusive bloqueio, sem contagem; borda de campo `neutral.400` (o cinza mais claro reprova 3:1); local de textos de interface e de componentes base ainda não definido pelo arquiteto (perguntado em 2026-10-16).

**Why:** contexto para as próximas fatias (02 em diante) reutilizarem marca, tokens e padrões.
**How to apply:** conferir se as perguntas em aberto das specs foram respondidas antes de assumir local de arquivos.
