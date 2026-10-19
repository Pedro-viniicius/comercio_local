// QA do grupo A, rodada 2 (S22, S74): a lista de senhas comuns não pode recusar senha forte
// real (falso positivo) e precisa pegar cada disfarce e cada ponta da regra de forma.
import { describe, expect, it } from 'vitest';
import {
  ehSenhaComum,
  ehSenhaSoDeDigitosESimbolos,
  formaComparavelDaSenha,
  type ListaDeSenhasComuns,
  MOTIVO_SENHA_COMUM,
  MOTIVO_SENHA_SO_DE_DIGITOS_E_SIMBOLOS,
  motivoDaSenhaComum,
  problemaDaSenha,
} from './index.ts';

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

// Etapa 5b do plano 01b (S74, R34): regra para nome composto e palavra repetida e listas à
// mão maiores. Cada senha abaixo passava antes da 5b e é recusada só com as listas à mão (o
// que vale no painel e nos apps). As que dependem da lista pública ficam no teste da API
// (`apps/api/src/modulos/identidade/http/senha-fora-da-lista-publica.test.ts`).
describe('senhas comuns: recusadas pelas listas à mão, sem a lista pública (S74, etapa 5b)', () => {
  it.each([
    ['nome composto', 'joaopedro123'],
    ['nome composto', 'mariaclara123'],
    ['nome composto', 'anajulia123'],
    ['nome composto', 'pedrohenrique'],
    ['nome e sobrenome', 'gabrielsilva'],
    ['sobrenome', 'silva123'],
    ['sobrenome', 'souza1234'],
    ['sobrenome', 'oliveira1'],
    ['sobrenome', 'Ferreira@2026'],
    ['torcida', 'palmeirense'],
    ['torcida', 'corintiano'],
    ['torcida', 'flamenguista'],
    ['torcida', 'colorado'],
    ['repetição', 'senhasenha'],
    ['repetição', 'senha@senha'],
    ['hífen', 'Bem-vindo1'],
    ['cultura pop', 'neymar10'],
    ['frase', 'jesusmeama'],
    ['frase', 'deusmeama'],
  ])('%s: %s é recusada', (_tipo, senha) => {
    expect(problemaDaSenha(senha)).toBe('comum');
  });
});

describe('senhas comuns: lista pública opcional, somada às listas à mão (etapa 5b)', () => {
  const lista: ListaDeSenhasComuns = {
    senhas: new Set(['naruto123', 'sorvetao2']),
    nucleos: new Set(['sorvete', 'girassol']),
  };

  it('sem a lista, palavra que só ela tem passa', () => {
    expect(ehSenhaComum('sorvete123')).toBe(false);
    expect(ehSenhaComum('naruto123')).toBe(false);
  });

  it.each([
    ['senha inteira da lista', 'naruto123'],
    ['senha da lista também vale como núcleo', '!sorvetao2!'],
    ['núcleo da lista com dígitos', 'sorvete123'],
    ['núcleo da lista com letra disfarçada', 's0rv3te@2026'],
    ['as duas metades da lista', 'sorvetegirassol'],
    ['uma metade da lista e outra à mão', 'girassolana1'],
    ['uma metade à mão e outra da lista', 'silva&sorvete'],
  ])('com a lista: %s (%s)', (_caso, senha) => {
    expect(ehSenhaComum(senha, lista)).toBe(true);
  });

  it('a lista não muda o que já era aceito nem o que já era recusado', () => {
    expect(ehSenhaComum('Xk9#mP2$vL7@qR4!', lista)).toBe(false);
    expect(ehSenhaComum('senha123', lista)).toBe(true);
    expect(ehSenhaComum('%354O3*1', lista)).toBe(false);
  });
});

describe('senhas comuns: núcleo composto de dois núcleos conhecidos (S74, etapa 5b)', () => {
  it.each([
    ['corte logo depois de 3 letras', 'anajulia2026'],
    ['corte no meio', 'mariaclara'],
    ['corte antes das 3 últimas letras', 'gabrielana'],
    ['símbolo entre as metades', 'maria&clara2026'],
    ['dígito entre as metades', 'joao2pedro'],
    ['letra disfarçada nas metades', 'j0a0pedr0123'],
    ['dígitos antes', '2026anajulia'],
    ['hífen e ponto entre as metades', 'joao.pedro-2026'],
  ])('%s: %s', (_caso, senha) => {
    expect(ehSenhaComum(senha)).toBe(true);
  });

  it('três núcleos separados por símbolo e metade com menos de 3 caracteres não contam', () => {
    expect(ehSenhaComum('ana&pedro&lucas&2026')).toBe(false);
    expect(ehSenhaComum('xsenha12')).toBe(false);
  });

  it.each(['anapedrolucas', 'joaopedrosilva123', 'anajuliasilva', 'Maria-Clara-Souza'])(
    'três núcleos juntos com dois nomes ou sobrenomes: %s (S83)',
    (senha) => {
      expect(ehSenhaComum(senha)).toBe(true);
    },
  );

  it('três palavras sem dois nomes, ou quatro palavras comuns, não contam (S83)', () => {
    expect(ehSenhaComum('casalivrochuva')).toBe(false);
    expect(ehSenhaComum('casa livro chuva rio')).toBe(false);
  });
});

describe('senhas comuns: palavra repetida de qualquer tamanho (S74, etapa 5b)', () => {
  it.each([
    'senhasenha',
    'senha@senha',
    'girafagirafa',
    'girafa!girafa',
    'Girafa1Girafa2',
    'casa_casa',
    'S3nh4S3nh4',
    'Xk7#Xk7#Xk7#',
  ])('%s', (senha) => {
    expect(ehSenhaComum(senha)).toBe(true);
  });

  it('trecho com menos de 3 letras e mais de 4 caracteres não é palavra repetida', () => {
    expect(ehSenhaComum('Q7#x9Q7#x9!')).toBe(false);
  });
});

describe('senhas comuns: `-`, `_` e `.` internos saem só da forma comparável (etapa 5b)', () => {
  it('saem do meio, ficam nas pontas e a senha não muda', () => {
    const senha = 'Bem-vindo_1.0';
    expect(formaComparavelDaSenha(senha)).toBe('bemvindo10');
    expect(senha).toBe('Bem-vindo_1.0');
    expect(formaComparavelDaSenha('--senha--')).toBe('--senha--');
    expect(formaComparavelDaSenha('a-_.b')).toBe('ab');
  });

  it('senha só de separadores continua só de símbolos', () => {
    expect(formaComparavelDaSenha('........')).toBe('........');
    expect(ehSenhaSoDeDigitosESimbolos('........')).toBe(true);
    expect(ehSenhaSoDeDigitosESimbolos('1987-06-15')).toBe(true);
  });
});

describe('senhas comuns: núcleo de 3 caracteres ou mais e motivo próprio (R34)', () => {
  it('núcleo de 1 ou 2 letras cercado de dígitos e símbolos não é comum', () => {
    expect(problemaDaSenha('%354O3*1')).toBeNull();
    expect(problemaDaSenha('@-*_d*!#&1')).toBeNull();
    expect(problemaDaSenha('71xK#0938')).toBeNull();
  });

  it('a senha só de dígitos e símbolos é comum, com o motivo próprio', () => {
    for (const senha of [
      '12345678',
      '10203040',
      '!@#$%^&*',
      '１２３４５６７８',
      ' 1 2 3 4 5 6 7 8 ',
    ]) {
      expect(problemaDaSenha(senha), senha).toBe('comum');
      expect(ehSenhaSoDeDigitosESimbolos(senha), senha).toBe(true);
      expect(motivoDaSenhaComum(senha), senha).toBe(MOTIVO_SENHA_SO_DE_DIGITOS_E_SIMBOLOS);
    }
  });

  it('as outras comuns ficam com o motivo geral', () => {
    for (const senha of ['senha123', 'joaopedro123', '        ', '🔑'.repeat(8)]) {
      expect(ehSenhaSoDeDigitosESimbolos(senha), senha).toBe(false);
      expect(motivoDaSenhaComum(senha), senha).toBe(MOTIVO_SENHA_COMUM);
    }
    expect(MOTIVO_SENHA_SO_DE_DIGITOS_E_SIMBOLOS).not.toBe(MOTIVO_SENHA_COMUM);
  });
});

// QA da etapa 5b: bordas da regra de forma, só com as listas à mão (o que valem no painel e nos
// apps). Cada senha é montada para falhar se a regra errar um ponto de corte ou uma ponta.
describe('QA 5b: núcleo composto, cada ponto de corte e cada lado', () => {
  // Tamanhos de 3, 4, 5, 6, 7, 8 e 9 letras, todos conhecidos pelas listas à mão.
  const conhecidos = [
    'ana', // 3
    'joao', // 4
    'pedro', // 5
    'maria', // 5
    'gabriel', // 7
    'mariana', // 7
    'fernanda', // 8
    'oliveira', // 8
    'nascimento', // 10
  ];

  it('toda junção de dois conhecidos é recusada, qualquer que seja o tamanho de cada um', () => {
    const aceitas: string[] = [];
    for (const a of conhecidos) {
      for (const b of conhecidos) {
        if (a === b) continue;
        for (const enfeite of ['', '123', '@2026', '!!']) {
          if (!ehSenhaComum(`${a}${b}${enfeite}`)) aceitas.push(`${a}${b}${enfeite}`);
        }
      }
    }
    expect(aceitas).toEqual([]);
  });

  it('conhecido mais lixo (ou lixo mais conhecido) em cada tamanho de lixo não é comum', () => {
    const lixo = ['xqz', 'kwvj', 'zxkqw', 'vkwjqz', 'qkzvwjx', 'wkjqzvxy', 'jkqwzvxyp'];
    const aceitas: string[] = [];
    for (const conhecido of ['ana', 'joao', 'gabriel', 'nascimento']) {
      for (const sujeira of lixo) {
        for (const senha of [`${conhecido}${sujeira}`, `${sujeira}${conhecido}`]) {
          if (ehSenhaComum(senha)) aceitas.push(senha);
        }
      }
    }
    // `xqzana` e `anaxqz` são lixo de verdade; nenhum vira núcleo composto.
    expect(aceitas).toEqual([]);
  });

  it('a metade que sobra com 2 caracteres não completa o composto, nem do lado esquerdo nem do direito', () => {
    expect(ehSenhaComum('gabrielab')).toBe(false);
    expect(ehSenhaComum('abgabriel')).toBe(false);
    expect(ehSenhaComum('anapedroab')).toBe(false);
  });

  it('a junção com dígitos e símbolos no meio vale em qualquer combinação', () => {
    for (const meio of ['1', '12', '@', '#2', '--', '_', '.', ' ', '​']) {
      expect(ehSenhaComum(`gabriel${meio}silva`), JSON.stringify(meio)).toBe(true);
    }
  });

  it('a junção também vale nas formas que a pessoa digita (caixa, acento, largura, invisível)', () => {
    for (const senha of [
      'JOAOPEDRO123',
      'JoãoPedro123',
      'João Pedro 123',
      'joãopedro123',
      'ｊｏａｏｐｅｄｒｏ１２３',
      'jo​ao­pe⁠dro123',
      ' joao pedro 123',
      'Joao-Pedro_123',
    ]) {
      expect(ehSenhaComum(senha), JSON.stringify(senha)).toBe(true);
    }
  });
});

describe('QA 5b: palavra repetida', () => {
  it('repetida com qualquer separador que a forma tira ou que é dígito ou símbolo', () => {
    for (const senha of [
      'senha-senha',
      'senha_senha',
      'senha.senha',
      'senha senha',
      'senha!senha',
      'senha123senha',
      'SENHAsenhaSENHA',
      'senha@senha@senha',
      'girafa girafa',
    ]) {
      expect(ehSenhaComum(senha), senha).toBe(true);
    }
  });

  it('só repete quando o trecho se repete inteiro: sobra diferente não é repetição', () => {
    for (const senha of ['girafagirafa7x', 'girafa!girafo', 'girafagirafagiraf', 'xgirafagirafa']) {
      expect(ehSenhaComum(senha), senha).toBe(false);
    }
  });

  it('trecho com 2 letras só repete como comum se couber em 4 caracteres; com 3 letras, qualquer tamanho', () => {
    expect(ehSenhaComum('abababab')).toBe(true);
    expect(ehSenhaComum('Zx9#Zx9#')).toBe(true);
    // Trecho de 7 caracteres com só 2 letras: nem REPETICAO (até 4) nem palavra repetida (3 letras).
    expect(ehSenhaComum('Zx9#7!%Zx9#7!%')).toBe(false);
    // Com 3 letras no trecho, a regra da palavra repetida pega.
    expect(ehSenhaComum('Zx9#kP2Zx9#kP2')).toBe(true);
  });
});

describe('QA 5b: `-`, `_` e `.` internos nas senhas da tabela e nas pontas', () => {
  it.each([
    ['Bem-vindo1'],
    ['bem_vindo1'],
    ['Bem.Vindo1'],
    ['bem--vindo1'],
    ['bem-_.vindo1'],
    ['b-e-m-v-i-n-d-o-1'],
    ['sen-ha-sen-ha'],
    ['jo-ao-pe-dro123'],
  ])('%s é recusada', (senha) => {
    expect(ehSenhaComum(senha)).toBe(true);
  });

  it('separador nas pontas não esconde a palavra nem vira senha só de símbolos por engano', () => {
    expect(ehSenhaComum('-senha123-')).toBe(true);
    expect(ehSenhaComum('__joaopedro__')).toBe(true);
    expect(formaComparavelDaSenha('-_.senha.-_')).toBe('-_.senha.-_');
    expect(ehSenhaSoDeDigitosESimbolos('-_.senha.-_')).toBe(false);
  });

  it('separador que une duas letras não cria palavra comum a partir de lixo', () => {
    expect(ehSenhaComum('xq-zk_wj.vp')).toBe(false);
    expect(ehSenhaComum('sa-nh-a-Xq7')).toBe(false);
  });

  it('o separador só sai da comparação: a senha continua com o tamanho que a pessoa digitou', () => {
    expect(problemaDaSenha('a-b-c-d')).toBe('curta');
    expect(problemaDaSenha('Xk-9m-Q2-vL')).toBeNull();
  });
});

describe('QA 5b: tamanho do núcleo (R34)', () => {
  it('núcleo de exatamente 3 letras compara; de 1 ou 2, não', () => {
    expect(ehSenhaComum('ana-12345')).toBe(true);
    expect(ehSenhaComum('!!ana!!!!')).toBe(true);
    expect(ehSenhaComum('xqz12345')).toBe(false);
    expect(ehSenhaComum('ab123456')).toBe(false);
    expect(ehSenhaComum('a1234567')).toBe(false);
  });

  it('núcleo de 1 ou 2 letras com disfarce não vira palavra de 3', () => {
    // `%354O3*1`: o núcleo é `o`; o `54` ao lado não pode virar `sa` e formar `sao`.
    for (const senha of ['%354O3*1', '@54O3*1x', '#4o!%^&*1']) {
      expect(ehSenhaComum(senha), senha).toBe(false);
    }
  });

  it('a senha só de dígitos e símbolos tem motivo próprio, e com 1 letra deixa de ter', () => {
    expect(motivoDaSenhaComum('12341234')).toBe(MOTIVO_SENHA_SO_DE_DIGITOS_E_SIMBOLOS);
    expect(motivoDaSenhaComum('1234-1234')).toBe(MOTIVO_SENHA_SO_DE_DIGITOS_E_SIMBOLOS);
    expect(motivoDaSenhaComum('1234a1234')).toBe(MOTIVO_SENHA_COMUM);
    expect(motivoDaSenhaComum('senha123')).toBe(MOTIVO_SENHA_COMUM);
  });

  it('símbolos de todas as categorias contam como símbolo, o emoji não', () => {
    for (const senha of ['+=<>~|^=', '€$£¥¢€$£', '¨´`^¯¨´`^', '(){}[]<>', '٠١٢٣٤٥٦٧', '½¼¾²³¹½¼']) {
      expect(ehSenhaSoDeDigitosESimbolos(senha), senha).toBe(true);
    }
    expect(ehSenhaSoDeDigitosESimbolos('😀😁😂🤣😃😄😅😆')).toBe(false);
    expect(ehSenhaSoDeDigitosESimbolos('1234567😀')).toBe(false);
  });
});

describe('QA 5b: listas à mão (sobrenomes do Censo 2022 e torcidas)', () => {
  it.each([
    'silva',
    'santos',
    'oliveira',
    'souza',
    'pereira',
    'lima',
    'rodrigues',
    'nascimento',
    'barbosa',
    'carvalho',
    'goncalves',
    'conceicao',
    'cavalcante',
    'cordeiro',
  ])('o sobrenome %s com dígitos é recusado', (sobrenome) => {
    expect(ehSenhaComum(`${sobrenome}2026`)).toBe(true);
    expect(ehSenhaComum(`${sobrenome.toUpperCase()}@123`)).toBe(true);
  });

  it('com acento: Gonçalves, Conceição e Araújo', () => {
    for (const senha of ['Gonçalves2026', 'Conceição123', 'Araújo@2026']) {
      expect(ehSenhaComum(senha), senha).toBe(true);
    }
  });

  it.each(['palmeirense', 'corintiano', 'corinthiano', 'flamenguista', 'colorado', 'gremista'])(
    'a torcida %s é recusada com e sem dígitos',
    (torcida) => {
      expect(ehSenhaComum(torcida)).toBe(true);
      expect(ehSenhaComum(`${torcida}123`)).toBe(true);
    },
  );

  it('frases de fé e de afeto', () => {
    for (const senha of ['jesusmeama', 'deusmeama', 'Jesus Me Ama', 'deus-me-ama!', 'teamo2026']) {
      expect(ehSenhaComum(senha), senha).toBe(true);
    }
  });
});

describe('QA 5b: senha forte parecida com as recusadas passa', () => {
  it('nome, sobrenome ou palavra repetida dentro de uma frase longa e própria', () => {
    for (const senha of [
      'joao-pedro-gosta-de-feira-7',
      'silva silva silva e mais um pouco 9',
      'Gabriel Silva mora na Rua Sete, 140',
      'mariaclara&pedrohenrique&anajulia',
      'senha da minha loja de esquina 22',
      'Bem-vindo ao bairro dos 5 pães',
    ]) {
      expect(problemaDaSenha(senha), senha).toBeNull();
    }
  });
});

describe('QA 5b: falso positivo em senha aleatória, só com as listas à mão', () => {
  const alfabetos: [string, string, number, number][] = [
    ['letras minúsculas', 'abcdefghijklmnopqrstuvwxyz', 12, 16],
    [
      'letras maiúsculas e minúsculas',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
      12,
      16,
    ],
    ['base32', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', 12, 16],
    ['minúsculas e dígitos', 'abcdefghijklmnopqrstuvwxyz0123456789', 12, 16],
  ];

  it.each(alfabetos)('nenhuma de 20 mil senhas de %s é recusada', (_nome, alfabeto, min, max) => {
    let semente = 5150;
    const proximo = () => {
      semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0;
      return semente / 2 ** 32;
    };
    const recusadas: string[] = [];
    for (let i = 0; i < 20_000; i += 1) {
      const tamanho = min + Math.floor(proximo() * (max - min + 1));
      let senha = '';
      for (let j = 0; j < tamanho; j += 1)
        senha += alfabeto.charAt(Math.floor(proximo() * alfabeto.length));
      if (problemaDaSenha(senha) !== null) recusadas.push(senha);
    }
    expect(recusadas).toEqual([]);
  });
});

// QA 5b, rodada de mutação: casos que sobreviveram às trocas de limite e de classe.
describe('QA 5b: o que a mutação da regra de forma deixou passar', () => {
  it('trecho de exatamente 3 letras repetido, com mais de 4 caracteres, é palavra repetida', () => {
    expect(ehSenhaComum('kPq9#7!kPq9#7!')).toBe(true);
    expect(ehSenhaComum('kPq9#7!kPq9#7!kPq9#7!')).toBe(true);
  });

  it('trecho de 5 caracteres com só 2 letras repetido não é repetição curta nem palavra repetida', () => {
    expect(ehSenhaComum('Zx9#!Zx9#!')).toBe(false);
  });

  it('senha da lista pública com núcleo de 1 letra é recusada pela senha inteira', () => {
    const lista: ListaDeSenhasComuns = {
      senhas: new Set(['a1234567', 'q1w2e3r4t5']),
      nucleos: new Set(),
    };
    expect(ehSenhaComum('a1234567')).toBe(false);
    expect(ehSenhaComum('a1234567', lista)).toBe(true);
    expect(ehSenhaComum('A-1234567', lista)).toBe(true);
    expect(ehSenhaComum('b1234567', lista)).toBe(false);
  });

  it('caractere ignorável por padrão que não é controle nem formatação some da comparação', () => {
    // U+3164 e U+115F (preenchimento Hangul), U+FFA0 (meia largura) e U+034F (CGJ).
    for (const invisivel of ['ㅤ', 'ᅟ', 'ﾠ', '͏', '᠋']) {
      expect(ehSenhaComum(`joao${invisivel}pedro123`), JSON.stringify(invisivel)).toBe(true);
      expect(ehSenhaComum(`sen${invisivel}ha1234`), JSON.stringify(invisivel)).toBe(true);
    }
    expect(formaComparavelDaSenha('aㅤb')).toBe('ab');
  });

  it('senha só de espaços ou só de invisíveis é comum, com o motivo geral', () => {
    for (const senha of [' '.repeat(8), '​'.repeat(8), 'ㅤ'.repeat(8), '\t  '.repeat(4)]) {
      expect(ehSenhaComum(senha), JSON.stringify(senha)).toBe(true);
      expect(problemaDaSenha(senha), JSON.stringify(senha)).toBe('comum');
      expect(motivoDaSenhaComum(senha)).toBe(MOTIVO_SENHA_COMUM);
    }
  });

  it('o núcleo inteiro como trecho de sequência ou repetição, cercado de dígitos, é comum', () => {
    for (const senha of [
      '1234asdfgh5678',
      '99poiuytre99',
      '77abcdefgh77',
      '12aaaaaa12',
      '!!abab!!abab',
    ]) {
      expect(ehSenhaComum(senha), senha).toBe(true);
    }
    expect(ehSenhaComum('1234asdfgx5678')).toBe(false);
  });
});

describe('senhas comuns: pontas sem limite, emoji e disfarce verossímil (S83, Q18)', () => {
  it.each([
    ['mais de 8 dígitos depois', 'senha1234567890'],
    ['nome com mais de 8 dígitos', 'gabriel1234567890'],
    ['mais de 8 símbolos antes', '!!!!!!!!!senha'],
    ['emoji como ponta', 'senha🔑123'],
    ['€ no lugar do e', 's€nha123'],
  ])('recusa %s: %s', (_caso, senha) => {
    expect(ehSenhaComum(senha)).toBe(true);
  });

  it('hexadecimal não vira palavra por disfarce em trecho curto ou quase só de dígitos', () => {
    expect(ehSenhaComum('1ec499325669')).toBe(false);
    expect(ehSenhaComum('d1b988893d06')).toBe(false);
    const lista: ListaDeSenhasComuns = { senhas: new Set(), nucleos: new Set(['tec', 'edo']) };
    expect(ehSenhaComum('97ec8f3d0279', lista)).toBe(false);
  });

  it('senha só de emojis distintos continua aceita', () => {
    expect(ehSenhaComum('🔑🏠🛒🍞🧀🥖🍰☕')).toBe(false);
  });
});
