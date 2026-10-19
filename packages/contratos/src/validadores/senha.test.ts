import { describe, expect, it } from 'vitest';
import {
  ehSenhaBemFormada,
  ehSenhaComum,
  formaComparavelDaSenha,
  problemaDaSenha,
  TAMANHO_MAXIMO_DA_SENHA,
  TAMANHO_MINIMO_DA_SENHA,
  tamanhoDaSenha,
} from './index.ts';

describe('problemaDaSenha', () => {
  it('aceita senha de 8 a 128 caracteres fora da lista', () => {
    expect(TAMANHO_MINIMO_DA_SENHA).toBe(8);
    expect(TAMANHO_MAXIMO_DA_SENHA).toBe(128);
    expect(problemaDaSenha('feira-do-bairro-7')).toBeNull();
    expect(problemaDaSenha('Xk7#pq2w')).toBeNull();
    expect(problemaDaSenha(`${'Xk7#pq2w'.repeat(15)}Zr9!mv4T`)).toBeNull();
  });

  it('o mesmo trecho com 3 letras ou mais repetido até 128 caracteres é comum (S74, etapa 5b)', () => {
    expect(problemaDaSenha('Xk7#pq2w'.repeat(16))).toBe('comum');
  });

  it('recusa curta e longa nos limites exatos', () => {
    expect(problemaDaSenha('Xk7#pq2')).toBe('curta');
    expect(problemaDaSenha('')).toBe('curta');
    expect(problemaDaSenha(`${'Xk7#pq2w'.repeat(16)}a`)).toBe('longa');
  });

  it('conta caracteres como a pessoa os vê: um emoji conta como um', () => {
    const emojis = '🔑🏠🛒🍞🧀🥖🍰☕';
    expect(emojis.length).toBe(15);
    expect(tamanhoDaSenha(emojis)).toBe(8);
    expect(problemaDaSenha(emojis)).toBeNull();
    expect(problemaDaSenha('🔑'.repeat(TAMANHO_MAXIMO_DA_SENHA))).toBe('comum');
    expect(problemaDaSenha('🔑🏠'.repeat(64))).toBe('comum');
    expect(problemaDaSenha(`${'🔑🏠🛒'.repeat(42)}🍞🧀`)).toBeNull();
    expect(problemaDaSenha(`${'🔑🏠🛒'.repeat(42)}🍞🧀🥖`)).toBe('longa');
  });

  it('espaços contam e não são cortados', () => {
    expect(problemaDaSenha('  ab c ')).toBe('curta');
    expect(tamanhoDaSenha(' feira 7 ')).toBe(9);
  });

  it('o tamanho vem antes da lista: senha comum curta é "curta"', () => {
    expect(problemaDaSenha('senha12')).toBe('curta');
    expect(problemaDaSenha('senha123')).toBe('comum');
  });
});

describe('ehSenhaComum (lista local, S22)', () => {
  it.each([
    '12345678',
    '123456789',
    'password',
    'senha123',
    'Senha@123',
    'SENHA1234',
    'flamengo',
    'Flamengo2026',
    'corinthians',
    'palmeiras123',
    'São Paulo 123',
    'brasil2024',
    'bairrin123',
    'paraiso123',
    'jesuscristo',
    'qwerty123',
    'qwertyuiop',
    'asdfghjkl',
    'abcdefgh',
    'zyxwvuts',
    '98765432',
    '1q2w3e4r',
    'p@ssw0rd',
    'aaaaaaaa',
    '12121212',
    'abcabcabc',
    'xyz!xyz!xyz!',
    'mudarsenha',
  ])('recusa %j', (senha) => {
    expect(ehSenhaComum(senha)).toBe(true);
  });

  it.each([
    'feira-do-bairro-7',
    'Xk7#pq2w',
    'pão de queijo da Dona Zica',
    'flamengo-e-cruzeiro-1981',
  ])('aceita %j', (senha) => {
    expect(ehSenhaComum(senha)).toBe(false);
  });

  it('compara sem acento, sem espaço e sem diferenciar maiúsculas', () => {
    expect(formaComparavelDaSenha('São Paulo 123')).toBe('saopaulo123');
    expect(formaComparavelDaSenha('FAMÍLIA 2025')).toBe('familia2025');
    expect(ehSenhaComum('Família2025')).toBe(true);
  });
});

describe('senha: bordas de tamanho e de lista (QA, CA-01, S22)', () => {
  const distintos = (quantidade: number, primeiro = 0x4e00) =>
    Array.from({ length: quantidade }, (_, i) => String.fromCodePoint(primeiro + i)).join('');

  it('7, 8, 128 e 129 pontos de código, com caracteres que não se repetem', () => {
    expect(problemaDaSenha(distintos(7))).toBe('curta');
    expect(problemaDaSenha(distintos(8))).toBeNull();
    expect(problemaDaSenha(distintos(128))).toBeNull();
    expect(problemaDaSenha(distintos(129))).toBe('longa');
    // Fora do plano básico: 1 ponto de código, 2 unidades UTF-16.
    expect(problemaDaSenha(distintos(128, 0x1f600))).toBeNull();
    expect(problemaDaSenha(distintos(129, 0x1f600))).toBe('longa');
  });

  it('conta pontos de código, não grafemas: acento decomposto pesa 2 e a sequência ZWJ pesa 7', () => {
    const decomposta = 'a\u0301e\u0301i\u0301o\u0301';
    expect(tamanhoDaSenha(decomposta)).toBe(8);
    expect(problemaDaSenha(decomposta)).toBeNull();
    expect(tamanhoDaSenha('👨‍👩‍👧‍👦')).toBe(7);
    expect(problemaDaSenha('👨‍👩‍👧‍👦')).toBe('curta');
  });

  it.each([
    ['largura total', 'ｓｅｎｈａ１２３'],
    ['espaços entre as letras', 'S E N H A 1 2 3'],
    ['tabulação e NBSP', 'senha\t\u00a0123'],
    ['acento decomposto', 'se\u0301nha123'],
    ['maiúsculas', 'FLAMENGO2026'],
    ['espaço no meio', 'Flamengo 2026'],
    ['sequência em largura total', '１２３４５６７８'],
    ['repetição com espaço', 'ab ab ab ab'],
    ['só espaços', '        '],
  ])('senha comum disfarçada por %s é recusada', (_caso, senha) => {
    expect(problemaDaSenha(senha)).toBe('comum');
  });

  it('a lista não pega senha longa e própria só por conter uma palavra comum', () => {
    expect(problemaDaSenha('minha senha da loja 2026 é outra')).toBeNull();
    expect(problemaDaSenha('flamengo-e-cruzeiro-1981')).toBeNull();
  });

  it('a comparação não altera a senha: a forma comparável é só para a lista', () => {
    const senha = ' Flamengo 2026 ';
    formaComparavelDaSenha(senha);
    expect(senha).toBe(' Flamengo 2026 ');
    expect(formaComparavelDaSenha(senha)).toBe('flamengo2026');
  });

  it('a entrada gigante não trava a regra de tamanho', () => {
    expect(problemaDaSenha('x'.repeat(1_000_000))).toBe('longa');
  });
});

describe('regra de forma e senhas brasileiras (S74)', () => {
  it.each([
    'Senha@2026',
    'Bairrin@2026',
    'Bairrin123!',
    'senha123!',
    '123mudar',
    '10203040',
    '1020304050',
    'aa123456',
    'qwe123456',
    '12345678a',
    'flamengo1981',
    'brasil2014',
    'gabriel123',
    'Passw0rd1',
    'Senha_123',
    'senha\u200b123',
  ])('recusa %j', (senha) => {
    expect(problemaDaSenha(senha)).toBe('comum');
  });

  it.each([
    ['palavra com dígitos antes e depois', '2026senha2026'],
    ['nome próprio com símbolo', 'Ana@2026!'],
    ['nome com acento', 'João#1990'],
    ['letra trocada por dígito', 'S3nh4@2026'],
    ['senha da lista com sufixo', 'P@ssw0rd2026'],
    ['linha do teclado com sufixo', 'Qwerty@2026'],
    ['repetição com sufixo', 'abcabc!2026'],
    ['só símbolos', '!@#$%^&*()'],
    ['só dígitos longa', '20262026202620261'],
    ['dígitos com espaço', '10 20 30 40'],
    ['hífen mole no meio', 'flamen\u00adgo1981'],
    ['ZWJ e BOM', '\ufeffgabriel\u200d123'],
    ['largura total misturada', 'ｓｅｎｈａ123'],
  ])('recusa %s: %j', (_caso, senha) => {
    expect(problemaDaSenha(senha)).toBe('comum');
  });

  it.each([
    'girafa violino tempestade',
    'girafa-violino-tempestade',
    'Cadeira azul do Tio Chico',
    'feira-do-bairro-7',
    'Xk7#pq2w',
    'flamengo-e-cruzeiro-1981',
    'senha da padaria nova',
    '2026 gabriel e a feira',
    '🔑🏠🛒🍞🧀🥖🍰☕',
    'Пароль-не-простой',
  ])('aceita senha boa %j', (senha) => {
    expect(problemaDaSenha(senha)).toBeNull();
  });

  it('a forma comparável parte da NFKC e tira os invisíveis', () => {
    expect(formaComparavelDaSenha('ｓｅｎｈａ123')).toBe('senha123');
    expect(formaComparavelDaSenha('se\u200bn\u00adha\u2060123\ufeff')).toBe('senha123');
  });
});

describe('senha mal formada (S75)', () => {
  it('recusa metade de par substituto solta, como String.prototype.isWellFormed', () => {
    for (const senha of [
      'abcdefg\ud800',
      '\udc00abcdefgh',
      'abc\ud83dxyz12',
      'abcdefgh\udfff\ud800',
    ]) {
      expect(ehSenhaBemFormada(senha), JSON.stringify(senha)).toBe(false);
      expect(problemaDaSenha(senha), JSON.stringify(senha)).toBe('mal_formada');
    }
    expect(ehSenhaBemFormada('feira-do-bairro-🔑')).toBe(true);
    expect(problemaDaSenha('feira-do-bairro-🔑')).toBeNull();
  });

  it('o tamanho vem antes: substituto solto em senha curta é "curta"', () => {
    expect(problemaDaSenha('ab\ud800')).toBe('curta');
  });
});
