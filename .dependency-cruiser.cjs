// Fronteiras de camadas do monorepo (CA-F7), verificadas por `pnpm deps:verificar`.
// Os testes de apps/api/test/fronteiras provam que cada regra reprova uma
// fixture que a viola e que a árvore real passa.
//
// Os caminhos das regras são relativos à raiz do repositório. O teste roda a
// CLI com a raiz em `apps/api/test/fronteiras/fixtures` (que repete o desenho
// `apps/api/src/modulos/...`), por isso nenhum padrão pode depender de outro
// prefixo.

const MODULOS = '^apps/api/src/modulos';
const NUCLEO = '^apps/api/src/compartilhado';
const DOMINIO = `${MODULOS}/[^/]+/dominio/`;
const APLICACAO = `${MODULOS}/[^/]+/aplicacao/`;
const CAMADAS_EXTERNAS_AO_DOMINIO = `${MODULOS}/[^/]+/(aplicacao|infra|http)/`;

// Adaptadores e entrega do núcleo (ADR-003): o domínio e a aplicação dos módulos
// só enxergam as portas puras (`transacao/`, `tempo/`, `eventos/publicador.ts`,
// `auditoria/`, `email/enviador-de-email.ts`, `titular/`...), nunca Nest, Prisma,
// logger, Sentry nem configuração. Adaptador fica em `compartilhado/infra/` ou
// tem o sufixo `.adaptador.ts`.
const ADAPTADORES_DO_NUCLEO = [
  `${NUCLEO}/(infra|http|log|observabilidade|config|saude)/`,
  `${NUCLEO}/.+\\.adaptador\\.ts$`,
  `${NUCLEO}/compartilhado\\.module\\.ts$`,
];

// Client do Prisma gerado (gitignored): só os adaptadores de banco o importam.
const CLIENT_GERADO = `${NUCLEO}/infra/gerado/`;

// Dependências npm resolvidas pelo pnpm vivem em `.../node_modules/<escopo>/<pacote>`.
const NESTJS = '(^|/)node_modules/@nestjs/';
const PRISMA = '(^|/)node_modules/@prisma/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'dominio-nao-importa-camadas-externas',
      comment: 'O domínio não depende de aplicação, infra nem http, do mesmo módulo ou de outro.',
      severity: 'error',
      from: { path: DOMINIO },
      to: { path: CAMADAS_EXTERNAS_AO_DOMINIO },
    },
    {
      name: 'dominio-nao-importa-framework',
      comment: 'O domínio é TypeScript puro: sem @nestjs/* nem @prisma/*.',
      severity: 'error',
      from: { path: DOMINIO },
      to: { path: [NESTJS, PRISMA] },
    },
    {
      name: 'dominio-so-importa-validadores',
      comment:
        'O domínio só pode importar @bairrin/contratos/validadores: nenhum outro pacote do ' +
        'workspace nem outro caminho de @bairrin/contratos. O subcaminho ainda não existe; ' +
        'a exceção vale para quando existir (como arquivo do pacote ou como nome não resolvido).',
      severity: 'error',
      from: { path: DOMINIO },
      to: {
        // O prefixo `../` aparece quando a raiz da execução é a das fixtures de teste.
        path: '^((\\.\\./)*packages/|@bairrin/)',
        pathNot:
          '^((\\.\\./)*packages/contratos/src/validadores([/.]|$)|@bairrin/contratos/validadores$)',
      },
    },
    {
      name: 'aplicacao-nao-importa-infra-nem-http',
      comment: 'A aplicação conhece portas, não adaptadores: sem infra nem http.',
      severity: 'error',
      from: { path: APLICACAO },
      to: { path: `${MODULOS}/[^/]+/(infra|http)/` },
    },
    {
      name: 'dominio-nao-importa-adaptador-do-nucleo',
      comment:
        'O domínio só usa as portas puras do núcleo: nada de compartilhado/(infra|http|log|' +
        'observabilidade|config|saude), de *.adaptador.ts nem do compartilhado.module.ts.',
      severity: 'error',
      from: { path: DOMINIO },
      to: { path: ADAPTADORES_DO_NUCLEO },
    },
    {
      name: 'aplicacao-nao-importa-adaptador-do-nucleo',
      comment:
        'A aplicação recebe as portas do núcleo (UnidadeDeTrabalho, PublicadorDeEventos, ' +
        'RepositorioDeAuditoria, EnviadorDeEmail, Relogio), nunca o adaptador.',
      severity: 'error',
      from: { path: APLICACAO },
      to: { path: ADAPTADORES_DO_NUCLEO },
    },
    {
      name: 'nucleo-nao-importa-modulos',
      comment: 'O núcleo compartilhado não depende de nenhum módulo de contexto.',
      severity: 'error',
      from: { path: `${NUCLEO}/` },
      to: { path: `${MODULOS}/` },
    },
    {
      name: 'client-do-prisma-so-na-infra',
      comment:
        'O client gerado do Prisma só é importado pela infra (do núcleo ou de um módulo); ' +
        'o resto passa pela UnidadeDeTrabalho e pelos repositórios.',
      severity: 'error',
      from: { pathNot: `^apps/api/src/(compartilhado|modulos/[^/]+)/infra/` },
      to: { path: CLIENT_GERADO },
    },
    {
      name: 'modulo-so-importa-index-de-outro-modulo',
      comment:
        'Um módulo só enxerga outro pela API pública (modulos/<m>/index.ts); ' +
        'qualquer outro arquivo é interno do módulo.',
      severity: 'error',
      from: { path: `${MODULOS}/([^/]+)/` },
      to: {
        path: `${MODULOS}/[^/]+/`,
        pathNot: [`${MODULOS}/$1/`, `${MODULOS}/[^/]+/index\\.ts$`],
      },
    },
    {
      name: 'fora-da-api-nao-importa-api',
      comment: 'Apps e pacotes não importam código de apps/api: o que é comum vai para packages/.',
      severity: 'error',
      from: { path: '^(apps/(?!api/)|packages/)' },
      to: { path: '^apps/api/' },
    },
  ],

  options: {
    // Dependências npm e o client gerado do Prisma entram no grafo como folhas
    // (as regras de framework e de client as veem), mas o cruiser não entra nelas.
    doNotFollow: { path: ['(^|/)node_modules/', CLIENT_GERADO] },
    exclude: {
      path: [
        // Só dentro de apps/ e packages/: o `dist/` de uma dependência npm precisa
        // continuar no grafo, senão `@prisma/*` e afins passam despercebidos.
        '^(apps|packages)/[^/]+/(dist|coverage|\\.expo)/',
        '^apps/[^/]+/(android|ios)/',
        // Fixtures que violam as regras de propósito: só o teste as verifica.
        '^apps/api/test/fronteiras/fixtures/',
      ],
    },
    // Conta também `import type`, que some depois da compilação.
    tsPreCompilationDeps: true,
    // Resolve os imports relativos com `.ts` e os pacotes `@bairrin/*` pelo fonte.
    tsConfig: { fileName: `${__dirname}/tsconfig.base.json` },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['@bairrin/fonte', 'import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
    },
  },
};
