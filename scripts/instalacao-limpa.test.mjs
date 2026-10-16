// CA-F1: `pnpm test` precisa passar numa cópia limpa, em que nenhum pacote foi compilado
// (`dist/` não existe: o CI roda os testes antes do build). Cada pacote que importa outro
// `@bairrin/*` tem de enxergar o código-fonte dele, não o `dist/`.
//
// O teste copia `packages/` e `apps/painel` para uma pasta temporária sem `dist/`, mantém
// os symlinks relativos do pnpm (os `@bairrin/*` apontam para a cópia) e aponta
// `node_modules` da raiz para o instalado. Roda o Vitest de cada pacote lá dentro.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFileSync, cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

/** Pacotes que importam outro `@bairrin/*` nos testes, e a pasta de cada um. */
const PACOTES = ['packages/cliente-api', 'packages/contratos', 'packages/tokens', 'apps/painel'];

const PASTAS_DE_SAIDA = new Set(['dist', '.vite', '.vitest', 'coverage']);

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
  symlinkSync(join(RAIZ, 'node_modules'), join(copia, 'node_modules'));
});

after(() => {
  if (copia !== undefined) rmSync(copia, { recursive: true, force: true });
});

function rodarVitest(pacote) {
  const pasta = join(copia, pacote);
  const vitest = join(pasta, 'node_modules/vitest/vitest.mjs');
  return new Promise((resolver) => {
    execFile(
      process.execPath,
      [vitest, 'run', '--passWithNoTests'],
      { cwd: pasta, timeout: 120_000, env: { ...process.env, CI: '1' } },
      (erro, stdout, stderr) => resolver({ erro, saida: `${stdout}\n${stderr}` }),
    );
  });
}

describe('cópia limpa, sem dist/ (CA-F1)', () => {
  for (const pacote of PACOTES) {
    it(`${pacote}: os testes passam sem nenhum pacote compilado`, async () => {
      const { erro, saida } = await rodarVitest(pacote);
      assert.equal(erro, null, saida.slice(-1500));
    });
  }
});
