// Texto por tela de `mensagemDoCampo` (D1, CA-13): as duas frases do segundo fator vêm da spec
// 01 (P1a e P1b), escritas por extenso aqui para o teste não repetir o `pt-BR.ts` que confere.
import { describe, expect, it } from 'vitest';
import { mensagemDoCampo } from './mensagem-do-campo.ts';

const P1A = 'Código inválido ou expirado. Confira o horário do celular e tente de novo.';
const P1B = 'Código não confere. Confira o horário do celular e digite o código atual.';
const TELA_DA_CONFIGURACAO = 'configuracaoDoSegundoFator';

describe('mensagemDoCampo com tela (D1)', () => {
  it('o mesmo codigo.invalido dá a frase da P1a sem tela e a da P1b na tela de configuração', () => {
    expect(mensagemDoCampo('codigo', 'invalido', 'motivo da API')).toBe(P1A);
    expect(mensagemDoCampo('codigo', 'invalido', 'motivo da API', TELA_DA_CONFIGURACAO)).toBe(P1B);
  });

  it('o texto da tela vale mesmo com o motivo da API vazio, e o geral também', () => {
    expect(mensagemDoCampo('codigo', 'invalido', '', TELA_DA_CONFIGURACAO)).toBe(P1B);
    expect(mensagemDoCampo('codigo', 'invalido', '')).toBe(P1A);
  });

  it('na tela de configuração, o que a tela não tem continua com o texto geral', () => {
    expect(mensagemDoCampo('codigo', 'obrigatorio', 'm', TELA_DA_CONFIGURACAO)).toBe(
      'Informe o código de 6 dígitos',
    );
    expect(mensagemDoCampo('codigoRecuperacao', 'invalido', 'm', TELA_DA_CONFIGURACAO)).toBe(
      'Código de recuperação inválido. Confira e tente de novo.',
    );
    expect(mensagemDoCampo('email', 'invalido', 'm', TELA_DA_CONFIGURACAO)).toBe(
      'Confira o e-mail: falta o @ ou o domínio',
    );
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', '', 'entrar'])(
    'tela "%s" que não existe cai no texto geral, sem achar propriedade herdada',
    (tela) => {
      expect(mensagemDoCampo('codigo', 'invalido', 'm', tela)).toBe(P1A);
    },
  );

  it.each(['constructor', '__proto__', 'toString'])(
    'campo ou código "%s" dentro de uma tela real cai no motivo da API',
    (hostil) => {
      expect(mensagemDoCampo(hostil, 'invalido', 'motivo da API', TELA_DA_CONFIGURACAO)).toBe(
        'motivo da API',
      );
      expect(mensagemDoCampo('codigo', hostil, 'motivo da API', TELA_DA_CONFIGURACAO)).toBe(
        'motivo da API',
      );
    },
  );

  it('tela indefinida é o mesmo que sem tela', () => {
    expect(mensagemDoCampo('codigo', 'invalido', 'm', undefined)).toBe(P1A);
  });
});
