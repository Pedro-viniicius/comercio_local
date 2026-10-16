---
name: verificador-migracoes
description: Como estender scripts/verificar-migracoes.mjs sem falso positivo nem brecha — visões alinhadas, corpo $tag$ como o Postgres, argumento de EXECUTE, %I injeta palavra-chave, sonda em Postgres descartável
metadata:
  type: project
---

Conferido em 2026-10-16 (etapa 0b do 01b e rodada 1 de correção, S33/S34/R14/R15/R16):
- `separarSql` devolve visões do MESMO tamanho (`codigo`, `comandos`, `topo`, `semComentarios`): ache a estrutura em `comandos` (texto e identificador entre aspas em branco) e leia o nome em `codigo` ou o texto bruto em `semComentarios` no mesmo índice. Papel `"public"` entre aspas some em `comandos`: lista de papéis sai de `codigo`.
- Corpo `$tag$`: termina na PRIMEIRA ocorrência do delimitador (`indexOf`), mesmo dentro de `--`, `'` ou `/*` — é o que o lexer do Postgres faz. Só é código depois de `DO`/`AS` no topo; outros usos vão para `delimitadoresRecusados` (texto, aninhado, atravessa). Tag aceita letra fora do ASCII (`$ção$`).
- O argumento literal de `EXECUTE` sempre entra como SQL dinâmico (`ANTES_DE_ARGUMENTO_DE_EXECUTE`); comando novo que deva valer em texto solto precisa entrar em `PARECE_COMANDO`. `EXECUTE` no topo do arquivo (profundidade 0) é ignorado; em texto dinâmico não (pode ser corpo `AS '...'`).
- Brechas conhecidas e ainda abertas (provadas no PG 17): `format('... %I ...', 'disable')` injeta palavra-chave não reservada sem aspas (DISABLE, role); `E'\x44ISABLE'` não é decodificado em `textos`; `U&'...'` idem.
- Colisões: `EXECUTE` também é privilégio e trigger; `ALTER DEFAULT PRIVILEGES REVOKE GRANT OPTION FOR` tem GRANT depois do REVOKE. `SET role` só conta no início do comando (`UPDATE ... SET role` passa) ou como opção de função/`ALTER DATABASE`.
- Ferramenta Edit grava `￿`/`�` como o caractere literal: confira com `grep -P '\xef\xbf'` e corrija por script.
- Sonda real: `docker run -d --rm --name sonda -e POSTGRES_HOST_AUTH_METHOD=trust --tmpfs /var/lib/postgresql/data postgres:17-alpine` e `docker exec -i sonda psql -U postgres`; não toque nos containers do compose. Cuidado: `ALTER DATABASE postgres SET role` persiste na sonda (desfaça com `SET ROLE postgres; ALTER DATABASE postgres RESET role`).
- Prettier reformata a tabela S27 do teste: rode `pnpm exec prettier --write` no teste antes do lint.

**How to apply:** toda regra nova do verificador e toda migração com SQL dinâmico. Ver [[prisma7-banco]].
