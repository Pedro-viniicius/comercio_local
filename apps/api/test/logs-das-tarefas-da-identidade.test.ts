// As tarefas diárias da Identidade com o logger de verdade do projeto (pino + redator), em
// vez de um espião (plano 01b, etapa 13; S81, S5, LGPD): o alerta dos 25 dias chega à linha
// do log com o id da conta e o prazo (um alerta que o redator engolisse não avisaria
// ninguém), e nenhuma linha de nenhuma tarefa leva nome, e-mail, telefone ou a mensagem do
// erro de um anonimizador.
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it } from 'vitest';
import { criarLoggerDaAplicacao } from '../src/compartilhado/log/logger.ts';
import { RelogioFixo } from '../src/compartilhado/tempo/relogio.ts';
import {
  type AnonimizadorDeTitular,
  RegistroDeAnonimizadores,
} from '../src/compartilhado/titular/anonimizador-de-titular.ts';
import { criarIdentidadeEmMemoria } from './fakes/identidade/repositorios-em-memoria.ts';
import { Conta } from '../src/modulos/identidade/dominio/conta.ts';
import { Email } from '../src/modulos/identidade/dominio/email.ts';
import { Telefone } from '../src/modulos/identidade/dominio/telefone.ts';
import { AnonimizadorDeIdentidade } from '../src/modulos/identidade/aplicacao/privacidade/anonimizador-identidade.ts';
import { AnonimizarContaCasoDeUso } from '../src/modulos/identidade/aplicacao/privacidade/anonimizar-conta.ts';
import { AnonimizarContasTarefa } from '../src/modulos/identidade/aplicacao/tarefas/anonimizar-contas.tarefa.ts';
import { ApagarContasNaoVerificadasTarefa } from '../src/modulos/identidade/aplicacao/tarefas/apagar-nao-verificadas.tarefa.ts';
import { ReterDadosDaIdentidadeTarefa } from '../src/modulos/identidade/aplicacao/tarefas/reter-dados.tarefa.ts';

const AGORA = new Date('2026-10-20T03:30:00.000Z');
const UM_DIA = 24 * 60 * 60 * 1000;
const NOME = 'Fulana Pessoa de Teste';
const EMAIL = 'fulana.da.silva@exemplo.com';
const TELEFONE_DIGITADO = '(35) 99876-5432';
const CONTA = 'b1b1b1b1-0000-4000-8000-000000000001';
const OUTRA = 'b1b1b1b1-0000-4000-8000-000000000002';

/** Um `PinoLogger` que repassa ao pino raiz do projeto, com o destino em memória. */
function loggerReal() {
  const linhas: string[] = [];
  const raiz = criarLoggerDaAplicacao(
    { LOG_NIVEL: 'info' },
    { write: (linha: string) => void linhas.push(linha) },
  );
  const repassar = (nivel: 'info' | 'warn' | 'error') => (dados: object, texto: string) =>
    raiz[nivel](dados, texto);
  const logger = {
    setContext: () => undefined,
    info: repassar('info'),
    warn: repassar('warn'),
    error: repassar('error'),
  } as unknown as PinoLogger;
  return {
    logger,
    linhas: () => linhas.map((linha) => JSON.parse(linha) as Record<string, unknown>),
    texto: () => linhas.join(''),
  };
}

class AnonimizadorQueFalha implements AnonimizadorDeTitular {
  readonly modulo = 'pedidos';
  anonimizar(): Promise<void> {
    return Promise.reject(new Error(`falha com ${EMAIL} e ${TELEFONE_DIGITADO} na mensagem`));
  }
}

function conta(id: string, criadaEm: Date, email = EMAIL): Conta {
  return Conta.criar({
    id,
    nome: NOME,
    email: Email.criar(email),
    telefone: Telefone.criar(TELEFONE_DIGITADO),
    senhaHash: 'hash-falso:senha',
    agora: criadaEm,
  });
}

function assertSemDadoPessoal(texto: string): void {
  for (const pessoal of [NOME, EMAIL, '99876', 'falha com']) {
    expect(texto).not.toContain(pessoal);
  }
}

describe('tarefas diárias com o logger real do projeto', () => {
  it('o alerta dos 25 dias sai com o id da conta e o prazo; a falha do anonimizador sai sem a mensagem', async () => {
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
    registro.registrar(new AnonimizadorQueFalha());
    const desativadaEm = new Date(AGORA.getTime() - 26 * UM_DIA);
    const pendente = conta(CONTA, new Date(AGORA.getTime() - 90 * UM_DIA));
    pendente.desativar(desativadaEm);
    await identidade.contas.inserir(pendente);
    await identidade.solicitacoes.inserir({
      id: 'b2b2b2b2-0000-4000-8000-000000000001',
      contaId: CONTA,
      tipo: 'exclusao',
      status: 'pendente',
      solicitadaEm: desativadaEm,
      concluidaEm: null,
    });
    const { logger, linhas, texto } = loggerReal();
    const tarefa = new AnonimizarContasTarefa(
      relogio,
      identidade.contas,
      identidade.solicitacoes,
      new AnonimizarContaCasoDeUso(
        identidade.unidade,
        identidade.contas,
        identidade.solicitacoes,
        registro,
        identidade.publicador,
        relogio,
      ),
      logger,
    );

    await tarefa.executar();

    const alerta = linhas().find((linha) => linha['level'] === 'warn');
    expect(alerta).toMatchObject({
      contaId: CONTA,
      prazoDeAnonimizacao: new Date(desativadaEm.getTime() + 30 * UM_DIA).toISOString(),
    });
    const falha = linhas().find((linha) => linha['level'] === 'error');
    expect(falha).toMatchObject({ contaId: CONTA, err: { tipo: 'FalhaNaAnonimizacao' } });
    expect(
      linhas().find((linha) => linha['msg'] === 'anonimização das exclusões concluída'),
    ).toMatchObject({ anonimizadas: 0, falhas: 1, alertas: 1 });
    assertSemDadoPessoal(texto());
  });

  it('o expurgo e a retenção registram só contadores', async () => {
    const identidade = criarIdentidadeEmMemoria();
    const relogio = new RelogioFixo(AGORA);
    await identidade.contas.inserir(conta(OUTRA, new Date(AGORA.getTime() - 8 * UM_DIA)));
    const { logger, linhas, texto } = loggerReal();

    await new ApagarContasNaoVerificadasTarefa(
      identidade.unidade,
      relogio,
      identidade.contas,
      logger,
    ).executar();
    await new ReterDadosDaIdentidadeTarefa(
      identidade.unidade,
      relogio,
      identidade.bloqueios,
      identidade.sessoes,
      identidade.codigos,
      identidade.exportacoes,
      logger,
    ).executar();

    const registros = linhas();
    expect(
      registros.find((r) => r['msg'] === 'expurgo de contas não verificadas concluído'),
    ).toMatchObject({
      apagadas: 1,
      mantidas: 0,
      recusadas: 0,
    });
    expect(registros.find((r) => r['msg'] === 'retenção da identidade concluída')).toMatchObject({
      freios: 0,
      sessoes: 0,
      codigos: 0,
      exportacoes: 0,
    });
    assertSemDadoPessoal(texto());
    expect(texto()).not.toContain(OUTRA);
  });
});
