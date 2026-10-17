---
name: feedback-escrita-so-com-edit
description: O plano e a memória se gravam só com Edit/Write; nada de sed -i ou script pelo Bash, nem no próprio plano
metadata:
  type: feedback
---

Gravar o plano (`docs/produto/planos/<slug>.md`) e a memória só com as ferramentas Edit e Write. Nada de `sed -i`, heredoc ou python pelo Bash, mesmo no arquivo do plano.

**Why:** o meu arquivo de agente limita o Bash à inspeção. Em 2026-10-16, ao fechar as perguntas da revisão do grupo A do 01b, fiz ajustes no plano com `sed -i` e python e tive de avisar o lead.

**How to apply:** para trocas repetidas em linhas longas da tabela de etapas, usar vários Edit com trecho único em vez de script.
