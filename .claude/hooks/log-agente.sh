#!/usr/bin/env bash
# PreToolUse da ferramenta de subagentes (Agent; "Task" nas versões antigas).
# Acrescenta: data hora | agente | modelo em .claude/logs/agentes.log
in=$(cat)
raiz="${CLAUDE_PROJECT_DIR:-$(pwd)}"
agente=$(jq -r '.tool_input.subagent_type // "general-purpose"' <<<"$in")
modelo=$(jq -r '.tool_input.model // empty' <<<"$in")
if [ -z "$modelo" ]; then
  # sem override: usa o model do frontmatter do agente
  modelo=$(sed -n 's/^model:[[:space:]]*//p' "$raiz/.claude/agents/$agente.md" 2>/dev/null | head -1)
fi
mkdir -p "$raiz/.claude/logs"
limpa() { tr -d '|\n\r' <<<"$1"; }
printf '%s | %s | %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$(limpa "$agente")" "$(limpa "${modelo:-herdado}")" >> "$raiz/.claude/logs/agentes.log"
exit 0
