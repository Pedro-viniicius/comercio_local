---
description: Relatório de uso de agentes e modelos (lê .claude/logs/agentes.log)
allowed-tools: Bash(cat:*), Bash(awk:*), Bash(sort:*), Bash(wc:*), Read
---

Leia `.claude/logs/agentes.log` (formato `data hora | agente | modelo`). Se não existir ou estiver vazio, diga que ainda não há registros e pare.

Mostre, em português:

1. Tabela com o total de chamadas por agente (ordem decrescente) e por modelo, com a porcentagem de cada um.
2. Gráfico de barras em ASCII (`█`, uma barra por linha, proporcional ao maior valor) para agentes e outro para modelos.
3. Uma linha de conclusão: `arquiteto`, `revisor` e `seguranca` são opus por definição e não contam como desvio. Aponte as chamadas com opus em agente que não é de modelo fixo (override em `dev`, `explorador`, `executor-simples`, `qa`, `designer`) e as linhas `herdado`, que usam o modelo da sessão principal.

Use `awk`/`sort` para contar; não releia o log mais de uma vez.
