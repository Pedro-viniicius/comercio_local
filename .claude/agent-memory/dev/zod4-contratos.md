---
name: zod4-contratos
description: Armadilhas do zod 4.6.7 em packages/contratos (locale ptBR, issue sem input, strictObject)
metadata:
  type: project
---

Conferido em 2026-10-16 (zod 4.6.7; Q14 em 2026-10-16):
- Locale: `z.config({ localeError })` explícito vale em qualquer ordem; o padrão `en` só entra se não houver config. `z.locales.ptBR()` existe em `import { z } from 'zod'`. `packages/contratos/src/zod.ts` configura e todo arquivo do pacote importa `z` de lá.
- A `issue` final NÃO traz `input` (só dentro do `localeError`, antes de finalizar). Por isso o código `obrigatorio` é detectado pelo motivo-marcador devolvido no locale (`MOTIVO_OBRIGATORIO`); esquema com `{error: 'texto'}` próprio num campo ausente vira `invalido`.
- `unrecognized_keys` vem com `path` do objeto pai e `keys[]`; o conversor gera um campo por chave.
- `refine(fn, { params: { codigo } })` chega em `issue.params` (code `custom`).
- Um erro por campo: `.refine(fn, { error, abort: true })` para a cadeia; sem `abort`, o campo vazio sai com dois issues.
- NÃO use `.min/.max/.length` em texto de entrada: esses checks têm `when` padrão (`_whenHasLength`, `core/checks.ts`) e rodam depois do erro de tipo em `[]`/`{length:0}`/`{length:1000}` → dois erros no campo (Q14). `when` não é aceito nos params públicos. `refine`, `overwrite`/`trim` e `regex` são pulados após erro de tipo. O pacote usa `.refine(ehTextoPreenchido, CAMPO_OBRIGATORIO)` (`src/zod.ts`). `.overwrite(fn)` normaliza sem virar pipe (continua `ZodString`, aceita checks depois). Mensagem própria só nos checks, nunca no tipo base (senão o ausente vira `invalido`).
- `superRefine` num `strictObject` roda mesmo com issue nos campos ou chave desconhecida (só pula se algum check do campo abortou): a lógica dele não pode supor campos válidos.
- Desde o 01b/2 os validadores puros (`src/validadores`, sem zod) existem e são o subcaminho `@bairrin/contratos/validadores`; os esquemas de `src/identidade` os usam.
- ptBR do zod não tem "obrigatório": ausente vira "Entrada inválida: esperava um texto, recebeu um valor "undefined"" sem o wrapper.
- `lib` do monorepo é ES2023: `String.prototype.isWellFormed` não tipa; use `/\p{Cs}/u` (mesmo resultado). Para provar "falha antes" sem `git stash` (outros `dev` em paralelo), rode os testes novos contra o `dist/` antigo copiado para o scratchpad (imports `.ts`→`.js`, symlink do `node_modules` do pacote).
- `z.enum` com o campo AUSENTE dá `invalido` (motivo "Opção inválida: esperava uma das seguintes opções: ..."), não `obrigatorio`: vale para `entrarSchema.cliente` e `renovarSessaoSchema.cliente` (5c). Subconjunto de enum: `z.enum(CLIENTES).exclude(['painel'])` (zod 4.6.7) mantém uma fonte só.
- `console.log` num teste do vitest de `packages/contratos` não aparece na saída do `vitest run`; para sondar um valor, faça um `expect(...).toEqual([])` falhar e leia o diff.
- S87 (2026-10-19): o zod 4.6.7 sonda `new Function` em `util.allowsEval` quando CONSTRÓI cada `z.object` (não no parse); com `z.config({ jitless: true })` antes do primeiro esquema a sonda não roda. Ligado em `src/zod.ts` só com `'document' in globalThis` (o tsconfig do pacote não tem DOM: `typeof document` não tipa). Teste no painel: arquivo sem import estático de contratos, `vi.stubGlobal('Function', new Proxy(...))` e `await import('@bairrin/contratos')`; sem o `jitless` o teste reprova (provado).
