// CA-F1: `pnpm test` precisa passar numa cópia limpa, em que nenhum pacote foi compilado
// (`dist/` não existe: o CI roda os testes antes do build). Cada pacote que importa outro
// `@bairrin/*` tem de enxergar o código-fonte dele, não o `dist/`.
//
// O teste copia `packages/`, `apps/painel` e os apps Expo para uma pasta temporária sem
// `dist/`, mantém os symlinks relativos do pnpm (os `@bairrin/*` apontam para a cópia) e aponta
// `node_modules` da raiz para o instalado. Roda o Vitest de cada pacote (e o Jest dos apps Expo e
// do `mobile-base`) lá dentro.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

/** Pacotes que importam outro `@bairrin/*` nos testes, e a pasta de cada um. */
const PACOTES = [
  'packages/cliente-api',
  'packages/contratos',
  'packages/mobile-base',
  'packages/tokens',
  'apps/painel',
  'apps/consumidor',
  'apps/lojista',
];

const PASTAS_DE_SAIDA = new Set(['dist', '.vite', '.vitest', 'coverage']);

// O `pnpm run` põe o armazém virtual (`node_modules/.pnpm/node_modules`) no NODE_PATH; o Jest dos
// apps Expo precisa dele para achar `@babel/runtime`, que o Babel injeta no código transformado e
// nenhum app declara. Como o teste chama o Node direto, repete o que o pnpm faria.
const ambienteDoPnpm = { NODE_PATH: join(RAIZ, 'node_modules/.pnpm/node_modules') };

let copia;

before(() => {
  copia = mkdtempSync(join(tmpdir(), 'bairrin-limpa-'));
  const semSaidas = (origem) => !PASTAS_DE_SAIDA.has(basename(origem));
  for (const pacote of PACOTES) {
    cpSync(join(RAIZ, pacote), join(copia, pacote), {
      recursive: true,
      verbatimSymlinks: true,
      filter: semSaidas,
    });
  }
  for (const arquivo of ['package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json']) {
    copyFileSync(join(RAIZ, arquivo), join(copia, arquivo));
  }
  // A identidade visual faz parte do código-fonte: o logo do mobile-base é conferido contra
  // `assets/brand` e os ícones dos apps apontam para lá.
  cpSync(join(RAIZ, 'assets'), join(copia, 'assets'), { recursive: true });
  symlinkSync(join(RAIZ, 'node_modules'), join(copia, 'node_modules'));
});

after(() => {
  if (copia !== undefined) rmSync(copia, { recursive: true, force: true });
});

function rodarTestes(pacote) {
  const pasta = join(copia, pacote);
  // Os apps Expo e o `mobile-base` testam com o Jest (jest-expo); o resto, com o Vitest.
  const comJest = existsSync(join(pasta, 'jest.config.js'));
  const comando = comJest
    ? [join(pasta, 'node_modules/jest/bin/jest.js')]
    : [join(pasta, 'node_modules/vitest/vitest.mjs'), 'run', '--passWithNoTests'];
  return new Promise((resolver) => {
    execFile(
      process.execPath,
      comando,
      { cwd: pasta, timeout: 120_000, env: { ...process.env, CI: '1', ...ambienteDoPnpm } },
      (erro, stdout, stderr) => resolver({ erro, saida: `${stdout}\n${stderr}` }),
    );
  });
}

describe('cópia limpa, sem dist/ (CA-F1)', () => {
  for (const pacote of PACOTES) {
    it(`${pacote}: os testes passam sem nenhum pacote compilado`, async () => {
      const { erro, saida } = await rodarTestes(pacote);
      assert.equal(erro, null, saida.slice(-1500));
    });
  }
});
