---
name: cripto-identidade
description: Armadilhas dos pacotes de cripto da Identidade (01b/6): const enum do @node-rs/argon2, Secret do otpauth, iat do jsonwebtoken, typecheck isolado com outro dev quebrando o tsc
metadata:
  type: project
---

Conferido em 2026-10-18 (etapa 6 do 01b; @node-rs/argon2 2.2.2, otpauth 9.5.2, @nestjs/jwt 12.0.3):
- `@node-rs/argon2`: `Algorithm` e `Version` são `declare const enum`; com `isolatedModules` não dá para ler `Algorithm.Argon2id`, e em runtime o objeto é `{}`. Use o literal (`2 satisfies Algorithm.Argon2id`). `verify` com hash mal formado LANÇA (`InvalidArg`, "Decoding failed" / "Memory cost is too small"), não devolve false. O binário `linux-x64-gnu` carrega na `node:22.23.3-trixie-slim` (sonda: `docker run --network none -v $PWD/node_modules/.pnpm:/p:ro ... require('/p/@node-rs+argon2@2.2.2/node_modules/@node-rs/argon2')`; montar só a pasta do pacote quebra os symlinks do .pnpm).
- Para testar que o adaptador manda a senha normalizada ao argon2, `vi.mock('@node-rs/argon2', importOriginal)` com `vi.fn(original.verify)` funciona (o pacote é CJS com exports detectáveis).
- `otpauth`: `Secret.fromBase32` lança "Invalid character found: X" (vaza um caractere do segredo: embrulhe), aceita minúsculas, espaços e `=`, e `''` vira segredo de 0 bytes (HMAC com chave vazia: confira o tamanho). `new Secret({ buffer })` faz `new Uint8Array(buffer)`: passar `randomBytes(n).buffer` levaria o bloco compartilhado do Node; copie para `new Uint8Array(...)` antes. `TOTP.validate` para no primeiro passo que confere; para "sem reuso" itere os passos com `HOTP.validate({ counter, window: 0 })`.
- `jsonwebtoken` (via `JwtService` sem opções de módulo): `iat` no payload vira a base do `exp` do `expiresIn`; `clockTimestamp` na verificação simula o `agora`. Erros de recusa têm `name` `JsonWebTokenError`/`TokenExpiredError`/`NotBeforeError`. Não importe `jsonwebtoken` direto (transitiva, pnpm estrito).
- Com outro dev em paralelo deixando arquivo com erro de sintaxe, o `tsc` do pacote para nos erros sintáticos e não checa o resto. Typecheck só dos seus arquivos: tsconfig no scratchpad com `extends` absoluto para `apps/api/tsconfig.json`, `include` absoluto e `typeRoots` absoluto para `apps/api/node_modules/@types`; rode `pnpm exec tsc -p <ele>` a partir de `apps/api`.

**How to apply:** etapas 9, 10 e 16 do 01b (usam esses adaptadores) e qualquer troca de pacote de cripto.
