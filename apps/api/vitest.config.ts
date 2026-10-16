// Testes unitários da API: `src/**/*.test.ts` e `test/**/*.test.ts`, fora a
// integração (vitest.integracao.config.ts). Não leem `.env`: cada teste monta
// o ambiente com valores fictícios.
//
// Sem `unplugin-swc`: o Vite 8 (oxc) emite os metadados de decorator que a
// injeção por construtor do Nest usa (conferido nesta etapa com o
// `FiltroDeErros`, que recebe o `PinoLogger` só pelo tipo do parâmetro).
import { configDefaults, defineConfig } from 'vitest/config';

/** Faz `@bairrin/*` resolver para o código-fonte, sem precisar de build. */
export const condicoesDoMonorepo = ['@bairrin/fonte'];

export default defineConfig({
  resolve: { conditions: condicoesDoMonorepo },
  ssr: { resolve: { conditions: condicoesDoMonorepo } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/integracao/**', '**/*.int.test.ts'],
  },
});
