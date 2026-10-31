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

  // Sessão do app (`@bairrin/mobile-base`): o token vive só no SecureStore (CA-03). AsyncStorage e
  // FileSystem gravam em texto puro e ficam proibidos em `src/sessao`, por `import`, `import()` ou
  // `require`. A cópia dos dados (`expo-file-system`) mora em outra pasta do pacote.
  {
    files: ['packages/mobile-base/src/sessao/**/*.{js,jsx,cjs,mjs,ts,tsx,mts,cts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@react-native-async-storage/async-storage',
              message: 'A sessão só usa o SecureStore (CA-03): AsyncStorage grava em texto puro.',
            },
            {
              name: 'expo-file-system',
              message: 'A sessão só usa o SecureStore (CA-03): FileSystem grava em texto puro.',
            },
          ],
          patterns: [
            {
              group: ['@react-native-async-storage/async-storage/*', 'expo-file-system/*'],
              message: 'A sessão só usa o SecureStore (CA-03): sem AsyncStorage nem FileSystem.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        ...[
          // Texto literal e template literal sem expressão: o Metro resolve os dois.
          "CallExpression[callee.name='require'][arguments.0.value=",
          'ImportExpression[source.value=',
          "CallExpression[callee.name='require'][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0][arguments.0.quasis.0.value.cooked=",
          "ImportExpression[source.type='TemplateLiteral'][source.expressions.length=0][source.quasis.0.value.cooked=",
        ].map((inicio) => ({
          selector: `${inicio}/^(@react-native-async-storage\\/async-storage|expo-file-system)(\\/|$)/]`,
          message: 'A sessão só usa o SecureStore (CA-03): sem AsyncStorage nem FileSystem.',
        })),
      ],
    },
  },
);
