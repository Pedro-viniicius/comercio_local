# Convenções

Regras de escrita de código e de documentação do Bairrin. A lista de comandos de verificação está no `README.md`; as decisões de arquitetura, em `docs/adr/`.

## Idioma

- Documentação, comentários, mensagens de log para humanos e textos de interface: português do Brasil, frases curtas e diretas.
- Identificadores de domínio em português, sem acento: `Pedido`, `criarConta`, `valorEmCentavos`.
- Termos de framework e de ferramenta ficam como são: `deploy`, `endpoint`, `build`, `cache`, `guard`.
- Nunca renomeie um identificador existente só por estilo.

## Nomes de arquivo

Kebab-case, com o papel no sufixo:

| Sufixo                                     | Uso                                                 |
| ------------------------------------------ | --------------------------------------------------- |
| `criar-conta.caso-de-uso.ts`               | caso de uso (aplicação)                             |
| `conta.controller.ts`                      | controlador HTTP                                    |
| `smtp.adaptador.ts`                        | adaptador de uma porta (infra)                      |
| `validacao-zod.pipe.ts`, `*.middleware.ts` | pipe e middleware do Nest                           |
| `limpeza.tarefa.ts`                        | tarefa agendada do worker                           |
| `*.test.ts`                                | teste unitário, ao lado do arquivo testado          |
| `*.int.test.ts`                            | teste de integração, em `apps/api/test/integracao/` |

Eventos de domínio se chamam `contexto.TipoDoEvento` (por exemplo `pedidos.PedidoCriado`), no passado, com versão.

## TypeScript

- ESM em tudo (`"type": "module"`). Imports relativos levam a extensão `.ts`; o `tsc` reescreve para `.js` (`rewriteRelativeImportExtensions`).
- `strict`, `noUncheckedIndexedAccess` e `noImplicitOverride` ligados (`tsconfig.base.json`). Método que implementa um abstrato leva `override`.
- Os pacotes `@bairrin/*` compilam com `lib: ["ES2023"]` e `types: []`, sem os tipos de DOM nem de Node. Para usar `fetch`, `AbortController` ou `setTimeout` neles, declare uma interface mínima no próprio módulo (veja `packages/cliente-api/src/cliente.ts`).
- Pacotes exportam o fonte pela condição `@bairrin/fonte` e o `dist` por `default`. Ferramentas que leem o fonte (Vitest, Vite, dependency-cruiser) configuram essa condição.
- `catch` que relança erro passa o original em `cause`. Promessa nunca é rejeitada com algo que não seja `Error`.
- Não use `tsx` para rodar nada que monte módulo Nest: ele não emite os metadados de decorator e a injeção de dependência quebra. Seeds e CLIs rodam o JavaScript compilado (`node dist/cli/...`).

## Camadas da API

Resumo do ADR-003 (a verificação é `pnpm deps:verificar`):

- `modulos/<contexto>/dominio`: regra de negócio em TypeScript puro. Só importa `@bairrin/contratos/validadores`.
- `modulos/<contexto>/aplicacao`: casos de uso e portas (classes abstratas). Não importa `infra` nem `http`.
- `modulos/<contexto>/infra`: adaptadores (Prisma, SMTP, gateway).
- `modulos/<contexto>/http`: controladores e conversão para Problem Details.
- Um módulo só importa outro pelo `index.ts` dele.
- Fakes e helpers de teste ficam em `apps/api/test/fakes/<contexto>/`. Código de produção (`apps/api/src/`, fora os `*.test.ts`) não importa nada de `apps/api/test/` (regra 11 do ADR-003; o `pnpm deps:verificar` reprova).
- A regra de negócio nunca fica no controlador nem no componente.
- Repositórios pegam o cliente do banco em `UnidadeDeTrabalhoPrisma.cliente()`, nunca direto no `PrismaService`; assim participam da transação do caso de uso.
- Evento de domínio é publicado dentro da transação do caso de uso, pelo `PublicadorDeEventos` (ADR-011).

## Banco e migrações

- Tabelas e colunas em `snake_case`, em português, um schema por contexto, nada em `public`.
- Uma migração por mudança. SQL revisado: `prisma migrate dev --create-only`, edite, depois aplique.
- Toda migração começa com `-- reversao:` (como desfazer). Toda tabela nova tem `ENABLE ROW LEVEL SECURITY` e política para `bairrin_app`.
- `DROP`, `RENAME`, `ALTER COLUMN ... TYPE` e `TRUNCATE` só em pasta `<timestamp>_<nome>_destrutiva`, separada da criação, começando por um bloco que aborta se a tabela tiver linhas.
- Tabela de auditoria e outras só de acréscimo: sem `UPDATE`, `DELETE` e `TRUNCATE` para `bairrin_app`.
- Confira com `pnpm migracoes:verificar`.

## HTTP e contratos

- Rotas em `/v1/...`. REST, JSON, nomes de campo em português.
- Esquemas em `packages/contratos`. Requisição: `objetoEstrito` (campo desconhecido gera 400). Resposta lida por cliente: `z.object`.
- Erro sempre em Problem Details, com `codigo` e `campos[{campo, codigo, motivo}]`. Nunca mensagem de exceção desconhecida, pilha, SQL ou dado pessoal.
- Dinheiro em centavos inteiros (`valorEmCentavos`). Datas ISO 8601 em UTC. IDs UUID. Paginação por cursor, `limite` até 20.
- Dado pessoal e token nunca em query string nem no caminho.

## Logs, erros e dado pessoal

- Log em JSON, com `idRequisicao`. Sem corpo de requisição, sem query na URL.
- Nunca registre nome, telefone, e-mail, documento, token, senha nem segredo. Isso vale também para a mensagem de erro de biblioteca de banco, que costuma trazer os parâmetros da consulta: registre só o tipo e o código (`serializarErro`).
- O redator de logs e do Sentry apaga o valor de toda chave cujo nome lembra dado pessoal ou segredo (`nome`, `codigo`, `hash`, `email`…, a mesma lista de `ehChaveProtegida`). A regra olha cada palavra do nome, inclusive dentro de camelCase (`codigoDoErro` também é apagado). Em log, use para o que não é pessoal nomes sem essas palavras, como `erroSql` e `evento`, e não afrouxe a regra.
- O texto do log é sempre fixo e escrito pelo código. O logger troca por `sem mensagem` o texto que vem de um `Error` (`logger.error(erro)` ou `logger.error({ err })` sem texto) ou que não é string, e descarta os argumentos de interpolação (`logger.info('conta %s', email)` grava só `conta %s`). A chave `msg` do objeto é descartada (o texto é só o segundo argumento), e `message` e `msg` aninhadas são redigidas. O `context` do nestjs-pino só passa se for texto de uma linha com até 80 caracteres; senão vira `contexto descartado`. Na API, o lint reprova template string com expressão (`` `conta ${email}` ``) e `.message` como argumento de método de log ou como valor de propriedade do objeto; texto montado antes, numa variável, não é detectado e fica com a revisão humana.
- Auditoria e payload da outbox sem dado pessoal; campo pessoal vira `{"alterado": true}` (ADR-015).
- Todo módulo que guarda dado pessoal implementa `AnonimizadorDeTitular`.

## Interface

- Texto de interface em `textos/pt-BR.ts` do app ou do painel, nunca solto no componente.
- Erro de campo é mostrado por `erro.<campo>.<codigo>`; o `motivo` da API é só reserva.
- Cores, tipografia, espaço e movimento vêm de `@bairrin/tokens`, nunca de valor solto.

## Testes

- Unitário ao lado do arquivo, `*.test.ts`. Integração em `apps/api/test/integracao`, `*.int.test.ts`, contra o Postgres de teste do compose.
- Todo critério de aceite tem pelo menos um teste. Bug corrigido ganha um teste que falhava antes.
- Teste não usa `.only`, não é pulado e não depende de ordem. Não leem `.env`: montam o ambiente com valores fictícios.
- Um arquivo: `pnpm --filter <pacote> exec vitest run <caminho>`; integração por trecho: `pnpm --filter api test:integracao -- <trecho>`.

## Estilo e ferramentas

- Prettier: aspas simples, 100 colunas, vírgula final (`.prettierrc.json`). EditorConfig: UTF-8, LF, 2 espaços.
- ESLint com `typescript-eslint` (regras com tipos) e `--max-warnings=0`. Parâmetro ou variável ignorada de propósito começa com `_`.
- `pnpm format` reescreve; `pnpm lint` só confere. O ESLint não olha `docs/`, mas o Prettier confere os `.md` fora de `docs/produto/`.

## Dependências

- Versão exata, publicada há mais de 3 dias, e script de instalação só se o pacote estiver em `allowBuilds` (tudo no `pnpm-workspace.yaml`, ADR-013).
- Versão compartilhada por mais de um pacote vai no `catalog:`.
- Dependência nova só entra com motivo e é citada no PR.
- O TypeScript fica na 6.x enquanto o `typescript-eslint` não suportar a 7.

## Segredos e ambiente

- Nenhum segredo no repositório. `.env*` está no `.gitignore`; só o `.env.example` é versionado, com valores fictícios.
- Variável do app (`EXPO_PUBLIC_*`) e do painel (`VITE_*`) vai embutida no build e é pública: nunca ponha segredo nelas.
- A API valida o ambiente com zod ao subir e não sobe se faltar algo; a mensagem cita só o nome da variável.

## Commits e documentação

- Conventional Commits em português: `feat(identidade): cria o cadastro de conta`, `fix(api): ...`, `docs: ...`, `chore: ...`, `refactor`, `test`, `build`, `ci`.
- O escopo é o módulo, o app ou o pacote alterado.
- README em cada app e pacote e em cada módulo da API; ADR curto em `docs/adr/NNNN-titulo.md`.
- Mudança que altera comportamento descrito em README ou ADR atualiza o texto na mesma mudança.
