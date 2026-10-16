// Testes de integração da API (`test/integracao/**/*.int.test.ts`).
// `pnpm --filter api test:integracao -- <trecho>` roda só os arquivos cujo
// nome contém o trecho. Antes de tudo, o `globalSetup` recria o Postgres de
// teste e aplica as migrações com o papel de migração. Não leem `.env`: as URLs
// do banco vêm do ambiente do processo ou dos valores do docker-compose.
//
// Sem `mergeConfig` com o config unitário de propósito: ele concatena
// `include` e `exclude`, e a exclusão da integração de lá valeria aqui.
import { defineConfig } from 'vitest/config';
import { condicoesDoMonorepo } from './vitest.config.ts';

/**
 * Trechos de nome depois de `--`. O pnpm 12 repassa o `--` ao script
 * (`vitest run --config ... -- http-base`) e o Vitest ignora o que vem depois
 * dele, então o filtro é aplicado aqui. Só letras, dígitos, `.`, `_` e `-`.
 */
function trechosDoFiltro(argumentos: readonly string[]): string[] {
  const indice = argumentos.indexOf('--');
  if (indice === -1) return [];
  return argumentos.slice(indice + 1).filter((trecho) => /^[\w.-]+$/.test(trecho));
}

const trechos = trechosDoFiltro(process.argv);

export default defineConfig({
  resolve: { conditions: condicoesDoMonorepo },
  ssr: { resolve: { conditions: condicoesDoMonorepo } },
  test: {
    environment: 'node',
    include:
      trechos.length > 0
        ? trechos.map((trecho) => `test/integracao/**/*${trecho}*.int.test.ts`)
        : ['test/integracao/**/*.int.test.ts'],
    globalSetup: ['test/integracao/preparar-banco.ts'],
    // Um arquivo por vez: os testes que usam o banco dividem o mesmo
    // Postgres de teste.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
