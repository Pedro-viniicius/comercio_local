// Relay da outbox (ADR-011), no worker: lê os eventos pendentes de
// `compartilhado.outbox` e cria um job no pg-boss para cada assinante do tipo
// do evento.
//
// Garantias (CA-F5):
// - Dois relays ao mesmo tempo não pegam o mesmo evento: o lote é lido com
//   `FOR UPDATE SKIP LOCKED`, e cada um fica com linhas diferentes.
// - Os jobs são criados na MESMA transação que marca o evento como publicado
//   (o pg-boss grava pela transação do Prisma, `fromPrisma`): ou o evento sai
//   com todos os jobs, ou fica pendente sem nenhum.
// - Cada job tem chave única evento + assinante (`singletonKey`) numa fila de
//   política `exclusive`: enquanto houver um job da mesma entrega na fila ou
//   em execução, outro igual não entra.
// - A deduplicação final é a do `EntregadorDeEventos` (`eventos_processados`).
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { fromPrisma, PgBoss } from 'pg-boss';
import { UnidadeDeTrabalhoPrisma } from '../infra/unidade-de-trabalho-prisma.ts';
import { Relogio } from '../tempo/relogio.ts';
import type { ObjetoJson } from '../titular/dado-pessoal.ts';
import {
  chaveDaEntrega,
  type EventoPublicado,
  nomeDaFila,
  RegistroDeAssinantes,
} from './assinantes.ts';

/** Eventos lidos por transação do relay. */
export const TAMANHO_DO_LOTE = 100;

/** Prazo da transação de um lote. */
export const PRAZO_DO_LOTE_EM_MS = 30_000;

/** Intervalo entre consultas quando não há pendentes. */
export const INTERVALO_DO_RELAY_EM_MS = 1_000;

/** Espera depois de uma falha (banco fora do ar, por exemplo). */
export const ESPERA_APOS_FALHA_EM_MS = 5_000;

interface LinhaDaOutbox {
  id: string;
  tipo: string;
  versao: number;
  agregadoId: string;
  payload: ObjetoJson;
  ocorridoEm: Date;
}

@Injectable()
export class RelayDaOutbox {
  #ativo = false;
  #ciclo: Promise<void> | undefined;
  #temporizador: NodeJS.Timeout | undefined;
  #acordar: (() => void) | undefined;

  constructor(
    private readonly unidade: UnidadeDeTrabalhoPrisma,
    private readonly fila: PgBoss,
    private readonly assinantes: RegistroDeAssinantes,
    private readonly relogio: Relogio,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(RelayDaOutbox.name);
  }

  /**
   * Publica um lote de eventos pendentes, do mais antigo para o mais novo.
   * Devolve quantos eventos saíram da outbox (com ou sem assinante).
   */
  async publicarLote(limite = TAMANHO_DO_LOTE): Promise<number> {
    return this.unidade.executar(
      async () => {
        const transacao = this.unidade.transacaoAtual();
        if (transacao === undefined) throw new Error('Relay fora de transação.');
        const eventos = await transacao.$queryRaw<LinhaDaOutbox[]>`
          SELECT id, tipo, versao, agregado_id AS "agregadoId", payload, ocorrido_em AS "ocorridoEm"
            FROM compartilhado.outbox
           WHERE publicado_em IS NULL
           ORDER BY ocorrido_em, id
           LIMIT ${limite}
             FOR UPDATE SKIP LOCKED`;
        if (eventos.length === 0) return 0;
        const banco = fromPrisma(transacao);
        for (const linha of eventos) {
          const evento: EventoPublicado = {
            id: linha.id,
            tipo: linha.tipo,
            versao: linha.versao,
            agregadoId: linha.agregadoId,
            payload: linha.payload,
            ocorridoEm: linha.ocorridoEm.toISOString(),
          };
          for (const assinante of this.assinantes.assinantesDe(evento.tipo)) {
            await this.fila.send(nomeDaFila(assinante.nome), evento, {
              singletonKey: chaveDaEntrega(evento.id, assinante.nome),
              db: banco,
            });
          }
        }
        await transacao.outbox.updateMany({
          where: { id: { in: eventos.map((evento) => evento.id) } },
          data: { publicadoEm: this.relogio.agora() },
        });
        return eventos.length;
      },
      { prazoEmMs: PRAZO_DO_LOTE_EM_MS },
    );
  }

  /** Começa a publicar em laço: lote atrás de lote; sem pendentes, espera o intervalo. */
  iniciar(intervaloEmMs = INTERVALO_DO_RELAY_EM_MS): void {
    if (this.#ativo) return;
    this.#ativo = true;
    this.#ciclo = this.#laco(intervaloEmMs);
  }

  /** Para o laço e espera o lote em andamento terminar. */
  async parar(): Promise<void> {
    this.#ativo = false;
    clearTimeout(this.#temporizador);
    this.#acordar?.();
    await this.#ciclo;
    this.#ciclo = undefined;
  }

  async #laco(intervaloEmMs: number): Promise<void> {
    while (this.#ativo) {
      let espera = 0;
      try {
        const publicados = await this.publicarLote();
        if (publicados === 0) espera = intervaloEmMs;
      } catch (erro) {
        this.logger.error({ err: erro }, 'relay da outbox falhou; tenta de novo');
        espera = ESPERA_APOS_FALHA_EM_MS;
      }
      if (espera > 0 && this.#ativo) await this.#esperar(espera);
    }
  }

  #esperar(milissegundos: number): Promise<void> {
    return new Promise((resolver) => {
      this.#acordar = resolver;
      this.#temporizador = setTimeout(resolver, milissegundos);
    });
  }
}
