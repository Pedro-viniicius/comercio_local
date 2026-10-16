// Testes do cliente da API. A condição `@bairrin/fonte` faz `@bairrin/contratos` resolver
// para o código-fonte: os testes passam sem build prévio dos pacotes (o CI roda `pnpm test`
// antes de `pnpm build`, numa cópia sem `dist/`).
import { defineConfig } from 'vitest/config';

const condicoesDoMonorepo = ['@bairrin/fonte'];

export default defineConfig({
  resolve: { conditions: condicoesDoMonorepo },
  ssr: { resolve: { conditions: condicoesDoMonorepo } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
