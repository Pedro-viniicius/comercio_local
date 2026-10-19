// HMAC e AES-256-GCM com subchave por finalidade e conta como AAD (S17): um
// valor calculado para uma conta ou finalidade nunca confere em outra.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CifradorAesGcm, VERSAO_DA_CHAVE } from './cifrador-aes-gcm.ts';

function chave(): string {
  return randomBytes(32).toString('base64');
}

function novoCifrador(chaves: Partial<Record<'CHAVE_HMAC' | 'CHAVE_CIFRAGEM_DADOS', string>> = {}) {
  return new CifradorAesGcm({
    CHAVE_HMAC: chaves.CHAVE_HMAC ?? chave(),
    CHAVE_CIFRAGEM_DADOS: chaves.CHAVE_CIFRAGEM_DADOS ?? chave(),
  });
}

const CONTA_A = '0b5f6a51-6a8f-4d2c-9a43-2f6d3f1a9c01';
const CONTA_B = '7d1e2c3b-4a59-4f60-8b71-9c8d7e6f5a02';

/** Troca um caractere do base64url sem sair do alfabeto. */
function alterarCaractere(texto: string, posicao: number): string {
  const atual = texto.charAt(posicao);
  return `${texto.slice(0, posicao)}${atual === 'A' ? 'B' : 'A'}${texto.slice(posicao + 1)}`;
}

describe('CifradorAesGcm.hmac', () => {
  const cifrador = novoCifrador();

  it('é determinístico, SHA-256 em base64url', () => {
    const valor = cifrador.hmac('token_renovacao', ['abc']);
    expect(valor).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cifrador.hmac('token_renovacao', ['abc'])).toBe(valor);
  });

  it('código emitido para uma conta ou finalidade não confere em outra', () => {
    const emitido = cifrador.hmac('verificacao_email', [CONTA_A, '123456']);
    expect(cifrador.hmacConfere('verificacao_email', [CONTA_A, '123456'], emitido)).toBe(true);
    expect(cifrador.hmacConfere('verificacao_email', [CONTA_B, '123456'], emitido)).toBe(false);
    expect(cifrador.hmacConfere('recuperacao_senha', [CONTA_A, '123456'], emitido)).toBe(false);
    expect(cifrador.hmacConfere('desafio_verificar', [CONTA_A, '123456'], emitido)).toBe(false);
    expect(cifrador.hmacConfere('verificacao_email', [CONTA_A, '123457'], emitido)).toBe(false);
  });

  it('as partes não se confundem ao serem juntadas', () => {
    const casos: (readonly string[])[] = [
      ['ab', 'c'],
      ['a', 'bc'],
      ['abc'],
      ['abc', ''],
      ['', 'abc'],
      [],
      [''],
      ['a\u0000', 'b'],
      ['a', '\u0000b'],
    ];
    const valores = casos.map((partes) => cifrador.hmac('token_renovacao', partes));
    expect(new Set(valores).size).toBe(casos.length);
  });

  it('a chave importa: outra CHAVE_HMAC dá outro HMAC', () => {
    const outro = novoCifrador();
    expect(outro.hmac('token_renovacao', ['abc'])).not.toBe(
      cifrador.hmac('token_renovacao', ['abc']),
    );
  });

  it('a chave de cifragem não entra no HMAC', () => {
    const chaveDeHmac = chave();
    const a = novoCifrador({ CHAVE_HMAC: chaveDeHmac });
    const b = novoCifrador({ CHAVE_HMAC: chaveDeHmac });
    expect(a.hmac('bloqueio_email', ['x'])).toBe(b.hmac('bloqueio_email', ['x']));
  });

  it.each([
    ['vazio', () => ''],
    ['mais curto', (emitido: string) => emitido.slice(0, -1)],
    ['com um caractere a mais', (emitido: string) => `${emitido}A`],
    ['com um caractere trocado', (emitido: string) => alterarCaractere(emitido, 0)],
    ['que não é base64url', () => '!'.repeat(43)],
  ])('esperado %s não confere e não lança', (_caso, esperado) => {
    const emitido = cifrador.hmac('bloqueio_ip', ['1.2.3.4']);
    expect(cifrador.hmacConfere('bloqueio_ip', ['1.2.3.4'], esperado(emitido))).toBe(false);
  });
});

describe('CifradorAesGcm.cifrar e decifrar', () => {
  const cifrador = novoCifrador();

  it('decifra o que cifrou, com prefixo de versão e IV novo a cada vez', () => {
    const texto = '{"tokenAcesso":"a.b.c","tokenRenovacao":"xyz"} ção';
    const a = cifrador.cifrar('par_novo_da_sessao', texto, CONTA_A);
    const b = cifrador.cifrar('par_novo_da_sessao', texto, CONTA_A);
    expect(a.startsWith(`${VERSAO_DA_CHAVE}.`)).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toContain('tokenRenovacao');
    expect(cifrador.decifrar('par_novo_da_sessao', a, CONTA_A)).toBe(texto);
    expect(cifrador.decifrar('par_novo_da_sessao', b, CONTA_A)).toBe(texto);
  });

  it('usa IV de 96 bits e tag de 128 bits', () => {
    const cifrado = cifrador.cifrar('segredo_totp', 'ABCDEFGH', CONTA_A);
    const corpo = Buffer.from(cifrado.slice(VERSAO_DA_CHAVE.length + 1), 'base64url');
    expect(corpo).toHaveLength(12 + 16 + 'ABCDEFGH'.length);
  });

  it('cifra e decifra texto vazio', () => {
    const cifrado = cifrador.cifrar('exportacao_titular', '', CONTA_A);
    expect(cifrador.decifrar('exportacao_titular', cifrado, CONTA_A)).toBe('');
  });

  it('não decifra com outra conta (AAD)', () => {
    const cifrado = cifrador.cifrar('segredo_totp', 'JBSWY3DPEHPK3PXP', CONTA_A);
    expect(cifrador.decifrar('segredo_totp', cifrado, CONTA_B)).toBeNull();
  });

  it('não decifra com outra finalidade (subchave)', () => {
    const cifrado = cifrador.cifrar('segredo_totp', 'JBSWY3DPEHPK3PXP', CONTA_A);
    expect(cifrador.decifrar('par_novo_da_sessao', cifrado, CONTA_A)).toBeNull();
    expect(cifrador.decifrar('exportacao_titular', cifrado, CONTA_A)).toBeNull();
  });

  it('não decifra com outra CHAVE_CIFRAGEM_DADOS', () => {
    const cifrado = cifrador.cifrar('segredo_totp', 'JBSWY3DPEHPK3PXP', CONTA_A);
    expect(novoCifrador().decifrar('segredo_totp', cifrado, CONTA_A)).toBeNull();
  });

  it('não decifra texto alterado em qualquer trecho (IV, tag ou cifrado)', () => {
    const cifrado = cifrador.cifrar('par_novo_da_sessao', 'texto claro de teste', CONTA_A);
    const inicio = VERSAO_DA_CHAVE.length + 1;
    for (let posicao = inicio; posicao < cifrado.length - 1; posicao++) {
      expect(
        cifrador.decifrar('par_novo_da_sessao', alterarCaractere(cifrado, posicao), CONTA_A),
      ).toBeNull();
    }
  });

  it('não decifra cifrado cortado ou com bytes a mais', () => {
    const cifrado = cifrador.cifrar('par_novo_da_sessao', 'texto claro de teste', CONTA_A);
    expect(cifrador.decifrar('par_novo_da_sessao', cifrado.slice(0, -4), CONTA_A)).toBeNull();
    expect(cifrador.decifrar('par_novo_da_sessao', `${cifrado}AAAA`, CONTA_A)).toBeNull();
  });

  it.each([
    ['vazio', ''],
    ['sem versão', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['versão desconhecida', `v2.${Buffer.alloc(40).toString('base64url')}`],
    ['versão zero', `v0.${Buffer.alloc(40).toString('base64url')}`],
    ['corpo curto demais', `v1.${Buffer.alloc(27).toString('base64url')}`],
    ['corpo fora do base64url', 'v1.@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@'],
    ['com preenchimento', `v1.${Buffer.alloc(40).toString('base64')}=`],
    ['dois pontos', `v1.${Buffer.alloc(40).toString('base64url')}.x`],
  ])('cifrado mal formado (%s) dá null, sem lançar', (_caso, cifrado) => {
    expect(cifrador.decifrar('par_novo_da_sessao', cifrado, CONTA_A)).toBeNull();
  });

  it('a versão do cifrado é a da chave: com outra versão no prefixo não decifra', () => {
    const cifrado = cifrador.cifrar('segredo_totp', 'JBSWY3DPEHPK3PXP', CONTA_A);
    expect(cifrador.decifrar('segredo_totp', cifrado.replace(/^v1\./, 'v2.'), CONTA_A)).toBeNull();
  });

  it('recusa conta vazia nos dois sentidos (o AAD não ligaria o cifrado a ninguém)', () => {
    expect(() => cifrador.cifrar('segredo_totp', 'x', '')).toThrow('Cifragem exige o id da conta.');
    const cifrado = cifrador.cifrar('segredo_totp', 'x', CONTA_A);
    expect(() => cifrador.decifrar('segredo_totp', cifrado, '')).toThrow(
      'Cifragem exige o id da conta.',
    );
  });
});
