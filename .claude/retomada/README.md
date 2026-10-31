# Retomada do trabalho (troca de computador, 2026-10-31)

Nota do lead para continuar em outra máquina. A memória da sessão (`~/.claude/projects/...`) e o scratchpad (`/tmp/...`) não vão pelo git; o essencial está aqui, em `docs/produto/decisoes.md` e no plano `docs/produto/planos/01b-identidade.md`.

## Onde paramos

- **Na `main`, revisado e fechado:** plano 01a completo, trilha "API e painel" do 01b (grupos 0, A–F), M1 (etapas 8 e 9 do 01a, 1b do 01b) e **M2** (etapas 12 e 12a do 01b: sessão dos apps e componentes base), com duas rodadas de revisão.
- **Revisão do M2:** rodada 1 em `m2-r1/` (achados); correções e rodada 2 em `m2-r2/`. Na rodada 2: `qa` APROVADO, `revisor` e `designer` APROVADO COM RESSALVAS (sugestões D21 e R21 feitas pelo lead; R20 registrada no plano), `seguranca` SEM BLOQUEIOS.
- Pendências para os próximos planos estão no 01b, seção "Pendências para os planos seguintes" (S132, S130, R14/props `cofre`/`agora`, R20, fila com id da conta, lint global de `expo-secure-store`, splash na etapa 17, Sentry, sucesso do Botão).

## Próximo passo

1. **M3:** etapa 14 do 01b (telas de conta nos apps: cadastro, entrar, verificação de e-mail com `substituirSessao`, recuperação, privacidade). Fluxo: `dev` (ver no plano se a etapa é sensível → `model: opus`) → `qa`, `revisor`, `designer`, `seguranca` em paralelo.
2. **M4:** etapas 17, 18 e 20b. A 17 traz `expo-splash-screen` (dependência nova: pedir aprovação do dono).
3. Pendências baixas: S118 (body-parser `inflate: false`), S114 residual, Q32 (painel sob carga), favicon do painel, peso 700 × 600 do wordmark (decisão do dono), audit moderado/baixo via expo/jest (sem override).
4. Verificação no aparelho (TalkBack/VoiceOver, fonte a 200%, 320 px) quando as telas montarem os componentes.

## O que não vai pelo git (e onde ficou)

- `memoria-do-lead/`: cópia da memória do lead (`~/.claude/projects/<projeto>/memory/`). Na outra máquina, copie para a pasta de memória do projeto lá (o nome da pasta depende do caminho do repositório: `~/.claude/projects/<caminho-com-hífens>/memory/`).
- `logs/agentes.log.txt`: cópia do registro de chamadas de subagentes (`.claude/logs/` e `*.log` são ignorados pelo git). Se quiser manter o histórico do `/relatorio`, copie para `.claude/logs/agentes.log`.
- **Não copiado, de propósito (segredos):** `apps/painel/.env.local` e `apps/painel/.vercel/`. Recrie a partir do `.env.example` (e `vercel link`) ou leve à mão, fora do git.
- Gerados (não precisam ir): `dist/`, `node_modules/`, `apps/*/.expo/`, `apps/api/src/compartilhado/infra/gerado/` (refeitos por `pnpm install`, `pnpm build` e o `prisma generate`).

## Cuidados (valeram nesta máquina; podem valer na outra)

- O `/tmp` tinha cota por usuário: rode testes com `TMPDIR=$HOME/.cache/bairrin-tmp` e nunca com `TMPDIR` dentro de `node_modules`.
- Cópia ou worktree com "bairrin" no caminho quebra `smtp.adaptador.test.ts` (o teste procura `/bairrin/` na pilha): não é bug.
- `scripts/instalacao-limpa.test.mjs` pode estourar o tempo do primeiro teste do Jest com cache frio e máquina carregada; isolado, passa.
- `pnpm test:integracao` exige `docker compose -f infra/docker-compose.yml up -d`.
- Antes de delegar `dev`, confira com `ListAgents` se outra sessão do lead está ativa no mesmo diretório.
