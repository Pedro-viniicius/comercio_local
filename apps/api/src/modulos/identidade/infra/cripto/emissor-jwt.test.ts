// JWT de acesso (CA-03, S17): HS256 de 15 min com `iss`/`aud` fixos. Qualquer
// outro algoritmo (HS512 com o mesmo segredo, `alg: none`), outro emissor ou
// público, outra chave, token alterado e token vencido são recusados.
import { randomBytes } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import type { ReivindicacoesDoToken } from '../../dominio/sessao.ts';
import { EMISSOR_DO_TOKEN, EmissorJwt, PUBLICO_DO_TOKEN } from './emissor-jwt.ts';

const SEGREDO = randomBytes(32).toString('base64');
const emissor = new EmissorJwt({ JWT_SEGREDO: SEGREDO });
const jwt = new JwtService();

const AGORA = new Date('2026-10-18T12:00:00.000Z');
const IAT = AGORA.getTime() / 1000;

const REIVINDICACOES: ReivindicacoesDoToken = {
  contaId: '0b5f6a51-6a8f-4d2c-9a43-2f6d3f1a9c01',
  sid: '7d1e2c3b-4a59-4f60-8b71-9c8d7e6f5a02',
  perfis: ['consumidor', 'admin'],
  mfa: true,
  emailVerificado: false,
};

function segundosDepois(segundos: number): Date {
  return new Date(AGORA.getTime() + segundos * 1000);
}

function base64url(objeto: object): string {
  return Buffer.from(JSON.stringify(objeto), 'utf8').toString('base64url');
}

/** Payload como o emissor monta, para forjar variações assinadas à mão. */
function payloadEmitido(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: REIVINDICACOES.contaId,
    sid: REIVINDICACOES.sid,
    perfis: [...REIVINDICACOES.perfis],
    mfa: REIVINDICACOES.mfa,
    emailVerificado: REIVINDICACOES.emailVerificado,
    iat: IAT,
    exp: IAT + 900,
    iss: EMISSOR_DO_TOKEN,
    aud: PUBLICO_DO_TOKEN,
    ...extra,
  };
}

function assinar(
  payload: Record<string, unknown>,
  opcoes: { algoritmo?: 'HS256' | 'HS384' | 'HS512'; segredo?: string } = {},
): string {
  return jwt.sign(payload, {
    secret: Buffer.from(opcoes.segredo ?? SEGREDO, 'base64'),
    algorithm: opcoes.algoritmo ?? 'HS256',
  });
}

describe('EmissorJwt.emitir', () => {
  it('assina HS256 com iss, aud, sub, iat = agora e exp - iat = 900', async () => {
    const { token, expiraEm } = await emissor.emitir(REIVINDICACOES, AGORA);
    const { header, payload } = jwt.decode<Record<string, unknown>>(token, { complete: true });
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(payload).toEqual(payloadEmitido());
    expect(Number(payload['exp']) - Number(payload['iat'])).toBe(900);
    expect(expiraEm).toEqual(segundosDepois(900));
  });

  it('não leva dado pessoal nem segredo no payload, só ids, perfis e marcas', async () => {
    const { token } = await emissor.emitir(REIVINDICACOES, AGORA);
    const payload = jwt.decode<Record<string, unknown>>(token);
    expect(Object.keys(payload).sort()).toEqual(
      ['aud', 'emailVerificado', 'exp', 'iat', 'iss', 'mfa', 'perfis', 'sid', 'sub'].sort(),
    );
  });

  it('arredonda o agora para baixo, ao segundo', async () => {
    const { token, expiraEm } = await emissor.emitir(
      REIVINDICACOES,
      new Date(AGORA.getTime() + 999),
    );
    expect(jwt.decode<Record<string, unknown>>(token)).toMatchObject({ iat: IAT, exp: IAT + 900 });
    expect(expiraEm).toEqual(segundosDepois(900));
  });
});

describe('EmissorJwt.verificar', () => {
  it('devolve as claims do token válido até o último segundo antes de exp', async () => {
    const { token } = await emissor.emitir(REIVINDICACOES, AGORA);
    await expect(emissor.verificar(token, AGORA)).resolves.toEqual(REIVINDICACOES);
    await expect(emissor.verificar(token, segundosDepois(899))).resolves.toEqual(REIVINDICACOES);
  });

  it('recusa token vencido (a partir de exp)', async () => {
    const { token } = await emissor.emitir(REIVINDICACOES, AGORA);
    await expect(emissor.verificar(token, segundosDepois(900))).resolves.toBeNull();
    await expect(emissor.verificar(token, segundosDepois(3600))).resolves.toBeNull();
  });

  it('recusa HS512 e HS384 assinados com o mesmo segredo', async () => {
    for (const algoritmo of ['HS512', 'HS384'] as const) {
      const token = assinar(payloadEmitido(), { algoritmo });
      expect(jwt.decode(token, { complete: true }).header.alg).toBe(algoritmo);
      await expect(emissor.verificar(token, AGORA)).resolves.toBeNull();
    }
  });

  it('recusa alg: none, com e sem assinatura', async () => {
    const corpo = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payloadEmitido())}`;
    await expect(emissor.verificar(`${corpo}.`, AGORA)).resolves.toBeNull();
    const assinaturaValida = assinar(payloadEmitido()).split('.')[2] ?? '';
    await expect(emissor.verificar(`${corpo}.${assinaturaValida}`, AGORA)).resolves.toBeNull();
  });

  it('recusa iss ou aud trocados, ou ausentes', async () => {
    const casos = [
      payloadEmitido({ iss: 'outro-emissor' }),
      payloadEmitido({ aud: 'outro-publico' }),
      payloadEmitido({ aud: ['outro-publico'] }),
      payloadEmitido({ iss: undefined }),
      payloadEmitido({ aud: undefined }),
    ];
    for (const payload of casos) {
      await expect(emissor.verificar(assinar(payload), AGORA)).resolves.toBeNull();
    }
  });

  it('recusa token assinado com outro segredo', async () => {
    const outro = new EmissorJwt({ JWT_SEGREDO: randomBytes(32).toString('base64') });
    const { token } = await outro.emitir(REIVINDICACOES, AGORA);
    await expect(emissor.verificar(token, AGORA)).resolves.toBeNull();
  });

  it('recusa payload alterado com a assinatura original (ex.: perfil admin acrescentado)', async () => {
    const semAdmin = { ...REIVINDICACOES, perfis: ['consumidor'] as const, mfa: false };
    const { token } = await emissor.emitir(semAdmin, AGORA);
    const [cabecalho, , assinatura] = token.split('.');
    const forjado = `${cabecalho ?? ''}.${base64url(payloadEmitido())}.${assinatura ?? ''}`;
    await expect(emissor.verificar(forjado, AGORA)).resolves.toBeNull();
  });

  it('recusa token do mesmo segredo com validade diferente de 900 s', async () => {
    const longo = assinar(payloadEmitido({ exp: IAT + 30 * 24 * 3600 }));
    await expect(emissor.verificar(longo, AGORA)).resolves.toBeNull();
  });

  it.each([
    ['sem sub', { sub: undefined }],
    ['sub vazio', { sub: '' }],
    ['sem sid', { sid: undefined }],
    ['sid que não é texto', { sid: 123 }],
    ['perfil desconhecido', { perfis: ['consumidor', 'superusuario'] }],
    ['perfis que não são lista', { perfis: 'admin' }],
    ['mfa que não é booleano', { mfa: 'true' }],
    ['emailVerificado ausente', { emailVerificado: undefined }],
  ])('recusa token do mesmo segredo com claims fora da forma (%s)', async (_caso, extra) => {
    await expect(emissor.verificar(assinar(payloadEmitido(extra)), AGORA)).resolves.toBeNull();
  });

  it('recusa token com nbf no futuro', async () => {
    const token = assinar(payloadEmitido({ nbf: IAT + 60 }));
    await expect(emissor.verificar(token, AGORA)).resolves.toBeNull();
  });

  it.each([
    ['vazio', ''],
    ['texto qualquer', 'nao-e-jwt'],
    ['três partes sem JSON', 'a.b.c'],
    ['duas partes', 'a.b'],
    ['cabeçalho sem alg', `${base64url({ typ: 'JWT' })}.${base64url(payloadEmitido())}.x`],
  ])('recusa token mal formado (%s) sem lançar', async (_caso, token) => {
    await expect(emissor.verificar(token, AGORA)).resolves.toBeNull();
  });
});
