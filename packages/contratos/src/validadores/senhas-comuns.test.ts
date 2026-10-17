// QA do grupo A, rodada 2 (S22, S74): a lista de senhas comuns não pode recusar senha forte
// real (falso positivo) e precisa pegar cada disfarce e cada ponta da regra de forma.
import { describe, expect, it } from 'vitest';
import { ehSenhaComum, problemaDaSenha } from './index.ts';

describe('senhas comuns: senha forte real não é recusada (S74, falso positivo)', () => {
  it.each([
    'correto cavalo bateria grampo',
    'correct horse battery staple',
    'Tr0ub4dor&3',
    'Xk9#mP2$vL7@qR4!',
    '9fK2mQ7xLp4Zt8Rw',
    'Maçã verde no pomar de casa',
    'meu cachorro Rex come 3 ossos',
    'feira-do-bairro-sao-sebastiao',
    'Zé do Pão 1987 Rua Sete',
    'ana&pedro&lucas&2026',
    'Bairro Novo, Loja 42!',
    'pão de queijo mineiro',
    'L0ja@Esquina9Verde',
    '🔑🔒🗝️📦🚚🏪🍞🥖',
  ])('%s passa', (senha) => {
    expect(problemaDaSenha(senha)).toBeNull();
  });

  it('senha gerada de 16 caracteres, com semente fixa, nunca é recusada', () => {
    const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*-_';
    let semente = 20261016;
    const proximo = () => {
      semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0;
      return semente / 2 ** 32;
    };
    const recusadas: string[] = [];
    for (let i = 0; i < 20000; i += 1) {
      let senha = '';
      for (let j = 0; j < 16; j += 1) {
        senha += alfabeto.charAt(Math.floor(proximo() * alfabeto.length));
      }
      if (problemaDaSenha(senha) !== null) recusadas.push(senha);
    }
    expect(recusadas).toEqual([]);
  });

  it('frase de quatro palavras comuns não é recusada, salvo a repetição da mesma palavra', () => {
    expect(problemaDaSenha('casa livro chuva rio')).toBeNull();
    expect(problemaDaSenha('sol-lua-pedra-horta')).toBeNull();
    expect(problemaDaSenha('casa casa casa casa')).toBe('comum');
  });
});

describe('senhas comuns: PIN longo é recusado de propósito (S74)', () => {
  it.each(['12345678', '1357924680', '2580258025802580', '19871987'])('%s', (pin) => {
    expect(problemaDaSenha(pin)).toBe('comum');
  });
});

describe('senhas comuns: cada letra disfarçada é desfeita (S74)', () => {
  it.each([
    ['0 vira o', 'L0gin2026'],
    ['1 vira i', 'Adm1n2026'],
    ['3 vira e', 'S3nha2026'],
    ['4 vira a', '4dmin1234'],
    ['5 vira s', 'Pa55word77'],
    ['7 vira t', 'Tes7e1234'],
    ['@ vira a', 'M@ster123'],
    ['$ vira s', 'te$te1234'],
  ])('%s: %s', (_disfarce, senha) => {
    expect(ehSenhaComum(senha)).toBe(true);
  });
});

describe('senhas comuns: as pontas da regra de forma (S74)', () => {
  it('até 8 dígitos ou símbolos de cada lado da palavra óbvia ainda a denunciam', () => {
    expect(ehSenhaComum('senha12345678')).toBe(true);
    expect(ehSenhaComum('12345678senha')).toBe(true);
    expect(ehSenhaComum('senha!@#$%^&*')).toBe(true);
    expect(ehSenhaComum('*&^%$#@!senha')).toBe(true);
    expect(ehSenhaComum('1234senha5678')).toBe(true);
  });

  it('senha da lista cercada de dígitos também é comum, não só a palavra', () => {
    expect(ehSenhaComum('mudarsenha99')).toBe(true);
    expect(ehSenhaComum('99mudarsenha')).toBe(true);
  });

  it('a palavra no meio de texto próprio não é comum', () => {
    expect(ehSenhaComum('minha senha de feira')).toBe(false);
    expect(ehSenhaComum('Xk7senhaQ2w')).toBe(false);
  });
});
