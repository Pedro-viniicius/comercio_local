import { normalizarCelular } from '@bairrin/contratos';
import { digitosDoCelular, mascararTelefone } from './mascara-de-telefone.ts';

describe('mascararTelefone', () => {
  it.each([
    ['', ''],
    ['3', '(3'],
    ['35', '(35'],
    ['359', '(35) 9'],
    ['35999', '(35) 999'],
    ['3599999', '(35) 99999'],
    ['35999991', '(35) 99999-1'],
    ['35999991234', '(35) 99999-1234'],
  ])('aplica a máscara aos poucos: %j → %j', (entrada, esperado) => {
    expect(mascararTelefone(entrada)).toBe(esperado);
  });

  it.each([
    ['(35) 99999-1234', '(35) 99999-1234'],
    ['35999991234', '(35) 99999-1234'],
    ['+55 35 99999-1234', '(35) 99999-1234'],
    ['+5535999991234', '(35) 99999-1234'],
    ['5535999991234', '(35) 99999-1234'],
    ['035 99999-1234', '(35) 99999-1234'],
    ['  (35)99999.1234  ', '(35) 99999-1234'],
  ])('colar com ou sem máscara: %j', (colado, esperado) => {
    expect(mascararTelefone(colado)).toBe(esperado);
  });

  it('DDD 55 digitado com 11 dígitos não perde o DDD (o 55 do Brasil só sai com 12 ou 13)', () => {
    expect(mascararTelefone('55999991234')).toBe('(55) 99999-1234');
    expect(mascararTelefone('55')).toBe('(55');
  });

  it('corta além de 11 dígitos e ignora letras e símbolos', () => {
    expect(mascararTelefone('359999912345678')).toBe('(35) 99999-1234');
    expect(mascararTelefone('abc')).toBe('');
    expect(mascararTelefone('(35) 9a9b9')).toBe('(35) 999');
  });

  it('apagar do fim volta passo a passo, sem prender a pessoa no parêntese ou no hífen', () => {
    let texto = '(35) 99999-1234';
    const passos: string[] = [];
    while (texto !== '') {
      texto = mascararTelefone(texto.slice(0, -1));
      passos.push(texto);
    }
    expect(passos).toEqual([
      '(35) 99999-123',
      '(35) 99999-12',
      '(35) 99999-1',
      '(35) 99999',
      '(35) 9999',
      '(35) 999',
      '(35) 99',
      '(35) 9',
      '(35',
      '(3',
      '',
    ]);
  });

  it('o texto mascarado completo é aceito pelo validador do contrato, igual ao sem máscara', () => {
    expect(normalizarCelular(mascararTelefone('35999991234'))).toBe('+5535999991234');
    expect(normalizarCelular(mascararTelefone('+55 (35) 99999-1234'))).toBe('+5535999991234');
  });
});

describe('digitosDoCelular', () => {
  it('devolve só DDD + número', () => {
    expect(digitosDoCelular('+55 (35) 99999-1234')).toBe('35999991234');
    expect(digitosDoCelular('')).toBe('');
  });
});
