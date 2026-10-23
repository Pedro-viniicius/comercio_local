// Expurgo diário de contas não verificadas (P1-dono, S6, S8, S78; plano 01b,
// etapa 13): apaga com tudo o que é da conta, confere a regra de novo com a
// conta travada (quem renovou no meio fica), trata a recusa da trigger como
// "não apagou" sem derrubar o lote, e o token da conta apagada dá `invalida`
// (401), não erro interno.
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  criarIdentidadeEmMemoria,
  type IdentidadeEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import {
  CifradorFalso,
  EmissorDeJwtFalso,
  GeradorDeSegredosFalso,
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { CodigoDeVerificacao } from '../../dominio/codigo-de-verificacao.ts';
import { Conta, ContaForaDoExpurgo } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import { Sessao } from '../../dominio/sessao.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { hashDoTokenDeRenovacao } from '../comum/chaves.ts';
import { RenovarSessaoCasoDeUso } from '../sessao/renovar-sessao.caso-de-uso.ts';
import {
  ApagarContasNaoVerificadasTarefa,
  LOTE_DO_EXPURGO,
} from './apagar-nao-verificadas.tarefa.ts';

const AGORA = new Date('2026-10-20T03:00:00.000Z');
const UM_DIA = 24 * 60 * 60 * 1000;
const OITO_DIAS_ATRAS = new Date(AGORA.getTime() - 8 * UM_DIA);
const SETE_DIAS_ATRAS = new Date(AGORA.getTime() - 7 * UM_DIA);
const cifrador = new CifradorFalso();

function id(n: number): string {
  return `a0a0a0a0-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function loggerFalso() {
  return {
    setContext: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function montar() {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  const logger = loggerFalso();
  const tarefa = new ApagarContasNaoVerificadasTarefa(
    identidade.unidade,
    relogio,
    identidade.contas,
    logger as unknown as PinoLogger,
  );
  return { identidade, relogio, logger, tarefa };
}

async function inserirConta(
  identidade: IdentidadeEmMemoria,
  n: number,
  opcoes: { criadaEm?: Date; verificada?: boolean; perfil?: 'admin' | 'lojista' } = {},
): Promise<string> {
  const criadaEm = opcoes.criadaEm ?? OITO_DIAS_ATRAS;
  const conta = Conta.criar({
    id: id(n),
    nome: 'Pessoa de Teste',
    email: Email.criar(`pessoa${n}@exemplo.com`),
    telefone: Telefone.criar('35999991234'),
    senhaHash: 'hash-falso:senha',
    agora: criadaEm,
  });
  if (opcoes.verificada === true) conta.verificarEmail(criadaEm);
  if (opcoes.perfil === 'admin') conta.concederAdmin(criadaEm);
  if (opcoes.perfil === 'lojista') conta.concederPerfil('lojista', criadaEm);
  await identidade.contas.inserir(conta);
  return conta.id;
}

describe('ApagarContasNaoVerificadasTarefa (P1-dono, S8)', () => {
  it('apaga a conta não verificada sem login há mais de 7 dias, com sessões e códigos', async () => {
    const { identidade, tarefa } = montar();
    const contaId = await inserirConta(identidade, 1);
    await identidade.sessoes.inserir(
      Sessao.criar({
        id: id(101),
        contaId,
        cliente: 'app_consumidor',
        tokenHash: 'hash-do-token',
        mfa: false,
        agora: OITO_DIAS_ATRAS,
      }),
    );
    await identidade.codigos.inserir(
      CodigoDeVerificacao.emitir({
        id: id(201),
        contaId,
        finalidade: 'verificacao_email',
        codigoHmac: 'hmac',
        agora: OITO_DIAS_ATRAS,
      }),
    );

    await expect(tarefa.executar()).resolves.toEqual({ apagadas: 1, mantidas: 0, recusadas: 0 });

    expect(identidade.contas.todas()).toEqual([]);
    expect(identidade.sessoes.todas()).toEqual([]);
    expect(identidade.codigos.todos()).toEqual([]);
  });

  it('o token de renovação da conta apagada dá invalida (401), não erro interno', async () => {
    const { identidade, relogio, tarefa } = montar();
    const contaId = await inserirConta(identidade, 1);
    const token = 'token-da-conta-apagada';
    await identidade.sessoes.inserir(
      Sessao.criar({
        id: id(101),
        contaId,
        cliente: 'app_consumidor',
        tokenHash: hashDoTokenDeRenovacao(cifrador, token),
        mfa: false,
        agora: OITO_DIAS_ATRAS,
      }),
    );
    await tarefa.executar();

    const renovar = new RenovarSessaoCasoDeUso(
      identidade.unidade,
      relogio,
      identidade.contas,
      identidade.sessoes,
      cifrador,
      new GeradorDeSegredosFalso(),
      new EmissorDeJwtFalso(),
    );
    await expect(
      renovar.executar({ tokenRenovacao: token, cliente: 'app_consumidor' }),
    ).resolves.toEqual({ tipo: 'invalida' });
    await expect(identidade.contas.buscarPorId(contaId)).resolves.toBeNull();
  });

  it('poupa a verificada, a de admin, a de lojista e a que ainda não passou dos 7 dias', async () => {
    const { identidade, tarefa } = montar();
    await inserirConta(identidade, 1, { verificada: true });
    await inserirConta(identidade, 2, { perfil: 'admin' });
    await inserirConta(identidade, 3, { perfil: 'lojista' });
    await inserirConta(identidade, 4, { criadaEm: SETE_DIAS_ATRAS });

    await expect(tarefa.executar()).resolves.toEqual({ apagadas: 0, mantidas: 0, recusadas: 0 });

    expect(identidade.contas.todas()).toHaveLength(4);
  });

  it('confere de novo com a conta travada: quem renovou entre a listagem e a exclusão fica', async () => {
    const { identidade, tarefa } = montar();
    const renovou = await inserirConta(identidade, 1);
    const esquecida = await inserirConta(identidade, 2);
    const listar = identidade.contas.listarParaExpurgo.bind(identidade.contas);
    vi.spyOn(identidade.contas, 'listarParaExpurgo').mockImplementationOnce(async (...args) => {
      const ids = await listar(...args);
      // A renovação grava `ultimo_login_em` depois da listagem (etapa 9).
      await identidade.contas.gravarUltimoLogin(renovou, AGORA);
      return ids;
    });

    await expect(tarefa.executar()).resolves.toEqual({ apagadas: 1, mantidas: 1, recusadas: 0 });

    expect(identidade.contas.dadosDe(renovou)).toBeDefined();
    expect(identidade.contas.dadosDe(esquecida)).toBeUndefined();
  });

  it('a recusa da trigger na fronteira, no meio do lote, conta como "não apagou" e o lote segue (S78)', async () => {
    const { identidade, tarefa } = montar();
    const antes = await inserirConta(identidade, 1, {
      criadaEm: new Date(OITO_DIAS_ATRAS.getTime() - 2),
    });
    const fronteira = await inserirConta(identidade, 2, {
      criadaEm: new Date(OITO_DIAS_ATRAS.getTime() - 1),
    });
    const depois = await inserirConta(identidade, 3);
    await identidade.sessoes.inserir(
      Sessao.criar({
        id: id(102),
        contaId: fronteira,
        cliente: 'app_lojista',
        tokenHash: 'hash-da-fronteira',
        mfa: false,
        agora: OITO_DIAS_ATRAS,
      }),
    );
    const apagar = identidade.contas.apagar.bind(identidade.contas);
    // O relógio do banco (`now()`) ainda não deu os 7 dias para esta conta.
    vi.spyOn(identidade.contas, 'apagar').mockImplementation(async (contaId) => {
      if (contaId === fronteira) throw new ContaForaDoExpurgo();
      await apagar(contaId);
    });

    await expect(tarefa.executar()).resolves.toEqual({ apagadas: 2, mantidas: 0, recusadas: 1 });

    expect(identidade.contas.dadosDe(antes)).toBeUndefined();
    expect(identidade.contas.dadosDe(depois)).toBeUndefined();
    expect(identidade.contas.dadosDe(fronteira)).toBeDefined();
    expect(identidade.sessoes.todas().map((s) => s.contaId)).toEqual([fronteira]);
  });

  it('outro erro do banco para a tarefa (o pg-boss tenta de novo)', async () => {
    const { identidade, tarefa } = montar();
    await inserirConta(identidade, 1);
    vi.spyOn(identidade.contas, 'apagar').mockRejectedValueOnce(
      Object.assign(new Error('falha'), { code: 'P1001' }),
    );

    await expect(tarefa.executar()).rejects.toMatchObject({ code: 'P1001' });
    expect(identidade.contas.todas()).toHaveLength(1);
  });

  it('com um lote inteiro de recusas da trigger na frente, a conta seguinte também é apagada (S105)', async () => {
    const { identidade, tarefa } = montar();
    const recusadas = new Set<string>();
    for (let n = 1; n <= LOTE_DO_EXPURGO + 1; n += 1) {
      const contaId = await inserirConta(identidade, n);
      if (n <= LOTE_DO_EXPURGO) recusadas.add(contaId);
    }
    const apagar = identidade.contas.apagar.bind(identidade.contas);
    const tentativas = vi.spyOn(identidade.contas, 'apagar').mockImplementation(async (contaId) => {
      if (recusadas.has(contaId)) throw new ContaForaDoExpurgo();
      await apagar(contaId);
    });

    await expect(tarefa.executar()).resolves.toEqual({
      apagadas: 1,
      mantidas: 0,
      recusadas: LOTE_DO_EXPURGO,
    });

    expect(identidade.contas.dadosDe(id(LOTE_DO_EXPURGO + 1))).toBeUndefined();
    // Uma tentativa por conta e por execução.
    expect(tentativas).toHaveBeenCalledTimes(LOTE_DO_EXPURGO + 1);
  });

  it('percorre mais de um lote, em ordem de id', async () => {
    const { identidade, tarefa, logger } = montar();
    for (let n = 1; n <= LOTE_DO_EXPURGO + 1; n += 1) {
      await inserirConta(identidade, n, { criadaEm: new Date(OITO_DIAS_ATRAS.getTime() - n) });
    }

    await expect(tarefa.executar()).resolves.toMatchObject({ apagadas: LOTE_DO_EXPURGO + 1 });

    expect(identidade.contas.todas()).toEqual([]);
    // O log leva só as contagens.
    expect(logger.info).toHaveBeenCalledWith(
      { apagadas: LOTE_DO_EXPURGO + 1, mantidas: 0, recusadas: 0 },
      expect.any(String),
    );
  });
});
