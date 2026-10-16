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

  // Painel: React no navegador.
  {
    files: ['apps/painel/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
);
