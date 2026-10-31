// QA da etapa 5b do plano 01b (S74): a tabela de senhas do CA5 por tipo, nos dois corpos, o
// falso positivo com outros alfabetos e frases, e a regra do corpo nas bordas.
import {
  type CampoComErro,
  camposDoErroZod,
  criarContaSchema,
  entrarSchema,
  redefinirSenhaSchema,
  type z,
} from '@bairrin/contratos';
import { ehSenhaComum } from '@bairrin/contratos/validadores';
import { describe, expect, it } from 'vitest';
import {
  comSenhaForaDaListaPublica,
  LISTA_PUBLICA_DE_SENHAS,
} from './senha-fora-da-lista-publica.ts';

const MOTIVO_COMUM = 'Essa senha é muito comum. Escolha outra, mais difícil de adivinhar';

const cadastro = {
  nome: 'Ana Souza',
  email: 'ana.souza@exemplo.com.br',
  telefone: '(35) 99999-1234',
  senha: 'feira-do-bairro-7',
  aceites: { termos: '1', privacidade: '1' },
};
const redefinicao = { email: 'ana@exemplo.com', codigo: '012345', novaSenha: 'feira-do-bairro-7' };

const criarConta = comSenhaForaDaListaPublica(criarContaSchema, 'senha');
const redefinirSenha = comSenhaForaDaListaPublica(redefinirSenhaSchema, 'novaSenha');

function campos(esquema: z.ZodType, entrada: unknown): CampoComErro[] {
  const resultado = esquema.safeParse(entrada);
  if (resultado.success) throw new Error('esperava falha de validação');
  return camposDoErroZod(resultado.error);
}

/** Gerador com semente fixa (congruencial linear): o mesmo resultado em toda execução. */
function sementeFixa(semente: number): () => number {
  let estado = semente;
  return () => {
    estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0;
    return estado / 2 ** 32;
  };
}

function senhasAleatorias(
  alfabeto: string,
  minimo: number,
  maximo: number,
  quantidade: number,
  semente: number,
): string[] {
  const proximo = sementeFixa(semente);
  return Array.from({ length: quantidade }, () => {
    const tamanho = minimo + Math.floor(proximo() * (maximo - minimo + 1));
    let senha = '';
    for (let i = 0; i < tamanho; i += 1) {
      senha += alfabeto.charAt(Math.floor(proximo() * alfabeto.length));
    }
    return senha;
  });
}

function recusadas(senhas: readonly string[]): string[] {
  return senhas.filter((senha) => ehSenhaComum(senha, LISTA_PUBLICA_DE_SENHAS));
}

// A tabela do CA5, agrupada como no plano. Cada senha é recusada pelos dois corpos com senha nova.
const TABELA: [string, string][] = [
  ...['joaopedro123', 'mariaclara123', 'anajulia123', 'pedrohenrique', 'gabrielsilva'].map(
    (senha): [string, string] => ['nome composto', senha],
  ),
  ...['silva123', 'souza1234', 'oliveira1'].map((senha): [string, string] => ['sobrenome', senha]),
  ...['palmeirense', 'corintiano', 'flamenguista', 'colorado'].map((senha): [string, string] => [
    'torcida',
    senha,
  ]),
  ...['senhasenha', 'senha@senha'].map((senha): [string, string] => ['repetição', senha]),
  ['hífen', 'Bem-vindo1'],
  ...['naruto123', 'neymar10', 'batman123', 'pokemon1'].map((senha): [string, string] => [
    'cultura pop',
    senha,
  ]),
  ...['jesusmeama', 'deusmeama'].map((senha): [string, string] => ['frase', senha]),
  ...['sorvete123', 'sucesso123', 'naosei123', 'inicial@123'].map((senha): [string, string] => [
    'palavra comum',
    senha,
  ]),
];

describe('CA5: a tabela do plano, no cadastro e na redefinição', () => {
  it.each(TABELA)('%s: %s', (_tipo, senha) => {
    expect(campos(criarConta, { ...cadastro, senha })).toEqual([
      { campo: 'senha', codigo: 'comum', motivo: MOTIVO_COMUM },
    ]);
    expect(campos(redefinirSenha, { ...redefinicao, novaSenha: senha })).toEqual([
      { campo: 'novaSenha', codigo: 'comum', motivo: MOTIVO_COMUM },
    ]);
  });

  it('a tabela tem as 25 senhas do plano, sem repetir', () => {
    expect(TABELA).toHaveLength(25);
    expect(new Set(TABELA.map(([, senha]) => senha)).size).toBe(25);
  });

  it('o login não aplica a lista: senha de conta antiga continua entrando', () => {
    for (const [, senha] of TABELA) {
      expect(
        entrarSchema.safeParse({ email: 'ana@exemplo.com', senha, cliente: 'painel' }).success,
        senha,
      ).toBe(true);
    }
  });
});

describe('CA5: a mesma senha digitada de outro jeito também é recusada', () => {
  it.each([
    ['maiúsculas', 'JOAOPEDRO123'],
    ['com espaços', 'João Pedro 123'],
    ['acento decomposto', 'joãopedro123'],
    ['largura total', 'ｓｏｒｖｅｔｅ１２３'],
    ['espaço invisível no meio', 'sor​vete123'],
    ['hífen mole no meio', 'nar­uto123'],
    ['com símbolos nas pontas', '!!sorvete123!!'],
    ['letra disfarçada', 's0rv3te123'],
    ['separador no meio', 'sor-vete_123'],
    ['duas palavras da lista pública', 'sorvete chocolate'],
    ['palavra da lista pública, símbolo e outra', 'sorvete@sucesso'],
    ['símbolo Unicode entre as palavras (a lista à mão sozinha deixa passar)', 'Bem–vindo1'],
    ['dígitos entre as palavras', 'bem2vindo2'],
  ])('%s: %s', (_caso, senha) => {
    expect(ehSenhaComum(senha, LISTA_PUBLICA_DE_SENHAS), senha).toBe(true);
    expect(campos(criarConta, { ...cadastro, senha }).map((e) => `${e.campo}.${e.codigo}`)).toEqual(
      ['senha.comum'],
    );
  });
});

describe('CA5: falso positivo em senha aleatória (lista completa)', () => {
  // A lista pública tem cerca de 41 mil palavras de 3 letras ou mais, então uma senha aleatória
  // pode, raramente, parecer "palavra mais palavra" (ou palavra com disfarce de dígito). O risco
  // cai com o tamanho e com o alfabeto maior. Medido com sementes diferentes: de 0 a 1 em 100 mil
  // a partir de 14 caracteres; cerca de 4 em 100 mil com 12 caracteres. O limite abaixo é 5 em 100
  // mil (0,005%): uma regra que passasse a recusar frase de 3 palavras ou senha longa de verdade
  // passaria de centenas.
  const LIMITE_POR_100_MIL = 5;
  const ALFABETO_COMPLETO =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*-_.';

  it.each([
    ['letras minúsculas, 12 a 16', 'abcdefghijklmnopqrstuvwxyz', 12, 16],
    [
      'letras maiúsculas e minúsculas, 12 a 16',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
      12,
      16,
    ],
    ['base32, 12 a 16', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', 12, 16],
    ['minúsculas e dígitos, 16 a 24', 'abcdefghijklmnopqrstuvwxyz0123456789', 16, 24],
    ['alfabeto completo com símbolos, 12 a 24', ALFABETO_COMPLETO, 12, 24],
    ['alfabeto completo com símbolos, 14 a 24', ALFABETO_COMPLETO, 14, 24],
  ])(
    'no máximo 5 de 100 mil senhas de %s são recusadas',
    (_nome, alfabeto, minimo, maximo) => {
      const lote = senhasAleatorias(alfabeto, minimo, maximo, 100_000, 90210);
      expect(recusadas(lote).length).toBeLessThanOrEqual(LIMITE_POR_100_MIL);
    },
    60_000,
  );

  it('com exatamente 12 caracteres e o alfabeto completo, no máximo 20 de 100 mil (medido: 4 a 7)', () => {
    // No tamanho mínimo da regra o falso positivo não é zero: `87oLA!2wAS.*` é `ola` mais `was`
    // e `598-3.#03uSo` tem o núcleo `uso`, de 3 letras, cercado de 9 dígitos e símbolos.
    const lote = senhasAleatorias(ALFABETO_COMPLETO, 12, 12, 100_000, 31337);
    expect(recusadas(lote).length).toBeLessThanOrEqual(20);
  }, 60_000);

  it('UUID v4 como senha gerada (32 hex com os hífens, que a forma comparável tira)', () => {
    const proximo = sementeFixa(4);
    const hex = (n: number) =>
      Array.from({ length: n }, () => '0123456789abcdef'.charAt(Math.floor(proximo() * 16))).join(
        '',
      );
    const uuids = Array.from(
      { length: 10_000 },
      () =>
        `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'.charAt(Math.floor(proximo() * 4))}${hex(3)}-${hex(12)}`,
    );
    expect(recusadas(uuids)).toEqual([]);
  }, 60_000);

  it('frase de 3 ou 4 palavras sorteadas da própria lista não é recusada (só a de 2 é)', () => {
    const palavras = [...LISTA_PUBLICA_DE_SENHAS.nucleos].filter(
      (palavra) => palavra.length >= 4 && palavra.length <= 9,
    );
    const proximo = sementeFixa(2026);
    const frase = (quantas: number, separador: string) =>
      Array.from(
        { length: quantas },
        () => palavras[Math.floor(proximo() * palavras.length)] ?? '',
      ).join(separador);
    for (const quantas of [3, 4]) {
      for (const separador of [' ', '-', '']) {
        const lote = Array.from({ length: 5000 }, () => frase(quantas, separador));
        expect(
          recusadas(lote),
          `${quantas} palavras, separador ${JSON.stringify(separador)}`,
        ).toEqual([]);
      }
    }
    expect(recusadas(Array.from({ length: 200 }, () => frase(2, ' '))).length).toBe(200);
    // 30 mil senhas: 1,5 a 2 s sozinho, mais de 5 s com a máquina ocupada (o padrão do Vitest).
  }, 60_000);

  it('senhas fortes que um usuário de verdade usaria passam', () => {
    for (const senha of [
      'correto cavalo bateria grampo',
      'meu gato Mingau dorme no sofa 7',
      'Padaria-Do-Ze-1987-Paraiso!',
      'k7#Pq2$vL9@mX4!r',
      'Tr0ub4dor&3',
      '😀🎉🚀🍕🌈🎸🐱🏠',
    ]) {
      expect(ehSenhaComum(senha, LISTA_PUBLICA_DE_SENHAS), senha).toBe(false);
    }
  });
});

// Rodada 2 da 5b (S83, Q18, Q19): o que a correção mudou, provado pelos dois corpos com senha nova.
describe('S83: pontas sem limite, emoji, nomes juntos e frase longa (cadastro e redefinição)', () => {
  it.each([
    ['mais de 8 dígitos depois do nome', 'gabriel1234567890'],
    ['mais de 8 dígitos depois da palavra', 'senha1234567890'],
    ['mais de 8 símbolos antes da palavra', '!!!!!!!!!senha'],
    ['emoji como ponta', 'senha🔑123'],
    ['€ no lugar do e', 's€nha123'],
    ['dois nomes e um sobrenome', 'joaopedrosilva123'],
    ['nome, nome e sobrenome', 'anajuliasilva'],
    ['os mesmos nomes em maiúsculas e com acento', 'JoãoPedroSilva!'],
    ['os mesmos nomes separados por espaço e ano', 'Ana Julia Silva 2026'],
    ['os mesmos nomes em largura total', 'ｊｏａｏｐｅｄｒｏｓｉｌｖａ'],
  ])('recusa %s: %s', (_caso, senha) => {
    expect(campos(criarConta, { ...cadastro, senha })).toEqual([
      { campo: 'senha', codigo: 'comum', motivo: MOTIVO_COMUM },
    ]);
    expect(campos(redefinirSenha, { ...redefinicao, novaSenha: senha })).toEqual([
      { campo: 'novaSenha', codigo: 'comum', motivo: MOTIVO_COMUM },
    ]);
  });

  it.each([
    'correto cavalo bateria grampo',
    'cavalo-bateria-grampo-silva',
    'ana&pedro&lucas&2026',
    'girafa violino tempestade',
    '🔑🏠🛒🍞🧀🥖🍰☕',
  ])('aceita %s (frase longa, nomes separados por símbolo ou só emojis)', (senha) => {
    expect(criarConta.safeParse({ ...cadastro, senha }).success).toBe(true);
    expect(redefinirSenha.safeParse({ ...redefinicao, novaSenha: senha }).success).toBe(true);
  });
});

describe('Q18 e Q19: falso positivo medido, com tetos que um retrocesso estoura', () => {
  const ALFABETO_COMPLETO =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*-_.';

  it('com 8 caracteres (o mínimo) e o alfabeto completo, no máximo 180 de 100 mil (medido: 102 a 135; antes da correção, 237)', () => {
    const lote = senhasAleatorias(ALFABETO_COMPLETO, 8, 8, 100_000, 31337);
    expect(recusadas(lote).length).toBeLessThanOrEqual(180);
  }, 60_000);

  it('senha de 14 a 24 caracteres do alfabeto completo: nenhuma de 100 mil é recusada (medido: 0 em 5 sementes)', () => {
    const lote = senhasAleatorias(ALFABETO_COMPLETO, 14, 24, 100_000, 424242);
    expect(recusadas(lote)).toEqual([]);
  }, 60_000);

  // Hexadecimal com pelo menos uma letra: `cafe`, `bad` e `eba` são núcleos da lista, então algum
  // falso positivo sobra (Q18 parcial). Medido: 0,27% com 12 caracteres, 0,12% com 14, 0,04% com
  // 18 e 0 com 32. Antes da correção do disfarce, com 12, passava de 0,6%.
  function hexadecimais(tamanho: number, quantidade: number, semente: number): string[] {
    const proximo = sementeFixa(semente);
    const lote: string[] = [];
    while (lote.length < quantidade) {
      let senha = '';
      for (let i = 0; i < tamanho; i += 1) {
        senha += '0123456789abcdef'.charAt(Math.floor(proximo() * 16));
      }
      if (!/^\d+$/u.test(senha)) lote.push(senha);
    }
    return lote;
  }

  it('hexadecimal de 12 caracteres com letra: no máximo 0,4% recusado (medido: 0,27%)', () => {
    expect(recusadas(hexadecimais(12, 100_000, 777)).length).toBeLessThanOrEqual(400);
  }, 60_000);

  it('hexadecimal de 18 caracteres com letra: no máximo 0,1% recusado (medido: 0,04%)', () => {
    expect(recusadas(hexadecimais(18, 100_000, 778)).length).toBeLessThanOrEqual(100);
  }, 60_000);

  it('hexadecimal de 32 caracteres com letra (hash, token): nenhum de 20 mil é recusado', () => {
    expect(recusadas(hexadecimais(32, 20_000, 779))).toEqual([]);
  }, 60_000);

  it('o hexadecimal que virava palavra por disfarce em trecho curto passa', () => {
    // `1ec499325669` tinha o núcleo `eca` (e = 3, c, a = 4) e `d1b988893d06`, `boa`.
    for (const senha of ['1ec499325669', 'd1b988893d06', '97ec8f3d0279']) {
      expect(ehSenhaComum(senha, LISTA_PUBLICA_DE_SENHAS), senha).toBe(false);
    }
  });
});

describe('desempenho: a regra termina rápido nas senhas de 128 caracteres (pior caso)', () => {
  it('200 senhas de 128 caracteres de formas ruins levam menos de 2 s no total', () => {
    const formas = [
      'a'.repeat(128),
      'ab'.repeat(64),
      `12345678${'x'.repeat(112)}12345678`,
      `12345678${'a1b2'.repeat(28)}87654321`,
      `!@#$%^&*${'senha'.repeat(22)}*&^%$#@!`,
      'joao'.repeat(32),
      `${'ana1'.repeat(31)}ana1`,
      'senha-'.repeat(21) + 'ab',
    ];
    const lote: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      for (const forma of formas)
        lote.push(i === 0 ? forma : `${forma.slice(i)}${forma.slice(0, i)}`);
    }
    expect(lote).toHaveLength(200);
    const comeco = performance.now();
    for (const senha of lote) ehSenhaComum(senha.slice(0, 128), LISTA_PUBLICA_DE_SENHAS);
    expect(performance.now() - comeco).toBeLessThan(2000);
  });
});

describe('comSenhaForaDaListaPublica: bordas da regra do corpo', () => {
  it('campo que não existe no corpo não dá erro nem exceção', () => {
    const esquema = comSenhaForaDaListaPublica(criarContaSchema, 'campoQueNaoExiste');
    expect(esquema.safeParse({ ...cadastro, senha: 'sorvete123' }).success).toBe(true);
  });

  it('é idempotente: o mesmo corpo dá o mesmo resultado e o esquema original não muda', () => {
    const entrada = { ...cadastro, senha: 'naruto123' };
    const primeira = campos(criarConta, entrada);
    expect(campos(criarConta, entrada)).toEqual(primeira);
    expect(criarContaSchema.safeParse(entrada).success).toBe(true);
    expect(redefinirSenhaSchema.safeParse({ ...redefinicao, novaSenha: 'naruto123' }).success).toBe(
      true,
    );
  });

  it('a recusa traz o mesmo corpo de erro para e-mails diferentes (não é oráculo de cadastro)', () => {
    const a = campos(criarConta, { ...cadastro, email: 'nova@exemplo.com', senha: 'sorvete123' });
    const b = campos(criarConta, {
      ...cadastro,
      email: 'ja.cadastrada@exemplo.com',
      senha: 'sorvete123',
    });
    expect(a).toEqual(b);
  });

  it('a senha não vai para o texto do erro', () => {
    const erros = campos(criarConta, { ...cadastro, senha: 'sorvete123' });
    expect(JSON.stringify(erros)).not.toContain('sorvete');
  });

  it('com mais um erro que não encerra a validação, a senha ainda sai uma vez só', () => {
    const erros = campos(criarConta, {
      ...cadastro,
      aceites: { termos: '!!', privacidade: '1' },
      senha: 'sorvete123',
    });
    expect(erros.filter((erro) => erro.campo === 'senha')).toEqual([
      { campo: 'senha', codigo: 'comum', motivo: MOTIVO_COMUM },
    ]);
  });

  it('a lista montada vale as duas listas do arquivo e só tem texto na forma comparável', () => {
    expect(LISTA_PUBLICA_DE_SENHAS.senhas.has('sorvete123')).toBe(false);
    expect(LISTA_PUBLICA_DE_SENHAS.nucleos.has('sorvete')).toBe(true);
    expect(LISTA_PUBLICA_DE_SENHAS.nucleos.has('Sorvete')).toBe(false);
    expect(LISTA_PUBLICA_DE_SENHAS.nucleos.has('pikachu')).toBe(true);
  });
});

describe('desempenho (R1, S82): sem pico mesmo com entrada enorme ou montada de palavras da lista', () => {
  it('300 senhas de 128 caracteres montadas de nomes da lista levam menos de 500 ms no total', () => {
    const nomes = [...LISTA_PUBLICA_DE_SENHAS.nucleos].filter(
      (nome) => nome.length >= 3 && nome.length <= 8,
    );
    const proximo = sementeFixa(5);
    const lote: string[] = [];
    for (let i = 0; i < 300; i += 1) {
      let senha = i % 2 === 0 ? '12345678' : '';
      while (senha.length < 120) {
        senha += nomes[Math.floor(proximo() * nomes.length)] ?? '';
        if (i % 3 === 0) senha += '1';
      }
      lote.push(`${senha}87654321`.slice(0, 128));
    }
    const comeco = performance.now();
    for (const senha of lote) ehSenhaComum(senha, LISTA_PUBLICA_DE_SENHAS);
    // Medido: cerca de 0,1 ms por senha. O teto é folgado para máquina lenta de CI.
    expect(performance.now() - comeco).toBeLessThan(500);
  });

  it('uma entrada de 100 mil caracteres (fora do que o corpo deixa passar) termina em menos de 1 s', () => {
    const comeco = performance.now();
    ehSenhaComum(`12345678${'xqzk'.repeat(25_000)}87654321`, LISTA_PUBLICA_DE_SENHAS);
    ehSenhaComum('silva1'.repeat(20_000), LISTA_PUBLICA_DE_SENHAS);
    expect(performance.now() - comeco).toBeLessThan(1000);
  });
});
