// Conta (CA-01, CA-07, CA-11; P1-dono): cadastro, recadastro que não altera,
// login sem verificação, redefinição que verifica, expurgo, perfis, exclusão e
// anonimização, e os estados que os CHECKs de `identidade.contas` recusam.
import { describe, expect, it } from 'vitest';
import {
  aceitesDivergentes,
  Conta,
  type DadosDaConta,
  decidirCadastro,
  DIAS_ATE_EXPURGO_DE_NAO_VERIFICADA,
  DIAS_PARA_ALERTA_DE_ANONIMIZACAO,
  EstadoDeContaInvalido,
  HashDeSenhaInvalido,
  limiteDoExpurgo,
  NOME_DA_CONTA_ANONIMIZADA,
  NomeInvalido,
  OperacaoInvalidaNaConta,
  type PerfilConcedivel,
} from './conta.ts';
import { Email } from './email.ts';
import { Telefone } from './telefone.ts';

const ID = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';
const OUTRO_ADMIN = '7a2e4d3b-2c3d-4e4f-9a01-23456789abcd';
const AGORA = new Date('2026-10-17T12:00:00.000Z');
const UM_DIA = 24 * 60 * 60 * 1000;

function depois(ms: number): Date {
  return new Date(AGORA.getTime() + ms);
}

function novaConta(extra: { nome?: string; senhaHash?: string } = {}): Conta {
  return Conta.criar({
    id: ID,
    nome: extra.nome ?? '  Ana Souza ',
    email: Email.criar('Ana.Souza@Gmail.com'),
    telefone: Telefone.criar('(35) 99999-1234'),
    senhaHash: extra.senhaHash ?? 'hash-da-senha',
    agora: AGORA,
  });
}

describe('Conta.criar (CA-01)', () => {
  it('nasce ativa, com e-mail não verificado, perfil consumidor e campos normalizados', () => {
    const conta = novaConta();
    expect(conta.dados).toEqual({
      id: ID,
      nome: 'Ana Souza',
      emailNormalizado: 'ana.souza@gmail.com',
      telefoneE164: '+5535999991234',
      senhaHash: 'hash-da-senha',
      emailVerificadoEm: null,
      ultimoLoginEm: null,
      status: 'ativa',
      criadaEm: AGORA,
      desativadaEm: null,
      anonimizadaEm: null,
      perfis: [{ perfil: 'consumidor', concedidoEm: AGORA, concedidoPor: null }],
    } satisfies DadosDaConta);
    expect(conta.emailVerificado).toBe(false);
    expect(conta.perfis).toEqual(['consumidor']);
    expect(conta.podeEntrar).toBe(true);
  });

  it.each([
    ['   ', 'vazio'],
    ['a'.repeat(81), 'longo'],
    ['Ana\nSouza', 'caractere_proibido'],
  ])('recusa o nome %j (%s) sem repetir o valor', (nome, problema) => {
    expect(() => novaConta({ nome })).toThrow(NomeInvalido);
    expect(() => novaConta({ nome })).toThrow(`Nome inválido (${problema}).`);
  });

  it('recusa hash de senha vazio', () => {
    expect(() => novaConta({ senhaHash: ' ' })).toThrow(HashDeSenhaInvalido);
  });

  it('a cópia de dados não deixa mudar a conta por fora', () => {
    const conta = novaConta();
    const dados = conta.dados as unknown as { perfis: unknown[]; criadaEm: Date };
    dados.perfis.push({ perfil: 'admin' });
    dados.criadaEm.setFullYear(2000);
    expect(conta.perfis).toEqual(['consumidor']);
    expect(conta.criadaEm).toEqual(AGORA);
  });

  it('não serializa dado pessoal (JSON.stringify dá {})', () => {
    expect(JSON.stringify(novaConta())).toBe('{}');
  });
});

describe('recadastro (CA-02, P1-dono)', () => {
  it('sem conta com o e-mail, cria', () => {
    expect(decidirCadastro(null)).toEqual({ tipo: 'criar' });
  });

  it.each([
    ['não verificada', (_conta: Conta) => undefined],
    ['verificada', (conta: Conta) => conta.verificarEmail(AGORA)],
    ['desativada', (conta: Conta) => conta.desativar(AGORA)],
  ])('com conta %s, é repetido e a conta continua igual', (_caso, preparar) => {
    const conta = novaConta();
    preparar(conta);
    const antes = conta.dados;
    expect(decidirCadastro(conta)).toEqual({ tipo: 'repetido', contaId: ID });
    expect(conta.dados).toEqual(antes);
  });
});

describe('login e verificação (P1-dono)', () => {
  it('conta não verificada entra e grava ultimo_login_em', () => {
    const conta = novaConta();
    conta.registrarLogin(depois(1000));
    expect(conta.ultimoLoginEm).toEqual(depois(1000));
    expect(conta.emailVerificado).toBe(false);
  });

  it('verificar o e-mail guarda a primeira data (idempotente)', () => {
    const conta = novaConta();
    conta.verificarEmail(depois(1000));
    conta.verificarEmail(depois(2000));
    expect(conta.emailVerificado).toBe(true);
    expect(conta.emailVerificadoEm).toEqual(depois(1000));
  });

  it('redefinir a senha troca o hash e conta como verificação', () => {
    const conta = novaConta();
    conta.redefinirSenha('hash-novo', depois(1000));
    expect(conta.senhaHash).toBe('hash-novo');
    expect(conta.emailVerificadoEm).toEqual(depois(1000));
  });

  it('redefinir com hash vazio é recusado e nada muda', () => {
    const conta = novaConta();
    expect(() => conta.redefinirSenha('', AGORA)).toThrow(HashDeSenhaInvalido);
    expect(conta.senhaHash).toBe('hash-da-senha');
    expect(conta.emailVerificado).toBe(false);
  });

  it('conta sem senha (criada pela CLI) não pode entrar até a redefinição', () => {
    const dados = { ...novaConta().dados, senhaHash: null };
    const conta = Conta.reconstituir(dados);
    expect(conta.podeEntrar).toBe(false);
    conta.redefinirSenha('hash-novo', AGORA);
    expect(conta.podeEntrar).toBe(true);
  });

  it.each([
    ['registrarLogin', (conta: Conta) => conta.registrarLogin(AGORA)],
    ['verificarEmail', (conta: Conta) => conta.verificarEmail(AGORA)],
    ['redefinirSenha', (conta: Conta) => conta.redefinirSenha('hash-novo', AGORA)],
  ])('%s é recusado em conta desativada', (_operacao, operar) => {
    const conta = novaConta();
    conta.desativar(AGORA);
    expect(conta.podeEntrar).toBe(false);
    expect(() => operar(conta)).toThrow(OperacaoInvalidaNaConta);
  });
});

describe('Conta.criarAdmin (CLI seed:admin; CA-07)', () => {
  function novoAdmin(nome = '  Bia Admin ') {
    return Conta.criarAdmin({
      id: ID,
      nome,
      email: Email.criar('Bia@Bairrin.com.br'),
      telefone: Telefone.criar('(35) 98888-1234'),
      agora: AGORA,
    });
  }

  it('nasce ativa, sem senha, com telefone e os perfis consumidor e admin', () => {
    const conta = novoAdmin();
    expect(conta.dados).toEqual({
      id: ID,
      nome: 'Bia Admin',
      emailNormalizado: 'bia@bairrin.com.br',
      telefoneE164: '+5535988881234',
      senhaHash: null,
      emailVerificadoEm: null,
      ultimoLoginEm: null,
      status: 'ativa',
      criadaEm: AGORA,
      desativadaEm: null,
      anonimizadaEm: null,
      perfis: [
        { perfil: 'consumidor', concedidoEm: AGORA, concedidoPor: null },
        { perfil: 'admin', concedidoEm: AGORA, concedidoPor: null },
      ],
    } satisfies DadosDaConta);
  });

  it('não pode entrar antes da redefinição; depois dela entra e fica verificada', () => {
    const conta = novoAdmin();
    expect(conta.podeEntrar).toBe(false);
    conta.redefinirSenha('hash-da-primeira-senha', depois(1000));
    expect(conta.podeEntrar).toBe(true);
    expect(conta.emailVerificadoEm).toEqual(depois(1000));
  });

  it('nunca é expurgada, mesmo sem verificação e sem login', () => {
    expect(novoAdmin().deveSerExpurgada(depois(365 * UM_DIA))).toBe(false);
  });

  it('recusa nome inválido, como o cadastro', () => {
    expect(() => novoAdmin('   ')).toThrow(NomeInvalido);
  });
});

describe('perfis (CA-07)', () => {
  it('concede lojista à mesma conta, sem duplicar', () => {
    const conta = novaConta();
    conta.concederPerfil('lojista', depois(1000));
    conta.concederPerfil('lojista', depois(2000));
    expect(conta.perfis).toEqual(['consumidor', 'lojista']);
    expect(conta.dados.perfis[1]).toEqual({
      perfil: 'lojista',
      concedidoEm: depois(1000),
      concedidoPor: null,
    });
  });

  it('o caminho comum nunca concede admin', () => {
    const conta = novaConta();
    expect(() => conta.concederPerfil('admin' as PerfilConcedivel, AGORA, OUTRO_ADMIN)).toThrow(
      OperacaoInvalidaNaConta,
    );
    expect(conta.temPerfil('admin')).toBe(false);
  });

  it('admin só por concederAdmin (CLI), sem quem concedeu', () => {
    const conta = novaConta();
    conta.concederAdmin(AGORA);
    expect(conta.temPerfil('admin')).toBe(true);
    expect(conta.dados.perfis.find((p) => p.perfil === 'admin')?.concedidoPor).toBeNull();
  });
});

describe('expurgo de não verificada (P1-dono)', () => {
  const SETE_DIAS = DIAS_ATE_EXPURGO_DE_NAO_VERIFICADA * UM_DIA;

  it('o limite é 7 dias antes de agora', () => {
    expect(limiteDoExpurgo(depois(SETE_DIAS))).toEqual(AGORA);
  });

  it('sem login, conta a partir do cadastro: só passa depois de mais de 7 dias', () => {
    const conta = novaConta();
    expect(conta.deveSerExpurgada(depois(SETE_DIAS))).toBe(false);
    expect(conta.deveSerExpurgada(depois(SETE_DIAS + 1))).toBe(true);
  });

  it('o login empurra o prazo', () => {
    const conta = novaConta();
    conta.registrarLogin(depois(3 * UM_DIA));
    expect(conta.deveSerExpurgada(depois(SETE_DIAS + 1))).toBe(false);
    expect(conta.deveSerExpurgada(depois(3 * UM_DIA + SETE_DIAS + 1))).toBe(true);
  });

  it.each([
    ['verificada', (conta: Conta) => conta.verificarEmail(AGORA)],
    ['admin', (conta: Conta) => conta.concederAdmin(AGORA)],
    ['lojista', (conta: Conta) => conta.concederPerfil('lojista', AGORA)],
    ['desativada', (conta: Conta) => conta.desativar(AGORA)],
  ])('nunca apaga conta %s', (_caso, preparar) => {
    const conta = novaConta();
    preparar(conta);
    expect(conta.deveSerExpurgada(depois(365 * UM_DIA))).toBe(false);
  });
});

describe('exclusão e anonimização (CA-11)', () => {
  it('desativa na hora, com prazo de anonimização de 30 dias', () => {
    const conta = novaConta();
    conta.desativar(depois(1000));
    expect(conta.status).toBe('desativada');
    expect(conta.desativadaEm).toEqual(depois(1000));
    expect(conta.prazoDeAnonimizacao).toEqual(depois(1000 + 30 * UM_DIA));
    expect(() => conta.desativar(depois(2000))).toThrow(OperacaoInvalidaNaConta);
  });

  it('alerta só depois de 25 dias da desativação (prazo de 30 menos 5)', () => {
    const conta = novaConta();
    conta.desativar(AGORA);
    const inicio = depois(DIAS_PARA_ALERTA_DE_ANONIMIZACAO * UM_DIA);
    expect(conta.inicioDoAlertaDeAnonimizacao).toEqual(inicio);
    expect(conta.deveAlertarAnonimizacao(inicio)).toBe(false);
    expect(conta.deveAlertarAnonimizacao(new Date(inicio.getTime() + 1))).toBe(true);
  });

  it('conta ativa ou anonimizada não alerta', () => {
    const conta = novaConta();
    expect(conta.inicioDoAlertaDeAnonimizacao).toBeNull();
    expect(conta.deveAlertarAnonimizacao(depois(365 * UM_DIA))).toBe(false);
    conta.desativar(AGORA);
    conta.anonimizar(depois(UM_DIA));
    expect(conta.deveAlertarAnonimizacao(depois(365 * UM_DIA))).toBe(false);
  });

  it('conta ativa não tem prazo de anonimização e não pode ser anonimizada', () => {
    const conta = novaConta();
    expect(conta.prazoDeAnonimizacao).toBeNull();
    expect(() => conta.anonimizar(AGORA)).toThrow(OperacaoInvalidaNaConta);
    expect(conta.status).toBe('ativa');
  });

  it('anonimiza: some nome, e-mail, telefone e senha; ficam id, perfis e datas', () => {
    const conta = novaConta();
    conta.concederPerfil('lojista', AGORA);
    conta.verificarEmail(AGORA);
    conta.desativar(depois(1000));
    conta.anonimizar(depois(2000));
    const dados = conta.dados;
    expect(dados).toMatchObject({
      id: ID,
      nome: NOME_DA_CONTA_ANONIMIZADA,
      emailNormalizado: `anonimizada-${ID}@anonimizada.invalid`,
      telefoneE164: null,
      senhaHash: null,
      status: 'anonimizada',
      desativadaEm: depois(1000),
      anonimizadaEm: depois(2000),
      emailVerificadoEm: AGORA,
    });
    expect(conta.perfis).toEqual(['consumidor', 'lojista']);
    expect(JSON.stringify(dados)).not.toMatch(/ana|souza|99999|hash-da-senha/i);
    expect(conta.podeEntrar).toBe(false);
    expect(conta.prazoDeAnonimizacao).toBeNull();
  });

  it('anonimizar de novo não muda nada (idempotente)', () => {
    const conta = novaConta();
    conta.desativar(AGORA);
    conta.anonimizar(depois(1000));
    const antes = conta.dados;
    conta.anonimizar(depois(5000));
    expect(conta.dados).toEqual(antes);
    expect(Conta.reconstituir(antes).dados).toEqual(antes);
  });
});

describe('estados recusados pelos CHECKs de identidade.contas', () => {
  const base = novaConta().dados;

  it.each<[string, Partial<DadosDaConta>]>([
    ['ativa sem telefone', { telefoneE164: null }],
    ['desativada sem desativada_em', { status: 'desativada' }],
    [
      'anonimizada sem anonimizada_em',
      { status: 'anonimizada', desativadaEm: AGORA, senhaHash: null, telefoneE164: null },
    ],
    [
      'anonimizada com senha',
      {
        status: 'anonimizada',
        desativadaEm: AGORA,
        anonimizadaEm: AGORA,
        telefoneE164: null,
      },
    ],
    [
      'anonimizada com telefone',
      { status: 'anonimizada', desativadaEm: AGORA, anonimizadaEm: AGORA, senhaHash: null },
    ],
    ['hash de senha vazio', { senhaHash: '' }],
  ])('não remonta conta %s', (_caso, extra) => {
    expect(() => Conta.reconstituir({ ...base, ...extra })).toThrow(EstadoDeContaInvalido);
  });

  it('o e-mail lido passa pela normalização (minúsculas, até 254)', () => {
    const conta = Conta.reconstituir({ ...base, emailNormalizado: 'ANA@EXEMPLO.COM' });
    expect(conta.dados.emailNormalizado).toBe('ana@exemplo.com');
  });
});

describe('aceites versionados (CA-01, S24)', () => {
  const vigentes = { termos: 'v1', privacidade: 'v1' };

  it('confere quando as versões aceitas são as vigentes', () => {
    expect(aceitesDivergentes({ termos: 'v1', privacidade: 'v1' }, vigentes)).toEqual([]);
  });

  it('aponta cada documento com versão diferente da vigente', () => {
    expect(aceitesDivergentes({ termos: 'v0', privacidade: 'v1' }, vigentes)).toEqual(['termos']);
    expect(aceitesDivergentes({ termos: 'v2', privacidade: 'v0' }, vigentes)).toEqual([
      'termos',
      'privacidade',
    ]);
  });
});
