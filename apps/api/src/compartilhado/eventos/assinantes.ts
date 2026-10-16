// Assinantes de eventos (ADR-011): cada módulo registra os seus ao subir
// (`onModuleInit`) e o worker dá a cada assinante uma fila própria no pg-boss.
// O relay cria um job por assinante para cada evento da outbox; o
// `EntregadorDeEventos` roda o assinante com deduplicação em
// `compartilhado.eventos_processados`.
//
// Entrega pelo menos uma vez, efeito uma vez: um job repetido (retentativa
// depois de o efeito já ter sido gravado, ou a mesma entrega duas vezes) não
// roda o assinante de novo. O que o assinante grava no banco pela
// `UnidadeDeTrabalho` fica na mesma transação da marca de processado; efeito
// fora do banco (e-mail, push) pode se repetir se a transação falhar depois
// dele. Sem garantia de ordem entre eventos.
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { UnidadeDeTrabalhoPrisma } from '../infra/unidade-de-trabalho-prisma.ts';
import { serializarErro } from '../log/logger.ts';
import { Relogio } from '../tempo/relogio.ts';
import type { ObjetoJson } from '../titular/dado-pessoal.ts';

/** Evento como o assinante recebe (dados do job no pg-boss). */
export interface EventoPublicado<P extends ObjetoJson = ObjetoJson> {
  id: string;
  tipo: string;
  versao: number;
  agregadoId: string;
  payload: P;
  /** ISO 8601 em UTC. */
  ocorridoEm: string;
}

export interface Assinante {
  /**
   * Nome estável e único, `<contexto>.<acao>` em minúsculas com hífen
   * (ex.: `identidade.enviar-codigo-de-verificacao`). Vira o nome da fila e a
   * chave da deduplicação: renomear faz os eventos pendentes se perderem.
   */
  readonly nome: string;
  /** Tipos de evento que interessam (ex.: `identidade.ContaCriada`). */
  readonly eventos: readonly string[];
  /**
   * Trata o evento dentro de uma `UnidadeDeTrabalho` já aberta. Rejeitar desfaz
   * o que foi gravado e agenda nova tentativa.
   */
  tratar(evento: EventoPublicado): Promise<void>;
}

export const FORMATO_DO_NOME_DO_ASSINANTE = /^[a-z][a-z0-9]*\.[a-z0-9]+(-[a-z0-9]+)*$/;

/** Prefixo das filas de assinante no pg-boss. */
export const PREFIXO_DAS_FILAS = 'assinante.';

export function nomeDaFila(assinante: string): string {
  return `${PREFIXO_DAS_FILAS}${assinante}`;
}

/** Chave única do job de uma entrega: evento + assinante. */
export function chaveDaEntrega(eventoId: string, assinante: string): string {
  return `${eventoId}.${assinante}`;
}

@Injectable()
export class RegistroDeAssinantes {
  readonly #assinantes = new Map<string, Assinante>();

  registrar(assinante: Assinante): void {
    if (!FORMATO_DO_NOME_DO_ASSINANTE.test(assinante.nome)) {
      throw new Error(`Nome de assinante inválido: "${assinante.nome}".`);
    }
    if (this.#assinantes.has(assinante.nome)) {
      throw new Error(`Assinante já registrado: ${assinante.nome}.`);
    }
    if (assinante.eventos.length === 0) {
      throw new Error(`O assinante ${assinante.nome} não assina nenhum evento.`);
    }
    this.#assinantes.set(assinante.nome, assinante);
  }

  todos(): Assinante[] {
    return [...this.#assinantes.values()];
  }

  assinantesDe(tipo: string): Assinante[] {
    return this.todos().filter((assinante) => assinante.eventos.includes(tipo));
  }
}

/**
 * O assinante falhou. Vai para a saída do job no pg-boss (guardada até 7 dias)
 * e para o log, por isso leva só o tipo e o código do erro original, nunca a
 * mensagem (a de banco ou de SMTP traz parâmetros, endereço ou credencial).
 */
export class FalhaNoAssinante extends Error {
  readonly tipoDaCausa: string;
  readonly codigoDaCausa?: string | number;

  constructor(
    readonly assinante: string,
    causa: unknown,
  ) {
    const { tipo, codigo } = serializarErro(causa);
    super(`O assinante ${assinante} falhou (${tipo}${codigo ? `/${codigo}` : ''}).`);
    this.name = 'FalhaNoAssinante';
    this.tipoDaCausa = tipo;
    if (codigo !== undefined) this.codigoDaCausa = codigo;
  }
}

/** Prazo da transação de uma entrega (o assinante pode mandar e-mail dentro dela). */
export const PRAZO_DA_ENTREGA_EM_MS = 60_000;

export type ResultadoDaEntrega = 'tratado' | 'repetido';

@Injectable()
export class EntregadorDeEventos {
  constructor(
    private readonly unidade: UnidadeDeTrabalhoPrisma,
    private readonly relogio: Relogio,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(EntregadorDeEventos.name);
  }

  /**
   * Marca o evento como processado pelo assinante e roda o assinante, na mesma
   * transação. Se a marca já existe, não roda de novo (`repetido`). Se o
   * assinante rejeitar, desfaz tudo e rejeita com `FalhaNoAssinante`, para o
   * pg-boss tentar de novo.
   */
  async entregar(assinante: Assinante, evento: EventoPublicado): Promise<ResultadoDaEntrega> {
    try {
      return await this.unidade.executar(
        async () => {
          const transacao = this.unidade.transacaoAtual();
          if (transacao === undefined) throw new Error('Entrega fora de transação.');
          // Duas entregas simultâneas do mesmo evento: a segunda espera a
          // trava da chave primária e, depois do commit da primeira, não insere.
          const { count } = await transacao.eventoProcessado.createMany({
            data: [
              {
                eventoId: evento.id,
                assinante: assinante.nome,
                processadoEm: this.relogio.agora(),
              },
            ],
            skipDuplicates: true,
          });
          if (count === 0) return 'repetido';
          await assinante.tratar(evento);
          return 'tratado';
        },
        { prazoEmMs: PRAZO_DA_ENTREGA_EM_MS },
      );
    } catch (erro) {
      const falha = new FalhaNoAssinante(assinante.nome, erro);
      this.logger.warn(
        { err: erro, assinante: assinante.nome, eventoId: evento.id, tipo: evento.tipo },
        'assinante falhou; o pg-boss tenta de novo',
      );
      throw falha;
    }
  }
}
