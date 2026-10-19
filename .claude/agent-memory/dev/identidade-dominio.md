---
name: identidade-dominio
description: Domínio de Identidade (01b/4) — CHECKs da migração espelhados no domínio, janela_inicio NOT NULL, fakes com rollback, lint dos fakes
metadata:
  type: project
---

Conferido em 2026-10-17 (etapa 4 do 01b, em paralelo com a etapa 3):
- A migração `20261017120000_identidade` tem CHECKs que o plano não lista (telefone nulo só em anonimizada, painel com `expira_absoluto_em`, par novo e prazo juntos, `mfa` só no painel, `janela_inicio` NOT NULL) e colunas fora da tabela do plano (`sessoes.criada_em`, `codigos_verificacao.criado_em`, `exportacoes_titular.criada_em`). Antes de mexer em entidade de identidade, leia a migração, não só o plano. O domínio replica os CHECKs em `validarEstado` (construtor de Conta e Sessao).
- Freio (`BloqueioDeLogin`): como `janela_inicio` é NOT NULL, "sem janela aberta" é `falhas = 0`; `novo()` recebe `agora`.
- Fakes (desde a rodada 1 de R1/S77/Q17, 2026-10-17): `UnidadeDeTrabalhoFalsa`, `PublicadorDeEventosFalso` e `comoPromessa` ficam em `test/fakes/compartilhado/`. A unidade usa AsyncLocalStorage e registro de desfazer por unidade (não mais instantâneo global: duas unidades concorrentes se atropelavam), e `travar(chave)` imita `FOR UPDATE` (sem detecção de deadlock). Todo repositório em memória recebe a unidade no construtor. Métodos sem `await` devolvem `comoPromessa(...)` por causa do `require-await`.
- Portas com trava (R1): `buscarParaAtualizar` (freio), `buscarVigenteParaAtualizar` (código), `buscarPorIdParaAtualizar` (desafio), `gravarRotacao` (UPDATE condicionado + histórico `tokens_de_renovacao_usados`, S77). Desde R7 (rodada 3): `gravarRotacao` = `WHERE id AND token_hash = trocado AND revogada_em IS NULL` e SET só das colunas da rotação; `atualizar` de sessão grava só a revogação com `coalesce` (o fake recusa sessão não revogada). Armadilha geral: UPDATE condicionado que regrava a entidade inteira lida sem trava ressuscita colunas que outra transação mudou (READ COMMITTED reavalia só o WHERE).
- Trigger `contas_so_expurgo` (S78): DELETE em `identidade.contas` só passa para conta ativa, não verificada, sem admin/lojista e criada/logada há mais de 7 dias, inclusive para o dono. Teste que apaga conta (ou limpa dados comitados como dono) precisa de `criada_em = now() - 8 days`. O fake confere só a parte sem tempo.
- `documentos_legais` é só SELECT para `bairrin_app` (S79): teste que precisa de documento grava como dono e apaga no `finally`; o seed usa `DATABASE_URL_MIGRACAO`.
- Cuidado: `prettier --write` numa pasta que contém diretório de outro dev em paralelo (ex.: `modulos/identidade` com `http/` da 5b) formata os arquivos dele; passe só as subpastas suas.
- Etapa em paralelo com a 5b: `test/fronteiras/validadores-puros.test.ts` reprova se `packages/contratos/src/validadores` importar subpasta (`./dados/...`); não é do domínio, é da 5b.

**How to apply:** etapas 6 a 13 do 01b e qualquer mudança em entidade da Identidade.
