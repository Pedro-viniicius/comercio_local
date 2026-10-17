// O domínio da API só pode importar `@bairrin/contratos/validadores` (ADR-003). Isso só vale
// se os validadores não puxarem zod nem outro arquivo do pacote: o domínio herdaria a
// dependência por baixo da regra de fronteira (que olha só o import direto).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as validadores from '@bairrin/contratos/validadores';

const PASTA = fileURLToPath(
  new URL('../../../../packages/contratos/src/validadores/', import.meta.url),
);
const FONTES = readdirSync(PASTA).filter((arquivo) => /^(?!.*\.test\.ts$).*\.ts$/.test(arquivo));

/** Origem de cada `import`/`export ... from` e de cada `import()` do texto. */
function origensDoArquivo(texto: string): string[] {
  const semComentarios = texto.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
  return [
    ...semComentarios.matchAll(/\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g),
    ...semComentarios.matchAll(/\bimport\s*['"]([^'"]+)['"]/g),
    ...semComentarios.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
    ...semComentarios.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]/g),
  ].map((achado) => achado[1] ?? '');
}

describe('validadores puros (ADR-003)', () => {
  it('há os arquivos esperados no subcaminho', () => {
    expect(FONTES).toEqual(
      expect.arrayContaining([
        'codigo.ts',
        'email.ts',
        'index.ts',
        'senha.ts',
        'senhas-comuns.ts',
        'telefone.ts',
      ]),
    );
  });

  it.each(FONTES)('%s só importa arquivos da própria pasta (nem zod, nem ../)', (arquivo) => {
    const origens = origensDoArquivo(readFileSync(`${PASTA}${arquivo}`, 'utf8'));
    for (const origem of origens) {
      expect(origem, `${arquivo} importa ${origem}`).toMatch(/^\.\/[a-z-]+\.ts$/);
    }
  });

  it('a detecção de import enxerga os formatos usados (a própria prova não é cega)', () => {
    const texto = [
      "import { z } from 'zod';",
      "export * from '../zod.ts';",
      "import '../efeito.ts';",
      "const m = await import('node:fs');",
      "// import x from 'comentario';",
    ].join('\n');
    expect(origensDoArquivo(texto)).toEqual(['zod', '../zod.ts', '../efeito.ts', 'node:fs']);
  });

  it('exporta só funções e constantes de dados: nenhum esquema do zod', () => {
    for (const [nome, valor] of Object.entries(validadores)) {
      const ehEsquemaDoZod =
        typeof valor === 'object' && valor !== null && '_zod' in (valor as object);
      expect(ehEsquemaDoZod, nome).toBe(false);
    }
  });
});
