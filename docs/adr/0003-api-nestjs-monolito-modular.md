# ADR-003: API NestJS como monólito modular, com fronteiras checadas

- Situação: aceita (decisão do dono, 2026-10-16).
- Origem: `docs/produto/planos/00-arquitetura.md`, abordagem 3 (backend) e `docs/produto/decisoes.md` (DDD, Clean Architecture e monólito modular).

## Contexto

O dono pediu DDD, Clean Architecture e um monólito modular preparado para extrair serviços, sem o custo de microsserviços. A equipe é pequena e a linguagem já é TypeScript. Spring Boot e Fastify puro foram considerados.

## Decisão

API em NestJS 12 (Node 22, ESM), um módulo por contexto em `apps/api/src/modulos/<contexto>/{dominio,aplicacao,infra,http}` e o núcleo em `apps/api/src/compartilhado`. O domínio fica sem framework. Duas entradas no mesmo código: `src/main.ts` (HTTP) e `src/worker.ts` (relay da outbox, assinantes e tarefas), dois processos no deploy.

As fronteiras são checadas por `pnpm deps:verificar` (dependency-cruiser, `.dependency-cruiser.cjs`), com onze regras, todas provadas por fixtures em `apps/api/test/fronteiras/fixtures`:

1. o domínio não importa aplicação, infra nem http;
2. o domínio não importa `@nestjs/*` nem `@prisma/*`;
3. o domínio só importa `@bairrin/contratos/validadores` (funções puras, sem zod, em `packages/contratos/src/validadores/`);
4. a aplicação não importa infra nem http;
5. um módulo só importa outro pelo `index.ts`;
6. apps e pacotes não importam `apps/api`;
7. o domínio não importa adaptador do núcleo;
8. a aplicação não importa adaptador do núcleo;
9. o núcleo (`compartilhado`) não importa `modulos/`;
10. só a infra (`compartilhado/infra/` ou `modulos/<m>/infra/`) importa o client gerado do Prisma;
11. o código de produção (`apps/api/src/`, fora os `*.test.ts`) não importa `apps/api/test/`: fakes e helpers de teste ficam em `apps/api/test/fakes/<contexto>/` (pendência Q7 do 01a).

### Portas e adaptadores do núcleo

O núcleo separa cada porta do seu adaptador. A porta é um arquivo sem Nest nem Prisma, que o domínio e a aplicação dos módulos podem importar; o adaptador fica em `compartilhado/infra/` (ou, fora dela, com o sufixo `.adaptador.ts`) e só a infra e o `CompartilhadoModule` o enxergam.

| Porta (pura)                                                       | Adaptador                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `transacao/unidade-de-trabalho.ts` (`UnidadeDeTrabalho`)           | `infra/unidade-de-trabalho-prisma.ts`                                     |
| `eventos/publicador.ts` (`PublicadorDeEventos`)                    | `infra/publicador-na-outbox.ts`                                           |
| `auditoria/repositorio-de-auditoria.ts` (`RepositorioDeAuditoria`) | `infra/repositorio-de-auditoria-prisma.ts`                                |
| `email/enviador-de-email.ts` (`EnviadorDeEmail`)                   | `infra/smtp.adaptador.ts` (falso em `test/fakes/compartilhado/`)          |
| `tempo/relogio.ts` (`Relogio`)                                     | o próprio arquivo: `RelogioDoSistema` e `RelogioFixo` só usam a linguagem |

Para as regras 7 e 8, "adaptador do núcleo" é tudo o que está em `compartilhado/{infra,http,log,observabilidade,config,saude}/`, todo `*.adaptador.ts` dentro de `compartilhado` e o `compartilhado.module.ts`. As portas ficam fora dessas pastas, por isso não precisam de exceção na regra. O teste de fronteiras também confere, na árvore real, que os arquivos de porta não importam Nest, Prisma, o client gerado nem adaptador.

O client gerado do Prisma (`compartilhado/infra/gerado/`, gitignored) entra no grafo como folha (`doNotFollow`), e não no `exclude`: excluído, ele sumiria também como destino e a regra 10 nunca dispararia.

## Consequências

- Decorators e injeção de dependência pedem disciplina: o domínio fica fora do Nest só porque a regra 2 barra o contrário.
- O NestJS 12 é ESM puro. Os imports relativos levam a extensão `.ts` e o `tsc` os reescreve para `.js` (`rewriteRelativeImportExtensions`). A API roda sempre o JavaScript compilado em `dist/`.
- O `tsx` não emite os metadados de decorator e quebra a injeção de dependência por construtor. Seeds e CLIs rodam o JS compilado.
- O Vitest 5 lê esses metadados sozinho; o plano previa `unplugin-swc`, e a configuração atual não o usa.
- Cada módulo tem schema Postgres próprio, sem chave estrangeira entre schemas (ADR-004), o que deixa a extração futura de um serviço possível.
- Situação do código: o núcleo existe; nenhum módulo de negócio ainda (o primeiro é Identidade, no plano 01b). A pasta `modulos/` só aparece com ele.
