// Conta admin da CLI `seed:admin` (CA-07; plano 01b, etapa 13): nasce sem
// senha, com `consumidor` e `admin`, e dispara a recuperação de senha; não
// entra antes da redefinição; entrada inválida ou e-mail já cadastrado não
// grava nada; a auditoria leva só ids. O primeiro admin tem ator `sistema`;
// depois dele, o operador admin ativo é obrigatório e é o ator (S106).
import { describe, expect, it } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  criarIdentidadeEmMemoria,
  type IdentidadeEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import {
  CifradorFalso,
  EmissorDeJwtFalso,
  GeradorDeSegredosFalso,
  HasherFalso,
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { Conta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { EntrarCasoDeUso } from '../sessao/entrar.caso-de-uso.ts';
import { CriarAdminCasoDeUso, type EntradaDeCriarAdmin } from './criar-admin.caso-de-uso.ts';

const AGORA = new Date('2026-10-20T10:00:00.000Z');
const ENTRADA: EntradaDeCriarAdmin = {
  nome: '  Bia Admin ',
  email: 'Bia.Admin@Bairrin.com.br',
  telefone: '(35) 98888-1234',
  operadorId: null,
};
const OPERADOR = 'e2e2e2e2-0000-4000-8000-000000000001';

/** Uma conta com `admin` já gravada (o operador), ativa ou desativada. */
async function adminExistente(
  identidade: IdentidadeEmMemoria,
  opcoes: { id?: string; email?: string; desativada?: boolean; admin?: boolean } = {},
): Promise<string> {
  const conta = Conta.criar({
    id: opcoes.id ?? OPERADOR,
    nome: 'Operador Admin',
    email: Email.criar(opcoes.email ?? 'operador@bairrin.com.br'),
    telefone: Telefone.criar('35999990000'),
    senhaHash: 'hash-falso:senha',
    agora: AGORA,
  });
  if (opcoes.admin !== false) conta.concederAdmin(AGORA);
  if (opcoes.desativada === true) conta.desativar(AGORA);
  await identidade.contas.inserir(conta);
  return conta.id;
}

function montar() {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  const gerador = new GeradorDeSegredosFalso();
  const caso = new CriarAdminCasoDeUso(
    identidade.unidade,
    relogio,
    identidade.contas,
    identidade.auditoria,
    identidade.publicador,
    gerador,
  );
  return { identidade, relogio, gerador, caso };
}

function nadaFoiGravado(identidade: IdentidadeEmMemoria): void {
  expect(identidade.contas.todas()).toEqual([]);
  expect(identidade.publicador.publicados).toEqual([]);
  expect(identidade.auditoria.entradas).toEqual([]);
}

describe('CriarAdminCasoDeUso (CA-07)', () => {
  it('cria a conta ativa sem senha, com consumidor e admin, e o e-mail normalizado', async () => {
    const { identidade, caso } = montar();

    const resultado = await caso.executar(ENTRADA);

    expect(resultado.tipo).toBe('criado');
    const [dados] = identidade.contas.todas();
    expect(dados).toMatchObject({
      nome: 'Bia Admin',
      emailNormalizado: 'bia.admin@bairrin.com.br',
      telefoneE164: '+5535988881234',
      senhaHash: null,
      emailVerificadoEm: null,
      status: 'ativa',
    });
    expect(dados?.perfis.map((p) => p.perfil)).toEqual(['consumidor', 'admin']);
    expect(resultado).toEqual({ tipo: 'criado', contaId: dados?.id });
  });

  it('dispara a recuperação de senha (RecuperacaoSolicitada só com o id)', async () => {
    const { identidade, caso } = montar();

    const resultado = await caso.executar(ENTRADA);

    if (resultado.tipo !== 'criado') throw new Error(resultado.tipo);
    expect(identidade.publicador.publicados).toEqual([
      expect.objectContaining({
        tipo: 'identidade.RecuperacaoSolicitada',
        agregadoId: resultado.contaId,
        payload: { contaId: resultado.contaId },
      }),
    ]);
  });

  it('audita com ator sistema e origem cli, sem nome, e-mail nem telefone', async () => {
    const { identidade, caso } = montar();

    const resultado = await caso.executar(ENTRADA);

    if (resultado.tipo !== 'criado') throw new Error(resultado.tipo);
    expect(identidade.auditoria.entradas).toEqual([
      expect.objectContaining({
        atorTipo: 'sistema',
        atorId: null,
        acao: 'admin_criado',
        recurso: 'conta',
        recursoId: resultado.contaId,
        origem: 'cli',
      }),
    ]);
    const auditado = JSON.stringify(identidade.auditoria.entradas);
    for (const pessoal of ['Bia', 'bia.admin', '98888']) expect(auditado).not.toContain(pessoal);
  });

  it('a conta do admin não pode entrar antes da redefinição da senha', async () => {
    const { identidade, relogio, caso } = montar();
    await caso.executar(ENTRADA);
    const hasher = new HasherFalso(identidade.unidade);
    const entrar = new EntrarCasoDeUso(
      identidade.unidade,
      relogio,
      identidade.contas,
      identidade.sessoes,
      identidade.bloqueios,
      identidade.desafios,
      identidade.segundoFator,
      hasher,
      new CifradorFalso(),
      new GeradorDeSegredosFalso(),
      new EmissorDeJwtFalso(),
    );

    for (const cliente of ['painel', 'app_consumidor'] as const) {
      await expect(
        entrar.executar({ email: ENTRADA.email, senha: '', cliente, ip: '203.0.113.5' }),
      ).resolves.toEqual({ tipo: 'credenciais_invalidas' });
    }
    // Sem senha guardada, nenhuma senha confere: o hash nem é conferido (tempo do fictício).
    expect(hasher.chamadas.verificar).toBe(0);
    expect(hasher.chamadas.simularVerificacao).toBe(2);
    expect(identidade.sessoes.todas()).toEqual([]);
  });

  it.each([
    ['telefone inválido', { telefone: '123' }, 'telefone_invalido'],
    ['telefone fixo', { telefone: '(35) 3531-1234' }, 'telefone_invalido'],
    ['e-mail inválido', { email: 'nao-e-email' }, 'email_invalido'],
    ['nome vazio', { nome: '   ' }, 'nome_invalido'],
  ] as const)('%s: %s, sem gravar nada', async (_caso, parcial, tipo) => {
    const { identidade, caso } = montar();

    await expect(caso.executar({ ...ENTRADA, ...parcial })).resolves.toEqual({ tipo });

    nadaFoiGravado(identidade);
  });

  it('e-mail que já tem conta: email_ja_cadastrado, sem mudar a conta existente nem dar admin', async () => {
    const { identidade, caso } = montar();
    const existente = Conta.criar({
      id: 'e1e1e1e1-0000-4000-8000-000000000001',
      nome: 'Outra Pessoa',
      email: Email.criar(ENTRADA.email),
      telefone: Telefone.criar('35999991234'),
      senhaHash: 'hash-falso:senha',
      agora: AGORA,
    });
    await identidade.contas.inserir(existente);

    await expect(caso.executar(ENTRADA)).resolves.toEqual({ tipo: 'email_ja_cadastrado' });

    expect(identidade.contas.todas()).toEqual([existente.dados]);
    expect(identidade.publicador.publicados).toEqual([]);
    expect(identidade.auditoria.entradas).toEqual([]);
  });
});

describe('CriarAdminCasoDeUso: operador (S106)', () => {
  it('já existe admin ativo e não veio operador: operador_obrigatorio, sem gravar nada', async () => {
    const { identidade, caso } = montar();
    await adminExistente(identidade);
    const antes = identidade.contas.todas();

    await expect(caso.executar(ENTRADA)).resolves.toEqual({ tipo: 'operador_obrigatorio' });

    expect(identidade.contas.todas()).toEqual(antes);
    expect(identidade.publicador.publicados).toEqual([]);
    expect(identidade.auditoria.entradas).toEqual([]);
  });

  it('com operador admin ativo: cria e audita com ator admin e o id do operador', async () => {
    const { identidade, caso } = montar();
    await adminExistente(identidade);

    const resultado = await caso.executar({ ...ENTRADA, operadorId: OPERADOR });

    if (resultado.tipo !== 'criado') throw new Error(resultado.tipo);
    expect(identidade.auditoria.entradas).toEqual([
      expect.objectContaining({
        atorTipo: 'admin',
        atorId: OPERADOR,
        acao: 'admin_criado',
        recursoId: resultado.contaId,
        origem: 'cli',
      }),
    ]);
  });

  it.each([
    ['inexistente', 'e3e3e3e3-0000-4000-8000-000000000009'],
    ['que não é UUID', 'nao-e-uuid'],
  ] as const)('operador %s: operador_invalido, sem gravar nada', async (_caso, operadorId) => {
    const { identidade, caso } = montar();
    await adminExistente(identidade);
    const antes = identidade.contas.todas();

    await expect(caso.executar({ ...ENTRADA, operadorId })).resolves.toEqual({
      tipo: 'operador_invalido',
    });
    expect(identidade.contas.todas()).toEqual(antes);
    expect(identidade.auditoria.entradas).toEqual([]);
  });

  it('operador sem admin, ou desativado: operador_invalido', async () => {
    const { identidade, caso } = montar();
    await adminExistente(identidade);
    const semAdmin = await adminExistente(identidade, {
      id: 'e3e3e3e3-0000-4000-8000-000000000001',
      email: 'comum@bairrin.com.br',
      admin: false,
    });
    const desativado = await adminExistente(identidade, {
      id: 'e3e3e3e3-0000-4000-8000-000000000002',
      email: 'saiu@bairrin.com.br',
      desativada: true,
    });

    for (const operadorId of [semAdmin, desativado]) {
      await expect(caso.executar({ ...ENTRADA, operadorId })).resolves.toEqual({
        tipo: 'operador_invalido',
      });
    }
    expect(identidade.auditoria.entradas).toEqual([]);
  });

  it('o admin desativado não conta como admin existente: o próximo é o primeiro, com ator sistema', async () => {
    const { identidade, caso } = montar();
    await adminExistente(identidade, { desativada: true });

    await expect(caso.executar(ENTRADA)).resolves.toMatchObject({ tipo: 'criado' });
    expect(identidade.auditoria.entradas).toEqual([
      expect.objectContaining({ atorTipo: 'sistema', atorId: null }),
    ]);
  });

  it('duas execuções ao mesmo tempo sem admin ativo: só a primeira cria com ator sistema; a outra espera a trava e recebe operador_obrigatorio', async () => {
    const { identidade, caso } = montar();

    const resultados = await Promise.all([
      caso.executar(ENTRADA),
      caso.executar({ ...ENTRADA, email: 'outro.admin@bairrin.com.br' }),
    ]);

    expect(resultados.map((r) => r.tipo).sort()).toEqual(['criado', 'operador_obrigatorio']);
    expect(identidade.contas.todas()).toHaveLength(1);
    expect(identidade.auditoria.entradas).toEqual([
      expect.objectContaining({ acao: 'admin_criado', atorTipo: 'sistema', atorId: null }),
    ]);
  });

  it('sem admin nenhum, um operador informado não confere: operador_invalido', async () => {
    const { identidade, caso } = montar();

    await expect(caso.executar({ ...ENTRADA, operadorId: OPERADOR })).resolves.toEqual({
      tipo: 'operador_invalido',
    });
    nadaFoiGravado(identidade);
  });
});
