// O logo do painel é uma cópia do asset da marca (o Vite o serve como arquivo, de dentro da pasta
// do app): se o `designer` mudar o desenho em `assets/brand`, este teste falha até a cópia ser refeita.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const COPIA = join(import.meta.dirname, 'bairrin-logo-horizontal.svg');
const ASSET = join(import.meta.dirname, '../../../../assets/brand/bairrin-logo-horizontal.svg');

describe('logo do painel', () => {
  it('é igual ao `assets/brand/bairrin-logo-horizontal.svg`', () => {
    expect(readFileSync(COPIA, 'utf8')).toBe(readFileSync(ASSET, 'utf8'));
  });
});
