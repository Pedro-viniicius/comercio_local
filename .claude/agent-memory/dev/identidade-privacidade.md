---
name: identidade-privacidade
description: Privacidade da Identidade (01b/11) — semântica escolhida para pendências, chave do freio por e-mail, uso único com marcarBaixada booleano, typecheck isolado com outros dev em paralelo
metadata:
  type: project
---

Feito em 2026-10-18 (etapa 11 do 01b, rodada 1), em `aplicacao/privacidade/`:
- Pendências na exclusão (CA-11): a spec deixou aberta a pergunta 2 (aguarda ou recusa). Escolhi: conta continua ativa, solicitação `aguardando_pendencias` (reaproveitada no pedido repetido; vira `pendente` quando a exclusão acontece) e resultado `com_pendencias` (409). Ninguém reprocessa `aguardando_pendencias` no 01b: confira se o dono/arquiteto decidiu antes de mexer.
- Solicitação de exclusão `pendente` = conta desativada esperando anonimização; `AnonimizarContaCasoDeUso` a conclui (com a conta travada, Q24). A tarefa da etapa 13 deve usar `listarPorStatus('exclusao', 'pendente', n)`.
- Chave do freio por e-mail: desde 2026-10-19 só em `aplicacao/comum/chaves.ts` (`chaveDoFreioPorEmail(cifrador, Email)`), usada por login, redefinição e exclusão. A do 2FA fica em `segundo-fator/comum.ts`.
- Corrida exclusão × redefinição: as duas travam o freio por e-mail e só então releem a conta. Desde S95 nenhuma das duas grava a conta inteira (`gravarDesativacao`, `gravarSenhaRedefinida`), e a exclusão confere a senha fora da transação (S91), relendo a conta e comparando o hash na conclusão.
- Resolvido na etapa 7 (2026-10-18): `marcarBaixada` devolve `boolean` (`WHERE baixada_em IS NULL`); `false` → erro sentinela privado dentro da unidade, traduzido fora para `indisponivel`. `listarConsentimentos(contaId)` traz o histórico de aceites (com `tipo` e `versao`) e alimenta a exportação. Concorrência no fake: subclasse no teste cujo `buscarDisponivel` espera as duas leituras (barreira) antes de seguir.
- Verificar só os meus arquivos com outro `dev` quebrando o `tsc -p apps/api/tsconfig.json`: tsconfig no scratchpad com `"extends": "<abs>/apps/api/tsconfig.json"` e `"include": ["<abs>/.../privacidade/*.ts"]`, rodado de `apps/api` com `pnpm exec tsc -p <scratch>/tsconfig.json`. Funciona (inclui os testes e os fakes que eles importam).
- Mutação rápida para provar que o teste pega a regra: copiar o arquivo para o scratchpad, trocar uma linha com `python3 -c ... replace`, rodar o vitest da pasta e restaurar com `cp`.

**How to apply:** etapas 13, 16 e 19 do 01b e qualquer mudança em exclusão/exportação. Relacionado: [[identidade-dominio]].
