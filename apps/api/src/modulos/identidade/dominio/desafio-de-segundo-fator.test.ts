// Desafio do segundo fator (S1; plano 01b, "Respostas do 2FA"): etapa, 5 min,
// uso único, 5 tentativas e a ordem desafio inválido → freado → código errado.
import { describe, expect, it } from 'vitest';
import { BloqueioDeLogin } from './bloqueio-de-login.ts';
import {
  type DadosDoDesafioDeSegundoFator,
  DesafioDeSegundoFator,
  etapaDoDesafio,
  finalidadeDoDesafio,
  TENTATIVAS_POR_DESAFIO,
  VALIDADE_DO_DESAFIO_EM_MS,
} from './desafio-de-segundo-fator.ts';

const AGORA = new Date('2026-10-17T12:00:00.000Z');
const CONTA = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';

function depois(ms: number): Date {
  return new Date(AGORA.getTime() + ms);
}

function emitir(etapa: 'configurar' | 'verificar' = 'verificar'): DesafioDeSegundoFator {
  return DesafioDeSegundoFator.emitir({
    id: '0b8e1f2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
    contaId: CONTA,
    etapa,
    tokenHmac: 'hmac-do-desafio',
    agora: AGORA,
  });
}

function freio(): BloqueioDeLogin {
  return BloqueioDeLogin.novo('chave-da-conta', 'segundo_fator', AGORA);
}

describe('etapa do desafio (S1)', () => {
  it('configurar só sem segundo fator confirmado', () => {
    expect(etapaDoDesafio(false)).toBe('configurar');
    expect(etapaDoDesafio(true)).toBe('verificar');
  });

  it('a finalidade gravada em codigos_verificacao segue a etapa', () => {
    expect(finalidadeDoDesafio('configurar')).toBe('desafio_configurar');
    expect(finalidadeDoDesafio('verificar')).toBe('desafio_verificar');
  });
});

describe('DesafioDeSegundoFator', () => {
  it('vale 5 min, sem tentativa', () => {
    expect(emitir().dados).toEqual({
      id: '0b8e1f2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
      contaId: CONTA,
      etapa: 'verificar',
      tokenHmac: 'hmac-do-desafio',
      tentativas: 0,
      expiraEm: depois(VALIDADE_DO_DESAFIO_EM_MS),
      usadoEm: null,
      criadoEm: AGORA,
    } satisfies DadosDoDesafioDeSegundoFator);
    expect(VALIDADE_DO_DESAFIO_EM_MS).toBe(5 * 60 * 1000);
  });

  it('desafio de login (verificar) não vale para configurar, e vice-versa', () => {
    expect(emitir('verificar').estaValidoPara('configurar', AGORA)).toBe(false);
    expect(emitir('configurar').estaValidoPara('verificar', AGORA)).toBe(false);
    expect(emitir('configurar').estaValidoPara('configurar', AGORA)).toBe(true);
  });

  it('código certo conclui, consome o desafio e zera o freio de segundo fator', () => {
    const desafio = emitir();
    const freioDaConta = freio();
    freioDaConta.registrarFalha(AGORA);
    const resultado = desafio.avaliarCodigo({
      etapa: 'verificar',
      freio: freioDaConta,
      codigoConfere: true,
      agora: depois(1000),
    });
    expect(resultado).toEqual({ tipo: 'concluido' });
    expect(desafio.dados.usadoEm).toEqual(depois(1000));
    expect(freioDaConta.estaZerado).toBe(true);
    expect(
      desafio.avaliarCodigo({
        etapa: 'verificar',
        freio: freioDaConta,
        codigoConfere: true,
        agora: depois(2000),
      }),
    ).toEqual({ tipo: 'desafio_invalido' });
  });

  it('quatro erradas → codigo_errado; a quinta → desafio_invalido; a sexta, mesmo certa → desafio_invalido', () => {
    const desafio = emitir();
    const freioDaConta = freio();
    const tentar = (codigoConfere: boolean) =>
      desafio.avaliarCodigo({
        etapa: 'verificar',
        freio: freioDaConta,
        codigoConfere,
        agora: AGORA,
      });
    for (let i = 1; i < TENTATIVAS_POR_DESAFIO; i += 1) {
      expect(tentar(false)).toEqual({ tipo: 'codigo_errado' });
    }
    expect(tentar(false)).toEqual({ tipo: 'desafio_invalido' });
    expect(tentar(true)).toEqual({ tipo: 'desafio_invalido' });
    expect(desafio.dados.tentativas).toBe(5);
  });

  it('certo depois de quatro erradas → concluido', () => {
    const desafio = emitir();
    const freioDaConta = freio();
    for (let i = 1; i < TENTATIVAS_POR_DESAFIO; i += 1) {
      desafio.avaliarCodigo({
        etapa: 'verificar',
        freio: freioDaConta,
        codigoConfere: false,
        agora: AGORA,
      });
    }
    expect(
      desafio.avaliarCodigo({
        etapa: 'verificar',
        freio: freioDaConta,
        codigoConfere: true,
        agora: AGORA,
      }),
    ).toEqual({ tipo: 'concluido' });
  });

  it('as falhas somam no freio da conta, que freia o próximo desafio sem gastar tentativa', () => {
    const freioDaConta = freio();
    const primeiro = emitir();
    for (let i = 0; i < TENTATIVAS_POR_DESAFIO; i += 1) {
      primeiro.avaliarCodigo({
        etapa: 'verificar',
        freio: freioDaConta,
        codigoConfere: false,
        agora: AGORA,
      });
    }
    expect(freioDaConta.estaBloqueado(AGORA)).toBe(true);
    const segundo = emitir();
    const resultado = segundo.avaliarCodigo({
      etapa: 'verificar',
      freio: freioDaConta,
      codigoConfere: true,
      agora: depois(10_000),
    });
    expect(resultado).toEqual({ tipo: 'freado', segundosDeEspera: 50 });
    expect(segundo.dados.tentativas).toBe(0);
    expect(segundo.dados.usadoEm).toBeNull();
  });

  it('a ordem começa pelo desafio: inválido responde antes do freio', () => {
    const freioDaConta = freio();
    for (let i = 0; i < 5; i += 1) freioDaConta.registrarFalha(AGORA);
    const vencido = emitir();
    expect(
      vencido.avaliarCodigo({
        etapa: 'verificar',
        freio: freioDaConta,
        codigoConfere: true,
        agora: depois(VALIDADE_DO_DESAFIO_EM_MS),
      }),
    ).toEqual({ tipo: 'desafio_invalido' });
    expect(
      emitir('configurar').avaliarCodigo({
        etapa: 'verificar',
        freio: freioDaConta,
        codigoConfere: true,
        agora: AGORA,
      }),
    ).toEqual({ tipo: 'desafio_invalido' });
  });

  it('código errado em desafio inválido não soma no freio', () => {
    const freioDaConta = freio();
    const vencido = emitir();
    vencido.avaliarCodigo({
      etapa: 'verificar',
      freio: freioDaConta,
      codigoConfere: false,
      agora: depois(VALIDADE_DO_DESAFIO_EM_MS),
    });
    expect(freioDaConta.estaZerado).toBe(true);
  });

  it('só aceita o freio de segundo fator', () => {
    expect(() =>
      emitir().avaliarCodigo({
        etapa: 'verificar',
        freio: BloqueioDeLogin.novo('x', 'email', AGORA),
        codigoConfere: true,
        agora: AGORA,
      }),
    ).toThrow(/segundo fator/);
  });

  it('recusa tentativas negativas ao remontar (CHECK do banco)', () => {
    expect(() =>
      DesafioDeSegundoFator.reconstituir({ ...emitir().dados, tentativas: -1 }),
    ).toThrow();
  });
});
