// Adaptador Prisma da `UnidadeDeTrabalho` (porta em
// `transacao/unidade-de-trabalho.ts`): uma transação do Prisma que os
// repositórios, o publicador de eventos e a auditoria compartilham sem receber
// a transação por parâmetro. A transação aberta fica num AsyncLocalStorage; quem está dentro
// de `executar` e pede `cliente()` recebe a transação, e quem está fora
// recebe o client comum.
//
// Regra para os repositórios (infra): sempre `uow.cliente()`, nunca o
// `PrismaService` direto. Uma consulta pelo client comum dentro de uma
// transação sai por outra conexão: não vê o que a transação gravou e pode
// esperar para sempre por uma trava que ela mesma segura.
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import {
  type OpcoesDaUnidadeDeTrabalho,
  UnidadeDeTrabalho,
} from '../transacao/unidade-de-trabalho.ts';
import type { Prisma } from './gerado/prisma/client.ts';
import { PrismaService } from './prisma.service.ts';

/** Client do Prisma dentro de uma transação. */
export type TransacaoDoBanco = Prisma.TransactionClient;

/** Client usado pelos repositórios: a transação aberta ou o client comum. */
export type ClienteDoBanco = Prisma.TransactionClient | PrismaService;

/** Prazo padrão de uma transação de caso de uso. */
export const PRAZO_PADRAO_DA_TRANSACAO_EM_MS = 10_000;

/** Espera máxima por uma conexão livre para abrir a transação. */
export const ESPERA_PELA_TRANSACAO_EM_MS = 5_000;

/** Adaptador Prisma da unidade de trabalho. */
@Injectable()
export class UnidadeDeTrabalhoPrisma extends UnidadeDeTrabalho {
  readonly #transacaoAtual = new AsyncLocalStorage<TransacaoDoBanco>();

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  override async executar<T>(
    trabalho: () => Promise<T>,
    opcoes: OpcoesDaUnidadeDeTrabalho = {},
  ): Promise<T> {
    if (this.#transacaoAtual.getStore() !== undefined) return trabalho();
    return this.prisma.$transaction((transacao) => this.#transacaoAtual.run(transacao, trabalho), {
      timeout: opcoes.prazoEmMs ?? PRAZO_PADRAO_DA_TRANSACAO_EM_MS,
      maxWait: ESPERA_PELA_TRANSACAO_EM_MS,
    });
  }

  /** A transação aberta por `executar`, ou `undefined` fora de uma unidade. */
  transacaoAtual(): TransacaoDoBanco | undefined {
    return this.#transacaoAtual.getStore();
  }

  /** A transação aberta ou, fora de uma unidade, o client comum. */
  cliente(): ClienteDoBanco {
    return this.#transacaoAtual.getStore() ?? this.prisma;
  }
}
