import { describe, expect, it } from 'vitest';
import {
  CLIENTES,
  ETAPAS_DO_DESAFIO,
  normalizarNome,
  PERFIS,
  problemaDoNome,
  TAMANHO_MAXIMO_DO_NOME,
} from './index.ts';

describe('normalizarNome e problemaDoNome (R30)', () => {
  it('normaliza em NFC e corta os espaços das pontas', () => {
    expect(normalizarNome('  José da Silva \t')).toBe('José da Silva');
    expect(normalizarNome('   ')).toBe('');
  });

  it('aceita nome comum, com acento e emoji, até 80 pontos de código', () => {
    expect(TAMANHO_MAXIMO_DO_NOME).toBe(80);
    expect(problemaDoNome('Ana Souza')).toBeNull();
    expect(problemaDoNome('Conceição D’Ávila')).toBeNull();
    expect(problemaDoNome('😀'.repeat(80))).toBeNull();
  });

  it('vazio, longo e caractere proibido', () => {
    expect(problemaDoNome('')).toBe('vazio');
    expect(problemaDoNome('a'.repeat(81))).toBe('longo');
    expect(problemaDoNome('Ana\nSouza')).toBe('caractere_proibido');
  });

  it.each([
    ['controle', 'Ana\u0007'],
    ['formatação invisível (ZWSP)', 'Ana​Souza'],
    ['inversão de direção (RLO)', 'Ana‮azuoS'],
    ['separador de linha', 'Ana Souza'],
    ['separador de parágrafo', 'Ana Souza'],
    ['substituto solto', 'Ana\ud800'],
    ['uso privado', 'Ana'],
    ['uso privado suplementar', 'Ana\u{f0000}'],
    ['não atribuído', 'Ana\u{e0080}'],
  ])('recusa %s (R31, S73)', (_caso, nome) => {
    expect(problemaDoNome(normalizarNome(nome))).toBe('caractere_proibido');
  });
});

describe('constantes da Identidade no subcaminho puro (R30)', () => {
  it('perfis, clientes e etapas do desafio', () => {
    expect(PERFIS).toEqual(['consumidor', 'lojista', 'admin']);
    expect(CLIENTES).toEqual(['app_consumidor', 'app_lojista', 'painel']);
    expect(ETAPAS_DO_DESAFIO).toEqual(['verificar', 'configurar']);
  });
});
