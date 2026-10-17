---
name: verificador-migracoes
description: Como estender scripts/verificar-migracoes.mjs sem falso positivo nem brecha — visões alinhadas, corpo $tag$ como o Postgres, argumento de EXECUTE, %I injeta palavra-chave, sonda em Postgres descartável
metadata:
  type: project
---

Conferido em 2026-10-16 (etapa 0b do 01b, rodada 1 de correção S33/S34/R14/R15/R16, e etapa 3a):
- `separarSql` devolve visões do MESMO tamanho (`codigo`, `comandos`, `topo`, `semComentarios`): ache a estrutura em `comandos` (texto e identificador entre aspas em branco) e leia o nome em `codigo` ou o texto bruto em `semComentarios` no mesmo índice. Papel `"public"` entre aspas some em `comandos`: lista de papéis sai de `codigo`.
- Corpo `$tag$`: termina na PRIMEIRA ocorrência do delimitador (`indexOf`), mesmo dentro de `--`, `'` ou `/*` — é o que o lexer do Postgres faz. Só é código depois de `DO`/`AS` no topo; outros usos vão para `delimitadoresRecusados` (texto, aninhado, atravessa). Tag aceita letra fora do ASCII (`$ção$`).
- O argumento literal de `EXECUTE` sempre entra como SQL dinâmico (`ANTES_DE_ARGUMENTO_DE_EXECUTE`); comando novo que deva valer em texto solto precisa entrar em `PARECE_COMANDO`. `EXECUTE` no topo do arquivo (profundidade 0) é ignorado; em texto dinâmico não (pode ser corpo `AS '...'`).
- Brechas conhecidas e ainda abertas (provadas no PG 17): `format('... %I ...', 'disable')` injeta palavra-chave não reservada sem aspas (DISABLE, role); `E'\x44ISABLE'` não é decodificado em `textos`; `U&'...'` idem.
- Colisões: `EXECUTE` também é privilégio e trigger; `ALTER DEFAULT PRIVILEGES REVOKE GRANT OPTION FOR` tem GRANT depois do REVOKE. `SET role` só conta no início do comando (`UPDATE ... SET role` passa) ou como opção de função/`ALTER DATABASE`.
- Ferramenta Edit grava `￿`/`�` como o caractere literal: confira com `grep -P '\xef\xbf'` e corrija por script.
- Sonda real: `docker run -d --rm --name sonda -e POSTGRES_HOST_AUTH_METHOD=trust --tmpfs /var/lib/postgresql/data postgres:17-alpine` e `docker exec -i sonda psql -U postgres`; não toque nos containers do compose. Cuidado: `ALTER DATABASE postgres SET role` persiste na sonda (desfaça com `SET ROLE postgres; ALTER DATABASE postgres RESET role`).
- Prettier reformata a tabela S27 do teste: rode `pnpm exec prettier --write` no teste antes do lint.

- Etapa 3a do 01b (P8): destino do GRANT sai de `papeisDoGrant` (lista com `GROUP` opcional; `%I` vira `undefined` = reprova). Regra nova de lista permitida: caso de teste que use `TO <outro papel>` precisa esperar a mensagem P8.
- Catálogo (`privilegio-para-outro-papel`): ACL nula de função/tipo = PUBLIC com EXECUTE/USAGE sem entrada; o PRIMEIRO GRANT grava `=X/dono` na ACL e a regra reprova. Teste de catálogo que dá GRANT em função/tipo precisa de `REVOKE ... FROM PUBLIC` antes. Privilégio padrão do `postgres` alcança tabela que o próprio `postgres` cria depois na mesma transação (ordem importa no teste como admin).
- Desde R29/S76/S72 (01b grupo A): `privilegio-para-outro-papel` só olha objeto cujo dono é `bairrin_migracao` (o `public` é de `pg_database_owner`, fica de fora); objeto de outro dono em schema de `bairrin_migracao` cai em `dono-fora-dos-papeis`. Teste como admin (`postgres`) que queira exercitar o P8 precisa de `ALTER ... OWNER TO bairrin_migracao` antes do GRANT. Só `SECURITY DEFINER` usa `coalesce(proacl, acldefault('f', dono))`. `CREATE ROLE anon/service_role` dentro de BEGIN/ROLLBACK do admin simula o Supabase sem sujar o banco.
- `pnpm --filter api build` sai com erro se outro dev quebrou o typecheck de `packages/contratos`, mas o `tsc` emite o `dist` mesmo assim: confira `grep` no `dist` antes de concluir que o release rodou com o código novo.
- Provar que teste novo falha antes: copie `HEAD:scripts/verificar-migracoes.mjs` + teste + `scripts/fixtures` + `apps/api/prisma/migrations` para o scratchpad e rode `node --test` lá; para `.ts` da API, `git show HEAD:<arq> > <arq>`, rode só o arquivo de teste e restaure a cópia.

**How to apply:** toda regra nova do verificador e toda migração com SQL dinâmico. Ver [[prisma7-banco]].
