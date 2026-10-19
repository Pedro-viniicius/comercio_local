// Celular da conta em E.164 (`contas.telefone_e164`).
import { describe, expect, it } from 'vitest';
import { Telefone, TelefoneInvalido } from './telefone.ts';

describe('Telefone', () => {
  it.each(['(35) 99999-1234', '35999991234', '+55 35 99999-1234', '5535999991234'])(
    'normaliza %s para E.164',
    (texto) => {
      expect(Telefone.criar(texto).valor).toBe('+5535999991234');
    },
  );

  it('a forma guardada casa com o CHECK do banco e volta igual ao ser lida', () => {
    const valor = Telefone.criar('(35) 99999-1234').valor;
    expect(valor).toMatch(/^\+[1-9][0-9]{7,14}$/);
    expect(Telefone.criar(valor).valor).toBe(valor);
  });

  it.each(['', '(35) 3531-1234', '(20) 99999-1234', '+1 415 555 0100', '35 9999a1234'])(
    'recusa "%s" sem repetir o valor na mensagem',
    (texto) => {
      expect(() => Telefone.criar(texto)).toThrow(/^Telefone inválido\.$/);
      expect(() => Telefone.criar(texto)).toThrow(TelefoneInvalido);
      expect(Telefone.tentarCriar(texto)).toBeNull();
    },
  );

  it('compara pelo E.164', () => {
    expect(Telefone.criar('35999991234').igual(Telefone.criar('+5535999991234'))).toBe(true);
  });
});
