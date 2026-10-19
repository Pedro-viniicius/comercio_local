---
name: senhas-comuns-lista-publica
description: Lista pública de senhas comuns (etapa 5b do 01b) — licença real das fontes, armadilhas do arquivo gerado, teste de fronteira e medição do bundle
metadata:
  type: project
---

Conferido em 2026-10-17 (etapa 5b do 01b):
- `@zxcvbn-ts/language-pt-br` diz MIT no package.json, mas os dados têm origem de terceiros: na 4.1.1 o `commonWords.json` vem do OpenSubtitles 2024 (OPUS) sob **ODC-BY** (NOTICE.md pede manter o aviso); na 3.0.2 vinha do FrequencyWords (conteúdo CC-BY-SA 4.0). `firstnames` vem da API do IBGE e `lastnames` do pt.wiktionary (CC BY-SA). Origem em `data-scripts/lists.ts` da tag no GitHub.
- SecLists: `xato-net-10-million-passwords-10000.txt` e `10k-most-common.txt` sem nenhum `@`; o 10k recebe commits de contribuidores avulsos.
- `export const X = \`...\`` grande gera o literal inteiro no `.d.ts` (380 KB): anote `: string`.
- `apps/api/test/fronteiras/validadores-puros.test.ts` só aceita import `./[a-z-]+.ts` e não lê subpastas: nada de subpasta em `validadores/`. Decisão do arquiteto (2026-10-17): a lista pública fica só na API (`apps/api/src/modulos/identidade/http/dados/`), e `ehSenhaComum(senha, listaPublica?)` a recebe por parâmetro.
- Ranking oficial de sobrenomes do Censo 2022: `https://servicodados.ibge.gov.br/api/v3/nomes/2022/localidade/0/ranking/sobrenome?page=N` (30 por página). Dono escolheu a P11 opção 1: sem `lastnames.json` (CC BY-SA); 100 sobrenomes do IBGE à mão.
- Refine de corpo (`superRefine` no objeto) NÃO roda quando outro campo tem issue com `abort` (e-mail inválido). `refine(fn, { when, path, params, error })` tipa no zod 4.6.7, mas o `when` também é pulado se há issue com `continue: false` (`util.explicitlyAborted`): só ajuda com campo desconhecido. `payload.issues` traz as issues dos campos com `path[0]` = nome do campo.
- `senhas-comuns.ts` é importado pelo Node em `scripts/*.test.mjs` (type stripping): nada de parameter property, enum ou namespace ali (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`).
- Custo (S85, rodada 3): medir sempre com NFKC que expande (`⁗`→`′′′′`, `⒇`→`(20)`; 128 pontos viram 458) e trecho longo de PONTA no meio com pontas de disfarce (81 variantes). Solução: vetores `pontaAte`/`pontaDesde` em O(n), consulta por índices com recusa pelo tamanho antes do `slice`, memo por chave numérica e corte da forma > 256. Pior caso ~0,3 ms. Varredura de todas as expansões NFKC: `scratchpad/s85/varrer.mts`.
- `packages/contratos` não tem tipos do Node: teste que lê arquivo vai para `scripts/*.test.mjs`. Node 22.23 importa `.ts` direto (type stripping), então o teste de script pode importar a função TS para comparar.
- Medir bundle do painel quando outro `dev` quebrou o `tsc -b`: `pnpm exec vite build --outDir <scratchpad> --emptyOutDir` em `apps/painel`. Lista completa no painel dava +378 KB minificado e +128 KB gzip; depois da mudança para a API, o JS do painel ficou em ~100 KB gzip.

**How to apply:** ao mexer na lista, na fronteira dos validadores ou ao conferir licença de dicionário "MIT" que traz dados de terceiros. Ver também [[zod4-contratos]].
