# Retomada do trabalho (troca de computador, 2026-10-31)

Nota do lead para continuar em outra máquina. A memória da sessão (`~/.claude/projects/...`) e o scratchpad (`/tmp/...`) não vão pelo git; o essencial está aqui e em `docs/produto/decisoes.md`.

## Onde paramos

- **Na `main`, revisado:** plano 01a completo, trilha "API e painel" do 01b (grupos 0, A–F) e o grupo M1 da trilha mobile (etapas 8 e 9 do 01a, 1b do 01b: apps Expo e `packages/mobile-base`), mais `assets/brand`, cache do Vitest por pacote (Q35) e a correção do workflow `android-nativo` (`eac050f`).
- **No commit de retomada, ainda em revisão:** grupo **M2** do 01b (etapas 12 e 12a) e a integração do lead (sessão no `src/index.ts`, `urlDaApiConfigurada` nos apps, ícones no `app.config.ts`, `assets/` na cópia do `instalacao-limpa`), docs do R11, registros no plano (R9, R12, S132, R14) e `CLAUDE.md` com `src/instalacao` como regra de negócio.

## Revisão do M2, rodada 1 (relatórios em `m2-r1/`)

| Agente | Veredito | Obrigatórios |
|---|---|---|
| designer | MUDANÇAS NECESSÁRIAS | D10 (modal sem rolagem a 200%), D11 (✓ da caixa de seleção cresce), D12 (selo com altura fixa) |
| revisor | MUDANÇAS NECESSÁRIAS | R8 (troca de conta com fila travada: estado `com_sessao` falso e sessão nova órfã; = S131), R9 (`substituirSessao` para a verificação de e-mail), R10 (lint próprio de `src/instalacao`), R11 (docs: feito pelo lead), R12 (registro no plano: feito pelo lead) |
| seguranca | SEM BLOQUEIOS | — (baixas a fazer: S127 = R13 converter sessão antiga em revogação pendente na 1ª abertura; S129 `visible-password` no Android) |
| qa | APROVADO COM RESSALVAS | — (baixos Q36 = R8/S131, Q37 máscara aceita +54 como DDD 54, Q38 data impossível em `formatarDataLegal`; os 3 testes estão como `it.failing`: trocar por `it` ao corrigir) |

Sugestões aceitas para a mesma rodada: R15 = D15 (tipar `tela` do `mensagemDoCampo`), R16 (cache próprio do `test:integracao` da API e o teste estrutural olhar todo script com vitest), R17 (`gerar-png.sh` apaga e confere o PNG; teste do cabeçalho dos PNG), S128 (tirar `criarCofreDaSessao`, `CHAVE_DA_SESSAO` e `criarSessaoDoApp` do índice público; `expo-secure-store` só em `armazenamento-seguro.ts`), D13, D14, D16–D20, R14, R18, R19.

## Próximo passo

1. Rodada de correção do M2 em paralelo, sem arquivo em comum: `designer` (D10–D14, D16–D20 em `src/componentes`) e `dev` com `model: opus` (etapa 12 é sensível: R8/S131, R9, R10, S127, S129, S128, R15, R16, R17, Q36, Q37 e Q38).
2. Rodada 2 com `qa`, `revisor`, `seguranca` e `designer`; verificação completa do lead; commit e push.
3. Depois: M3 (etapa 14, telas de conta) e M4 (17, 18, 20b).

## Cuidados nesta máquina (podem valer na outra)

- O `/tmp` tinha cota por usuário: rode testes com `TMPDIR=$HOME/.cache/bairrin-tmp` e nunca com `TMPDIR` dentro de `node_modules`.
- Cópia ou worktree com "bairrin" no caminho quebra `smtp.adaptador.test.ts` (o teste procura `/bairrin/` na pilha): não é bug.
- `pnpm audit --prod` tem 2 moderadas e 1 baixa via expo/jest (minimatch, glob, deepmerge): informativas, sem override (correção salta major).
- Antes de delegar `dev`, confira com `ListAgents` se outra sessão do lead está ativa no mesmo diretório.
