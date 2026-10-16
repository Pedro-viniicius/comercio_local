---
name: tsconfig-sem-dom
description: Pacotes @bairrin/* compilam com lib ES2023 e types [] (sem DOM/Node); como tipar fetch, AbortController e timers
metadata:
  type: project
---

Conferido em 2026-10-16 (etapa 6 do 01a, packages/cliente-api): `tsconfig.base.json` tem `lib: ["ES2023"]` e `types: []`, então `fetch`, `AbortController`, `setTimeout` e `URL` não existem em tipo.
- Solução sem mexer no tsconfig: interfaces mínimas próprias + `declare const AbortController: ...` / `declare function setTimeout(...)` no escopo do módulo (sombreia o global e não emite nada). Vale também nos testes (precisam do seu próprio `declare`).
- `@typescript-eslint/prefer-promise-reject-errors` reprova `rejeitar(erro)` com `unknown`; embrulhe em `Error`.
- Vitest 5: `vi.advanceTimersByTimeAsync` + `vi.getTimerCount()` bastam para testar tempo limite; o fetch falso deve rejeitar no `abort` do sinal, e o cliente também usa `Promise.race`-like para fetch que ignora o sinal.

**How to apply:** qualquer código compartilhado que use globais de plataforma (etapas 8 a 10 e 01b).
