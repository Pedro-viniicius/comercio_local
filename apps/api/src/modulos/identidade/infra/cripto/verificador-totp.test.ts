// TOTP do admin (CA-09, S1): RFC 6238 com SHA1, 6 dígitos e 30 s, janela de
// ±1 passo e sem reuso de passo.
import { Secret, TOTP, URI } from 'otpauth';
import { describe, expect, it } from 'vitest';
import { VerificadorTotpOtpauth } from './verificador-totp.ts';

const verificador = new VerificadorTotpOtpauth();

/** Segredo dos vetores de teste da RFC 6238 (apêndice B), SHA1. */
const SEGREDO_DA_RFC = Secret.fromLatin1('12345678901234567890').base32;

const AGORA = new Date('2026-10-18T12:00:10.000Z');
const PASSO_ATUAL = Math.floor(AGORA.getTime() / 30_000);

function codigoDoPasso(segredoBase32: string, passo: number): string {
  return TOTP.generate({ secret: Secret.fromBase32(segredoBase32), timestamp: passo * 30_000 });
}

describe('VerificadorTotpOtpauth.gerarConfiguracao', () => {
  it('gera segredo de 160 bits e a URI com emissor Bairrin, SHA1, 6 dígitos e 30 s', () => {
    const { segredoBase32, otpauthUri } = verificador.gerarConfiguracao('m***@e***.com');
    expect(segredoBase32).toMatch(/^[A-Z2-7]{32}$/);
    expect(Secret.fromBase32(segredoBase32).bytes).toHaveLength(20);
    expect(otpauthUri.startsWith('otpauth://totp/Bairrin:m***%40e***.com?')).toBe(true);
    const lido = URI.parse(otpauthUri);
    expect(lido).toBeInstanceOf(TOTP);
    expect(lido).toMatchObject({
      issuer: 'Bairrin',
      label: 'm***@e***.com',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    expect(lido.secret.base32).toBe(segredoBase32);
  });

  it('sorteia um segredo novo a cada configuração', () => {
    const segredos = Array.from(
      { length: 50 },
      () => verificador.gerarConfiguracao('a***@b***.com').segredoBase32,
    );
    expect(new Set(segredos).size).toBe(50);
  });

  it('o código do app autenticador, gerado a partir da URI, confere', () => {
    const { segredoBase32, otpauthUri } = verificador.gerarConfiguracao('a***@b***.com');
    const codigo = URI.parse(otpauthUri).generate({ timestamp: AGORA.getTime() });
    expect(verificador.verificar(segredoBase32, codigo, AGORA, null)).toBe(PASSO_ATUAL);
  });

  it.each([[''], ['   ']])('recusa rótulo vazio (%j)', (rotulo) => {
    expect(() => verificador.gerarConfiguracao(rotulo)).toThrow(
      'O rótulo do TOTP não pode ser vazio.',
    );
  });
});

describe('VerificadorTotpOtpauth.verificar', () => {
  it.each([
    [59, '287082', 1],
    [1_111_111_109, '081804', 37_037_036],
    [1_234_567_890, '005924', 41_152_263],
  ])('confere o vetor da RFC 6238 em t=%i s (%s) e devolve o passo', (segundos, codigo, passo) => {
    const agora = new Date(segundos * 1000);
    expect(verificador.verificar(SEGREDO_DA_RFC, codigo, agora, null)).toBe(passo);
  });

  it('aceita o passo anterior e o seguinte (janela de ±1), e não os de ±2', () => {
    for (const desvio of [-1, 0, 1]) {
      const codigo = codigoDoPasso(SEGREDO_DA_RFC, PASSO_ATUAL + desvio);
      expect(verificador.verificar(SEGREDO_DA_RFC, codigo, AGORA, null)).toBe(PASSO_ATUAL + desvio);
    }
    for (const desvio of [-2, 2]) {
      const codigo = codigoDoPasso(SEGREDO_DA_RFC, PASSO_ATUAL + desvio);
      expect(verificador.verificar(SEGREDO_DA_RFC, codigo, AGORA, null)).toBeNull();
    }
  });

  it('não aceita o mesmo código duas vezes (passo igual ao último usado)', () => {
    const codigo = codigoDoPasso(SEGREDO_DA_RFC, PASSO_ATUAL);
    const passo = verificador.verificar(SEGREDO_DA_RFC, codigo, AGORA, null);
    expect(passo).toBe(PASSO_ATUAL);
    expect(verificador.verificar(SEGREDO_DA_RFC, codigo, AGORA, passo)).toBeNull();
    // Nem 30 s depois, quando o passo ainda está dentro da janela.
    const depois = new Date(AGORA.getTime() + 30_000);
    expect(verificador.verificar(SEGREDO_DA_RFC, codigo, depois, passo)).toBeNull();
  });

  it('depois de usar um passo, recusa os anteriores da janela e aceita o seguinte', () => {
    const anterior = codigoDoPasso(SEGREDO_DA_RFC, PASSO_ATUAL - 1);
    const seguinte = codigoDoPasso(SEGREDO_DA_RFC, PASSO_ATUAL + 1);
    expect(verificador.verificar(SEGREDO_DA_RFC, anterior, AGORA, PASSO_ATUAL)).toBeNull();
    expect(verificador.verificar(SEGREDO_DA_RFC, seguinte, AGORA, PASSO_ATUAL)).toBe(
      PASSO_ATUAL + 1,
    );
  });

  it('aceita o passo atual quando o último usado é anterior', () => {
    const codigo = codigoDoPasso(SEGREDO_DA_RFC, PASSO_ATUAL);
    expect(verificador.verificar(SEGREDO_DA_RFC, codigo, AGORA, PASSO_ATUAL - 1)).toBe(PASSO_ATUAL);
  });

  it('não confere código de outro segredo', () => {
    const outro = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const codigo = codigoDoPasso(outro, PASSO_ATUAL);
    // Segredos e instante fixos: confere que não há coincidência na janela.
    for (const desvio of [-1, 0, 1]) {
      expect(codigoDoPasso(SEGREDO_DA_RFC, PASSO_ATUAL + desvio)).not.toBe(codigo);
    }
    expect(verificador.verificar(outro, codigo, AGORA, null)).toBe(PASSO_ATUAL);
    expect(verificador.verificar(SEGREDO_DA_RFC, codigo, AGORA, null)).toBeNull();
  });

  it.each([
    ['vazio', ''],
    ['cinco dígitos', '28708'],
    ['sete dígitos', '2870820'],
    ['com espaço', ' 287082'],
    ['com letra', '28708a'],
    ['dígitos de largura cheia', '２８７０８２'],
  ])('código mal formado (%s) não confere', (_caso, codigo) => {
    expect(verificador.verificar(SEGREDO_DA_RFC, codigo, new Date(59_000), null)).toBeNull();
  });

  it('segredo guardado fora do base32 lança erro sem nenhum trecho dele', () => {
    const segredo = 'GEZDGNBVGY3TQOJQ1EZDGNBVGY3TQOJQ';
    let capturado: unknown;
    try {
      verificador.verificar(segredo, '287082', new Date(59_000), null);
    } catch (erro) {
      capturado = erro;
    }
    expect(capturado).toBeInstanceOf(Error);
    const erro = capturado as Error;
    expect(erro.message).toBe('Segredo TOTP guardado não está em base32.');
    expect(erro.cause).toBeUndefined();
  });

  it.each([
    ['vazio', ''],
    ['de 80 bits', 'JBSWY3DPEHPK3PXP'],
  ])('segredo guardado curto demais (%s) lança erro', (_caso, segredo) => {
    expect(() => verificador.verificar(segredo, '287082', AGORA, null)).toThrow(
      'Segredo TOTP guardado é curto demais.',
    );
  });
});
