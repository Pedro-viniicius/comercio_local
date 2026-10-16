---
name: riscos-aceitos
description: Riscos que o dono do Bairrin aceitou explicitamente; não voltam como achado salvo se a mitigação deixar de valer
metadata:
  type: project
---

Nenhum risco de segurança aceito pelo dono até 2026-10-16.

Não confundir com riscos já decididos no produto que não são aceite de achado: telefone sem verificação por SMS (decisão do dono em `docs/produto/decisoes.md`); bloqueio direcionado de conta por até 15 min aceito como efeito do CA-04 pelo próprio brief (o plano 01b diz "nunca bloqueio definitivo").

Pendente de registro pelo dono (2026-10-16): conta criada com e-mail alheio pode ser usada sem pagar até o titular recuperar a senha (consequência do login sem verificação). Reabre se alguma ação além de navegar/carrinho dispensar verificação (ex.: criar loja).

Pendente de decisão do dono (levantado em 2026-10-16, revisão do 01a): EAS Update sem assinatura de código (exige plano pago do Expo). Antes das etapas 8/9 ligarem updates: desligar `expo-updates` ou registrar aceite com MFA na conta Expo e poucas pessoas com permissão de publicar.

Ao registrar um aceite: data, ID do achado, mitigação declarada e o fato que reabriria.

Relacionado: [[areas-sensiveis]]
