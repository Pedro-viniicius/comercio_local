---
name: cliente-api-sessao
description: Armadilhas ao testar o cliente autenticado (packages/cliente-api/src/sessao.ts) e código assíncrono com fila única
metadata:
  type: project
---

Conferido em 2026-10-17 (01b, etapa 5 e correção S80/Q18):
- Laço de promessas só com microtarefas (fetch falso que resolve na hora + repetição que renova de novo) TRAVA o Vitest: o tempo limite do teste é por timer e nunca dispara. Nos testes de "não renova de novo", faça a 2ª renovação ser recusada (contador no fetch falso) para a mutação falhar em vez de travar.
- `carregamento ??= carregar()` com `finally { carregamento = undefined }` dentro do `async carregar()`: se o `ler()` lança síncrono, o `finally` roda ANTES da atribuição e a promessa rejeitada fica guardada para sempre. Limpe no chamador (`if (carregamento === leitura) carregamento = undefined`).
- Prova de que os testes pegam falha sem `git stash` (outros `dev` em paralelo): copie o `.ts` para o scratchpad, aplique a mutação com um `python3 -c` que faz `replace`, rode `pnpm exec vitest run <arquivo>` dentro do pacote e restaure com `cp` + `cmp`.
- Promessa iniciada cedo e esperada depois (ex.: limpar o aparelho em paralelo ao DELETE) não pode rejeitar enquanto ninguém a espera: o Vitest acusa "unhandled rejection". Faça a função devolver `{ erro }` em vez de rejeitar e relance no fim (padrão de `encerrarNoAparelho`/`definirPendente`, S80).
- Mutação em lote: um `mutar-<id>.py <arquivo> <velho> <novo>` no scratchpad (o scratchpad é dividido com outros agentes da sessão: um `mutar.py` genérico foi sobrescrito por outro agente em 2026-10-18; use nome com o ID do achado) (assert + replace 1x) e uma função shell `mut` que aplica, roda `pnpm exec vitest run` e restaura com `cp`; 11 mutações em ~1 min.
- Testes do qa contam voltas de microtarefa (`for (5x) await Promise.resolve()`) antes de conferir que a sessão foi limpa: um `await` a mais antes de `encerrarNoAparelho` (ex.: ler outro armazenamento) reprova. Faça a limpeza síncrona logo depois de `obterSessao` e leia o resto em paralelo.
- `@typescript-eslint/no-base-to-string` reprova `String(x)` com `x: unknown` no teste; use `JSON.stringify(x) ?? ''`.

- Desde a 5c (2026-10-18), `OpcoesDoClienteAutenticado` é união: `modoDeRenovacao: 'token'` exige `clienteDoApp` (o nome `cliente` já é o `ClienteApi`), e `criarClienteAutenticado` lança `TypeError` sem ele. Os `montar` dos testes passam `clienteDoApp: 'app_consumidor'` sempre (o ramo `cookie` aceita e ignora), e os corpos de renovação esperados nos testes levam `cliente`. Testes que simulam a API podem validar o corpo com `renovarSessaoSchema` real (400 se faltar o `cliente`).
**How to apply:** etapas 12 (provedor de sessão no `mobile-base`) e 15 (painel) usam este cliente; ver [[tsconfig-sem-dom]] para os `declare` de `setTimeout` nos testes.
