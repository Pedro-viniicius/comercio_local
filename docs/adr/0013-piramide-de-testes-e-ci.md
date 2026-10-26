# ADR-013: Pirâmide de testes, CI e cadeia de suprimentos

- Situação: aceita (decisão do dono, 2026-10-16). Testes, regras de dependências e CI (`.github/workflows/ci.yml`, `android-nativo.yml`, `dependabot.yml`) implementados no plano 01a; o CI ainda não rodou no GitHub.
- Origem: `docs/produto/planos/00-arquitetura.md`, seção "Testes e CI (ADR-013)" e a revisão de segurança S12.

## Contexto

O dono pediu testes em todos os níveis e um CI que compila os apps. Uma dependência recém-publicada ou com script de instalação é um vetor conhecido de ataque.

## Decisão

| Nível      | Ferramenta                                                               | Onde                       | Meta                                                   |
| ---------- | ------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------ |
| Unitário   | Vitest                                                                   | PR                         | linhas ≥ 90% em `dominio/`, ≥ 80% na API e nos pacotes |
| Integração | Vitest com o Postgres real do `infra/docker-compose.yml` (serviço no CI) | PR                         | todo repositório e todo endpoint                       |
| UI         | jest-expo e Testing Library (apps); Vitest e Testing Library (painel)    | PR                         | ≥ 60% em `apps/*/src`                                  |
| e2e        | Maestro em emulador Android, com API local e serviços falsos             | noturno e antes de release | cadastro, compra, aceite, pagamento                    |

CI de PR (GitHub Actions), nesta ordem: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm deps:verificar`, `pnpm migracoes:verificar`, `pnpm test`, `pnpm test:integracao`, `pnpm build` (API, painel e `expo export` dos dois apps) e `pnpm audit --prod --audit-level=high`, este bloqueante. Na `main`, o build Android nativo; o iOS é manual pelo EAS Build. Sem serviço externo: gateway, push e geocodificação falsos e Mailpit. Teste de propriedade (fast-check) só em dinheiro (plano 05).

Cadeia de suprimentos (S12):

- Versões exatas e `minimumReleaseAge` de 3 dias, `strictDepBuilds` e a lista `allowBuilds`, tudo em `pnpm-workspace.yaml`.
- Dependabot e EAS Update com assinatura de código.
- TypeScript fica na 6.0.3, versão fixa no catálogo do `pnpm-workspace.yaml`, porque o `typescript-eslint` ainda não suporta o TypeScript 7.

## Consequências

- **Desvio do plano:** o plano 00 e o 01a escreviam `save-exact` no `.npmrc` e `onlyBuiltDependencies`. No pnpm 12.4.1 o `.npmrc` só vale para registry e autenticação (`save-exact=true` ali é ignorado em silêncio), e o nome atual é `allowBuilds` (mapa `pacote: true|false`). Valem `saveExact: true`, `minimumReleaseAge: 4320` (em minutos) e `allowBuilds` no `pnpm-workspace.yaml`. Com `strictDepBuilds`, pacote novo com script de instalação faz a instalação falhar até alguém decidir.
- `overrides` no `pnpm-workspace.yaml` só para dependência transitiva que o pacote de cima fixa sem faixa e que tem aviso de segurança: versão exata, o GHSA no comentário e seletor `pai>filho@<versão corrigida>`, que desliga o override sozinho quando o pacote de cima subir. O `minimumReleaseAge` vale também para a versão forçada. Primeiro caso: multer 2.5.0 sob `@nestjs/platform-express` (2026-10-26).
- Versão publicada há menos de 3 dias não é instalável, nem como transitiva. Isso adia correções de segurança em até 3 dias (exemplo: a correção do Prisma 7.10.1 só pôde entrar em 2026-10-18, dois dias depois do aviso do audit).
- Os testes de integração apagam e recriam o Postgres de teste a cada execução, então rodam um arquivo por vez.
- Os testes de fronteiras e os do verificador de migrações são testes comuns e entram em `pnpm test` e no PR.
- Os testes dos scripts rodam com `node --test "scripts/**/*.test.mjs"` (o Node 22 não aceita a pasta sozinha).
