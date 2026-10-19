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
    ['não atribuído fora dos ignoráveis (U+0378)', 'Ana\u0378'],
    ['não caractere (U+10FFFF)', 'Ana\u{10FFFF}'],
  ])('recusa %s (R31, S73)', (_caso, nome) => {
    expect(problemaDoNome(normalizarNome(nome))).toBe('caractere_proibido');
  });

  it.each([
    ['preenchimento Hangul (U+3164)', 'Ana\u3164'],
    ['nome só de preenchimento Hangul', '\u3164\u3164'],
    ['preenchimento inicial Hangul (U+115F)', '\u115FAna'],
    ['preenchimento de meia largura (U+FFA0)', 'Ana\uFFA0Souza'],
    ['CGJ (U+034F)', 'An\u034Fa'],
    ['seletor de variante comum (U+FE00)', 'Ana\uFE00'],
    ['seletor de variante suplementar (U+E0100)', 'Ana\u{E0100}'],
  ])('recusa ignorável por padrão, invisível na tela: %s (S73)', (_caso, nome) => {
    expect(problemaDoNome(normalizarNome(nome))).toBe('caractere_proibido');
  });

  it('aceita emoji com seletor de apresentação (U+FE0F) e Hangul de verdade', () => {
    expect(problemaDoNome('Ana ❤️')).toBeNull();
    expect(problemaDoNome('Ana \u263A\uFE0E')).toBeNull();
    expect(problemaDoNome('김민준')).toBeNull();
  });
});

// QA da etapa 5b (S73): o seletor U+FE0F/U+FE0E é aceito no nome para o emoji (`❤️`), mas sozinho
// não aparece na tela. Um nome feito só deles é um nome invisível, o mesmo problema do
// preenchimento Hangul (U+3164) que o S73 fechou.
describe('nome sem nenhum caractere visível (S73, QA da 5b)', () => {
  it.each([
    ['só U+FE0F', '\uFE0F'],
    ['só U+FE0E', '\uFE0E'],
    ['vários seletores', '\uFE0F\uFE0E\uFE0F'],
    ['seletores e espaços', ' \uFE0F \uFE0E '],
    ['80 seletores', '\uFE0F'.repeat(80)],
  ])('recusa %s', (_caso, nome) => {
    expect(problemaDoNome(normalizarNome(nome))).not.toBeNull();
  });

  it('o seletor continua aceito quando acompanha um caractere visível', () => {
    for (const nome of ['❤️', 'Ana ❤️', '☺\uFE0E', '1️⃣', '🇧🇷', '👍🏽', 'Zé ✌️ Silva']) {
      expect(problemaDoNome(normalizarNome(nome)), nome).toBeNull();
    }
  });

  it.each([
    ['Braille em branco (U+2800)', '\u2800\u2800'],
    ['Braille em branco junto do nome', 'Ana\u2800Souza'],
    ['seletores repetidos depois da letra', 'Ana\uFE0F\uFE0F'],
    ['seletor depois de espaço', 'Ana \uFE0F'],
    ['só símbolos, sem letra, número nem emoji', '★★★'],
  ])('recusa %s (S84, correção da 5b)', (_caso, nome) => {
    expect(problemaDoNome(normalizarNome(nome))).toBe('caractere_proibido');
  });

  it.each([
    ['seletor depois de pontuação', '.\uFE0F'],
    ['seletor depois de símbolo que não é emoji', '★\uFE0F'],
    ['seletor depois de espaço sem-quebra (que o trim tira)', '\u00A0\uFE0F'],
    ['seletor de variante estendido (U+E0100)', '\u{E0100}'],
    ['seletor mongol (U+180B)', '\u180B'],
    ['preenchimento Hangul (U+3164)', '\u3164'],
    ['acento solto, sem letra (U+0301)', '\u0301\u0301'],
    ['espaço, ZWJ e seletor', ' \u200D\uFE0F'],
  ])('recusa %s (Q17 da 5b, segunda rodada)', (_caso, nome) => {
    expect(problemaDoNome(normalizarNome(nome))).toBe('caractere_proibido');
  });

  it('um nome de 80 caracteres só de seletores é recusado por não ter nada visível, não por tamanho', () => {
    expect(problemaDoNome('\uFE0F'.repeat(80))).toBe('caractere_proibido');
    expect(problemaDoNome('\uFE0F'.repeat(81))).toBe('longo');
  });

  it('sequência de emoji com ZWJ segue recusada: o ZWJ é formatação invisível (Cf)', () => {
    expect(problemaDoNome('👨\u200D👩\u200D👧')).toBe('caractere_proibido');
  });
});

describe('constantes da Identidade no subcaminho puro (R30)', () => {
  it('perfis, clientes e etapas do desafio', () => {
    expect(PERFIS).toEqual(['consumidor', 'lojista', 'admin']);
    expect(CLIENTES).toEqual(['app_consumidor', 'app_lojista', 'painel']);
    expect(ETAPAS_DO_DESAFIO).toEqual(['verificar', 'configurar']);
  });
});
