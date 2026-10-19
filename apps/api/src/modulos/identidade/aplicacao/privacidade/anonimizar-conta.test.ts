// Anonimização da conta desativada (CA-11, S5): passa por todos os
// anonimizadores registrados numa transação só, conclui a solicitação de
// exclusão e publica `ContaAnonimizada`; falha em qualquer módulo desfaz tudo.
import { describe, expect, it } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  type AnonimizadorDeTitular,
  FalhaNaAnonimizacao,
  RegistroDeAnonimizadores,
} from '../../../../compartilhado/titular/anonimizador-de-titular.ts';
import {
  criarIdentidadeEmMemoria,
  type IdentidadeEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import { Conta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import { Sessao } from '../../dominio/sessao.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { AnonimizadorDeIdentidade } from './anonimizador-identidade.ts';
import { AnonimizarContaCasoDeUso } from './anonimizar-conta.ts';

const CADASTRO = new Date('2026-09-01T12:00:00.000Z');
const EXCLUSAO = new Date('2026-10-01T12:00:00.000Z');
const AGORA = new Date('2026-10-18T12:00:00.000Z');
const CONTA = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';

/** Anonimizador de outro módulo (pedidos, por exemplo), que só registra as chamadas. */
class AnonimizadorDeOutroModulo implements AnonimizadorDeTitular {
  readonly modulo = 'pedidos';
  readonly chamadas: string[] = [];
  falhar = false;

  anonimizar(contaId: string): Promise<void> {
    this.chamadas.push(contaId);
    if (this.falhar) {
      return Promise.reject(new Error('falha com fulano@exemplo.com na mensagem'));
    }
    return Promise.resolve();
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
  const outro = new AnonimizadorDeOutroModulo();
  registro.registrar(outro);
  const caso = new AnonimizarContaCasoDeUso(
    identidade.unidade,
    identidade.contas,
    identidade.solicitacoes,
    registro,
    identidade.publicador,
    relogio,
  );
  return { identidade, outro, caso };
}

async function inserirConta(identidade: IdentidadeEmMemoria, desativar: boolean): Promise<void> {
  const conta = Conta.criar({
    id: CONTA,
    nome: 'Ana Souza',
    email: Email.criar('ana@exemplo.com'),
    telefone: Telefone.criar('35999991234'),
    senhaHash: 'hash-da-senha',
    agora: CADASTRO,
  });
  if (desativar) conta.desativar(EXCLUSAO);
  await identidade.contas.inserir(conta);
  await identidade.sessoes.inserir(
    Sessao.criar({
      id: 'sessao-da-ana',
      contaId: CONTA,
      cliente: 'app_consumidor',
      tokenHash: 'token-da-ana',
      mfa: false,
      agora: CADASTRO,
    }),
  );
  if (desativar) {
    await identidade.solicitacoes.inserir({
      id: 'solicitacao-da-ana',
      contaId: CONTA,
      tipo: 'exclusao',
      status: 'pendente',
      solicitadaEm: EXCLUSAO,
      concluidaEm: null,
    });
  }
}

describe('AnonimizarContaCasoDeUso', () => {
  it('anonimiza em todos os módulos, conclui a solicitação e publica ContaAnonimizada', async () => {
    const { identidade, outro, caso } = montar();
    await inserirConta(identidade, true);

    await expect(caso.executar({ contaId: CONTA })).resolves.toEqual({ tipo: 'anonimizada' });

    expect(identidade.contas.dadosDe(CONTA)).toMatchObject({
      status: 'anonimizada',
      telefoneE164: null,
      senhaHash: null,
      anonimizadaEm: AGORA,
    });
    expect(identidade.sessoes.todas()).toEqual([]);
    expect(outro.chamadas).toEqual([CONTA]);
    expect(identidade.solicitacoes.todas()).toEqual([
      {
        id: 'solicitacao-da-ana',
        contaId: CONTA,
        tipo: 'exclusao',
        status: 'concluida',
        solicitadaEm: EXCLUSAO,
        concluidaEm: AGORA,
      },
    ]);
    expect(identidade.publicador.publicados).toEqual([
      {
        tipo: 'identidade.ContaAnonimizada',
        versao: 1,
        agregadoId: CONTA,
        payload: { contaId: CONTA },
      },
    ]);
  });

  it('falha em outro módulo desfaz a anonimização da Identidade e rejeita sem a mensagem original', async () => {
    const { identidade, outro, caso } = montar();
    await inserirConta(identidade, true);
    outro.falhar = true;

    const erro = await caso.executar({ contaId: CONTA }).then(
      () => new Error('deveria falhar'),
      (falha: unknown) => falha as Error,
    );

    expect(erro).toBeInstanceOf(FalhaNaAnonimizacao);
    expect(erro.message).toContain('pedidos');
    expect(erro.message).not.toContain('fulano');
    expect(identidade.contas.dadosDe(CONTA)).toMatchObject({
      status: 'desativada',
      nome: 'Ana Souza',
      telefoneE164: '+5535999991234',
    });
    expect(identidade.sessoes.todas()).toHaveLength(1);
    expect(identidade.solicitacoes.todas()[0]?.status).toBe('pendente');
    expect(identidade.publicador.publicados).toEqual([]);

    // A próxima tentativa roda do início e conclui.
    outro.falhar = false;
    await expect(caso.executar({ contaId: CONTA })).resolves.toEqual({ tipo: 'anonimizada' });
  });

  it('conta ativa é recusada sem chamar nenhum anonimizador', async () => {
    const { identidade, outro, caso } = montar();
    await inserirConta(identidade, false);

    await expect(caso.executar({ contaId: CONTA })).resolves.toEqual({ tipo: 'conta_ativa' });

    expect(identidade.contas.dadosDe(CONTA)?.status).toBe('ativa');
    expect(identidade.sessoes.todas()).toHaveLength(1);
    expect(outro.chamadas).toEqual([]);
    expect(identidade.publicador.publicados).toEqual([]);
  });

  it('conta já anonimizada: nada a fazer, nenhum evento repetido', async () => {
    const { identidade, outro, caso } = montar();
    await inserirConta(identidade, true);
    await caso.executar({ contaId: CONTA });

    await expect(caso.executar({ contaId: CONTA })).resolves.toEqual({ tipo: 'ja_anonimizada' });

    expect(outro.chamadas).toEqual([CONTA]);
    expect(identidade.publicador.tipos).toEqual(['identidade.ContaAnonimizada']);
  });

  it('duas anonimizações simultâneas da mesma conta: uma anonimiza, a outra acha feito, e o evento sai uma vez (Q24)', async () => {
    const { identidade, outro, caso } = montar();
    await inserirConta(identidade, true);

    const resultados = await Promise.all([
      caso.executar({ contaId: CONTA }),
      caso.executar({ contaId: CONTA }),
    ]);

    expect(resultados.map((r) => r.tipo).sort()).toEqual(['anonimizada', 'ja_anonimizada']);
    expect(outro.chamadas).toEqual([CONTA]);
    expect(identidade.publicador.tipos).toEqual(['identidade.ContaAnonimizada']);
  });

  it('conta inexistente', async () => {
    const { outro, caso } = montar();
    await expect(caso.executar({ contaId: CONTA })).resolves.toEqual({ tipo: 'inexistente' });
    expect(outro.chamadas).toEqual([]);
  });
});
