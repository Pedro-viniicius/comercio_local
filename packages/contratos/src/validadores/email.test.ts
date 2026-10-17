import { describe, expect, it } from 'vitest';
import { ehEmailValido, normalizarEmail, TAMANHO_MAXIMO_DO_EMAIL } from './index.ts';

describe('normalizarEmail', () => {
  it('tira espaços das pontas e passa tudo para minúsculas, inclusive a parte local', () => {
    expect(normalizarEmail('  Ana.Souza@Gmail.COM ')).toBe('ana.souza@gmail.com');
  });

  it('mantém pontos e o trecho depois de +: cada endereço é uma conta', () => {
    expect(normalizarEmail('ana.souza+loja@gmail.com')).toBe('ana.souza+loja@gmail.com');
    expect(normalizarEmail('anasouza@gmail.com')).not.toBe(normalizarEmail('ana.souza@gmail.com'));
  });

  it.each([
    'ana@exemplo.com.br',
    'a@b.co',
    "o'neil@exemplo.com",
    'ana_souza-2@sub.exemplo.com',
    'ana@xn--paraso-zta.com.br',
  ])('aceita %j', (email) => {
    expect(ehEmailValido(email)).toBe(true);
  });

  it.each([
    '',
    '   ',
    'sem-arroba',
    'ana@',
    '@exemplo.com',
    'ana@exemplo',
    'ana@@exemplo.com',
    'ana@ex@emplo.com',
    'ana@exemplo.c',
    'ana@exemplo.123',
    'ana@-exemplo.com',
    'ana@exemplo-.com',
    'ana@exemplo..com',
    '.ana@exemplo.com',
    'ana.@exemplo.com',
    'ana..souza@exemplo.com',
    'ana souza@exemplo.com',
    'ana@exem plo.com',
    'josé@exemplo.com',
    'ana@paraíso.com.br',
    'ana\n@exemplo.com',
    'ana\u0000@exemplo.com',
    '"ana"@exemplo.com',
  ])('recusa %j', (email) => {
    expect(normalizarEmail(email)).toBeNull();
  });

  it('respeita os limites da RFC 5321: 64 na parte local e 254 no total', () => {
    const local = 'a'.repeat(64);
    expect(ehEmailValido(`${local}@exemplo.com`)).toBe(true);
    expect(ehEmailValido(`a${local}@exemplo.com`)).toBe(false);
    const dominio = `${'b'.repeat(61)}.${'c'.repeat(61)}.${'d'.repeat(61)}.com`;
    const noLimite = `${local}@${dominio}`;
    expect(noLimite).toHaveLength(TAMANHO_MAXIMO_DO_EMAIL);
    expect(ehEmailValido(noLimite)).toBe(true);
    expect(ehEmailValido(`${local}@b${dominio}`)).toBe(false);
  });

  it('rótulo do domínio vai até 63 caracteres', () => {
    expect(ehEmailValido(`ana@${'b'.repeat(63)}.com`)).toBe(true);
    expect(ehEmailValido(`ana@${'b'.repeat(64)}.com`)).toBe(false);
  });

  it('é idempotente', () => {
    const uma = normalizarEmail(' Ana@Exemplo.com ');
    expect(uma).not.toBeNull();
    expect(normalizarEmail(uma ?? '')).toBe(uma);
  });
});

describe('normalizarEmail: bordas de formato (QA, CA-01)', () => {
  it('Unicode: parte local e domínio com acento são recusados; IDN só em punycode (xn--)', () => {
    expect(normalizarEmail('ana@münchen.de')).toBeNull();
    expect(normalizarEmail('ana@xn--mnchen-3ya.de')).toBe('ana@xn--mnchen-3ya.de');
    expect(normalizarEmail('ana@exemplo.xn--p1ai')).toBe('ana@exemplo.xn--p1ai');
    expect(normalizarEmail('josé@exemplo.com')).toBeNull();
    // Largura total e invisíveis não viram ASCII por engano.
    expect(normalizarEmail('ana@exemplo.ＣＯＭ')).toBeNull();
    expect(normalizarEmail('ana@exemplo.com\u200b')).toBeNull();
    expect(normalizarEmail('İ@exemplo.com')).toBeNull();
  });

  it('as maiúsculas do e-mail inteiro viram minúsculas, e o resultado é sempre ASCII', () => {
    const email = normalizarEmail('ANA.Souza+Loja@EXEMPLO.Com.BR');
    expect(email).toBe('ana.souza+loja@exemplo.com.br');
    expect(email).toMatch(/^[\x21-\x7e]+$/);
  });

  it('o corte das pontas (espaço, tabulação, quebra de linha, NBSP) vem antes dos limites', () => {
    const local = 'a'.repeat(64);
    const dominio = `${'b'.repeat(61)}.${'c'.repeat(61)}.${'d'.repeat(61)}.com`;
    const noLimite = `${local}@${dominio}`;
    expect(noLimite).toHaveLength(TAMANHO_MAXIMO_DO_EMAIL);
    expect(normalizarEmail(` \t${noLimite}\n\u00a0`)).toBe(noLimite);
    expect(normalizarEmail(`${noLimite}x`)).toBeNull();
  });

  it('+tag e variações: aceita, mas cada uma é uma chave diferente', () => {
    expect(normalizarEmail('ana+a@exemplo.com')).toBe('ana+a@exemplo.com');
    expect(normalizarEmail('ana+@exemplo.com')).toBe('ana+@exemplo.com');
    expect(normalizarEmail('ana+a@exemplo.com')).not.toBe(normalizarEmail('ana+b@exemplo.com'));
    expect(normalizarEmail('+ana@exemplo.com')).toBe('+ana@exemplo.com');
  });

  it.each([
    'ana@exemplo.com.',
    'ana@.com',
    'ana@127.0.0.1',
    'ana@[127.0.0.1]',
    'ana@a_b.com',
    'ana!@exemplo.com',
    'ana@exemplo.com,outro@exemplo.com',
    'ana@exemplo.com outro@exemplo.com',
    'Ana <ana@exemplo.com>',
    '<ana@exemplo.com>',
    'mailto:ana@exemplo.com',
  ])('recusa %j', (email) => {
    expect(normalizarEmail(email)).toBeNull();
  });
});
