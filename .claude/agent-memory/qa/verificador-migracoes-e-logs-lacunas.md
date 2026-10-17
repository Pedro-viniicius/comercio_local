---
name: verificador-migracoes-e-logs-lacunas
description: Estado do redator de logs, do verificador de migrações, da checagem de catálogo (S33) e de schemasDoBairrin depois da rodada 2 do grupo 0 do 01b (2026-10-16); lacunas baixas que restam
metadata:
  type: project
---

01a (Q1-Q4) corrigido. Grupo 0 do 01b (Q5-Q11, Seg-1 a Seg-4, S33-S36) conferido nas rodadas 1 e 2; veredito da rodada 2: aprovado com ressalvas (só baixas).

Mutação feita na rodada 2 (cópia no scratchpad): cada regra do `problemasNoCatalogo` e cada posição de comando do `TROCA_DE_PAPEL` é reprovada por pelo menos um teste. Eram sobreviventes e viraram testes do qa: schema cujo dono é `bairrin_app` e GRANT OPTION em banco (exigem superusuário: cliente `postgres` do compose, env `DATABASE_URL_ADMIN_TESTE`), GRANT OPTION em função e tipo, e SET ROLE depois de THEN/LOOP/AS/BEGIN ATOMIC/BEGIN. Mutante equivalente: o `;` do `TROCA_DE_PAPEL` (a visão `codigo` já cobre).

Lacunas baixas que restam (sondadas em 2026-10-16):
- Logger/redator: chaves `mensagem`, `errorMessage`, `error.message` e `stack` (texto) em objeto passam sem redação (só `message` e `msg` inteiras são redigidas); array como primeiro argumento vira chave "0"; `HINT` de RAISE com `row_security` ainda dá falso positivo no verificador.
- Verificador: brechas declaradas pelo dev B (`%I` injetando palavra-chave, `E'\x..'`, `U&'..'`, set_config com nome não literal, ALTER SYSTEM, GRANT para postgres/supabase_*, corpo não SQL lido como SQL).
- Catálogo: view materializada e CREATE no banco não cobertos; Supabase (extensions, pg_stat_statements) pararia o release (não verificado).
- `schemasDoBairrin`: schema de outro papel sem USAGE da app não entra; schemas `pg_temp_*` ficam de fora.
- Fronteiras: fake em `apps/api/src` só é pego pelo nome (`falso|fake|mock|stub`); `em-memoria` não é pego.

**How to apply:** o `fundacao.test.mjs` usa `git check-ignore`: numa cópia limpa (tar sem .git) rode `git init` antes. Poison pill do relay segue pendência do arquiteto.

Grupo A do 01b, rodada 1 (2026-10-16): testes do qa em contratos (CORPOS: campo desconhecido, um erro por campo, motivo sem valor), validadores, verificador P8, catálogo (7 int tests) e log. Testes vermelhos de propósito até o dev corrigir: Q14 (vetor vazio no lugar do texto gera 2 erros), Q15 (lint `e?.message`, = S70), Q16 (`child({context})`/`setBindings` sem filtro de contexto). Lacunas que ficam sem teste: NBSP/bidi no celular colado (rejeitado), `GRANT ... "to"` (coluna ou tabela chamada to) dá falso positivo no P8, `ß`/`ı` viram `SS`/`I` no código de recuperação, senha comum com invisível (ZWSP, hífen mole) ou pontuação (`Senha_123`) passa (ligado ao S74).

Grupo A do 01b, rodada 2 (2026-10-16): Q14, Q15 e Q16 passaram sem alterar o teste; R32 (códigos de recuperação sem `.length`), catálogo (`dono-fora-dos-papeis`) e reescrita de `cause` não enfraqueceram nada. Mutação (cópia no scratchpad): sobreviviam o filtro "só schema de bairrin_migracao" da regra `dono-fora-dos-papeis` (teste novo no int de migrações com tabela, função e tipo da plataforma em `public`) e, em `senhas-comuns.ts`, as letras `@ $ 5 7`, o limite de 8 nas pontas e os literais como núcleo (arquivo novo `packages/contratos/src/validadores/senhas-comuns.test.ts`, com falsos positivos de senha forte). Lacunas baixas: núcleo de 1 letra com dígitos e símbolos (`%354O3*1`, `@-*_d*!#&1`) é recusado por cair em trecho de sequência (~0,08% das senhas aleatórias de 8 caracteres, ~0,005% das de 10, 0 de 12+); `senha` com 9 ou mais dígitos ou símbolos nas pontas passa; `\d{6}` não pega telefone ou CPF formatado.
