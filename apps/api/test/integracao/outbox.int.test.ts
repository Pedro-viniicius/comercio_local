// Integração da outbox e do relay (CA-F5; ADR-011; S4, S5) contra o Postgres
// de teste, no papel `bairrin_app`, com o pg-boss migrado pelo `globalSetup`.
// Cada "pilha" (Prisma + pg-boss) faz o papel de um processo do worker: duas
// pilhas ao mesmo tempo são dois workers concorrentes.
//
// Provas: evento gravado na transação do caso de uso chega uma única vez a
// cada assinante, mesmo com dois relays e dois consumidores; falha do
// assinante gera nova tentativa (e desfaz o que ele gravou); rollback não
// publica nada; retenção de 30 dias na outbox e 7 nos jobs.
import { randomBytes, randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { PinoLogger } from 'nestjs-pino';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositorioDeAuditoria } from '../../src/compartilhado/auditoria/repositorio-de-auditoria.ts';
import { type Ambiente, carregarAmbiente } from '../../src/compartilhado/config/ambiente.ts';
import {
  type Assinante,
  EntregadorDeEventos,
  type EventoPublicado,
  nomeDaFila,
  RegistroDeAssinantes,
} from '../../src/compartilhado/eventos/assinantes.ts';
import {
  FILA_DA_LIMPEZA,
  TarefaDeLimpeza,
} from '../../src/compartilhado/eventos/limpeza.tarefa.ts';
import {
  type EventoDeDominio,
  PublicadorDeEventos,
} from '../../src/compartilhado/eventos/publicador.ts';
import { RelayDaOutbox } from '../../src/compartilhado/eventos/relay.ts';
import { criarPgBoss, SCHEMA_DO_PG_BOSS } from '../../src/compartilhado/infra/pg-boss.ts';
import { PrismaService } from '../../src/compartilhado/infra/prisma.service.ts';
import { PublicadorDeEventosNaOutbox } from '../../src/compartilhado/infra/publicador-na-outbox.ts';
import { RepositorioDeAuditoriaPrisma } from '../../src/compartilhado/infra/repositorio-de-auditoria-prisma.ts';
import { UnidadeDeTrabalhoPrisma } from '../../src/compartilhado/infra/unidade-de-trabalho-prisma.ts';
import {
  type Relogio,
  RelogioDoSistema,
  RelogioFixo,
} from '../../src/compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../src/compartilhado/transacao/unidade-de-trabalho.ts';
import {
  AJUSTES_PADRAO_DO_WORKER,
  type AjustesDoWorker,
  opcoesDaFilaDeAssinante,
  WorkerModule,
} from '../../src/worker.module.ts';
import { URL_APP_TESTE, URL_MIGRACAO_TESTE } from './preparar-banco.ts';

const UM_DIA_EM_MS = 24 * 60 * 60 * 1_000;

/** Ajustes rápidos para teste: consulta a cada 0,5 s e nova tentativa sem espera. */
const AJUSTES_DE_TESTE: AjustesDoWorker = {
  ...AJUSTES_PADRAO_DO_WORKER,
  intervaloDoRelayEmMs: 100,
  intervaloDasFilasEmSegundos: 0.5,
  retentativas: { limite: 3, esperaEmSegundos: 0, exponencial: false },
  supervisionar: false,
  agendarLimpeza: false,
};

/** Logger silencioso no formato do PinoLogger (os registros reais estão no teste do worker). */
function loggerSilencioso(): PinoLogger {
  const nada = () => undefined;
  return {
    setContext: nada,
    trace: nada,
    debug: nada,
    info: nada,
    warn: nada,
    error: nada,
    fatal: nada,
  } as unknown as PinoLogger;
}

/** Um "processo" do worker: Prisma e pg-boss próprios (pools separados). */
interface Pilha {
  prisma: PrismaService;
  unidade: UnidadeDeTrabalhoPrisma;
  publicador: PublicadorDeEventosNaOutbox;
  auditoria: RepositorioDeAuditoriaPrisma;
  fila: PgBoss;
  relay: RelayDaOutbox;
  entregador: EntregadorDeEventos;
}

const pilhas: Pilha[] = [];
let dono: pg.Client;

beforeAll(async () => {
  dono = new pg.Client({ connectionString: URL_MIGRACAO_TESTE });
  await dono.connect();
});

afterAll(async () => {
  await dono?.end();
});

beforeEach(async () => {
  // A outbox é comum a todos os testes de integração: cada teste começa vazio.
  await dono.query('DELETE FROM compartilhado.outbox');
});

afterEach(async () => {
  for (const pilha of pilhas.splice(0)) {
    await pilha.relay.parar();
    await pilha.fila.stop({ graceful: false, timeout: 1_000 });
    await pilha.prisma.$disconnect();
  }
});

async function montarPilha(
  assinantes: RegistroDeAssinantes,
  relogio: Relogio = new RelogioDoSistema(),
): Promise<Pilha> {
  const logger = loggerSilencioso();
  const prisma = new PrismaService({ DATABASE_URL: URL_APP_TESTE } as Ambiente, logger);
  const unidade = new UnidadeDeTrabalhoPrisma(prisma);
  const fila = criarPgBoss(URL_APP_TESTE, logger, {
    supervisionar: false,
    agendar: false,
    conexoes: 3,
  });
  await fila.start();
  const pilha: Pilha = {
    prisma,
    unidade,
    publicador: new PublicadorDeEventosNaOutbox(unidade, relogio),
    auditoria: new RepositorioDeAuditoriaPrisma(unidade, relogio),
    fila,
    relay: new RelayDaOutbox(unidade, fila, assinantes, relogio, logger),
    entregador: new EntregadorDeEventos(unidade, relogio, logger),
  };
  pilhas.push(pilha);
  return pilha;
}

/** Cria a fila de cada assinante como o worker cria (política `exclusive`). */
async function criarFilas(pilha: Pilha, assinantes: RegistroDeAssinantes): Promise<void> {
  const opcoes = opcoesDaFilaDeAssinante(AJUSTES_DE_TESTE);
  for (const assinante of assinantes.todos()) {
    await pilha.fila.createQueue(nomeDaFila(assinante.nome), { policy: 'exclusive', ...opcoes });
  }
}

/** Consome as filas dos assinantes nesta pilha, como o `ProcessoDoWorker`. */
async function consumir(pilha: Pilha, assinantes: RegistroDeAssinantes): Promise<void> {
  for (const assinante of assinantes.todos()) {
    await pilha.fila.work<EventoPublicado>(
      nomeDaFila(assinante.nome),
      { pollingIntervalSeconds: AJUSTES_DE_TESTE.intervaloDasFilasEmSegundos, batchSize: 1 },
      async ([job]) => {
        if (job !== undefined) await pilha.entregador.entregar(assinante, job.data);
      },
    );
  }
}

/** Nome de assinante único por teste (as filas do pg-boss ficam entre testes). */
function nomeUnico(base: string): string {
  return `teste.${base}-${randomBytes(4).toString('hex')}`;
}

/** Assinante que conta as chamadas por evento e pode falhar ou gravar auditoria. */
function assinanteContador(
  nome: string,
  eventos: string[],
  comportamento: (evento: EventoPublicado, tentativa: number) => Promise<void> = () =>
    Promise.resolve(),
) {
  const chamadas = new Map<string, number>();
  const assinante: Assinante = {
    nome,
    eventos,
    tratar: async (evento) => {
      const tentativa = (chamadas.get(evento.id) ?? 0) + 1;
      chamadas.set(evento.id, tentativa);
      await comportamento(evento, tentativa);
    },
  };
  return { assinante, chamadas };
}

function evento(tipo: string, extra: Partial<EventoDeDominio> = {}): EventoDeDominio {
  const agregadoId = randomUUID();
  return { tipo, versao: 1, agregadoId, payload: { contaId: agregadoId }, ...extra };
}

/** Publica cada evento no seu próprio "caso de uso" (uma transação cada). */
async function publicarEmTransacoes(pilha: Pilha, eventos: EventoDeDominio[]): Promise<void> {
  for (const item of eventos) {
    await pilha.unidade.executar(() => pilha.publicador.publicar(item));
  }
}

async function esperarAte(condicao: () => Promise<boolean>, prazoEmMs = 15_000): Promise<void> {
  const limite = Date.now() + prazoEmMs;
  while (!(await condicao())) {
    if (Date.now() > limite) throw new Error('Condição não atingida no prazo.');
    await new Promise((resolver) => setTimeout(resolver, 100));
  }
}

async function contar(sql: string, parametros: unknown[] = []): Promise<number> {
  const { rows } = await dono.query<{ total: number }>(`SELECT (${sql})::int AS total`, parametros);
  return rows[0]?.total ?? -1;
}

async function pendentesNaOutbox(): Promise<number> {
  return contar('SELECT count(*) FROM compartilhado.outbox WHERE publicado_em IS NULL');
}

async function jobsDaFila(
  fila: string,
): Promise<{ chave: string; estado: string; saida: string | null }[]> {
  const { rows } = await dono.query<{ chave: string; estado: string; saida: string | null }>(
    `SELECT singleton_key AS chave, state::text AS estado, output::text AS saida
       FROM ${SCHEMA_DO_PG_BOSS}.job WHERE name = $1`,
    [fila],
  );
  return rows;
}

async function processadosPor(assinante: string): Promise<number> {
  return contar('SELECT count(*) FROM compartilhado.eventos_processados WHERE assinante = $1', [
    assinante,
  ]);
}

describe('publicação na transação do caso de uso', () => {
  it('rollback do caso de uso não grava o evento nem publica nada', async () => {
    const { assinante, chamadas } = assinanteContador(nomeUnico('rollback'), ['teste.Desfeito']);
    const registro = new RegistroDeAssinantes();
    registro.registrar(assinante);
    const pilha = await montarPilha(registro);
    await criarFilas(pilha, registro);
    const desfeito = evento('teste.Desfeito');

    await expect(
      pilha.unidade.executar(async () => {
        await pilha.publicador.publicar(desfeito);
        await pilha.auditoria.registrar({
          atorTipo: 'sistema',
          atorId: null,
          acao: 'teste_desfeito',
          recurso: 'teste',
          recursoId: desfeito.agregadoId,
          origem: 'worker',
        });
        throw new Error('regra de negócio recusou');
      }),
    ).rejects.toThrow('regra de negócio recusou');

    expect(
      await contar('SELECT count(*) FROM compartilhado.outbox WHERE agregado_id = $1', [
        desfeito.agregadoId,
      ]),
    ).toBe(0);
    expect(
      await contar('SELECT count(*) FROM compartilhado.auditoria WHERE recurso_id = $1', [
        desfeito.agregadoId,
      ]),
    ).toBe(0);
    expect(await pilha.relay.publicarLote()).toBe(0);
    expect(await jobsDaFila(nomeDaFila(assinante.nome))).toEqual([]);
    expect(chamadas.size).toBe(0);
  });

  it('commit grava evento e auditoria juntos, com a hora do relógio e sem publicar ainda', async () => {
    const relogio = new RelogioFixo(new Date('2026-10-16T12:00:00.000Z'));
    const pilha = await montarPilha(new RegistroDeAssinantes(), relogio);
    const confirmado = evento('teste.Confirmado');

    await pilha.unidade.executar(async () => {
      await pilha.publicador.publicar(confirmado);
      await pilha.auditoria.registrar({
        atorTipo: 'sistema',
        atorId: null,
        acao: 'teste_confirmado',
        recurso: 'teste',
        recursoId: confirmado.agregadoId,
        depois: { email: { alterado: true }, status: 'ativo' },
        origem: 'worker',
      });
    });

    const { rows } = await dono.query<{ ocorrido: Date; publicado: Date | null; payload: unknown }>(
      `SELECT ocorrido_em AS ocorrido, publicado_em AS publicado, payload
         FROM compartilhado.outbox WHERE agregado_id = $1`,
      [confirmado.agregadoId],
    );
    expect(rows).toEqual([
      { ocorrido: relogio.agora(), publicado: null, payload: { contaId: confirmado.agregadoId } },
    ]);
    const auditoria = await dono.query<{ depois: unknown; ocorrido: Date }>(
      'SELECT depois, ocorrido_em AS ocorrido FROM compartilhado.auditoria WHERE recurso_id = $1',
      [confirmado.agregadoId],
    );
    expect(auditoria.rows).toEqual([
      { depois: { email: { alterado: true }, status: 'ativo' }, ocorrido: relogio.agora() },
    ]);
  });
});

describe('relay da outbox', () => {
  it('pula as linhas travadas por outro relay (FOR UPDATE SKIP LOCKED) sem esperar', async () => {
    const pilha = await montarPilha(new RegistroDeAssinantes());
    const eventos = [evento('teste.Travado'), evento('teste.Travado'), evento('teste.Travado')];
    await publicarEmTransacoes(pilha, eventos);

    // Outro "relay" segura a trava do primeiro evento numa transação aberta.
    const outro = new pg.Client({ connectionString: URL_MIGRACAO_TESTE });
    await outro.connect();
    let lote: Promise<number> | undefined;
    try {
      await outro.query('BEGIN');
      await outro.query('SELECT id FROM compartilhado.outbox WHERE agregado_id = $1 FOR UPDATE', [
        eventos[0]?.agregadoId,
      ]);
      // Sem SKIP LOCKED o relay ficaria esperando a trava: o prazo transforma
      // a espera em falha do teste em vez de travar a execução.
      lote = pilha.relay.publicarLote();
      const resultado = await Promise.race([
        lote,
        new Promise<'esperou a trava'>((resolver) =>
          setTimeout(() => resolver('esperou a trava'), 3_000),
        ),
      ]);
      expect(resultado).toBe(2);
      expect(await pendentesNaOutbox()).toBe(1);
    } finally {
      await outro.query('ROLLBACK');
      await outro.end();
      await lote?.catch(() => undefined);
    }
    expect(await pilha.relay.publicarLote()).toBe(1);
    expect(await pendentesNaOutbox()).toBe(0);
  });

  it('dois relays concorrentes criam exatamente um job por evento e assinante (CA-F5)', async () => {
    const tipo = 'teste.Concorrido';
    const a = assinanteContador(nomeUnico('relay-a'), [tipo]);
    const b = assinanteContador(nomeUnico('relay-b'), [tipo]);
    const registro = new RegistroDeAssinantes();
    registro.registrar(a.assinante);
    registro.registrar(b.assinante);
    const primeiro = await montarPilha(registro);
    const segundo = await montarPilha(registro);
    await criarFilas(primeiro, registro);
    const total = 60;
    const eventos = Array.from({ length: total }, () => evento(tipo));
    await publicarEmTransacoes(primeiro, eventos);
    // O id do evento entregue é o id da linha da outbox.
    const { rows: linhas } = await dono.query<{ id: string }>(
      'SELECT id FROM compartilhado.outbox',
    );
    expect(linhas).toHaveLength(total);

    // Lotes pequenos para os dois relays se cruzarem várias vezes.
    const publicados = [0, 0];
    const rodar = async (pilha: Pilha, indice: 0 | 1) => {
      for (;;) {
        const lote = await pilha.relay.publicarLote(7);
        if (lote === 0) return;
        publicados[indice] = (publicados[indice] ?? 0) + lote;
      }
    };
    await Promise.all([rodar(primeiro, 0), rodar(segundo, 1)]);

    expect((publicados[0] ?? 0) + (publicados[1] ?? 0)).toBe(total);
    expect(await pendentesNaOutbox()).toBe(0);
    for (const { assinante } of [a, b]) {
      const jobs = await jobsDaFila(nomeDaFila(assinante.nome));
      expect(jobs).toHaveLength(total);
      expect(new Set(jobs.map((job) => job.chave)).size).toBe(total);
      expect(new Set(jobs.map((job) => job.chave))).toEqual(
        new Set(linhas.map((linha) => `${linha.id}.${assinante.nome}`)),
      );
    }
  });

  it('dois workers completos entregam cada evento uma única vez a cada assinante (CA-F5)', async () => {
    const tipo = 'teste.Entregue';
    const a = assinanteContador(nomeUnico('entrega-a'), [tipo]);
    const b = assinanteContador(nomeUnico('entrega-b'), [tipo]);
    const registro = new RegistroDeAssinantes();
    registro.registrar(a.assinante);
    registro.registrar(b.assinante);
    const primeiro = await montarPilha(registro);
    const segundo = await montarPilha(registro);
    await criarFilas(primeiro, registro);
    await consumir(primeiro, registro);
    await consumir(segundo, registro);
    primeiro.relay.iniciar(AJUSTES_DE_TESTE.intervaloDoRelayEmMs);
    segundo.relay.iniciar(AJUSTES_DE_TESTE.intervaloDoRelayEmMs);

    const total = 20;
    const eventos = Array.from({ length: total }, () => evento(tipo));
    await publicarEmTransacoes(primeiro, eventos);

    await esperarAte(
      async () =>
        (await processadosPor(a.assinante.nome)) === total &&
        (await processadosPor(b.assinante.nome)) === total,
    );
    // Folga para uma eventual entrega repetida aparecer.
    await new Promise((resolver) => setTimeout(resolver, 1_500));

    for (const { chamadas } of [a, b]) {
      expect(chamadas.size).toBe(total);
      expect([...chamadas.values()].every((vezes) => vezes === 1)).toBe(true);
    }
    expect(await processadosPor(a.assinante.nome)).toBe(total);
    expect(await processadosPor(b.assinante.nome)).toBe(total);
  });

  it('falha ao criar o job do segundo assinante desfaz o lote: evento pendente e nenhum job (CA-F5)', async () => {
    const tipo = 'teste.FalhaNoRelay';
    const a = assinanteContador(nomeUnico('atomico-a'), [tipo]);
    const b = assinanteContador(nomeUnico('atomico-b'), [tipo]);
    const registro = new RegistroDeAssinantes();
    registro.registrar(a.assinante);
    registro.registrar(b.assinante);
    const pilha = await montarPilha(registro);
    await criarFilas(pilha, registro);
    await publicarEmTransacoes(pilha, [evento(tipo)]);

    const enviarDeVerdade = pilha.fila.send.bind(pilha.fila) as (...args: unknown[]) => unknown;
    let chamadas = 0;
    const espiao = vi.spyOn(pilha.fila, 'send').mockImplementation(((...args: unknown[]) => {
      chamadas += 1;
      if (chamadas === 2) return Promise.reject(new Error('falha simulada no pg-boss'));
      return enviarDeVerdade(...args);
    }) as never);

    await expect(pilha.relay.publicarLote()).rejects.toThrow('falha simulada no pg-boss');
    // O job do primeiro assinante entrou na mesma transação do lote: volta junto.
    expect(await pendentesNaOutbox()).toBe(1);
    expect(await jobsDaFila(nomeDaFila(a.assinante.nome))).toEqual([]);
    expect(await jobsDaFila(nomeDaFila(b.assinante.nome))).toEqual([]);

    // Passada a falha, a nova tentativa publica o evento uma vez para cada assinante.
    espiao.mockRestore();
    expect(await pilha.relay.publicarLote()).toBe(1);
    expect(await pendentesNaOutbox()).toBe(0);
    expect(await jobsDaFila(nomeDaFila(a.assinante.nome))).toHaveLength(1);
    expect(await jobsDaFila(nomeDaFila(b.assinante.nome))).toHaveLength(1);
  });

  it('evento sem assinante sai da outbox sem criar job', async () => {
    const pilha = await montarPilha(new RegistroDeAssinantes());
    await publicarEmTransacoes(pilha, [evento('teste.SemAssinante')]);
    expect(await pilha.relay.publicarLote()).toBe(1);
    expect(await pendentesNaOutbox()).toBe(0);
  });
});

describe('entrega ao assinante', () => {
  it('a mesma entrega duas vezes, ao mesmo tempo, roda o assinante uma vez só', async () => {
    const { assinante, chamadas } = assinanteContador(nomeUnico('dedup'), ['teste.Repetido']);
    const registro = new RegistroDeAssinantes();
    registro.registrar(assinante);
    const primeiro = await montarPilha(registro);
    const segundo = await montarPilha(registro);
    const publicado: EventoPublicado = {
      id: randomUUID(),
      tipo: 'teste.Repetido',
      versao: 1,
      agregadoId: randomUUID(),
      payload: {},
      ocorridoEm: new Date().toISOString(),
    };

    const resultados = await Promise.all([
      primeiro.entregador.entregar(assinante, publicado),
      segundo.entregador.entregar(assinante, publicado),
    ]);
    expect(resultados.sort()).toEqual(['repetido', 'tratado']);
    expect(await primeiro.entregador.entregar(assinante, publicado)).toBe('repetido');
    expect(chamadas.get(publicado.id)).toBe(1);
    expect(await processadosPor(assinante.nome)).toBe(1);
  });

  it('falha do assinante gera nova tentativa e desfaz o que ele gravou (CA-F5)', async () => {
    const tipo = 'teste.Instavel';
    const registro = new RegistroDeAssinantes();
    const pilha = await montarPilha(registro);
    const { assinante, chamadas } = assinanteContador(
      nomeUnico('retentativa'),
      [tipo],
      async (recebido, tentativa) => {
        // Grava na transação da entrega; na primeira tentativa, falha depois de gravar.
        await pilha.auditoria.registrar({
          atorTipo: 'sistema',
          atorId: null,
          acao: 'teste_tratado',
          recurso: 'teste',
          recursoId: recebido.id,
          origem: 'worker',
        });
        if (tentativa === 1) {
          throw Object.assign(new Error('SMTP recusou maria@exemplo.com.br'), {
            code: 'EENVELOPE',
          });
        }
      },
    );
    registro.registrar(assinante);
    await criarFilas(pilha, registro);
    await consumir(pilha, registro);
    await publicarEmTransacoes(pilha, [evento(tipo)]);
    expect(await pilha.relay.publicarLote()).toBe(1);

    await esperarAte(async () => (await processadosPor(assinante.nome)) === 1);
    const [eventoId] = [...chamadas.keys()];
    expect(chamadas.get(eventoId ?? '')).toBe(2);
    // A gravação da tentativa que falhou foi desfeita: sobra uma.
    expect(
      await contar('SELECT count(*) FROM compartilhado.auditoria WHERE recurso_id = $1', [
        eventoId,
      ]),
    ).toBe(1);
    await esperarAte(
      async () => (await jobsDaFila(nomeDaFila(assinante.nome)))[0]?.estado === 'completed',
    );
  });

  it('esgotadas as tentativas, o job falha com erro sem a mensagem original', async () => {
    const tipo = 'teste.SempreFalha';
    const { assinante, chamadas } = assinanteContador(nomeUnico('falha'), [tipo], () =>
      Promise.reject(
        Object.assign(new Error('senha-smtp-vazada maria@exemplo.com.br'), { code: 'EAUTH' }),
      ),
    );
    const registro = new RegistroDeAssinantes();
    registro.registrar(assinante);
    const pilha = await montarPilha(registro);
    await criarFilas(pilha, registro);
    await consumir(pilha, registro);
    await publicarEmTransacoes(pilha, [evento(tipo)]);
    await pilha.relay.publicarLote();

    const fila = nomeDaFila(assinante.nome);
    await esperarAte(async () => (await jobsDaFila(fila))[0]?.estado === 'failed');
    const [job] = await jobsDaFila(fila);
    // Primeira tentativa + `limite` novas tentativas.
    expect([...chamadas.values()]).toEqual([AJUSTES_DE_TESTE.retentativas.limite + 1]);
    expect(job?.saida).toContain('FalhaNoAssinante');
    expect(job?.saida).toContain('EAUTH');
    expect(job?.saida).not.toContain('senha-smtp-vazada');
    expect(job?.saida).not.toContain('maria');
    expect(await processadosPor(assinante.nome)).toBe(0);
  });
});

describe('limpeza de retenção (S5)', () => {
  it('apaga da outbox o publicado há mais de 30 dias e mantém o resto', async () => {
    const agora = new Date('2026-10-16T12:00:00.000Z');
    const pilha = await montarPilha(new RegistroDeAssinantes(), new RelogioFixo(agora));
    const inserir = async (publicadoEm: Date | null, ocorridoEm: Date) => {
      const { rows } = await dono.query<{ id: string }>(
        `INSERT INTO compartilhado.outbox (tipo, versao, agregado_id, payload, ocorrido_em, publicado_em)
         VALUES ('teste.Retido', 1, gen_random_uuid(), '{}', $1, $2) RETURNING id`,
        [ocorridoEm, publicadoEm],
      );
      return rows[0]?.id;
    };
    const antigo = await inserir(
      new Date(agora.getTime() - 31 * UM_DIA_EM_MS),
      new Date(agora.getTime() - 40 * UM_DIA_EM_MS),
    );
    const recente = await inserir(
      new Date(agora.getTime() - 29 * UM_DIA_EM_MS),
      new Date(agora.getTime() - 29 * UM_DIA_EM_MS),
    );
    const pendente = await inserir(null, new Date(agora.getTime() - 60 * UM_DIA_EM_MS));

    const limpeza = new TarefaDeLimpeza(pilha.unidade, new RelogioFixo(agora), loggerSilencioso());
    const resultado = await limpeza.executar();

    expect(resultado.eventosApagados).toBe(1);
    const { rows } = await dono.query<{ id: string }>('SELECT id FROM compartilhado.outbox');
    expect(rows.map((linha) => linha.id).sort()).toEqual([recente, pendente].sort());
    expect(rows.map((linha) => linha.id)).not.toContain(antigo);
  });

  it('apaga do pg-boss os jobs encerrados há mais de 7 dias e mantém os pendentes', async () => {
    const pilha = await montarPilha(new RegistroDeAssinantes());
    const fila = `teste.retencao-${randomBytes(4).toString('hex')}`;
    await pilha.fila.createQueue(fila, { retryLimit: 0 });
    const concluido = await pilha.fila.send(fila, { contaId: randomUUID() });
    const falhou = await pilha.fila.send(fila, { contaId: randomUUID() });
    const cancelado = await pilha.fila.send(fila, { contaId: randomUUID() });
    const pendente = await pilha.fila.send(fila, { contaId: randomUUID() }, { startAfter: 3_600 });
    const buscados = await pilha.fila.fetch(fila, { batchSize: 2 });
    expect(buscados.map((job) => job.id).sort()).toEqual([concluido, falhou].sort());
    await pilha.fila.complete(fila, concluido ?? '');
    await pilha.fila.fail(fila, falhou ?? '');
    await pilha.fila.cancel(fila, cancelado ?? '');
    const estados = async () => {
      const { rows } = await dono.query<{ id: string; estado: string }>(
        `SELECT id, state::text AS estado FROM ${SCHEMA_DO_PG_BOSS}.job WHERE name = $1`,
        [fila],
      );
      return Object.fromEntries(rows.map((linha) => [linha.id, linha.estado]));
    };
    expect(await estados()).toEqual({
      [concluido ?? '']: 'completed',
      [falhou ?? '']: 'failed',
      [cancelado ?? '']: 'cancelled',
      [pendente ?? '']: 'created',
    });

    // Encerrados agora: com o relógio 6 dias à frente, ainda ficam.
    const daqui = (dias: number) => new RelogioFixo(new Date(Date.now() + dias * UM_DIA_EM_MS));
    await new TarefaDeLimpeza(pilha.unidade, daqui(6), loggerSilencioso()).executar();
    expect(Object.keys(await estados())).toHaveLength(4);

    // 8 dias à frente: os três encerrados saem; o pendente fica.
    const resultado = await new TarefaDeLimpeza(
      pilha.unidade,
      daqui(8),
      loggerSilencioso(),
    ).executar();
    expect(resultado.jobsApagados).toBeGreaterThanOrEqual(3);
    expect(await estados()).toEqual({ [pendente ?? '']: 'created' });
  });
});

describe('WorkerModule (montagem completa do worker)', () => {
  const linhas: string[] = [];
  const destinoDoLog = { write: (linha: string) => void linhas.push(linha) };
  let modulo: TestingModule | undefined;

  afterEach(async () => {
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

  it('sobe, agenda a limpeza, entrega o evento com nova tentativa e não registra a mensagem do erro', async () => {
    linhas.length = 0;
    modulo = await Test.createTestingModule({
      imports: [
        WorkerModule.registrar({
          ambiente: ambiente(),
          destinoDoLog,
          ajustes: { ...AJUSTES_DE_TESTE, agendarLimpeza: true },
        }),
      ],
    }).compile();

    const tipo = 'teste.PeloWorker';
    const auditoria = modulo.get(RepositorioDeAuditoria);
    const { assinante, chamadas } = assinanteContador(
      nomeUnico('worker'),
      [tipo],
      async (recebido, tentativa) => {
        if (tentativa === 1) {
          throw Object.assign(new Error('falhou para maria@exemplo.com.br'), {
            code: 'ECONNECTION',
          });
        }
        await auditoria.registrar({
          atorTipo: 'sistema',
          atorId: null,
          acao: 'teste_pelo_worker',
          recurso: 'teste',
          recursoId: recebido.id,
          origem: 'worker',
        });
      },
    );
    // Como um módulo de contexto faria no `onModuleInit`.
    modulo.get(RegistroDeAssinantes).registrar(assinante);
    await modulo.init();

    const unidade = modulo.get(UnidadeDeTrabalho);
    const publicador = modulo.get(PublicadorDeEventos);
    await unidade.executar(() => publicador.publicar(evento(tipo)));

    await esperarAte(async () => (await processadosPor(assinante.nome)) === 1);
    expect([...chamadas.values()]).toEqual([2]);
    const [eventoId] = [...chamadas.keys()];
    expect(
      await contar('SELECT count(*) FROM compartilhado.auditoria WHERE recurso_id = $1', [
        eventoId,
      ]),
    ).toBe(1);

    const agendas = await modulo.get(PgBoss).getSchedules(FILA_DA_LIMPEZA);
    expect(agendas.map((agenda) => agenda.name)).toEqual([FILA_DA_LIMPEZA]);

    const log = linhas.join('\n');
    expect(log).toContain('assinante falhou');
    expect(log).toContain('ECONNECTION');
    expect(log).not.toContain('maria');
  });
});
