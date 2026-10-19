import { create } from 'qrcode';
import { describe, expect, it } from 'vitest';
import {
  agruparDeQuatro,
  desenharQr,
  ehUriDoAutenticador,
  formatarCodigoDeRecuperacao,
  MARGEM_DO_QR,
  soletrar,
} from './qr.ts';

const URI = 'otpauth://totp/Bairrin:p***%40exemplo.com.br?secret=JBSWY3DPEHPK3PXP&issuer=Bairrin';

/** Refaz a matriz a partir do caminho, para comparar com a do `qrcode`. */
function matrizDoCaminho(caminho: string, lado: number): boolean[] {
  const matriz = Array<boolean>(lado * lado).fill(false);
  for (const [, x, y, largura] of caminho.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(largura); i += 1) matriz[Number(y) * lado + Number(x) + i] = true;
  }
  return matriz;
}

describe('desenharQr', () => {
  it('desenha exatamente os módulos escuros do QR, com a margem de 4', () => {
    const { lado, caminho } = desenharQr(URI);
    const { modules } = create(URI, { errorCorrectionLevel: 'M' });
    expect(lado).toBe(modules.size + 2 * MARGEM_DO_QR);

    const desenhada = matrizDoCaminho(caminho, lado);
    for (let linha = 0; linha < lado; linha += 1) {
      for (let coluna = 0; coluna < lado; coluna += 1) {
        const dentro =
          linha >= MARGEM_DO_QR &&
          coluna >= MARGEM_DO_QR &&
          linha < lado - MARGEM_DO_QR &&
          coluna < lado - MARGEM_DO_QR;
        const esperado =
          dentro &&
          Boolean(modules.data[(linha - MARGEM_DO_QR) * modules.size + (coluna - MARGEM_DO_QR)]);
        expect(desenhada[linha * lado + coluna]).toBe(esperado);
      }
    }
  });

  it('o caminho não carrega o texto (nem a chave) de volta', () => {
    expect(desenharQr(URI).caminho).not.toContain('JBSW');
  });

  it('texto que não cabe num QR lança', () => {
    expect(() => desenharQr('x'.repeat(5000))).toThrow();
  });
});

describe('apoios da P1b', () => {
  it('só aceita URI de TOTP', () => {
    expect(ehUriDoAutenticador(URI)).toBe(true);
    expect(ehUriDoAutenticador('otpauth://hotp/x')).toBe(false);
    expect(ehUriDoAutenticador('https://exemplo.invalido')).toBe(false);
    expect(ehUriDoAutenticador('')).toBe(false);
  });

  it('agrupa a chave de 4 em 4, sem espaços', () => {
    expect(agruparDeQuatro('JBSW Y3DPEHPK3PXP')).toEqual(['JBSW', 'Y3DP', 'EHPK', '3PXP']);
    expect(agruparDeQuatro('ABCDEF')).toEqual(['ABCD', 'EF']);
    expect(agruparDeQuatro('')).toEqual([]);
  });

  it('formata o código de recuperação em 5-5 só quando tem 10 caracteres', () => {
    expect(formatarCodigoDeRecuperacao('ABCDEFGHIJ')).toBe('ABCDE-FGHIJ');
    expect(formatarCodigoDeRecuperacao('ABCDE-FGHIJ')).toBe('ABCDE-FGHIJ');
    expect(formatarCodigoDeRecuperacao('ABC')).toBe('ABC');
  });

  it('soletra para o leitor de tela: letras separadas e grupos por vírgula', () => {
    expect(soletrar(['AB2', 'C'])).toBe('A B 2, C');
    expect(soletrar([])).toBe('');
  });
});
