// Etapa 5b, rodada 3 (S85, que absorve o S82): o custo de `ehSenhaComum` no pior caso. A NFKC
// expande alguns caracteres (`⁗` vira `′′′′`, `⒇` vira `(20)`), e uma senha de 128 pontos de
// código vira até 458 ou mais na forma comparável; um trecho longo de símbolos no meio do
// núcleo, com pontas que são disfarce, gera 81 variantes. Antes da correção, cada chamada
// levava de 13 a 387 ms nesses casos; depois, menos de 1 ms. O orçamento abaixo é folgado
// (5 ms por chamada, em média) para não oscilar em máquina lenta de CI.
import { describe, expect, it } from 'vitest';
import { criarContaSchema } from '../identidade/contas.ts';
import { ehSenhaComum, formaComparavelDaSenha, problemaDaSenha } from './index.ts';

// O pacote compila sem tipos de DOM nem de Node (`lib: ["ES2023"]`, `types: []`).
declare const performance: { now(): number };

const PONTAS = '11111111';
const PIORES_CASOS: Readonly<Record<string, string>> = {
  'U+2057 (⁗) ×110': `${PONTAS}a${'⁗'.repeat(110)}b${PONTAS}`,
  'U+2487 (⒇) ×110': `${PONTAS}a${'⒇'.repeat(110)}b${PONTAS}`,
  "'1' ×110": `${PONTAS}a${'1'.repeat(110)}b${PONTAS}`,
  "'🔑1' ×55": `${PONTAS}a${'🔑1'.repeat(55)}b${PONTAS}`,
  'U+2152 (⅒) ×110': `${PONTAS}a${'⅒'.repeat(110)}b${PONTAS}`,
  'U+FDFA ×110 (18 letras cada)': `${PONTAS}a${'ﷺ'.repeat(110)}b${PONTAS}`,
  'pontas de disfarce, 1 ×110': `0134@$57a${'1'.repeat(110)}b0134@$57`,
  "'abc!!!' ×18": `12345678${'abc!!!'.repeat(18)}x12345678`,
};

/** Milissegundos gastos em `vezes` chamadas de `fn`. */
function medir(vezes: number, fn: () => unknown): number {
  const comeco = performance.now();
  for (let i = 0; i < vezes; i += 1) fn();
  return performance.now() - comeco;
}

describe('ehSenhaComum: tempo no pior caso conhecido (S85)', () => {
  it('os casos têm até 128 pontos de código, e a NFKC expande os do seguranca', () => {
    for (const senha of Object.values(PIORES_CASOS)) {
      expect([...senha].length).toBeLessThanOrEqual(128);
    }
    expect([...formaComparavelDaSenha(PIORES_CASOS['U+2057 (⁗) ×110'] ?? '')].length).toBe(458);
  });

  it.each(Object.entries(PIORES_CASOS))('%s: 40 chamadas em menos de 200 ms', (_caso, senha) => {
    ehSenhaComum(senha);
    expect(medir(40, () => ehSenhaComum(senha))).toBeLessThan(200);
  });

  it('pelo esquema do cadastro, que roda a regra mais de uma vez, também fica folgado', () => {
    const cadastro = {
      nome: 'Ana Souza',
      email: 'ana.souza@exemplo.com.br',
      telefone: '(35) 99999-1234',
      aceites: { termos: '1', privacidade: '1' },
    };
    const senhas = Object.values(PIORES_CASOS);
    const gasto = medir(20, () => {
      for (const senha of senhas) criarContaSchema.safeParse({ ...cadastro, senha });
    });
    expect(gasto).toBeLessThan(800);
  });
});

describe('ehSenhaComum: forma comparável muito expandida (S85, defesa em profundidade)', () => {
  it('acima de 256 caracteres na forma, a busca direta e as regras de forma continuam', () => {
    const senha = `senha${'⁗'.repeat(64)}`;
    expect([...formaComparavelDaSenha(senha)].length).toBeGreaterThan(256);
    expect(problemaDaSenha(senha)).toBe('comum');
    expect(problemaDaSenha('⁗'.repeat(64))).toBe('comum');
  });
});

describe('ehSenhaComum: composto com senha da lista e dígitos que não são disfarce (R7)', () => {
  it.each(['12qwaszxmaria', '123qweasdjoao', '1234qwerana'])('%s é recusada', (senha) => {
    expect(ehSenhaComum(senha)).toBe(true);
  });

  it('senha boa com dígitos na ponta continua aceita', () => {
    expect(ehSenhaComum('2026 gabriel e a feira')).toBe(false);
    expect(ehSenhaComum('feira-do-bairro-7')).toBe(false);
    expect(ehSenhaComum('Xk9#mP2$vL7@qR4!')).toBe(false);
  });
});
