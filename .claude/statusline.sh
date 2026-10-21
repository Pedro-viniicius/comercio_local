#!/usr/bin/env bash
# Status line: modelo | pasta | branch | custo | contexto | limites 5 h e semana. Uma linha, ANSI simples.
export LC_NUMERIC=C
in=$(cat)
modelo=$(jq -r '.model.display_name // .model.id // "?"' <<<"$in" 2>/dev/null)
dir=$(jq -r '.workspace.current_dir // .cwd // empty' <<<"$in" 2>/dev/null)
custo=$(jq -r '.cost.total_cost_usd // empty' <<<"$in" 2>/dev/null)
ctx=$(jq -r '.context_window.used_percentage // empty' <<<"$in" 2>/dev/null)
cinco=$(jq -r '.rate_limits.five_hour.used_percentage // empty' <<<"$in" 2>/dev/null)
semana=$(jq -r '.rate_limits.seven_day.used_percentage // empty' <<<"$in" 2>/dev/null)
sep=" \033[2m|\033[0m "
out="\033[35m${modelo:-?}\033[0m"
if [ -n "$dir" ]; then
  out+="${sep}\033[34m${dir##*/}\033[0m"
  branch=$(git -C "$dir" branch --show-current 2>/dev/null)
  [ -n "$branch" ] && out+="${sep}\033[32m${branch}\033[0m"
fi
[ -n "$custo" ] && out+="${sep}\033[33m$(printf '$%.2f' "$custo")\033[0m"
[ -n "$ctx" ] && out+="${sep}ctx $(printf '%.0f' "$ctx")%"
[ -n "$cinco" ] && out+="${sep}5h $(printf '%.0f' "$cinco")%"
[ -n "$semana" ] && out+="${sep}semana $(printf '%.0f' "$semana")%"
printf '%b\n' "$out"
