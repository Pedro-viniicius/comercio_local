# ADR-010: API REST `/v1`, contratos zod, Problem Details e paginação por cursor

- Situação: aceita (decisão do dono, 2026-10-16). Parte implementada na fundação; o restante é dos planos 01b em diante.
- Origem: `docs/produto/planos/00-arquitetura.md`, seção "Contratos da API (ADR-010)".

## Contexto

Os apps, o painel e a API precisam concordar sobre o formato de cada requisição, resposta e erro, e mudar isso sem quebrar app antigo nas lojas.

## Decisão

- REST com JSON em `/v1`. Mudança incompatível vira `/v2` e as duas convivem enquanto houver app antigo; `GET /v1/app/versao-minima` força atualização (futuro).
- Esquemas zod em `packages/contratos` validam no app, no painel e na API: é a fonte única. Locale `ptBR`, configurado uma vez em `src/zod.ts`; todo arquivo do pacote importa `z` de lá. Corpo e consulta usam `objetoEstrito` (campo desconhecido gera 400); resposta lida por cliente usa `z.object`, para tolerar campo novo do servidor.
- Erros em Problem Details (RFC 9457), `application/problem+json`: `type` (`urn:bairrin:erro:<codigo>` até o domínio existir), `title` em português, `status`, `codigo`, `campos: [{campo, codigo, motivo}]` e `idRequisicao`. Os códigos de campo que a API produz são `obrigatorio`, `invalido`, `comum` e `desconhecido` (`CampoComErro`); o cliente lê `campos[].codigo` como texto livre (`campoDoProblemaSchema`), para que um app antigo não descarte o Problema inteiro, com `campos` e `idRequisicao`, quando a API ganhar um código novo. Nunca pilha, SQL ou dado pessoal. O app escolhe o texto por `erro.<campo>.<codigo>` e usa o `motivo` quando não conhece a chave.
- O campo do título é `title`, o nome da RFC 9457, em português no valor. O plano 00 dizia `titulo`; ficou `title` para seguir a RFC (corrigido no plano em 2026-10-16).
- Cabeçalho `X-Request-Id` gerado sempre no servidor.
- Paginação por cursor (`?cursor=&limite=`, máximo 20). Dinheiro em centavos inteiros (`...EmCentavos`). Datas em ISO 8601 UTC. IDs UUID.
- Autorização (futuro, plano 01b): guarda `Autenticado` global (`APP_GUARD`); rota aberta só com `@Publico()` explícito; prefixo `/v1/admin` com `Perfis(admin)` e `ExigeMfa`; um teste percorre o roteador e reprova exceção. Todo recurso de loja ou conta passa pelo helper de isolamento.
- Dado pessoal e token nunca em query string ou caminho (S20): busca por e-mail ou telefone é `POST` com corpo; token de convite vai no corpo ou no fragmento. Log e Sentry gravam `req.url` sem a query.
- `Idempotency-Key` conforme o ADR-009.

## Consequências

- Já implementado na API: limite de 300 requisições por minuto por IP (throttler em memória, aceito para uma instância), corpo JSON até 100 KB (413 acima), `Cache-Control: no-store` por padrão, helmet, CORS por lista e `GET /v1/saude` e `GET /v1/saude/pronto`.
- Fora de produção a API expõe o OpenAPI gerado dos esquemas em `/v1/docs` (futuro).
- Mudança em `packages/contratos` atinge os três produtos; app antigo precisa ler resposta nova, por isso o cliente não é estrito.
- O throttler em memória deixa de valer com mais de uma instância; trocar por armazenamento compartilhado ao escalar.
