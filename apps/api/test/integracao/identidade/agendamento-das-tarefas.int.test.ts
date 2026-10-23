// Agendamento das tarefas diárias da Identidade no worker (plano 01b, etapa 16, "Vindo do
// grupo D"): o `WorkerModule` completo, com o pg-boss do Postgres de teste, cria a fila e a
// agenda de cada uma das três tarefas (anonimização, expurgo das não verificadas e
// retenção), consome a fila chamando a tarefa registrada pelo `IdentidadeModule`, e a falha
// sai no log e na saída do job sem a mensagem do erro.
//
// As tarefas em si (o que apagam, anonimizam e retêm) têm os próprios testes (etapa 13): aqui
// elas são trocadas por espiões, para o teste não mexer nos dados de outros arquivos.
import { randomBytes } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PgBoss } from 'pg-boss';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { carregarAmbiente } from '../../../src/compartilhado/config/ambiente.ts';
import { nomeDaFila, RegistroDeAssinantes } from '../../../src/compartilhado/eventos/assinantes.ts';
import { RegistroDeAnonimizadores } from '../../../src/compartilhado/titular/anonimizador-de-titular.ts';
import { AnonimizarContasTarefa } from '../../../src/modulos/identidade/aplicacao/tarefas/anonimizar-contas.tarefa.ts';
import { ApagarContasNaoVerificadasTarefa } from '../../../src/modulos/identidade/aplicacao/tarefas/apagar-nao-verificadas.tarefa.ts';
import { ReterDadosDaIdentidadeTarefa } from '../../../src/modulos/identidade/aplicacao/tarefas/reter-dados.tarefa.ts';
import { TAREFAS_DIARIAS_DA_IDENTIDADE } from '../../../src/modulos/identidade/index.ts';
import {
  AJUSTES_PADRAO_DO_WORKER,
  TAREFAS_DIARIAS,
  WorkerModule,
} from '../../../src/worker.module.ts';
import { URL_APP_TESTE } from '../preparar-banco.ts';

const linhas: string[] = [];
const destinoDoLog = { write: (linha: string) => void linhas.push(linha) };
let modulo: TestingModule | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await modulo?.close();
  modulo = undefined;
});

function ambiente() {
  const chave = () => randomBytes(32).toString('base64');
  return carregarAmbiente({
    NODE_ENV: 'test',
    PORTA: '3000',
    DATABASE_URL: URL_APP_TESTE,
    CORS_ORIGENS: 'https://painel.bairrin.com.br',
    JWT_SEGREDO: chave(),
    CHAVE_CIFRAGEM_DADOS: chave(),
    CHAVE_HMAC: chave(),
    SMTP_URL: 'smtp://127.0.0.1:1025',
    EMAIL_REMETENTE: 'nao-responda@bairrin.com.br',
    LOG_NIVEL: 'info',
  });
}

async function esperarAte(condicao: () => Promise<boolean> | boolean, prazoEmMs = 15_000) {
  const limite = Date.now() + prazoEmMs;
  while (Date.now() < limite) {
    if (await condicao()) return;
    await new Promise((resolver) => setTimeout(resolver, 100));
  }
  throw new Error('a condição não se cumpriu no prazo');
}

describe('tarefas diárias da Identidade no worker', () => {
  it('as três tarefas da Identidade estão na lista do worker', () => {
    expect(TAREFAS_DIARIAS).toEqual(expect.arrayContaining([...TAREFAS_DIARIAS_DA_IDENTIDADE]));
    expect(TAREFAS_DIARIAS_DA_IDENTIDADE.map(({ tarefa }) => tarefa)).toEqual([
      AnonimizarContasTarefa,
      ApagarContasNaoVerificadasTarefa,
      ReterDadosDaIdentidadeTarefa,
    ]);
  });

  it('agenda cada uma uma vez por dia no fuso de Brasília, consome a fila e não registra a mensagem da falha', async () => {
    linhas.length = 0;
    modulo = await Test.createTestingModule({
      imports: [
        WorkerModule.registrar({
          ambiente: ambiente(),
          destinoDoLog,
          ajustes: {
            ...AJUSTES_PADRAO_DO_WORKER,
            intervaloDoRelayEmMs: 100,
            intervaloDasFilasEmSegundos: 0.5,
            supervisionar: false,
            agendarLimpeza: false,
            agendarTarefasDosModulos: true,
          },
        }),
      ],
    }).compile();

    const anonimizar = vi
      .spyOn(modulo.get(AnonimizarContasTarefa, { strict: false }), 'executar')
      .mockResolvedValue({ anonimizadas: 0, ignoradas: 0, falhas: 0, alertas: 0 });
    const apagar = vi
      .spyOn(modulo.get(ApagarContasNaoVerificadasTarefa, { strict: false }), 'executar')
      .mockResolvedValue({ apagadas: 0, mantidas: 0, recusadas: 0 });
    const reter = vi
      .spyOn(modulo.get(ReterDadosDaIdentidadeTarefa, { strict: false }), 'executar')
      .mockRejectedValue(
        Object.assign(new Error('falhou para maria@exemplo.com.br'), { code: 'ECONNRESET' }),
      );
    await modulo.init();

    const fila = modulo.get(PgBoss);
    // O `IdentidadeModule` registrou os cinco assinantes e o anonimizador, e o worker criou a
    // fila de cada assinante.
    const assinantes = modulo
      .get(RegistroDeAssinantes)
      .todos()
      .map(({ nome }) => nome)
      .filter((nome) => nome.startsWith('identidade.'))
      .sort();
    expect(assinantes).toEqual([
      'identidade.avisar-cadastro-repetido',
      'identidade.avisar-segundo-fator-freado',
      'identidade.enviar-codigo-de-recuperacao',
      'identidade.enviar-codigo-de-verificacao',
      'identidade.gerar-exportacao',
    ]);
    for (const nome of assinantes) {
      expect(await fila.getQueue(nomeDaFila(nome))).not.toBeNull();
    }
    expect(modulo.get(RegistroDeAnonimizadores).modulos()).toEqual(['identidade']);

    for (const { fila: nome, agenda } of TAREFAS_DIARIAS_DA_IDENTIDADE) {
      const agendas = await fila.getSchedules(nome);
      expect(agendas.map(({ name, cron, timezone }) => ({ name, cron, timezone }))).toEqual([
        { name: nome, cron: agenda.cron, timezone: 'America/Sao_Paulo' },
      ]);
    }

    const ids = new Map<string, string | null>();
    for (const { fila: nome } of TAREFAS_DIARIAS_DA_IDENTIDADE) {
      ids.set(nome, await fila.send(nome, {}));
    }
    await esperarAte(
      () =>
        anonimizar.mock.calls.length > 0 &&
        apagar.mock.calls.length > 0 &&
        reter.mock.calls.length > 0,
    );

    const filaDaRetencao = 'identidade.reter-dados';
    const idDaRetencao = ids.get(filaDaRetencao) ?? '';
    let saida: unknown;
    await esperarAte(async () => {
      const job = await fila.getJobById(filaDaRetencao, idDaRetencao);
      saida = job?.output;
      return job !== null && job.state !== 'active' && job.state !== 'created';
    });
    expect(JSON.stringify(saida)).toContain('ECONNRESET');
    expect(JSON.stringify(saida)).not.toContain('maria');

    await esperarAte(() => linhas.some((linha) => linha.includes('tarefa diária falhou')));
    const log = linhas.join('\n');
    expect(log).toContain(filaDaRetencao);
    expect(log).not.toContain('maria');
  });
});
