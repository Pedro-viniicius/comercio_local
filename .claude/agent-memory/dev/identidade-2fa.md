---
name: identidade-2fa
description: 2FA do admin (01b/10) — helpers em segundo-fator/comum.ts, emissão invalida desafios, teste de concorrência do R8 nos fakes, CLI por createApplicationContext
metadata:
  type: project
---

Conferido em 2026-10-18 (etapa 10 do 01b):
- `aplicacao/segundo-fator/comum.ts` concentra o que o `entrar` (etapa 9) e a etapa 16 precisam: `emitirDesafioDeSegundoFator` (token `<uuid>.<segredo>`, invalida os desafios vivos das DUAS etapas), `lerDesafio`, `chaveDoFreioDeSegundoFator` (`bloqueio_segundo_fator`, `[contaId]`), `abrirSessaoComSegundoFator` (grava `gravarUltimoLogin` antes da sessão, `null` se a conta saiu de ativa; HMAC `token_renovacao` com partes `[token]`, igual à etapa 8).
- O id do token é conferido como UUID antes da consulta: no Postgres a coluna é UUID e um texto qualquer daria 500.
- Como a emissão invalida o desafio anterior, teste "dois desafios ao mesmo tempo" (R8) precisa gravar os desafios direto (`DesafioDeSegundoFator.emitir` + `inserir`); pelo `entrar`, o primeiro já estaria morto e o teste passaria sem provar nada.
- Mutação conferida: ler `segundoFator.buscar` antes de `buscarParaAtualizar` do freio faz o teste concorrente do TOTP reprovar nos fakes (o `Promise.all` intercala sem pausa artificial).
- Caso de uso que lança antes de abrir a unidade precisa ser `async` (`return await`), senão o `rejects` do teste vira exceção síncrona.
- CLI com Nest: `NestFactory.createApplicationContext(AppModule.registrar({ ambiente }), { logger: false, abortOnError: false })` e `app.get(Caso)`. Provider ausente lança `UnknownElementException` com `name` = `'Error'`: use `constructor.name` na saída. Sondar a CLI sem mexer em `dist/`: `tsc -p tsconfig.build.json --outDir <scratchpad>/dist`, copiar `package.json` e linkar `node_modules`, e rodar com `env -i PATH=$PATH node --env-file=apps/api/.env.example`.

**How to apply:** etapas 9, 15 e 16 do 01b e qualquer mudança no 2FA. Ver [[identidade-dominio]].
