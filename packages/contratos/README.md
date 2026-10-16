# @bairrin/contratos

Esquemas zod compartilhados por API, apps e painel. É a fonte única do formato de requisições, respostas e erros (ADR-010). O pacote é privado ao monorepo.

## O que exporta

| Export                                                                 | Para quê                                                                           |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `z`                                                                    | O zod 4 já configurado com o locale `ptBR`. **Importe `z` daqui, nunca de `zod`.** |
| `objetoEstrito(forma)`                                                 | Objeto que recusa campo desconhecido. Use em todo corpo e consulta HTTP.           |
| `problemaSchema`, `Problema`, `criarProblema`, `ERROS`, `CodigoDeErro` | Problem Details (RFC 9457) e os códigos de erro da API.                            |
| `campoComErroSchema`, `CODIGOS_DE_CAMPO`, `camposDoErroZod`            | Erro de campo `{campo, codigo, motivo}` e a conversão de um erro do zod.           |
| `campoDoProblemaSchema`, `CampoDoProblema`                             | Erro de campo como o cliente o lê, com `codigo` em texto livre.                    |
| `TIPO_DE_CONTEUDO_PROBLEMA`                                            | `application/problem+json`.                                                        |
| `formaDaPaginacao`, `consultaPaginadaSchema`, `paginaSchema`, `Pagina` | Paginação por cursor, com `limite` de no máximo 20.                                |
| `saudeSchema`, `prontidaoSchema`                                       | Contratos de `GET /v1/saude` e `GET /v1/saude/pronto`.                             |

## Regras de uso

- **Requisição estrita, resposta tolerante.** Corpo e consulta usam `objetoEstrito` (campo desconhecido gera 400). Resposta lida por cliente usa `z.object`, para que um app antigo entenda uma API mais nova.
- **Códigos de campo.** O Problem Details leva `campos[{campo, codigo, motivo}]`. A API produz `codigo` em `obrigatorio`, `invalido`, `comum` ou `desconhecido` (`CampoComErro`, `z.enum`); o cliente lê `codigo` como texto livre (`CampoDoProblema`), para que um app antigo não descarte o Problema de uma API que criou um código novo. O app mostra o texto por `erro.<campo>.<codigo>` e usa o `motivo` quando não conhece a chave.
- **Campo ausente.** O `obrigatorio` é detectado por um motivo-marcador (`Campo obrigatório.`) devolvido pelo locale: a `issue` final do zod não traz o valor recebido. Um esquema com `{ error: 'texto' }` próprio em campo ausente vira `invalido`.
- **Erros com código próprio.** `refine(fn, { params: { codigo } })` chega ao conversor como `issue.params`.
- Dinheiro em centavos inteiros, datas ISO 8601 em UTC, IDs UUID.
- Nova rota ou novo erro entra aqui primeiro; a API e os clientes só consomem.
- O subcaminho `@bairrin/contratos/validadores` (validações que o domínio da API pode importar) e os eventos versionados em `src/eventos` são futuros.

## Como é consumido

O pacote exporta o código-fonte pela condição `@bairrin/fonte` (Vitest, Vite e dependency-cruiser a usam) e o `dist` por `default` (Node e a API compilada). Num clone limpo, compile antes de rodar a API (o painel e os testes leem o fonte):

```bash
pnpm --filter @bairrin/contratos run build
```

## Comandos

```bash
pnpm --filter @bairrin/contratos test
pnpm --filter @bairrin/contratos typecheck
pnpm --filter @bairrin/contratos build
```

Não há `lib` de DOM nem de Node neste pacote (`lib: ["ES2023"]`, `types: []`).
