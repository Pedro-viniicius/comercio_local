// O texto do logo no app é uma cópia do asset da marca (o Metro não importa `.svg`): se o
// `designer` mudar o desenho, este teste falha até a cópia ser refeita.
import { LOGO_HORIZONTAL } from './logo.ts';

// O pacote não declara os tipos do Node (só roda no Jest, onde o módulo existe).
declare const __dirname: string;
const { readFileSync } = jest.requireActual<{
  readFileSync: (caminho: string, codificacao: 'utf8') => string;
}>('node:fs');
const { join } = jest.requireActual<{ join: (...partes: string[]) => string }>('node:path');

const ASSET = join(__dirname, '../../../../../assets/brand/bairrin-logo-horizontal.svg');

describe('LOGO_HORIZONTAL', () => {
  it('é igual ao `assets/brand/bairrin-logo-horizontal.svg`', () => {
    expect(LOGO_HORIZONTAL).toBe(readFileSync(ASSET, 'utf8').trim());
  });

  it('é um SVG sem texto, sem script e sem referência externa', () => {
    expect(LOGO_HORIZONTAL.startsWith('<svg ')).toBe(true);
    expect(LOGO_HORIZONTAL).not.toMatch(/<script|<text|<image|href=|javascript:/i);
  });
});
