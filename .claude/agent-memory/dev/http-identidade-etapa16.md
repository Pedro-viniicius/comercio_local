---
name: http-identidade-etapa16
description: Borda HTTP da Identidade (01b/16) — prefixo /v1/admin pelos metadados, ordem dos APP_GUARD, testes HTTP com trust proxy, spawn da CLI compilada, teste de tempo do login, scratchpad dividido
metadata:
  type: project
---

Conferido em 2026-10-23 (etapa 16 do 01b, Nest 12.1.3, Express 5, @nestjs/throttler 6.7.1):
- O Express casa rota sem diferenciar maiúsculas (`/V1/ADMIN/x` cai na rota `/v1/admin/x`): prefixo de admin na guarda sai de `PATH_METADATA` (`@nestjs/common/constants.js`) do controller + método E de `req.baseUrl + req.route.path` (o padrão casado; com Nest 12/Express 5 já traz o `setGlobalPrefix`, provado no `http-base`), nunca de `req.path`. `@Publico()` não vale em rota de admin (S110).
- `APP_GUARD` roda na ordem do array `providers` do `AppModule` (provado: o limite por conta depende da `Autenticado` antes). Guarda sempre roda antes do pipe (S82 sai de graça).
- `@nestjs/throttler` 6.7 já agrupa IPv6 por /64 (`normalizeIp`, exportado) e expõe o armazenamento por `@InjectThrottlerStorage()`; limites por rota com chave própria (conta, e-mail) ficaram numa guarda nossa (`limite-por-rota.guard.ts`) que chama `storage.increment(chave, ttl, limite, bloqueio, nome)`. O armazenamento usa `Date.now()` real, não o `Relogio`. O `increment` do armazenamento em memória não soma mais depois de bloqueado; a guarda confere os limites `por: 'ip'` primeiro (S109), então a recusa por e-mail/conta também gasta o do IP (ajustar testes que contam o IP).
- Teste HTTP da Identidade: `test/integracao/identidade/api-http.ts` sobe o `AppModule` com `overrideProvider(Relogio)` e `app.set('trust proxy', true)`; cada teste escolhe o IP por `X-Forwarded-For` (`ipNovo`), senão os limites por IP (cadastro 10/h) derrubam o arquivo. Mesmas `CHAVES` da `montarPilha()` (exportadas) para gravar código e ler freio pela pilha.
- Corrida pela rota: `pausarAntes(api.app.get(RepositorioDeSegundoFator), 'salvar')` pega a mesma instância do caso de uso; supertest só dispara com `.then(...)`.
- CLI de ponta a ponta por spawn: `node <typescript/bin/tsc> -p tsconfig.build.json --outDir <tmp>/dist` (~3 s), copiar `package.json`, symlink de `node_modules`, e `node --conditions=@bairrin/fonte <tmp>/dist/cli/x.js` (contratos pelo fonte, sem depender do `dist` do pacote). `node src/cli/*.ts` direto NÃO sobe o Nest (type stripping não aceita decorators).
- Teste de tempo (S23): Argon2id local ~20 ms e ruído de 2–3x entre amostras; medianas de casos rodados em sequência reprovam à toa. Alternar os casos a cada rodada e aceitar 0,4–2,0 da referência pega hash pulado (provado por mutação), não pega um hash a mais.
- Zod 4 lista as `unrecognized_keys` de um objeto DEPOIS dos campos declarados dele; o filtro de erros corta `campos` em 20 (Q30), então os erros reais sobrevivem ao corte.
- Duas sessões criadas no mesmo instante do `RelogioFixo` não têm ordem em `sessoesDaConta`: compare ordenado.
- O scratchpad é DIVIDIDO com os outros agentes da sessão (tem `dist/`, `package.json` de outras etapas): trabalhe numa subpasta própria (`scratchpad/e16/`), nunca na raiz.

**How to apply:** etapas 19 e 20a do 01b (rotas de conta, privacidade e admin; testes transversais) e qualquer rota nova. Ver [[nest12-http-logs]], [[identidade-2fa]], [[assinantes-tarefas-identidade]].
