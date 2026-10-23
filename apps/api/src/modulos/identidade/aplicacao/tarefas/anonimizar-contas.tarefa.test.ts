// Anonimização diária das exclusões (CA-11, S5; plano 01b, etapa 13): anonimiza
// cada exclusão `pendente`, uma falha não para as outras, e o alerta dos 25
// dias conta pela desativação, nunca pela data do pedido (exclusão que
// aguardou pendências reaproveita a solicitação antiga).
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  type AnonimizadorDeTitular,
  RegistroDeAnonimizadores,
} from '../../../../compartilhado/titular/anonimizador-de-titular.ts';
import {
  criarIdentidadeEmMemoria,
  type IdentidadeEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import { Conta, DIAS_PARA_ALERTA_DE_ANONIMIZACAO } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import type { StatusDaSolicitacao } from '../../dominio/repositorios.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { AnonimizadorDeIdentidade } from '../privacidade/anonimizador-identidade.ts';
import { AnonimizarContaCasoDeUso } from '../privacidade/anonimizar-conta.ts';
import { AnonimizarContasTarefa, LOTE_DA_ANONIMIZACAO } from './anonimizar-contas.tarefa.ts';

const AGORA = new Date('2026-10-20T03:30:00.000Z');
const UM_DIA = 24 * 60 * 60 * 1000;

function id(n: number): string {
  return `b0b0b0b0-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

/** Anonimizador de outro módulo que falha para as contas pedidas. */
class AnonimizadorQueFalha implements AnonimizadorDeTitular {
  readonly modulo = 'pedidos';
  readonly falharPara = new Set<string>();

  anonimizar(contaId: string): Promise<void> {
    return this.falharPara.has(contaId)
      ? Promise.reject(new Error('falha com fulano@exemplo.com na mensagem'))
      : Promise.resolve();
  }
}

function montar() {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  const registro = new RegistroDeAnonimizadores();
  registro.registrar(
    new AnonimizadorDeIdentidade(
      identidade.contas,
      identidade.sessoes,
      identidade.codigos,
      identidade.segundoFator,
      identidade.exportacoes,
      relogio,
    ),
  );
  const outro = new AnonimizadorQueFalha();
  registro.registrar(outro);
  const anonimizar = new AnonimizarContaCasoDeUso(
    identidade.unidade,
    identidade.contas,
    identidade.solicitacoes,
    registro,
    identidade.publicador,
    relogio,
  );
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const tarefa = new AnonimizarContasTarefa(
    relogio,
    identidade.contas,
    identidade.solicitacoes,
    anonimizar,
    logger as unknown as PinoLogger,
  );
  return { identidade, outro, logger, tarefa };
}

/**
 * Conta desativada em `desativadaEm`, com a exclusão no `status` pedido em
 * `solicitadaEm` (a reaproveitada guarda a data do primeiro pedido).
 */
async function exclusao(
  identidade: IdentidadeEmMemoria,
  n: number,
  opcoes: { desativadaEm: Date; solicitadaEm?: Date; status?: StatusDaSolicitacao },
): Promise<string> {
  const conta = Conta.criar({
    id: id(n),
    nome: 'Pessoa de Teste',
    email: Email.criar(`pessoa${n}@exemplo.com`),
    telefone: Telefone.criar('35999991234'),
    senhaHash: 'hash-falso:senha',
    agora: new Date(AGORA.getTime() - 90 * UM_DIA),
  });
  if (opcoes.status !== 'aguardando_pendencias') conta.desativar(opcoes.desativadaEm);
  await identidade.contas.inserir(conta);
  await identidade.solicitacoes.inserir({
    id: id(1000 + n),
    contaId: conta.id,
    tipo: 'exclusao',
    status: opcoes.status ?? 'pendente',
    solicitadaEm: opcoes.solicitadaEm ?? opcoes.desativadaEm,
    concluidaEm: null,
  });
  return conta.id;
}

function diasAntes(dias: number, ms = 0): Date {
  return new Date(AGORA.getTime() - dias * UM_DIA - ms);
}

describe('AnonimizarContasTarefa (CA-11, S5)', () => {
  it('anonimiza as exclusões pendentes e conclui as solicitações', async () => {
    const { identidade, tarefa } = montar();
    const primeira = await exclusao(identidade, 1, { desativadaEm: diasAntes(1) });
    const segunda = await exclusao(identidade, 2, { desativadaEm: diasAntes(2) });

    await expect(tarefa.executar()).resolves.toEqual({
      anonimizadas: 2,
      ignoradas: 0,
      falhas: 0,
      alertas: 0,
    });

    for (const contaId of [primeira, segunda]) {
      expect(identidade.contas.dadosDe(contaId)?.status).toBe('anonimizada');
    }
    expect(identidade.solicitacoes.todas().every((s) => s.status === 'concluida')).toBe(true);
  });

  it('a falha numa conta não para as outras, e a que falhou continua pendente', async () => {
    const { identidade, outro, tarefa, logger } = montar();
    const falha = await exclusao(identidade, 1, { desativadaEm: diasAntes(3) });
    const ok = await exclusao(identidade, 2, { desativadaEm: diasAntes(2) });
    outro.falharPara.add(falha);

    await expect(tarefa.executar()).resolves.toMatchObject({ anonimizadas: 1, falhas: 1 });

    expect(identidade.contas.dadosDe(falha)?.status).toBe('desativada');
    expect(identidade.contas.dadosDe(ok)?.status).toBe('anonimizada');
    expect(identidade.solicitacoes.todas().find((s) => s.contaId === falha)?.status).toBe(
      'pendente',
    );
    // O log da falha leva o id da conta, nunca a mensagem do erro (com e-mail).
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('fulano@exemplo.com');
  });

  it('com um lote inteiro de exclusões que falham na frente da fila, a seguinte também é tentada (S105)', async () => {
    const { identidade, outro, tarefa } = montar();
    const total = LOTE_DA_ANONIMIZACAO + 1;
    for (let n = 1; n <= total; n += 1) {
      // As que falham são as mais antigas: ocupam o primeiro lote inteiro.
      const contaId = await exclusao(identidade, n, {
        desativadaEm: new Date(AGORA.getTime() - UM_DIA - (total + 1 - n) * 60_000),
      });
      if (n <= LOTE_DA_ANONIMIZACAO) outro.falharPara.add(contaId);
    }

    await expect(tarefa.executar()).resolves.toMatchObject({
      anonimizadas: 1,
      falhas: LOTE_DA_ANONIMIZACAO,
    });

    expect(identidade.contas.dadosDe(id(total))?.status).toBe('anonimizada');
  });

  it('cada exclusão é tentada uma vez por execução, mesmo a que falha', async () => {
    const { identidade, outro, tarefa } = montar();
    const falha = await exclusao(identidade, 1, { desativadaEm: diasAntes(3) });
    outro.falharPara.add(falha);
    const anonimizar = vi.spyOn(outro, 'anonimizar');

    await expect(tarefa.executar()).resolves.toMatchObject({ falhas: 1 });
    expect(anonimizar).toHaveBeenCalledTimes(1);
  });

  it('a exclusão aguardando pendências (conta ainda ativa) não entra', async () => {
    const { identidade, tarefa } = montar();
    const contaId = await exclusao(identidade, 1, {
      desativadaEm: diasAntes(40),
      status: 'aguardando_pendencias',
    });

    await expect(tarefa.executar()).resolves.toEqual({
      anonimizadas: 0,
      ignoradas: 0,
      falhas: 0,
      alertas: 0,
    });
    expect(identidade.contas.dadosDe(contaId)?.status).toBe('ativa');
  });
});

describe('AnonimizarContasTarefa: alerta dos 25 dias pela desativação', () => {
  it('desativada há mais de 25 dias: alerta, com só o id da conta e o prazo', async () => {
    const { identidade, outro, tarefa, logger } = montar();
    const contaId = await exclusao(identidade, 1, {
      desativadaEm: diasAntes(DIAS_PARA_ALERTA_DE_ANONIMIZACAO, 1),
    });
    outro.falharPara.add(contaId);

    await expect(tarefa.executar()).resolves.toMatchObject({ alertas: 1, falhas: 1 });

    expect(logger.warn).toHaveBeenCalledWith(
      {
        contaId,
        prazoDeAnonimizacao: new Date(
          AGORA.getTime() - DIAS_PARA_ALERTA_DE_ANONIMIZACAO * UM_DIA - 1 + 30 * UM_DIA,
        ).toISOString(),
      },
      expect.any(String),
    );
  });

  it('desativada há exatos 25 dias: ainda não alerta', async () => {
    const { identidade, tarefa, logger } = montar();
    await exclusao(identidade, 1, { desativadaEm: diasAntes(DIAS_PARA_ALERTA_DE_ANONIMIZACAO) });

    await expect(tarefa.executar()).resolves.toMatchObject({ alertas: 0, anonimizadas: 1 });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('exclusão reaproveitada: pedido há 40 dias, desativada há 10 → não alerta (conta pela desativação)', async () => {
    const { identidade, outro, tarefa, logger } = montar();
    const contaId = await exclusao(identidade, 1, {
      desativadaEm: diasAntes(10),
      solicitadaEm: diasAntes(40),
    });
    outro.falharPara.add(contaId);

    await expect(tarefa.executar()).resolves.toMatchObject({ alertas: 0, falhas: 1 });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('exclusão reaproveitada: pedido há 40 dias, desativada há 26 → alerta', async () => {
    const { identidade, tarefa } = montar();
    await exclusao(identidade, 1, { desativadaEm: diasAntes(26), solicitadaEm: diasAntes(40) });

    await expect(tarefa.executar()).resolves.toMatchObject({ alertas: 1, anonimizadas: 1 });
  });
});
