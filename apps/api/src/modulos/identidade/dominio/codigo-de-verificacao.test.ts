// Código enviado por e-mail (CA-01, CA-06): 30 min, uso único, 5 tentativas.
import { describe, expect, it } from 'vitest';
import {
  CodigoDeVerificacao,
  type DadosDoCodigoDeVerificacao,
  TENTATIVAS_POR_CODIGO,
  VALIDADE_DO_CODIGO_EM_MS,
} from './codigo-de-verificacao.ts';

const AGORA = new Date('2026-10-17T12:00:00.000Z');

function depois(ms: number): Date {
  return new Date(AGORA.getTime() + ms);
}

function emitir(): CodigoDeVerificacao {
  return CodigoDeVerificacao.emitir({
    id: '0b8e1f2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
    contaId: '6f1d3c2a-1b2c-4d3e-8f90-123456789abc',
    finalidade: 'recuperacao_senha',
    codigoHmac: 'hmac-do-codigo',
    agora: AGORA,
  });
}

describe('CodigoDeVerificacao', () => {
  it('vale 30 min, sem tentativa e com a data de emissão', () => {
    expect(emitir().dados).toEqual({
      id: '0b8e1f2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
      contaId: '6f1d3c2a-1b2c-4d3e-8f90-123456789abc',
      finalidade: 'recuperacao_senha',
      codigoHmac: 'hmac-do-codigo',
      tentativas: 0,
      expiraEm: depois(VALIDADE_DO_CODIGO_EM_MS),
      usadoEm: null,
      criadoEm: AGORA,
    } satisfies DadosDoCodigoDeVerificacao);
    expect(VALIDADE_DO_CODIGO_EM_MS).toBe(30 * 60 * 1000);
  });

  it('aceita uma vez só (uso único, CA-06)', () => {
    const codigo = emitir();
    expect(codigo.conferir(true, depois(1000))).toBe('aceito');
    expect(codigo.dados.usadoEm).toEqual(depois(1000));
    expect(codigo.conferir(true, depois(2000))).toBe('invalido');
  });

  it('vencido não é aceito, mesmo certo, e não gasta tentativa', () => {
    const codigo = emitir();
    expect(codigo.conferir(true, depois(VALIDADE_DO_CODIGO_EM_MS))).toBe('invalido');
    expect(codigo.dados.tentativas).toBe(0);
    expect(codigo.dados.usadoEm).toBeNull();
  });

  it('quatro erradas dão "errado"; a quinta esgota; depois, nem o certo vale', () => {
    const codigo = emitir();
    for (let i = 1; i < TENTATIVAS_POR_CODIGO; i += 1) {
      expect(codigo.conferir(false, AGORA)).toBe('errado');
    }
    expect(codigo.conferir(false, AGORA)).toBe('invalido');
    expect(codigo.dados.tentativas).toBe(5);
    expect(codigo.conferir(true, AGORA)).toBe('invalido');
  });

  it('certo depois de quatro erradas é aceito', () => {
    const codigo = emitir();
    for (let i = 1; i < TENTATIVAS_POR_CODIGO; i += 1) codigo.conferir(false, AGORA);
    expect(codigo.conferir(true, AGORA)).toBe('aceito');
  });

  it('invalidar tira o código de uso (código novo emitido), uma vez só', () => {
    const codigo = emitir();
    codigo.invalidar(depois(1000));
    codigo.invalidar(depois(2000));
    expect(codigo.estaValido(depois(3000))).toBe(false);
    expect(codigo.dados.usadoEm).toEqual(depois(1000));
  });

  it('recusa HMAC vazio e tentativas negativas (CHECK do banco)', () => {
    expect(() =>
      CodigoDeVerificacao.emitir({
        id: 'x',
        contaId: 'y',
        finalidade: 'verificacao_email',
        codigoHmac: '',
        agora: AGORA,
      }),
    ).toThrow();
    expect(() => CodigoDeVerificacao.reconstituir({ ...emitir().dados, tentativas: -1 })).toThrow();
  });
});
