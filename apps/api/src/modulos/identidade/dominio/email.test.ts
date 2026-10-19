// E-mail da conta: forma normalizada (chave de `contas.email_normalizado`),
// substituto da anonimização e máscara para exibição.
import { describe, expect, it } from 'vitest';
import { Email, EmailInvalido } from './email.ts';

describe('Email', () => {
  it('normaliza para a forma guardada: sem espaço nas pontas e em minúsculas', () => {
    expect(Email.criar('  Ana.Souza@Gmail.COM ').valor).toBe('ana.souza@gmail.com');
  });

  it.each(['', 'ana', 'ana@', '@gmail.com', 'ana@gmail', 'josé@exemplo.com'])(
    'recusa "%s" sem repetir o valor na mensagem',
    (texto) => {
      expect(() => Email.criar(texto)).toThrow(EmailInvalido);
      expect(Email.tentarCriar(texto)).toBeNull();
    },
  );

  it('a mensagem do erro não traz o endereço', () => {
    expect(() => Email.criar('fulano@exemplo')).toThrow(/^E-mail inválido\.$/);
  });

  it('compara pela forma normalizada', () => {
    expect(Email.criar('ANA@exemplo.com').igual(Email.criar('ana@exemplo.com'))).toBe(true);
    expect(Email.criar('ana+1@exemplo.com').igual(Email.criar('ana@exemplo.com'))).toBe(false);
  });

  it.each([
    ['ana.souza@gmail.com', 'an***@gmail.com'],
    ['ab@exemplo.com', 'a***@exemplo.com'],
    ['a@exemplo.com', 'a***@exemplo.com'],
  ])('mascara %s como %s', (texto, mascarado) => {
    expect(Email.criar(texto).mascarado).toBe(mascarado);
  });

  it('o substituto da anonimização deriva só do id, em ASCII minúsculo e domínio .invalid', () => {
    const id = '6F1D3C2A-1B2C-4D3E-8F90-123456789ABC';
    const substituto = Email.substitutoDaAnonimizacao(id).valor;
    expect(substituto).toBe('anonimizada-6f1d3c2a-1b2c-4d3e-8f90-123456789abc@anonimizada.invalid');
    expect(substituto).toBe(substituto.toLowerCase());
    expect(substituto.length).toBeLessThanOrEqual(254);
  });

  it('não serializa o endereço (JSON.stringify dá {})', () => {
    expect(JSON.stringify({ email: Email.criar('ana@exemplo.com') })).toBe('{"email":{}}');
  });
});
