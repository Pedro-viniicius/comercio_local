// Formatos e distribuição dos valores aleatórios da Identidade (S17).
import { describe, expect, it } from 'vitest';
import {
  ALFABETO_BASE32,
  CARACTERES_DO_CODIGO_DE_RECUPERACAO,
  GeradorDeSegredosCripto,
} from './gerador-de-segredos.ts';

const gerador = new GeradorDeSegredosCripto();
const AMOSTRAS = 2_000;

function amostrar(gerar: () => string, vezes = AMOSTRAS): string[] {
  return Array.from({ length: vezes }, gerar);
}

describe('GeradorDeSegredosCripto', () => {
  it('novoId devolve UUID v4, sem repetir', () => {
    const ids = amostrar(() => gerador.novoId());
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tokenOpaco tem 32 bytes em base64url, sem preenchimento, sem repetir', () => {
    const tokens = amostrar(() => gerador.tokenOpaco());
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('codigoNumerico tem 6 dígitos, com zeros à esquerda', () => {
    for (const codigo of amostrar(() => gerador.codigoNumerico())) {
      expect(codigo).toMatch(/^\d{6}$/);
    }
  });

  it('codigoNumerico usa todos os dígitos em todas as posições, sem viés grosseiro', () => {
    const contagem = Array.from({ length: 6 }, () => new Array<number>(10).fill(0));
    const vezes = 10_000;
    for (const codigo of amostrar(() => gerador.codigoNumerico(), vezes)) {
      [...codigo].forEach((digito, posicao) => {
        const linha = contagem[posicao]!;
        linha[Number(digito)] = linha[Number(digito)]! + 1;
      });
    }
    // Esperado: 1000 por dígito e posição. O limite de 800 a 1200 está a mais
    // de 6 desvios-padrão: só um gerador viciado (ex.: sem zero à esquerda) cai fora.
    for (const linha of contagem) {
      for (const vezesDoDigito of linha) {
        expect(vezesDoDigito).toBeGreaterThan(800);
        expect(vezesDoDigito).toBeLessThan(1200);
      }
    }
  });

  it('codigoDeRecuperacao tem 10 caracteres base32 (A-Z, 2-7)', () => {
    for (const codigo of amostrar(() => gerador.codigoDeRecuperacao())) {
      expect(codigo).toMatch(/^[A-Z2-7]{10}$/);
    }
    expect(CARACTERES_DO_CODIGO_DE_RECUPERACAO).toBe(10);
    expect(new Set(ALFABETO_BASE32).size).toBe(32);
  });

  it('codigoDeRecuperacao usa os 32 caracteres com frequências parecidas', () => {
    const contagem = new Map<string, number>();
    for (const codigo of amostrar(() => gerador.codigoDeRecuperacao(), 6_400)) {
      for (const caractere of codigo) contagem.set(caractere, (contagem.get(caractere) ?? 0) + 1);
    }
    // 64 000 caracteres: esperado 2000 de cada. 1700 a 2300 está a mais de 6
    // desvios-padrão.
    expect([...contagem.keys()].sort().join('')).toBe([...ALFABETO_BASE32].sort().join(''));
    for (const vezes of contagem.values()) {
      expect(vezes).toBeGreaterThan(1700);
      expect(vezes).toBeLessThan(2300);
    }
  });
});
