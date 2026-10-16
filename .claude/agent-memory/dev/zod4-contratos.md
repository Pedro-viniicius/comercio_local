---
name: zod4-contratos
description: Armadilhas do zod 4.6.7 em packages/contratos (locale ptBR, issue sem input, strictObject)
metadata:
  type: project
---

Conferido em 2026-10-16 (zod 4.6.7):
- Locale: `z.config({ localeError })` explícito vale em qualquer ordem; o padrão `en` só entra se não houver config. `z.locales.ptBR()` existe em `import { z } from 'zod'`. `packages/contratos/src/zod.ts` configura e todo arquivo do pacote importa `z` de lá.
- A `issue` final NÃO traz `input` (só dentro do `localeError`, antes de finalizar). Por isso o código `obrigatorio` é detectado pelo motivo-marcador devolvido no locale (`MOTIVO_OBRIGATORIO`); esquema com `{error: 'texto'}` próprio num campo ausente vira `invalido`.
- `unrecognized_keys` vem com `path` do objeto pai e `keys[]`; o conversor gera um campo por chave.
- `refine(fn, { params: { codigo } })` chega em `issue.params` (code `custom`).
- ptBR do zod não tem "obrigatório": ausente vira "Entrada inválida: esperava um texto, recebeu um valor "undefined"" sem o wrapper.
