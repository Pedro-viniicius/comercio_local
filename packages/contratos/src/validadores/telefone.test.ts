import { describe, expect, it } from 'vitest';
import { DDDS_VALIDOS, ehCelularValido, ehDddValido, normalizarCelular } from './index.ts';

describe('normalizarCelular', () => {
  it.each([
    '(35) 99999-1234',
    '35999991234',
    '35 9 9999 1234',
    '35.99999.1234',
    '035 99999-1234',
    '+55 35 99999-1234',
    '+55 (35) 99999-1234',
    '+5535999991234',
    '5535999991234',
    '  (35) 99999-1234  ',
  ])('aceita %j e devolve E.164', (telefone) => {
    expect(normalizarCelular(telefone)).toBe('+5535999991234');
  });

  it('distingue o DDD 55 (RS) do código do país', () => {
    expect(normalizarCelular('55999991234')).toBe('+5555999991234');
    expect(normalizarCelular('5555999991234')).toBe('+5555999991234');
  });

  it.each([
    ['vazio', ''],
    ['fixo, sem o 9 depois do DDD', '(35) 3531-1234'],
    ['fixo com 8 dígitos e o 9 na frente do número', '(35) 9531-1234'],
    ['DDD inexistente', '(20) 99999-1234'],
    ['DDD começando com zero', '(01) 99999-1234'],
    ['sem DDD', '99999-1234'],
    ['dígito a mais', '(35) 99999-12345'],
    ['dígito a menos', '(35) 99999-123'],
    ['outro país', '+1 415 555 0100'],
    ['outro país com 11 dígitos', '+351 912 345 678'],
    ['+ no meio', '35 +99999-1234'],
    ['letra', '(35) 9999A-1234'],
    ['ramal', '(35) 99999-1234 r. 2'],
    ['barra', '35/99999-1234'],
    ['algarismo fora do ASCII', '(35) ９９９９９-1234'],
    ['entrada longa demais', `35999991234${' '.repeat(20)}-`],
  ])('recusa %s', (_caso, telefone) => {
    expect(normalizarCelular(telefone)).toBeNull();
    expect(ehCelularValido(telefone)).toBe(false);
  });

  it('a lista de DDDs tem os 67 códigos da Anatel, todos de 11 a 99', () => {
    expect(DDDS_VALIDOS.size).toBe(67);
    for (const ddd of DDDS_VALIDOS) expect(ddd).toMatch(/^[1-9][1-9]$/);
    expect(ehDddValido('35')).toBe(true);
    for (const ddd of ['10', '20', '23', '25', '26', '29', '30', '36', '39', '40', '50', '52']) {
      expect(ehDddValido(ddd), ddd).toBe(false);
    }
  });
});

describe('normalizarCelular: bordas de formato (QA, CA-01)', () => {
  it.each([
    '+55(35)99999-1234',
    '55 35 99999-1234',
    '0 35 99999-1234',
    '035999991234',
    '+ 55 35 999991234',
    '(35)99999-1234',
    '35 99999 1234',
  ])('aceita a máscara %j', (telefone) => {
    expect(normalizarCelular(telefone)).toBe('+5535999991234');
  });

  it.each([
    ['+55 sem número', '+55'],
    ['zero depois do +55', '+55 035 99999-1234'],
    ['00 de saída internacional', '0055 35 99999-1234'],
    ['dois +', '++5535999991234'],
    ['0 e DDD inexistente', '020 99999-1234'],
    ['0 e fixo', '035 3531-1234'],
    ['11 dígitos que começam com 0 (fixo com 0)', '03599991234'],
    ['fixo com +55', '+55 35 3531-1234'],
    ['só o número, sem DDD, com 9 na frente', '9 9999-1234'],
    ['hífen longo no lugar do hífen', '(35) 99999\u20131234'],
    ['tabulação entre os blocos', '35\t99999-1234'],
    ['quebra de linha no meio', '35\n99999-1234'],
    ['dois números', '35999991234 35999991235'],
    ['texto antes', 'tel 35999991234'],
    ['dígitos demais depois do 55', '55359999912345'],
    ['12 dígitos sem 0 na frente', '135999991234'],
    ['13 dígitos que não começam com 55', '1135999991234'],
    ['terceiro dígito que não é 9, com 11 dígitos', '(35) 89999-1234'],
    ['+ com código de país que não é o 55 e 11 dígitos', '+11 99999-9999'],
    ['+ com outro país e o DDD escrito no meio', '+1 35 99999-1234'],
    ['+ com outro país de 2 dígitos que deixa 11 dígitos depois de tirar 2', '+12 35 99999-1234'],
  ])('recusa %s', (_caso, telefone) => {
    expect(normalizarCelular(telefone)).toBeNull();
  });

  it('o DDD 55 (RS) e o prefixo de país 55 não se confundem pelo tamanho', () => {
    // 11 dígitos: DDD 55 + 9 dígitos. 13 dígitos: país 55 + DDD + 9 dígitos.
    expect(normalizarCelular('55 99999-1234')).toBe('+5555999991234');
    expect(normalizarCelular('55 55 99999-1234')).toBe('+5555999991234');
    expect(normalizarCelular('+55 55 99999-1234')).toBe('+5555999991234');
    expect(normalizarCelular('055 99999-1234')).toBe('+5555999991234');
  });

  it('a saída é idempotente e sempre E.164 de 14 caracteres', () => {
    for (const entrada of ['(35) 99999-1234', '035 99999-1234', '5535999991234', '99999999999']) {
      const e164 = normalizarCelular(entrada);
      expect(e164).toMatch(/^\+55[1-9][1-9]9[0-9]{8}$/);
      expect(normalizarCelular(e164 ?? '')).toBe(e164);
    }
  });

  it('a entrada gigante é recusada sem ser examinada', () => {
    expect(normalizarCelular(`35${'9'.repeat(100_000)}`)).toBeNull();
    expect(normalizarCelular(' '.repeat(100_000))).toBeNull();
  });
});
