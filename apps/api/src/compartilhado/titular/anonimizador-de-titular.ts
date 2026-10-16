// Anonimização em todos os contextos (S5; 00-arquitetura, ADR-015): cada
// módulo que guarda dado pessoal entrega um `AnonimizadorDeTitular` e o
// registra aqui, no molde do `VerificadorDePendencias` do 01b. O caso de uso
// de anonimizar conta (01b) chama `anonimizarTitular`, que passa por todos.
import { Injectable } from '@nestjs/common';
import { serializarErro } from '../log/logger.ts';

/**
 * Porta implementada por cada módulo com dado pessoal (pedidos, dispositivos
 * de push, autor de avaliação, convites...).
 */
export interface AnonimizadorDeTitular {
  /** Nome do módulo dono dos dados (ex.: `identidade`). Único no registro. */
  readonly modulo: string;
  /**
   * Apaga ou troca por valor não reversível todo dado pessoal da conta neste
   * módulo, preservando os registros que a lei manda guardar. Precisa ser
   * idempotente: depois de uma falha, a anonimização roda de novo do início.
   */
  anonimizar(contaId: string): Promise<void>;
}

const NOME_DE_MODULO = /^[a-z][a-z0-9-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Um anonimizador falhou. Leva o módulo e o tipo e o código do erro original,
 * nunca a mensagem (a de biblioteca de banco traz os parâmetros da consulta).
 */
export class FalhaNaAnonimizacao extends Error {
  readonly tipoDaCausa: string;
  readonly codigoDaCausa?: string | number;

  constructor(
    readonly modulo: string,
    causa: unknown,
  ) {
    const { tipo, codigo } = serializarErro(causa);
    super(`A anonimização falhou no módulo ${modulo} (${tipo}${codigo ? `/${codigo}` : ''}).`);
    this.name = 'FalhaNaAnonimizacao';
    this.tipoDaCausa = tipo;
    if (codigo !== undefined) this.codigoDaCausa = codigo;
  }
}

/**
 * Registro dos anonimizadores. Cada módulo registra o seu ao subir
 * (`onModuleInit`); um módulo com dois anonimizadores é erro de montagem.
 */
@Injectable()
export class RegistroDeAnonimizadores {
  readonly #anonimizadores = new Map<string, AnonimizadorDeTitular>();

  registrar(anonimizador: AnonimizadorDeTitular): void {
    if (!NOME_DE_MODULO.test(anonimizador.modulo)) {
      throw new Error(`Nome de módulo inválido para anonimizador: "${anonimizador.modulo}".`);
    }
    if (this.#anonimizadores.has(anonimizador.modulo)) {
      throw new Error(`O módulo ${anonimizador.modulo} já registrou um anonimizador.`);
    }
    this.#anonimizadores.set(anonimizador.modulo, anonimizador);
  }

  /** Módulos registrados, na ordem de registro. */
  modulos(): string[] {
    return [...this.#anonimizadores.keys()];
  }

  /**
   * Chama o anonimizador de cada módulo, um por vez, na ordem de registro.
   * Para no primeiro que falhar e rejeita com `FalhaNaAnonimizacao`: quem
   * chama tenta de novo depois, do início (os anonimizadores são
   * idempotentes). Não abre transação: se precisar, quem chama envolve a
   * chamada numa `UnidadeDeTrabalho`.
   */
  async anonimizarTitular(contaId: string): Promise<void> {
    if (!UUID.test(contaId)) throw new Error('O id da conta a anonimizar deve ser um UUID.');
    for (const [modulo, anonimizador] of this.#anonimizadores) {
      try {
        await anonimizador.anonimizar(contaId);
      } catch (erro) {
        throw new FalhaNaAnonimizacao(modulo, erro);
      }
    }
  }
}
