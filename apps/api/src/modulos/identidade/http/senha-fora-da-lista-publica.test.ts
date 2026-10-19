// Etapa 5b do plano 01b (S74): a lista pública de senhas comuns, que só a API tem, e a regra
// que a aplica no corpo com senha nova.
import {
  type CampoComErro,
  camposDoErroZod,
  criarContaSchema,
  redefinirSenhaSchema,
  type z,
} from '@bairrin/contratos';
import { ehSenhaComum, formaComparavelDaSenha } from '@bairrin/contratos/validadores';
import { describe, expect, it } from 'vitest';
import {
  NUCLEOS_DA_LISTA_PUBLICA,
  SENHAS_DA_LISTA_PUBLICA,
} from './dados/senhas-comuns-publicas.ts';
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

describe('lista pública: senhas que a rodada 2 aceitava (S74, etapa 5b)', () => {
  it.each([
    'joaopedro123',
    'mariaclara123',
    'silva123',
    'souza1234',
    'palmeirense',
    'senhasenha',
    'senha@senha',
    'Bem-vindo1',
    'naruto123',
    'neymar10',
    'jesusmeama',
    'sorvete123',
    'naosei123',
    // Também da tabela do S74.
    'anajulia123',
    'pedrohenrique',
    'gabrielsilva',
    'oliveira1',
    'corintiano',
    'flamenguista',
    'colorado',
    'batman123',
    'pokemon1',
    'deusmeama',
    'sucesso123',
    'inicial@123',
  ])('%s é recusada', (senha) => {
    expect(ehSenhaComum(senha, LISTA_PUBLICA_DE_SENHAS)).toBe(true);
    expect(campos(criarConta, { ...cadastro, senha })).toEqual([
      { campo: 'senha', codigo: 'comum', motivo: MOTIVO_COMUM },
    ]);
  });

  it('senha forte real continua aceita com a lista completa', () => {
    for (const senha of [
      'correto cavalo bateria grampo',
      'Tr0ub4dor&3',
      'Xk9#mP2$vL7@qR4!',
      'feira-do-bairro-sao-sebastiao',
      'ana&pedro&lucas&2026',
      'pão de queijo mineiro',
      'girafa violino tempestade',
      '%354O3*1',
    ]) {
      expect(ehSenhaComum(senha, LISTA_PUBLICA_DE_SENHAS), senha).toBe(false);
    }
  });

  // A taxa real é de cerca de 0,005% (5 em 100 mil com 12 caracteres, medida com outras
  // sementes): palavras curtas da lista pública aparecem por acaso no meio do texto. O teto
  // de 10 em 100 mil (0,01%) não depende da semente, e o caso medido aqui dá zero.
  it('no máximo 10 de 100 mil senhas aleatórias de 12 a 24 caracteres são recusadas', () => {
    const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*-_.';
    let semente = 20261017;
    const proximo = () => {
      semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0;
      return semente / 2 ** 32;
    };
    const recusadas: string[] = [];
    for (let i = 0; i < 100_000; i += 1) {
      const tamanho = 12 + Math.floor(proximo() * 13);
      let senha = '';
      for (let j = 0; j < tamanho; j += 1) {
        senha += alfabeto.charAt(Math.floor(proximo() * alfabeto.length));
      }
      if (ehSenhaComum(senha, LISTA_PUBLICA_DE_SENHAS)) recusadas.push(senha);
    }
    expect(recusadas.length).toBeLessThanOrEqual(10);
  }, 60_000);

  it('o pior caso conhecido fica longe do event loop travado (R1, S82)', () => {
    let miolo = '';
    for (let i = 0; i < 112; i += 1) miolo += 'qwzxkvjyhbnm'.charAt((i * 7) % 12);
    const piores = [
      `12345678${miolo}87654321`,
      `12345678${'abc!!!'.repeat(18)}x12345678`,
      `0134@$57${'xsilvasantosoliveirasouzapereiraferreiralimaalves'}0134@$57`,
    ];
    const comeco = performance.now();
    for (let i = 0; i < 100; i += 1) {
      for (const senha of piores) ehSenhaComum(senha, LISTA_PUBLICA_DE_SENHAS);
    }
    // 300 chamadas: com folga para máquina lenta de CI (medido: cerca de 0,1 ms cada).
    expect(performance.now() - comeco).toBeLessThan(1500);
  });

  // S85: a NFKC expande `⁗` e `⒇` (458 caracteres na forma comparável) e o trecho longo de
  // dígitos ou símbolos no meio do núcleo gera 81 variantes. Antes da rodada 3, de 13 a
  // 387 ms por chamada e cerca de 700 ms pelo esquema; depois, menos de 1 ms.
  const PONTAS = '11111111';
  const piores = {
    'U+2057 ×110': `${PONTAS}a${'⁗'.repeat(110)}b${PONTAS}`,
    'U+2487 ×110': `${PONTAS}a${'⒇'.repeat(110)}b${PONTAS}`,
    "'1' ×110": `${PONTAS}a${'1'.repeat(110)}b${PONTAS}`,
    "'🔑1' ×55": `${PONTAS}a${'🔑1'.repeat(55)}b${PONTAS}`,
  };

  it.each(Object.entries(piores))(
    '%s com a lista pública: 40 chamadas em menos de 200 ms (S85)',
    (_caso, senha) => {
      ehSenhaComum(senha, LISTA_PUBLICA_DE_SENHAS);
      const comeco = performance.now();
      for (let i = 0; i < 40; i += 1) ehSenhaComum(senha, LISTA_PUBLICA_DE_SENHAS);
      expect(performance.now() - comeco).toBeLessThan(200);
    },
  );

  it('os mesmos casos pelo esquema com a lista pública: 80 validações em menos de 800 ms', () => {
    const comeco = performance.now();
    for (let i = 0; i < 20; i += 1) {
      for (const senha of Object.values(piores)) criarConta.safeParse({ ...cadastro, senha });
    }
    expect(performance.now() - comeco).toBeLessThan(800);
  });
});

describe('comSenhaForaDaListaPublica (etapa 5b)', () => {
  it('senha que só a lista pública recusa sai como uma issue no campo certo', () => {
    expect(criarContaSchema.safeParse({ ...cadastro, senha: 'sorvete123' }).success).toBe(true);
    expect(campos(criarConta, { ...cadastro, senha: 'sorvete123' })).toEqual([
      { campo: 'senha', codigo: 'comum', motivo: MOTIVO_COMUM },
    ]);
    expect(campos(redefinirSenha, { ...redefinicao, novaSenha: 'sorvete123' })).toEqual([
      { campo: 'novaSenha', codigo: 'comum', motivo: MOTIVO_COMUM },
    ]);
  });

  it('não duplica a issue da lista à mão nem a do motivo próprio', () => {
    expect(campos(criarConta, { ...cadastro, senha: 'senha123' })).toEqual([
      { campo: 'senha', codigo: 'comum', motivo: MOTIVO_COMUM },
    ]);
    expect(campos(criarConta, { ...cadastro, senha: '12345678' })).toEqual([
      {
        campo: 'senha',
        codigo: 'comum',
        motivo: 'Use letras também: senha só com números e símbolos é fácil de adivinhar',
      },
    ]);
  });

  it('senha curta ou longa fica só com o erro de tamanho', () => {
    expect(campos(criarConta, { ...cadastro, senha: 'naruto' })).toEqual([
      { campo: 'senha', codigo: 'invalido', motivo: 'Use 8 caracteres ou mais' },
    ]);
    expect(campos(criarConta, { ...cadastro, senha: `sorvete${'x'.repeat(122)}` })).toEqual([
      { campo: 'senha', codigo: 'invalido', motivo: 'Use até 128 caracteres' },
    ]);
  });

  it('corpo sem o campo, com o campo de outro tipo ou que não é objeto não lança exceção', () => {
    const { senha: _senha, ...semSenha } = cadastro;
    expect(campos(criarConta, semSenha)).toEqual([
      { campo: 'senha', codigo: 'obrigatorio', motivo: 'Campo obrigatório.' },
    ]);
    expect(campos(criarConta, { ...cadastro, senha: 123 }).map((c) => c.campo)).toEqual(['senha']);
    expect(() => criarConta.safeParse(null)).not.toThrow();
    expect(() => criarConta.safeParse('sorvete123')).not.toThrow();
    expect(criarConta.safeParse(null).success).toBe(false);
  });

  it('campo desconhecido não impede a recusa; erro que encerra outro campo, sim (R4)', () => {
    expect(
      campos(criarConta, { ...cadastro, intruso: 1, senha: 'sorvete123' }).map((c) => c.campo),
    ).toEqual(['intruso', 'senha']);
    // O zod 4.6.7 pula todo check, mesmo com `when`, depois de uma issue com `abort: true`
    // (`util.explicitlyAborted`): com e-mail inválido, a senha sai no envio seguinte.
    expect(
      campos(criarConta, { ...cadastro, email: 'x', senha: 'sorvete123' }).map((c) => c.campo),
    ).toEqual(['email']);
  });

  it('senha aceita passa e sai como foi digitada', () => {
    expect(criarConta.parse(cadastro).senha).toBe('feira-do-bairro-7');
  });
});

describe('lista pública gerada (dados/senhas-comuns-publicas.ts, etapa 5b)', () => {
  const entradas = (texto: string) => texto.split(/\s+/u).filter((entrada) => entrada.length > 0);
  const senhas = entradas(SENHAS_DA_LISTA_PUBLICA);
  const nucleos = entradas(NUCLEOS_DA_LISTA_PUBLICA);

  it('as senhas estão na forma comparável, têm 8 caracteres ou mais e não se repetem', () => {
    expect(senhas.length).toBeGreaterThanOrEqual(3000);
    expect(senhas.filter((senha) => formaComparavelDaSenha(senha) !== senha)).toEqual([]);
    expect(senhas.filter((senha) => [...senha].length < 8)).toEqual([]);
    expect(new Set(senhas).size).toBe(senhas.length);
  });

  it('os núcleos estão na forma comparável, têm 3 letras ou mais e não se repetem', () => {
    expect(nucleos.length).toBeGreaterThan(10_000);
    expect(nucleos.filter((nucleo) => formaComparavelDaSenha(nucleo) !== nucleo)).toEqual([]);
    expect(nucleos.filter((nucleo) => !/^\p{L}{3,}$/u.test(nucleo))).toEqual([]);
    expect(new Set(nucleos).size).toBe(nucleos.length);
  });

  it('nenhuma entrada tem cara de e-mail', () => {
    const email = /[^@\s]@[^@\s]+\.[a-z]{2,}/iu;
    expect([...senhas, ...nucleos].filter((entrada) => email.test(entrada))).toEqual([]);
  });

  it('a lista montada tem as mesmas entradas do arquivo gerado', () => {
    expect(LISTA_PUBLICA_DE_SENHAS.senhas.size).toBe(senhas.length);
    expect(LISTA_PUBLICA_DE_SENHAS.nucleos.size).toBe(nucleos.length);
  });
});
