---
name: grupo-b-identidade-lacunas
description: Estado da revisão do grupo B do 01b (etapas 3, 4, 5, 12b) em 2026-10-17: Q17-Q19 fechados na rodada 2; Q20 (média) e Q21 (baixa) abertos, testes novos e lacunas
metadata:
  type: project
---

Grupo B, rodada 1 (2026-10-17). Testes do qa novos (todos verdes menos o Q17):
- `apps/api/src/modulos/identidade/dominio/bordas.test.ts` (fronteiras com valores do plano por extenso, propriedades com semente, nenhuma entidade expõe dado);
- `apps/api/src/modulos/identidade/aplicacao/portas/verificador-de-pendencias.bordas.test.ts`;
- `apps/api/test/fakes/identidade/fidelidade.test.ts` (cascata, FK, único, expurgo) e `unidade-de-trabalho-concorrente.test.ts` (VERMELHO de propósito: Q17);
- `apps/api/test/integracao/identidade/migracao-dominio.int.test.ts` (todo estado do domínio passa nos CHECKs e volta igual; sem repositório Prisma, SQL direto);
- `packages/cliente-api/src/sessao.bordas.test.ts`; `apps/painel/src/componentes/Campo.bordas.test.tsx`, `apps/painel/src/textos/mensagem-do-campo.digitacao.test.ts`.

Q17 (média): `UnidadeDeTrabalhoFalsa` usa um contador de profundidade global; duas `executar` concorrentes viram aninhadas (a 2ª rejeita com `PublicacaoForaDeTransacao` ou, se falha, não desfaz o que gravou). O adaptador real usa AsyncLocalStorage. Corrigir com ALS no fake (ou falhar alto na entrada concorrente) antes dos casos de uso da etapa 8 que testem corrida.

Lacunas baixas sondadas (sem teste vermelho): CHECK de e-mail só confere minúsculas e 254 (aceita vazio, sem @, acento; o comentário da migração diz "ASCII"); banco aceita `revogada_em` sem `motivo_revogacao` e `senha_hash` vazio, mas o domínio recusa remontar (leitura quebraria); `gravar` do armazenamento falhando na renovação ou `aoEncerrarSessao` lançando substituem o resultado da requisição; reuso só detecta o token imediatamente anterior (desvio declarado); `ultimo_login_em` não é atualizado pela renovação (expurgo de 7 dias pode apagar quem usa o app sem relogar); 401 em senha errada de rota autenticada faria o cliente renovar e repetir (duas falhas no freio); painel precisa de fetch com `credentials: 'include'` (etapa 15).

Mutação (cópia no scratchpad, 98 mutantes de domínio + 30 de aplicação/fakes + 34 do cliente + 28 do painel + 24 da migração): ficaram só equivalentes (F12, CA13, CA22, CA34, B21, S12, P1, P2, P4, M2). Cuidado em mutar: `pnpm --filter` reinstala; `npx vitest` na cópia basta.

**How to apply:** na rodada 2, rodar `pnpm --filter api exec vitest run test/fakes/identidade` e a integração (`pnpm --filter api test:integracao`); o `unidade-de-trabalho-concorrente.test.ts` deve ficar verde sem edição (se o dev optar por falhar alto, trocar o teste por um que espere o erro explícito).

**Rodada 2 (2026-10-17):** Q17, Q18, Q19, S77, R1, S78, S79, S80 e D1 comprovados (mutação: 17+3 mutantes de migração, 19 do cliente, 8 de domínio e 6 dos fakes, todos mortos menos equivalentes). Testes novos: `apps/api/test/integracao/identidade/migracao-bordas.int.test.ts` (limite exato da trigger, trigger fora do alcance da aplicação, histórico só de acréscimo, propriedade e-mail × CHECK, FOR UPDATE de código entre duas conexões, seed não sobrescreve), `apps/api/test/fakes/identidade/rotacao-e-revogacao.test.ts` (VERMELHO: Q20), `packages/cliente-api/src/sessao.revogacao.bordas.test.ts` (um teste VERMELHO: Q21), `apps/painel/src/textos/mensagem-do-campo.tela.test.ts`.
- Q20 (média): `gravarRotacao` não confere `revogada_em`: renovação que leu a sessão antes de uma revogação confirmar ressuscita a sessão (o fake e o modelo SQL dos testes gravam a entidade inteira, com `revogada_em = NULL`). Correção: `AND revogada_em IS NULL` no UPDATE e `false` no fake; documentar na porta. Vale para a etapa 7 (adaptador Prisma) e a 9.
- Q21 (baixa): `encerrarSessao` sobrescreve a revogação pendente anterior (um só slot): logout sem rede, login, logout sem rede de novo perde a credencial da 1ª conta.
- Lacunas: skew de relógio app × banco no limite de 7 dias faz o expurgo receber 23514 numa conta na fronteira (fail-closed; o caso de uso da etapa 11 deve tratar por conta); seed só se protege por NODE_ENV (como a spec manda); `encerrarSessao` sem sessão rejeita se `ler` da pendência falhar.
- Armadilhas: `now()` é fixo na transação (serve para testar fronteira exata); o dono também esbarra na trigger `contas_so_expurgo`, então limpeza de conta de teste exige `criada_em` com mais de 7 dias; `codigoDoErro` com SAVEPOINT desfaz também o INSERT que deu certo (use RELEASE quando precisar do efeito). Mutação: `numFailedTestSuites` conta o teste vermelho conhecido, ignore-o no script.
