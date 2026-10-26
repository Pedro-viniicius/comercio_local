import 'reflect-metadata';
import { Controller, type ExecutionContext, Post } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, type ThrottlerStorage } from '@nestjs/throttler';
import { describe, expect, it } from 'vitest';
import {
  CONTA_DA_REQUISICAO,
  type RequisicaoAutenticada,
} from './autenticacao/conta-atual.decorator.ts';
import { LimitarRota, LimitePorRotaGuard, type LimiteDaRota } from './limite-por-rota.guard.ts';

const UMA_HORA = 60 * 60 * 1000;
const CONTA_ID = '11111111-1111-4111-8111-111111111111';

const porConta: LimiteDaRota = { nome: 'a-conta', por: 'conta', limite: 3, janelaEmMs: UMA_HORA };
const porIp: LimiteDaRota = { nome: 'b-ip', por: 'ip', limite: 10, janelaEmMs: UMA_HORA };
const porEmail: LimiteDaRota = { nome: 'c-email', por: 'email', limite: 5, janelaEmMs: UMA_HORA };

const porIpDiario: LimiteDaRota = { nome: 'd-ip-dia', por: 'ip', limite: 50, janelaEmMs: UMA_HORA };

// A ordem do decorador é de propósito a inversa da de conferência (conta, IP, e-mail).
@Controller('x')
class RotaDeTeste {
  @Post()
  @LimitarRota(porEmail, porIp, porConta)
  tudo() {
    return 1;
  }

  @Post('dois-por-ip')
  @LimitarRota(porEmail, porIpDiario, porConta, porIp)
  doisPorIp() {
    return 1;
  }

  @Post('sem-limite')
  semLimite() {
    return 1;
  }
}

/** Armazenamento falso: conta as chamadas por limite e bloqueia a partir de `bloqueiaDepoisDe`. */
function armazenamento(bloqueiaDepoisDe: Partial<Record<string, number>> = {}) {
  const chamadas: string[] = [];
  const contagem = new Map<string, number>();
  const storage = {
    increment: (
      chave: string,
      _ttl: number,
      limite: number,
      _bloqueio: number,
      nome: string,
    ): Promise<{ isBlocked: boolean; timeToBlockExpire: number }> => {
      chamadas.push(nome);
      const total = (contagem.get(chave) ?? 0) + 1;
      const teto = bloqueiaDepoisDe[nome] ?? limite;
      // Como o `ThrottlerStorage` de verdade: o contador estourado não cresce.
      if (total > teto) return Promise.resolve({ isBlocked: true, timeToBlockExpire: 42 });
      contagem.set(chave, total);
      return Promise.resolve({ isBlocked: false, timeToBlockExpire: 0 });
    },
  } as unknown as ThrottlerStorage;
  return { storage, chamadas };
}

function contexto(
  metodo: keyof RotaDeTeste,
  req: object,
  cabecalhos: Record<string, string>,
): ExecutionContext {
  const proto = RotaDeTeste.prototype as unknown as Record<string, () => unknown>;
  return {
    getClass: () => RotaDeTeste,
    getHandler: () => proto[metodo],
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({
        setHeader: (nome: string, valor: string) => {
          cabecalhos[nome] = valor;
        },
      }),
    }),
  } as unknown as ExecutionContext;
}

function requisicao(corpo: unknown = { email: 'pessoa@exemplo.com.br' }): object {
  return {
    ip: '203.0.113.7',
    body: corpo,
    [CONTA_DA_REQUISICAO]: {
      contaId: CONTA_ID,
      sid: '22222222-2222-4222-8222-222222222222',
      perfis: ['consumidor'],
      mfa: false,
      emailVerificado: true,
    },
  } satisfies RequisicaoAutenticada & { ip: string; body: unknown };
}

describe('LimitePorRotaGuard: ordem de conferência', () => {
  it('confere conta, IP e e-mail nessa ordem, qualquer que seja a ordem do decorador', async () => {
    const { storage, chamadas } = armazenamento();
    const guarda = new LimitePorRotaGuard(new Reflector(), storage);

    await expect(guarda.canActivate(contexto('tudo', requisicao(), {}))).resolves.toBe(true);

    expect(chamadas).toEqual(['a-conta', 'b-ip', 'c-email']);
  });

  it('dois limites do mesmo tipo mantêm a ordem em que foram declarados (S112, sort estável)', async () => {
    const { storage, chamadas } = armazenamento();
    const guarda = new LimitePorRotaGuard(new Reflector(), storage);

    await expect(guarda.canActivate(contexto('doisPorIp', requisicao(), {}))).resolves.toBe(true);

    expect(chamadas).toEqual(['a-conta', 'd-ip-dia', 'b-ip', 'c-email']);
  });

  it('a recusa por conta (4ª) não gasta o limite do IP nem o do e-mail', async () => {
    const { storage, chamadas } = armazenamento();
    const guarda = new LimitePorRotaGuard(new Reflector(), storage);
    for (let vez = 0; vez < 3; vez += 1)
      await guarda.canActivate(contexto('tudo', requisicao(), {}));
    chamadas.length = 0;

    const cabecalhos: Record<string, string> = {};
    await expect(guarda.canActivate(contexto('tudo', requisicao(), cabecalhos))).rejects.toThrow(
      ThrottlerException,
    );

    expect(chamadas).toEqual(['a-conta']);
    expect(cabecalhos['Retry-After']).toBe('42');
  });

  it('IP estourado: a conta ainda conta, o e-mail não é conferido', async () => {
    const { storage, chamadas } = armazenamento({ 'b-ip': 0 });
    const guarda = new LimitePorRotaGuard(new Reflector(), storage);

    await expect(guarda.canActivate(contexto('tudo', requisicao(), {}))).rejects.toThrow(
      ThrottlerException,
    );

    expect(chamadas).toEqual(['a-conta', 'b-ip']);
  });

  it('corpo sem e-mail válido: o limite por e-mail não se aplica, os outros dois sim', async () => {
    const { storage, chamadas } = armazenamento();
    const guarda = new LimitePorRotaGuard(new Reflector(), storage);

    await guarda.canActivate(contexto('tudo', requisicao({ email: 12 }), {}));
    await guarda.canActivate(contexto('tudo', requisicao(null), {}));

    expect(chamadas).toEqual(['a-conta', 'b-ip', 'a-conta', 'b-ip']);
  });

  it('rota sem limite declarado passa sem tocar no armazenamento', async () => {
    const { storage, chamadas } = armazenamento();
    const guarda = new LimitePorRotaGuard(new Reflector(), storage);

    await expect(guarda.canActivate(contexto('semLimite', requisicao(), {}))).resolves.toBe(true);

    expect(chamadas).toEqual([]);
  });

  it('rota pública (sem conta na requisição): o limite por conta não se aplica, o IP continua valendo', async () => {
    const { storage, chamadas } = armazenamento();
    const guarda = new LimitePorRotaGuard(new Reflector(), storage);
    const publica = { ip: '203.0.113.7', body: { email: 'pessoa@exemplo.com.br' } };

    await guarda.canActivate(contexto('tudo', publica, {}));

    expect(chamadas).toEqual(['b-ip', 'c-email']);
  });
});
