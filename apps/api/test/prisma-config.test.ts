// `urlDeMigracao` do prisma.config.ts: schema de controle fixo e TLS do papel
// de migração no formato que o schema engine do Prisma entende (S21).
import { describe, expect, it } from 'vitest';
import { ErroNaUrlDeMigracao, SCHEMA_DE_CONTROLE, urlDeMigracao } from '../prisma.config.ts';

const CA = '/app/certificados/supabase-ca.crt';
const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
const BASE = 'postgresql://bairrin_migracao:senha-do-banco@db.exemplo.supabase.co:5432/postgres';
const SEGURA = `${BASE}?sslmode=verify-full&sslrootcert=${CA}`;
const lerCa = (conteudo: string) => (caminho: string) => {
  if (caminho !== CA) throw new Error('arquivo inexistente');
  return conteudo;
};

function parametros(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams);
}

function erroDe(executar: () => unknown): Error {
  try {
    executar();
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroNaUrlDeMigracao);
    expect((erro as Error).message).not.toContain('senha-do-banco');
    return erro as Error;
  }
  throw new Error('deveria ter recusado a URL');
}

describe('urlDeMigracao', () => {
  it('vazia continua vazia (prisma generate não conecta)', () => {
    expect(urlDeMigracao(undefined, 'production')).toBe('');
    expect(urlDeMigracao('  ', 'production')).toBe('');
  });

  it('fixa o schema de controle, qualquer que seja o recebido', () => {
    expect(parametros(urlDeMigracao(`${BASE}?schema=public`, 'test'))).toEqual({
      schema: SCHEMA_DE_CONTROLE,
    });
  });

  it('traduz verify-full do libpq para o schema engine (cadeia e nome conferidos)', () => {
    expect(parametros(urlDeMigracao(SEGURA, 'development'))).toEqual({
      schema: SCHEMA_DE_CONTROLE,
      sslmode: 'require',
      sslcert: CA,
      sslaccept: 'strict',
    });
  });

  it('em produção, aceita verify-full com a CA em PEM', () => {
    expect(parametros(urlDeMigracao(SEGURA, 'production', lerCa(PEM)))).toMatchObject({
      sslmode: 'require',
      sslaccept: 'strict',
    });
  });

  it.each([
    ['sem TLS', BASE],
    ['com sslmode=require', `${BASE}?sslmode=require&sslrootcert=${CA}`],
    ['sem sslrootcert', `${BASE}?sslmode=verify-full`],
  ])('em produção, recusa URL %s', (_caso, url) => {
    expect(erroDe(() => urlDeMigracao(url, 'production', lerCa(PEM))).message).toBe(
      'DATABASE_URL_MIGRACAO: em produção, use sslmode=verify-full e sslrootcert com o caminho da CA do Supabase.',
    );
  });

  it('em produção, recusa a CA ainda não substituída', () => {
    expect(erroDe(() => urlDeMigracao(SEGURA, 'production', lerCa('SUBSTITUA'))).message).toMatch(
      /não é um certificado PEM/,
    );
  });

  it('em produção, recusa CA que não dá para ler', () => {
    expect(
      erroDe(() => urlDeMigracao(SEGURA.replace(CA, '/nao/existe'), 'production', lerCa(PEM)))
        .message,
    ).toMatch(/não foi possível ler/);
  });

  it('verify-full sem sslrootcert é recusado em qualquer ambiente', () => {
    expect(erroDe(() => urlDeMigracao(`${BASE}?sslmode=verify-full`, 'test')).message).toMatch(
      /exige sslrootcert/,
    );
  });

  it('URL inválida é recusada sem mostrar o valor', () => {
    expect(erroDe(() => urlDeMigracao('nao-e-url-senha-do-banco', 'test')).message).toMatch(
      /não é uma URL válida/,
    );
  });
});
