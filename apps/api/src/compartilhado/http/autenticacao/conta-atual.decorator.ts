// `@ContaAtual()`: a conta autenticada pela guarda `Autenticado`, como
// parâmetro do método da rota. Só existe em rota sem `@Publico()`.
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ContaAutenticada } from '../../autenticacao/verificador-de-acesso.ts';

/** Onde a guarda guarda a conta na requisição (símbolo: nada de fora o forja). */
export const CONTA_DA_REQUISICAO: unique symbol = Symbol('bairrin.contaDaRequisicao');

export interface RequisicaoAutenticada {
  [CONTA_DA_REQUISICAO]?: ContaAutenticada;
}

/** A conta que a guarda pôs na requisição, ou `undefined` em rota pública. */
export function contaDaRequisicao(req: RequisicaoAutenticada): ContaAutenticada | undefined {
  return req[CONTA_DA_REQUISICAO];
}

/**
 * A conta autenticada. Numa rota com `@Publico()` não há conta: usar o
 * decorador ali é erro de programação e a requisição falha com 500.
 */
export const ContaAtual = createParamDecorator(
  (_dados: unknown, contexto: ExecutionContext): ContaAutenticada => {
    const conta = contaDaRequisicao(contexto.switchToHttp().getRequest<RequisicaoAutenticada>());
    if (conta === undefined) throw new Error('@ContaAtual() usado em rota sem autenticação.');
    return conta;
  },
);
