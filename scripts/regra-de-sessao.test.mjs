// Prova da regra de lint da sessão do app (CA-03 do plano 01b, etapa 1b): em
// `packages/mobile-base/src/sessao/**` não entra AsyncStorage nem FileSystem, que gravam em texto
// puro; o token vive só no SecureStore. As regras são lidas da configuração real do repositório,
// como o ESLint as aplica a um arquivo dessa pasta, e rodam sobre trechos com o parser do
// typescript-eslint. O teste de SecureStore de verdade fica na etapa 12.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const REGRAS = ['no-restricted-imports', 'no-restricted-syntax'];

const eslint = new ESLint({ cwd: RAIZ });

/** Mensagens das duas regras para um trecho, como se estivesse no arquivo `caminho` do repositório. */
async function violacoes(trecho, caminho = 'packages/mobile-base/src/sessao/x.ts') {
  const configuracao = await eslint.calculateConfigForFile(caminho);
  const regras = Object.fromEntries(
    REGRAS.map((nome) => [nome, configuracao?.rules?.[nome] ?? 'off']),
  );
  const mensagens = new Linter({ cwd: RAIZ }).verify(
    trecho,
    [
      {
        files: ['**/trecho.*'],
        languageOptions: { parser: tseslint.parser, sourceType: 'module' },
        rules: regras,
      },
    ],
    { filename: caminho.endsWith('.tsx') ? 'trecho.tsx' : 'trecho.ts' },
  );
  assert.deepEqual(
    mensagens.filter((mensagem) => mensagem.fatal),
    [],
    `o trecho não foi lido: ${trecho}`,
  );
  return mensagens.filter((mensagem) => REGRAS.includes(mensagem.ruleId ?? ''));
}

describe('regra de lint da sessão (mobile-base)', () => {
  it('a configuração real liga as duas regras como erro em src/sessao, inclusive em subpasta', async () => {
    for (const caminho of [
      'packages/mobile-base/src/sessao/x.ts',
      'packages/mobile-base/src/sessao/x.tsx',
      'packages/mobile-base/src/sessao/a/b/c/x.ts',
      'packages/mobile-base/src/sessao/x.test.ts',
      ...['js', 'jsx', 'cjs', 'mjs', 'mts', 'cts'].map(
        (ext) => `packages/mobile-base/src/sessao/x.${ext}`,
      ),
    ]) {
      const configuracao = await eslint.calculateConfigForFile(caminho);
      for (const nome of REGRAS) {
        const regra = configuracao?.rules?.[nome];
        assert.ok(Array.isArray(regra), `${nome} ausente em ${caminho}`);
        assert.equal(regra[0], 2, `${nome} não é erro em ${caminho}`);
      }
    }
  });

  for (const trecho of [
    "import fs from 'expo-file-system';",
    "import * as fs from 'expo-file-system';",
    "import { File } from 'expo-file-system';",
    "import 'expo-file-system';",
    "import type { File } from 'expo-file-system';",
    "import { type File } from 'expo-file-system';",
    "export * from 'expo-file-system';",
    "export { File } from 'expo-file-system';",
    "import fs from 'expo-file-system/legacy';",
    "import fs from 'expo-file-system/next';",
    "import a from '@react-native-async-storage/async-storage';",
    "import a from '@react-native-async-storage/async-storage/jest/async-storage-mock';",
    "const fs = require('expo-file-system');",
    'const a = require("@react-native-async-storage/async-storage");',
    "const fs = require('expo-file-system/legacy');",
    "const fs = await import('expo-file-system');",
    "const fs = await import('expo-file-system/legacy');",
    "const a = await import('@react-native-async-storage/async-storage');",
    "import fs = require('expo-file-system');",
    // Template literal sem expressão: o Metro resolve como texto literal (Q33).
    'const fs = await import(`expo-file-system`);',
    'const fs = await import(`expo-file-system/legacy`);',
    'const a = await import(`@react-native-async-storage/async-storage`);',
    'const fs = require(`expo-file-system`);',
    'const a = require(`@react-native-async-storage/async-storage/jest/async-storage-mock`);',
  ]) {
    it(`reprova em src/sessao: ${trecho}`, async () => {
      assert.ok((await violacoes(trecho)).length > 0, `deveria reprovar: ${trecho}`);
    });
  }

  it('reprova também em arquivo .tsx e em arquivo de teste dentro de src/sessao', async () => {
    const trecho = "import fs from 'expo-file-system';";
    assert.ok((await violacoes(trecho, 'packages/mobile-base/src/sessao/x.tsx')).length > 0);
    assert.ok((await violacoes(trecho, 'packages/mobile-base/src/sessao/x.test.ts')).length > 0);
  });

  it('reprova em arquivo .js, .jsx, .cjs, .mjs, .mts e .cts dentro de src/sessao (Q33)', async () => {
    const trecho = "import fs from 'expo-file-system';";
    for (const ext of ['js', 'jsx', 'cjs', 'mjs', 'mts', 'cts']) {
      assert.ok(
        (await violacoes(trecho, `packages/mobile-base/src/sessao/x.${ext}`)).length > 0,
        `deveria reprovar em x.${ext}`,
      );
    }
  });

  for (const trecho of [
    "import * as cofre from 'expo-secure-store';",
    "const cofre = await import('expo-secure-store');",
    "import { x } from './outro-arquivo.ts';",
    "import fs from 'expo-file-system-extra';",
    // Com expressão o caminho não é conhecido: a regra não alcança (limite documentado, S121).
    'const x = await import(`expo-${nome}`);',
    'const fs = require(`expo-file-system-extra`);',
  ]) {
    it(`deixa passar em src/sessao: ${trecho}`, async () => {
      assert.deepEqual(await violacoes(trecho), []);
    });
  }

  it('deixa o expo-file-system fora de src/sessao (a cópia dos dados do titular, S10)', async () => {
    const trecho = "import { File } from 'expo-file-system';";
    for (const caminho of [
      'packages/mobile-base/src/index.ts',
      'packages/mobile-base/src/privacidade/x.ts',
      'apps/consumidor/src/telas/x.tsx',
    ]) {
      assert.deepEqual(await violacoes(trecho, caminho), [], caminho);
    }
  });
});
