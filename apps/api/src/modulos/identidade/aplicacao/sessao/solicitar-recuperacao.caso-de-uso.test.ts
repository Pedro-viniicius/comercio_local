// Pedido de recuperação de senha (CA-06; plano 01b, etapa 9): resposta igual
// com ou sem conta; `RecuperacaoSolicitada` só para conta ativa, com só o id.
import type { SolicitarRecuperacao } from '@bairrin/contratos';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  criarIdentidadeEmMemoria,
  type IdentidadeEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import { HasherFalso } from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { Conta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import { Telefone } from '../../dominio/telefone.ts';
import {
  type EntradaDeSolicitarRecuperacao,
  SolicitarRecuperacaoCasoDeUso,
} from './solicitar-recuperacao.caso-de-uso.ts';

const AGORA = new Date('2026-10-18T12:00:00.000Z');
const CONTA = 'dddddddd-0000-4000-8000-000000000001';
const EMAIL = 'dani@exemplo.com';

function montar(): { identidade: IdentidadeEmMemoria; caso: SolicitarRecuperacaoCasoDeUso } {
  const identidade = criarIdentidadeEmMemoria();
  const caso = new SolicitarRecuperacaoCasoDeUso(
    identidade.unidade,
    identidade.publicador,
    identidade.contas,
  );
  return { identidade, caso };
}

function novaConta({ desativada = false, semSenha = false } = {}): Conta {
  const conta = Conta.criar({
    id: CONTA,
    nome: 'Dani Prado',
    email: Email.criar(EMAIL),
    telefone: Telefone.criar('35999991234'),
    senhaHash: HasherFalso.hashDe('senha-da-dani'),
    agora: AGORA,
  });
  if (desativada) conta.desativar(AGORA);
  if (semSenha) {
    conta.concederAdmin(AGORA);
    return Conta.reconstituir({ ...conta.dados, senhaHash: null });
  }
  return conta;
}

describe('SolicitarRecuperacaoCasoDeUso', () => {
  it('o corpo do contrato entra no caso de uso', () => {
    expectTypeOf<SolicitarRecuperacao>().toExtend<EntradaDeSolicitarRecuperacao>();
  });

  it('conta ativa: publica `RecuperacaoSolicitada` só com o id da conta (CA-06)', async () => {
    const { identidade, caso } = montar();
    await identidade.contas.inserir(novaConta());

    await expect(caso.executar({ email: EMAIL })).resolves.toBeUndefined();

    expect(identidade.publicador.publicados).toEqual([
      expect.objectContaining({
        tipo: 'identidade.RecuperacaoSolicitada',
        agregadoId: CONTA,
        payload: { contaId: CONTA },
      }),
    ]);
    expect(JSON.stringify(identidade.publicador.publicados)).not.toContain(EMAIL);
  });

  it('procura pelo e-mail normalizado', async () => {
    const { identidade, caso } = montar();
    await identidade.contas.inserir(novaConta());

    await caso.executar({ email: '  Dani@Exemplo.COM ' });

    expect(identidade.publicador.tipos).toEqual(['identidade.RecuperacaoSolicitada']);
  });

  it('admin criado pela CLI, ainda sem senha, também recebe (define a primeira senha por aqui)', async () => {
    const { identidade, caso } = montar();
    await identidade.contas.inserir(novaConta({ semSenha: true }));

    await caso.executar({ email: EMAIL });

    expect(identidade.publicador.tipos).toEqual(['identidade.RecuperacaoSolicitada']);
  });

  it.each([
    ['e-mail sem conta', null],
    ['conta desativada', { desativada: true }],
  ])('%s: resolve igual, sem evento (CA-06)', async (_caso, opcoes) => {
    const { identidade, caso } = montar();
    if (opcoes !== null) await identidade.contas.inserir(novaConta(opcoes));

    await expect(caso.executar({ email: EMAIL })).resolves.toBeUndefined();

    expect(identidade.publicador.publicados).toEqual([]);
  });

  it('nada muda na conta: o código nasce só no assinante (etapa 13)', async () => {
    const { identidade, caso } = montar();
    await identidade.contas.inserir(novaConta());
    const antes = identidade.contas.dadosDe(CONTA);

    await caso.executar({ email: EMAIL });

    expect(identidade.contas.dadosDe(CONTA)).toEqual(antes);
    expect(identidade.codigos.todos()).toEqual([]);
  });
});
