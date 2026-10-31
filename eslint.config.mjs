// Configuração única do ESLint para o monorepo (flat config).
// Regras com informação de tipos via projectService: cada arquivo .ts/.tsx
// precisa estar no `include` de algum tsconfig do pacote.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/coverage/',
    '**/.expo/',
    '**/.vercel/',
    'apps/*/android/',
    'apps/*/ios/',
    'docs/',
    '.claude/',
  ]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Parâmetro ou variável ignorada de propósito começa com "_".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // Arquivos JavaScript (configurações e scripts do Node) não passam pelo tsc.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  // API e pacotes rodam no Node.
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // API: o texto do log é fixo e escrito pelo código (Seg-1, S36, P8, S70). O
  // logger já descarta a mensagem do erro e os argumentos de interpolação, mas
  // não vê o texto montado antes da chamada: em nenhum ponto dos argumentos de
  // um método de log (nem dentro de objeto, ternário, `??`, `as` ou
  // encadeamento opcional) entram template string com expressão,
  // concatenação com `+`, `.message` e `.stack` (também `['message']` e
  // `` [`stack`] ``), `String(...)`, `.join`, `.concat` e `.toString`. A pilha
  // começa pela mensagem do erro: o erro vai inteiro em `err`, e o logger
  // guarda só os quadros. A concatenação só de literais, ou uma soma, também
  // reprova: texto fixo é um literal só, e a conta vai numa variável antes.
  // Os vínculos de logger filho (`child`, `assign` do nestjs-pino,
  // `setBindings`) seguem a mesma regra; `Object.assign` fica de fora.
  // `console` também: as CLIs escrevem para quem roda o release, não para o
  // log.
  //
  // No `Logger` do `@nestjs/common`, o último argumento depois do texto vira o
  // contexto (S71): `Logger.log('renovada', token)` grava o token. Por isso o
  // `Logger` estático e o `new Logger()` sem contexto (ou com `undefined`)
  // ficam proibidos, e também o `Logger` importado com outro nome ou pelo
  // namespace, que escapariam dessas duas regras. A instância com contexto
  // (`new Logger(Classe.name)`) põe o próprio contexto no fim, e o que vem
  // antes vira interpolação, que o logger descarta.
  {
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...(() => {
          const chamadaDeLog =
            "CallExpression[callee.type='MemberExpression'][callee.object.name!=/^(console|Object)$/]" +
            '[callee.property.name=/^(trace|debug|info|warn|error|fatal|log|verbose|child|assign|setBindings)$/]';
          const mensagem =
            'Texto do log é fixo (CONVENCOES, Logs): sem template string com expressão, sem ' +
            'concatenação com `+`, sem `.message` ou `.stack` e sem `String(...)`, `join`, `concat` ou ' +
            '`toString`, nem dentro de objeto. Ponha o erro em `err` e os dados não pessoais ' +
            'em chaves do objeto.';
          const proibidos = [
            'TemplateLiteral[expressions.length>0]',
            "BinaryExpression[operator='+']",
            'MemberExpression[property.name=/^(message|stack)$/]',
            'MemberExpression[property.value=/^(message|stack)$/]',
            // `` e[`message`] ``: a chave é um template (sem expressão, ou o
            // template com expressão já reprova).
            "MemberExpression[property.type='TemplateLiteral']" +
              '[property.quasis.0.value.cooked=/^(message|stack)$/]',
            "CallExpression[callee.name='String']",
            'CallExpression[callee.property.name=/^(join|concat|toString)$/]',
          ];
          // O próprio argumento (`> X.arguments`) e qualquer nó dentro dele
          // (`> *.arguments X`); o `callee` (`logger.info`) fica de fora.
          return proibidos.flatMap((proibido) =>
            [
              `${chamadaDeLog} > ${proibido}.arguments`,
              `${chamadaDeLog} > *.arguments ${proibido}`,
            ].map((selector) => ({ selector, message: mensagem })),
          );
        })(),
        {
          selector:
            "CallExpression[callee.object.name='Logger']" +
            '[callee.property.name=/^(debug|info|warn|error|fatal|log|verbose)$/]',
          message:
            'Sem `Logger` estático na API (CONVENCOES, Logs; S71): o último argumento vira o ' +
            'contexto do log. Use `new Logger(Classe.name)` ou o `PinoLogger` injetado.',
        },
        {
          selector: "NewExpression[callee.name='Logger'][arguments.length=0]",
          message:
            '`new Logger()` sem contexto (CONVENCOES, Logs; S71): o último argumento de cada ' +
            'chamada vira o contexto. Passe o nome: `new Logger(Classe.name)`.',
        },
        {
          selector: "NewExpression[callee.name='Logger'] > Identifier.arguments[name='undefined']",
          message:
            '`new Logger(undefined)` é um `Logger` sem contexto (CONVENCOES, Logs; S71). Passe ' +
            'o nome: `new Logger(Classe.name)`.',
        },
        {
          selector:
            "ImportDeclaration[source.value='@nestjs/common'] > " +
            "ImportSpecifier[imported.name='Logger'][local.name!='Logger']",
          message:
            '`Logger` do `@nestjs/common` com outro nome (CONVENCOES, Logs; S71): o lint das ' +
            'regras do `Logger` olha o nome `Logger`. Importe sem alias.',
        },
        {
          selector: "ImportDeclaration[source.value='@nestjs/common'] > ImportNamespaceSpecifier",
          message:
            'Sem `import * as` do `@nestjs/common` (CONVENCOES, Logs; S71): o `Logger` pelo ' +
            'namespace escapa das regras do `Logger`. Importe pelo nome.',
        },
      ],
    },
  },

  // Painel: React no navegador.
  {
    files: ['apps/painel/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },

  // Apps Expo e `@bairrin/mobile-base`: React Native, com as regras de hooks (sem o plugin do Vite).
  {
    files: [
      'apps/consumidor/**/*.{ts,tsx}',
      'apps/lojista/**/*.{ts,tsx}',
      'packages/mobile-base/**/*.{ts,tsx}',
    ],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },

  // Config plugin do Expo (`@bairrin/mobile-base/app.plugin.js`): CommonJS, carregado pelo `require`
  // do Expo CLI no Node, na configuração dos apps (não entra no bundle).
  {
    files: ['packages/mobile-base/app.plugin.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  // Sessão do app (`@bairrin/mobile-base`): o token vive só no SecureStore (CA-03). Em `src/sessao`,
  // os imports seguem uma lista de permissão (S121): qualquer módulo fora dela (AsyncStorage,
  // FileSystem, SQLite, o `Settings` do `react-native`, que gravam em texto puro, ou um pacote novo)
  // reprova. `import()` e `require` não entram, nem com caminho literal. Nenhum comentário desliga
  // regra nesses arquivos (`noInlineConfig`). A marca de instalação (`src/instalacao`, que usa o
  // FileSystem sem receber dado) é a única importação de fora da pasta.
  ...(() => {
    const ARQUIVOS = '{js,jsx,cjs,mjs,ts,tsx,mts,cts}';
    const PERMITIDOS = [
      'expo-secure-store',
      'react',
      '@bairrin/cliente-api',
      '@bairrin/contratos',
      '@tanstack/react-query',
      // Relativo dentro da pasta, sem `..` no meio.
      String.raw`\./[\w-]+(?:\.[\w-]+)*(?:/[\w-]+(?:\.[\w-]+)*)*`,
      String.raw`\.\./instalacao/marca-de-instalacao\.ts`,
    ];
    const NOS_TESTES = ['@testing-library/react-native'];
    // Os auxiliares de `src/sessao/teste` importam da pasta de cima (`../x.ts`), e só dela.
    const NOS_AUXILIARES = [String.raw`\.\./[\w-]+(?:\.[\w-]+)*`];
    const mensagem =
      'A sessão só importa da lista permitida (CA-03, S121): expo-secure-store, react, ' +
      '@bairrin/cliente-api, @bairrin/contratos, @tanstack/react-query e arquivos da pasta. ' +
      'AsyncStorage, FileSystem e SQLite gravam em texto puro.';
    const listaDePermissao = (lista) => [
      'error',
      {
        patterns: [
          {
            regex: `^(?!(?:${lista.join('|')})$)`,
            caseSensitive: true,
            message: mensagem,
          },
        ],
      },
    ];
    return [
      {
        files: [`packages/mobile-base/src/sessao/**/*.${ARQUIVOS}`],
        linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
        rules: {
          'no-restricted-imports': listaDePermissao(PERMITIDOS),
          'no-restricted-syntax': [
            'error',
            {
              selector: 'ImportExpression',
              message: 'Sem `import()` na sessão (S121): só `import` estático da lista permitida.',
            },
            {
              selector: "Identifier[name='require']",
              message: 'Sem `require` na sessão (S121): só `import` estático da lista permitida.',
            },
          ],
        },
      },
      {
        files: [
          `packages/mobile-base/src/sessao/**/*.test.${ARQUIVOS}`,
          `packages/mobile-base/src/sessao/teste/**/*.${ARQUIVOS}`,
        ],
        rules: { 'no-restricted-imports': listaDePermissao([...PERMITIDOS, ...NOS_TESTES]) },
      },
      {
        files: [`packages/mobile-base/src/sessao/teste/*.${ARQUIVOS}`],
        rules: {
          'no-restricted-imports': listaDePermissao([
            ...PERMITIDOS,
            ...NOS_TESTES,
            ...NOS_AUXILIARES,
          ]),
        },
      },
    ];
  })(),
);
