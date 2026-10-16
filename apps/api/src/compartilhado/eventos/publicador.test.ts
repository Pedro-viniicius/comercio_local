// Publicador de eventos: só dentro de transação e sem dado pessoal nem segredo
// no payload. A outbox real (rollback, relay, concorrência) está em
// test/integracao/outbox.int.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { PublicadorDeEventosNaOutbox } from '../infra/publicador-na-outbox.ts';
import type { UnidadeDeTrabalhoPrisma } from '../infra/unidade-de-trabalho-prisma.ts';
import { RelogioFixo } from '../tempo/relogio.ts';
import { DadoPessoalRecusado, type ObjetoJson } from '../titular/dado-pessoal.ts';
import { type EventoDeDominio, EventoInvalido, PublicacaoForaDeTransacao } from './publicador.ts';

const AGORA = new Date('2026-10-16T12:00:00.000Z');
const AGREGADO = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';

function montar(dentroDeTransacao = true) {
  const createMany = vi.fn().mockResolvedValue({ count: 1 });
  const transacao = { outbox: { createMany } };
  const unidade = {
    transacaoAtual: () => (dentroDeTransacao ? transacao : undefined),
  } as unknown as UnidadeDeTrabalhoPrisma;
  return {
    publicador: new PublicadorDeEventosNaOutbox(unidade, new RelogioFixo(AGORA)),
    createMany,
  };
}

function evento(extra: Partial<EventoDeDominio> = {}): EventoDeDominio {
  return {
    tipo: 'identidade.ContaCriada',
    versao: 1,
    agregadoId: AGREGADO,
    payload: { contaId: AGREGADO },
    ...extra,
  };
}

describe('PublicadorDeEventosNaOutbox.publicar', () => {
  it('grava os eventos na transação, com a hora do relógio', async () => {
    const { publicador, createMany } = montar();
    await publicador.publicar(evento(), evento({ tipo: 'identidade.VerificacaoReenviada' }));
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          tipo: 'identidade.ContaCriada',
          versao: 1,
          agregadoId: AGREGADO,
          payload: { contaId: AGREGADO },
          ocorridoEm: AGORA,
        },
        {
          tipo: 'identidade.VerificacaoReenviada',
          versao: 1,
          agregadoId: AGREGADO,
          payload: { contaId: AGREGADO },
          ocorridoEm: AGORA,
        },
      ],
    });
  });

  it('recusa publicar fora de uma unidade de trabalho', async () => {
    const { publicador, createMany } = montar(false);
    await expect(publicador.publicar(evento())).rejects.toBeInstanceOf(PublicacaoForaDeTransacao);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('sem eventos, não grava nada', async () => {
    const { publicador, createMany } = montar();
    await publicador.publicar();
    expect(createMany).not.toHaveBeenCalled();
  });

  it.each<[string, ObjetoJson]>([
    ['token', { contaId: AGREGADO, token: 'abc' }],
    ['senha', { novaSenha: 'segredo123' }],
    ['código de verificação', { codigo: '123456' }],
    ['e-mail', { email: 'maria@exemplo.com.br' }],
    ['telefone aninhado', { contato: { telefone: '+5535999990000' } }],
    ['nome', { nome: 'Maria' }],
  ])('recusa payload com %s e não grava nenhum evento do lote', async (_caso, payload) => {
    const { publicador, createMany } = montar();
    const erro: unknown = await publicador
      .publicar(evento(), evento({ payload }))
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(DadoPessoalRecusado);
    for (const valor of ['abc', 'segredo123', '123456', 'maria', '+5535', 'Maria']) {
      expect((erro as Error).message).not.toContain(valor);
    }
    expect(createMany).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<EventoDeDominio>]>([
    ['tipo sem contexto', { tipo: 'ContaCriada' }],
    ['tipo com espaço', { tipo: 'identidade.Conta Criada' }],
    ['versão zero', { versao: 0 }],
    ['versão fracionária', { versao: 1.5 }],
    ['agregado que não é UUID', { agregadoId: 'maria@exemplo.com.br' }],
  ])('recusa evento mal formado: %s', async (_caso, extra) => {
    const { publicador, createMany } = montar();
    await expect(publicador.publicar(evento(extra))).rejects.toBeInstanceOf(EventoInvalido);
    expect(createMany).not.toHaveBeenCalled();
  });
});
