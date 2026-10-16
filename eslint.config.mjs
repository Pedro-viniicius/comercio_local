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

  // API: o texto do log é fixo e escrito pelo código (Seg-1, S36). O logger
  // já descarta a mensagem do erro e os argumentos de interpolação, mas não vê
  // o texto montado antes da chamada: template string com expressão e
  // `.message` não entram como argumento de método de log (nem como valor de
  // propriedade do objeto). `console` fica de fora: as CLIs escrevem para quem
  // roda o release, não para o log.
  {
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...(() => {
          const chamadaDeLog =
            "CallExpression[callee.type='MemberExpression'][callee.object.name!='console']" +
            '[callee.property.name=/^(trace|debug|info|warn|error|fatal|log|verbose)$/]';
          const mensagem =
            'Texto do log é fixo (CONVENCOES, Logs): sem template string com expressão e sem ' +
            '`.message`. Ponha o erro em `err` e os dados não pessoais em chaves do objeto.';
          return [
            `${chamadaDeLog} > TemplateLiteral[expressions.length>0]`,
            `${chamadaDeLog} > MemberExpression[property.name='message']`,
            `${chamadaDeLog} > ObjectExpression > Property > TemplateLiteral.value[expressions.length>0]`,
            `${chamadaDeLog} > ObjectExpression > Property > MemberExpression.value[property.name='message']`,
          ].map((selector) => ({ selector, message: mensagem }));
        })(),
      ],
    },
  },

  // Painel: React no navegador.
  {
    files: ['apps/painel/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
);
