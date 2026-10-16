// Módulo do worker (`src/worker.ts`): o mesmo `AppModule` da API (logger,
// núcleo e módulos de contexto, que registram assinantes e anonimizadores) e
// mais o que só roda no worker: pg-boss, relay da outbox, consumo das filas de
// assinante e a tarefa diária de limpeza (ADR-011, S5).
import {
  type BeforeApplicationShutdown,
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PgBoss, type Queue } from 'pg-boss';
import { AppModule, type OpcoesDoAppModule } from './app.module.ts';
import { AMBIENTE, type Ambiente } from './compartilhado/config/ambiente.ts';
import {
  EntregadorDeEventos,
  type EventoPublicado,
  nomeDaFila,
  RegistroDeAssinantes,
} from './compartilhado/eventos/assinantes.ts';
import {
  AGENDA_DA_LIMPEZA,
  FILA_DA_LIMPEZA,
  RETENCAO_DOS_JOBS_EM_DIAS,
  TarefaDeLimpeza,
} from './compartilhado/eventos/limpeza.tarefa.ts';
import { INTERVALO_DO_RELAY_EM_MS, RelayDaOutbox } from './compartilhado/eventos/relay.ts';
import { criarPgBoss } from './compartilhado/infra/pg-boss.ts';
import { serializarErro } from './compartilhado/log/logger.ts';

const UM_DIA_EM_SEGUNDOS = 24 * 60 * 60;

export interface AjustesDoWorker {
  /** Espera do relay quando a outbox está vazia. */
  intervaloDoRelayEmMs: number;
  /** Espera entre consultas de cada fila de assinante (mínimo do pg-boss: 0,5 s). */
  intervaloDasFilasEmSegundos: number;
  /** Novas tentativas de um assinante que falhou. */
  retentativas: { limite: number; esperaEmSegundos: number; exponencial: boolean };
  /** Manutenção do pg-boss (expiração, retenção). */
  supervisionar: boolean;
  /** Agenda e consome a tarefa diária de limpeza. */
  agendarLimpeza: boolean;
}

export const AJUSTES_PADRAO_DO_WORKER: AjustesDoWorker = {
  intervaloDoRelayEmMs: INTERVALO_DO_RELAY_EM_MS,
  intervaloDasFilasEmSegundos: 2,
  // 15 s, 30 s, 1 min... até 1 h entre tentativas; 8 tentativas cobrem horas
  // de SMTP ou serviço fora do ar.
  retentativas: { limite: 8, esperaEmSegundos: 15, exponencial: true },
  supervisionar: true,
  agendarLimpeza: true,
};

const AJUSTES_DO_WORKER = Symbol('AJUSTES_DO_WORKER');

/** Configuração da fila de um assinante (exceto a política, fixa na criação). */
export function opcoesDaFilaDeAssinante(ajustes: AjustesDoWorker): Omit<Queue, 'name' | 'policy'> {
  return {
    retryLimit: ajustes.retentativas.limite,
    retryDelay: ajustes.retentativas.esperaEmSegundos,
    retryBackoff: ajustes.retentativas.exponencial,
    // O pg-boss só aceita teto de espera com espera exponencial.
    ...(ajustes.retentativas.exponencial ? { retryDelayMax: 60 * 60 } : {}),
    // Maior que o prazo da transação da entrega (60 s).
    expireInSeconds: 5 * 60,
    // Concluído: apagado em 7 dias (S5); pendente: em 14.
    deleteAfterSeconds: RETENCAO_DOS_JOBS_EM_DIAS * UM_DIA_EM_SEGUNDOS,
    retentionSeconds: 14 * UM_DIA_EM_SEGUNDOS,
  };
}

/** Sobe e desce o trabalho do worker com o ciclo de vida do Nest. */
@Injectable()
export class ProcessoDoWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  constructor(
    private readonly fila: PgBoss,
    private readonly relay: RelayDaOutbox,
    private readonly assinantes: RegistroDeAssinantes,
    private readonly entregador: EntregadorDeEventos,
    private readonly limpeza: TarefaDeLimpeza,
    @Inject(AJUSTES_DO_WORKER) private readonly ajustes: AjustesDoWorker,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(ProcessoDoWorker.name);
  }

  // Depois do `onModuleInit` de todos os módulos: os assinantes já se registraram.
  async onApplicationBootstrap(): Promise<void> {
    await this.fila.start();
    const opcoes = opcoesDaFilaDeAssinante(this.ajustes);
    for (const assinante of this.assinantes.todos()) {
      const nome = nomeDaFila(assinante.nome);
      // `exclusive`: um job por chave (evento + assinante) na fila ou em execução.
      await this.fila.createQueue(nome, { policy: 'exclusive', ...opcoes });
      // Fila que já existia recebe a configuração atual.
      await this.fila.updateQueue(nome, opcoes);
      await this.fila.work<EventoPublicado>(
        nome,
        { pollingIntervalSeconds: this.ajustes.intervaloDasFilasEmSegundos, batchSize: 1 },
        async ([job]) => {
          if (job !== undefined) await this.entregador.entregar(assinante, job.data);
        },
      );
    }
    if (this.ajustes.agendarLimpeza) await this.#agendarLimpeza();
    this.relay.iniciar(this.ajustes.intervaloDoRelayEmMs);
    this.logger.info({ assinantes: this.assinantes.todos().length }, 'worker no ar');
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.relay.parar();
    await this.fila.stop({ graceful: true, timeout: 30_000 });
  }

  async #agendarLimpeza(): Promise<void> {
    await this.fila.createQueue(FILA_DA_LIMPEZA, {
      policy: 'exclusive',
      retryLimit: 2,
      retryDelay: 15 * 60,
      deleteAfterSeconds: RETENCAO_DOS_JOBS_EM_DIAS * UM_DIA_EM_SEGUNDOS,
    });
    await this.fila.schedule(FILA_DA_LIMPEZA, AGENDA_DA_LIMPEZA.cron, null, {
      tz: AGENDA_DA_LIMPEZA.fusoHorario,
    });
    await this.fila.work(FILA_DA_LIMPEZA, async () => {
      try {
        await this.limpeza.executar();
      } catch (erro) {
        // A saída do job guarda o erro: só tipo e código, nunca a mensagem.
        this.logger.error({ err: erro }, 'limpeza de retenção falhou');
        const { tipo, codigo } = serializarErro(erro);
        // Sem `cause` de propósito: o pg-boss serializa a causa junto, com a mensagem.
        // eslint-disable-next-line preserve-caught-error
        throw new Error(`Limpeza de retenção falhou (${tipo}${codigo ? `/${codigo}` : ''}).`);
      }
    });
  }
}

export interface OpcoesDoWorkerModule extends OpcoesDoAppModule {
  /** Só nos testes: intervalos curtos, sem espera entre tentativas etc. */
  ajustes?: Partial<AjustesDoWorker>;
}

@Module({})
export class WorkerModule {
  static registrar(opcoes: OpcoesDoWorkerModule): DynamicModule {
    const ajustes: AjustesDoWorker = { ...AJUSTES_PADRAO_DO_WORKER, ...opcoes.ajustes };
    return {
      module: WorkerModule,
      imports: [AppModule.registrar(opcoes)],
      providers: [
        { provide: AJUSTES_DO_WORKER, useValue: ajustes },
        {
          provide: PgBoss,
          useFactory: (ambiente: Ambiente, logger: PinoLogger) => {
            logger.setContext('PgBoss');
            return criarPgBoss(ambiente.DATABASE_URL, logger, {
              supervisionar: ajustes.supervisionar,
              agendar: ajustes.agendarLimpeza,
            });
          },
          inject: [AMBIENTE, PinoLogger],
        },
        RelayDaOutbox,
        TarefaDeLimpeza,
        ProcessoDoWorker,
      ],
    };
  }
}
