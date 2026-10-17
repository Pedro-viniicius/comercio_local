import { describe, expect, it } from 'vitest';
import {
  normalizarCodigo,
  normalizarCodigoDeRecuperacao,
  TAMANHO_DO_CODIGO,
  TAMANHO_DO_CODIGO_DE_RECUPERACAO,
} from './index.ts';

describe('normalizarCodigo (6 dígitos)', () => {
  it('aceita 6 dígitos, inclusive com zero à esquerda e espaços colados do e-mail', () => {
    expect(TAMANHO_DO_CODIGO).toBe(6);
    expect(normalizarCodigo('123456')).toBe('123456');
    expect(normalizarCodigo('012345')).toBe('012345');
    expect(normalizarCodigo(' 123 456 ')).toBe('123456');
  });

  it.each([
    '',
    '12345',
    '1234567',
    '12345a',
    '123-456',
    '１２３４５６',
    '١٢٣٤٥٦',
    '12.345',
    `123456${' '.repeat(40)}`,
  ])('recusa %j', (codigo) => {
    expect(normalizarCodigo(codigo)).toBeNull();
  });
});

describe('normalizarCodigoDeRecuperacao (10 caracteres base32)', () => {
  it('aceita maiúsculas ou minúsculas, com hífen ou espaço, e devolve em maiúsculas', () => {
    expect(TAMANHO_DO_CODIGO_DE_RECUPERACAO).toBe(10);
    expect(normalizarCodigoDeRecuperacao('ABCDE23456')).toBe('ABCDE23456');
    expect(normalizarCodigoDeRecuperacao('abcde-23456')).toBe('ABCDE23456');
    expect(normalizarCodigoDeRecuperacao(' abcde 23456 ')).toBe('ABCDE23456');
  });

  it.each(['', 'ABCDE2345', 'ABCDE234567', 'ABCDE23450', 'ABCDE23458', 'ABCDE2345!', 'ÁBCDE23456'])(
    'recusa %j',
    (codigo) => {
      expect(normalizarCodigoDeRecuperacao(codigo)).toBeNull();
    },
  );
});

describe('códigos: espaços e dígitos fora do ASCII (QA, CA-09)', () => {
  it('cola do e-mail com espaço comum, NBSP, tabulação ou quebra de linha', () => {
    expect(normalizarCodigo('123\u00a0456')).toBe('123456');
    expect(normalizarCodigo('123\t456')).toBe('123456');
    expect(normalizarCodigo('123456\n')).toBe('123456');
    expect(normalizarCodigo('\u3000123 456')).toBe('123456');
    expect(normalizarCodigo('0 0 0 0 0 0')).toBe('000000');
  });

  it.each(['１２３４５６', '١٢٣٤٥٦', '१२३४५६', '123４56', '123456\u200b', '²³⁴⁵⁶¹'])(
    'não aceita dígito que não seja ASCII: %j',
    (codigo) => {
      expect(normalizarCodigo(codigo)).toBeNull();
    },
  );

  it('o código de recuperação aceita só os 10 caracteres do alfabeto base32, com hífen ou espaço', () => {
    expect(normalizarCodigoDeRecuperacao('abcde 23456')).toBe('ABCDE23456');
    expect(normalizarCodigoDeRecuperacao('ab-cd-e2-34-56')).toBe('ABCDE23456');
    expect(normalizarCodigoDeRecuperacao('ABCDE23456'.repeat(4))).toBeNull();
    expect(normalizarCodigoDeRecuperacao('ABCDE01896')).toBeNull();
  });

  it('um código de 6 dígitos não vale como código de recuperação, nem o contrário', () => {
    expect(normalizarCodigoDeRecuperacao('123456')).toBeNull();
    expect(normalizarCodigo('ABCDE23456')).toBeNull();
  });
});
