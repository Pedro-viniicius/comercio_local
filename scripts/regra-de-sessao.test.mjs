// Prova da regra de lint da sessão do app (CA-03 do plano 01b, etapas 1b e 12): em
// `packages/mobile-base/src/sessao/**` os imports seguem uma lista de permissão (S121), então não
// entra AsyncStorage, FileSystem, SQLite nem pacote novo, que gravariam o token em texto puro; o
// token vive só no SecureStore. `import()` e `require` não entram, e nenhum comentário desliga as
// regras (`noInlineConfig`). As regras são lidas da configuração real do repositório, como o ESLint
// as aplica a um arquivo dessa pasta, e rodam sobre trechos com o parser do typescript-eslint. O
// teste de SecureStore de verdade fica em `packages/mobile-base/src/sessao/*.test.ts(x)`.
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

  // Lista de permissão (S121): o que não está nela reprova, inclusive o que antes passava.
  for (const trecho of [
    "import fs from 'expo-file-system-extra';",
    "import { Settings } from 'react-native';",
    "import { openDatabaseSync } from 'expo-sqlite';",
    "import { temaClaro } from '@bairrin/tokens';",
    "import x from '@tanstack/react-query/build/x';",
    "import x from 'expo-secure-store/build/SecureStore';",
    "import x from 'Expo-Secure-Store';",
    "import { x } from '../outro-arquivo.ts';",
    "import { x } from '../instalacao/outro.ts';",
    "import { x } from './a/../../b.ts';",
    "import { render } from '@testing-library/react-native';",
    "const cofre = await import('expo-secure-store');",
    'const x = await import(`expo-${nome}`);',
    'const fs = require(`expo-file-system-extra`);',
    "const r = require; r('expo-file-system');",
    "const fs = module.require('expo-file-system');",
  ]) {
    it(`reprova em src/sessao (lista de permissão): ${trecho}`, async () => {
      assert.ok((await violacoes(trecho)).length > 0, `deveria reprovar: ${trecho}`);
    });
  }

  for (const trecho of [
    "import * as cofre from 'expo-secure-store';",
    "import { useState } from 'react';",
    "import { criarClienteAutenticado } from '@bairrin/cliente-api';",
    "import { sessaoSchema } from '@bairrin/contratos';",
    "import { QueryClient } from '@tanstack/react-query';",
    "import { x } from './outro-arquivo.ts';",
    "import { x } from './teste/cenario.ts';",
    "import { marcaDeInstalacaoNoAparelho } from '../instalacao/marca-de-instalacao.ts';",
  ]) {
    it(`deixa passar em src/sessao: ${trecho}`, async () => {
      assert.deepEqual(await violacoes(trecho), []);
    });
  }

  it('nos testes e auxiliares da sessão, só acrescenta a Testing Library (e `../` nos auxiliares)', async () => {
    const rntl = "import { render } from '@testing-library/react-native';";
    assert.deepEqual(await violacoes(rntl, 'packages/mobile-base/src/sessao/x.test.tsx'), []);
    assert.deepEqual(await violacoes(rntl, 'packages/mobile-base/src/sessao/teste/x.ts'), []);
    const acima = "import { x } from '../sessao-do-app.ts';";
    assert.deepEqual(await violacoes(acima, 'packages/mobile-base/src/sessao/teste/x.ts'), []);
    for (const caminho of [
      'packages/mobile-base/src/sessao/x.test.tsx',
      'packages/mobile-base/src/sessao/teste/x.ts',
    ]) {
      for (const trecho of [
        "import fs from 'expo-file-system';",
        "import { Settings } from 'react-native';",
        "import x from '../../index.ts';",
      ]) {
        assert.ok((await violacoes(trecho, caminho)).length > 0, `${trecho} em ${caminho}`);
      }
    }
  });

  it('nenhum comentário desliga a regra em src/sessao (noInlineConfig)', async () => {
    for (const comentario of [
      '/* eslint-disable */',
      '/* eslint-disable no-restricted-imports */',
      '// eslint-disable-next-line no-restricted-imports',
      '/* eslint no-restricted-imports: "off" */',
    ]) {
      const [resultado] = await eslint.lintText(
        `${comentario}\nimport fs from 'expo-file-system';\nexport default fs;\n`,
        { filePath: `${RAIZ}packages/mobile-base/src/sessao/desligada.js` },
      );
      assert.ok(
        resultado.messages.some((m) => m.ruleId === 'no-restricted-imports' && m.severity === 2),
        `o comentário desligou a regra: ${comentario}`,
      );
    }
  });

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
