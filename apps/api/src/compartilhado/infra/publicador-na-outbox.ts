// Adaptador da porta `PublicadorDeEventos` (`eventos/publicador.ts`): grava os
// eventos na tabela `compartilhado.outbox` pela transação aberta da unidade de
// trabalho (ADR-011).
import { Injectable } from '@nestjs/common';
import {
  type EventoDeDominio,
  PublicacaoForaDeTransacao,
  PublicadorDeEventos,
  validarEvento,
} from '../eventos/publicador.ts';
import { Relogio } from '../tempo/relogio.ts';
import { UnidadeDeTrabalhoPrisma } from './unidade-de-trabalho-prisma.ts';

/** Adaptador: grava na outbox pela transação aberta, com a hora do `Relogio`. */
@Injectable()
export class PublicadorDeEventosNaOutbox extends PublicadorDeEventos {
  constructor(
    private readonly unidade: UnidadeDeTrabalhoPrisma,
    private readonly relogio: Relogio,
  ) {
    super();
  }

  override async publicar(...eventos: readonly EventoDeDominio[]): Promise<void> {
    const transacao = this.unidade.transacaoAtual();
    if (transacao === undefined) throw new PublicacaoForaDeTransacao();
    if (eventos.length === 0) return;
    eventos.forEach(validarEvento);
    const ocorridoEm = this.relogio.agora();
    await transacao.outbox.createMany({
      data: eventos.map((evento) => ({
        tipo: evento.tipo,
        versao: evento.versao,
        agregadoId: evento.agregadoId,
        payload: evento.payload,
        ocorridoEm,
      })),
    });
  }
}
