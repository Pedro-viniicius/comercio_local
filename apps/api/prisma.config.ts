// Configuração do Prisma CLI (exigida pelo Prisma 7). Só a CLI usa este
// arquivo (`prisma migrate`, `prisma generate`); a aplicação conecta pelo
// `PrismaService`, com o driver adapter do `pg` e o papel `bairrin_app`.
//
// Não lê `.env`: as variáveis vêm do ambiente do processo
// (`node --env-file`, segredos do Fly no `release_command` ou o
// `globalSetup` dos testes de integração).
import { readFileSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

/**
 * Schema da tabela de controle `_prisma_migrations`. O Prisma a cria no schema
 * do parâmetro `schema` da URL (o padrão seria `public`, S2). Fica num schema
 * próprio, do papel de migração, sem nenhum acesso da aplicação.
 */
export const SCHEMA_DE_CONTROLE = 'migracoes';

/** Erro de configuração da URL de migração. Nunca cita a URL (tem a senha). */
export class ErroNaUrlDeMigracao extends Error {
  constructor(motivo: string) {
    super(`DATABASE_URL_MIGRACAO: ${motivo}`);
    this.name = 'ErroNaUrlDeMigracao';
  }
}

/** Lê o arquivo da CA; trocado nos testes. */
export type LerArquivo = (caminho: string) => string;

const lerDoDisco: LerArquivo = (caminho) => readFileSync(caminho, 'utf8');

/**
 * Confere a CA de `sslrootcert` em produção: o arquivo do repositório
 * (`infra/certificados/supabase-ca.crt`) é um aviso até ser trocado pela CA
 * baixada do painel do Supabase, e sem ela o deploy para aqui.
 */
function exigirCertificado(caminho: string, lerArquivo: LerArquivo): void {
  let conteudo: string;
  try {
    conteudo = lerArquivo(caminho);
  } catch {
    throw new ErroNaUrlDeMigracao('não foi possível ler o arquivo indicado em sslrootcert.');
  }
  if (!conteudo.includes('-----BEGIN CERTIFICATE-----')) {
    throw new ErroNaUrlDeMigracao(
      'o arquivo de sslrootcert não é um certificado PEM. Substitua ' +
        'infra/certificados/supabase-ca.crt pela CA do Supabase.',
    );
  }
}

/**
 * URL do papel de migração (dono dos schemas, S3) para o schema engine do
 * Prisma:
 * - `schema` fixado em `SCHEMA_DE_CONTROLE`, seja qual for o valor recebido:
 *   assim nenhum segredo mal configurado manda o controle para `public`;
 * - TLS (S21): o segredo usa a forma do libpq, a mesma que o `pg` entende
 *   (`sslmode=verify-full&sslrootcert=<CA>`). O schema engine não conhece
 *   `verify-full`: cai para `prefer` e aceita qualquer certificado. Por isso a
 *   URL é traduzida para `sslmode=require&sslcert=<CA>&sslaccept=strict`, que
 *   confere a cadeia e o nome do servidor (conferido com o Prisma 7.10.1
 *   (schema engine d1b3f37) em 2026-10-18, contra um Postgres com CA própria:
 *   a tradução recusa CA errada e nome que não confere; `verify-full` cru
 *   aceita os dois);
 * - em produção (`NODE_ENV=production`, como na imagem), recusa URL sem
 *   `verify-full`, sem `sslrootcert` ou com a CA ainda não substituída.
 * Vazia só para comando que não conecta (`prisma generate`); quem conecta
 * falha sem ela.
 */
export function urlDeMigracao(
  url: string | undefined,
  nodeEnv: string | undefined = process.env['NODE_ENV'],
  lerArquivo: LerArquivo = lerDoDisco,
): string {
  if (url === undefined || url.trim() === '') return '';
  let endereco: URL;
  try {
    endereco = new URL(url);
  } catch {
    throw new ErroNaUrlDeMigracao('não é uma URL válida.');
  }
  endereco.searchParams.set('schema', SCHEMA_DE_CONTROLE);

  const modo = endereco.searchParams.get('sslmode');
  const ca = endereco.searchParams.get('sslrootcert');
  if (nodeEnv === 'production') {
    if (modo !== 'verify-full' || ca === null || ca === '') {
      throw new ErroNaUrlDeMigracao(
        'em produção, use sslmode=verify-full e sslrootcert com o caminho da CA do Supabase.',
      );
    }
    exigirCertificado(ca, lerArquivo);
  }
  if (modo === 'verify-full') {
    if (ca === null || ca === '') {
      throw new ErroNaUrlDeMigracao('sslmode=verify-full exige sslrootcert com o caminho da CA.');
    }
    endereco.searchParams.delete('sslrootcert');
    endereco.searchParams.set('sslmode', 'require');
    endereco.searchParams.set('sslcert', ca);
    endereco.searchParams.set('sslaccept', 'strict');
  }
  return endereco.toString();
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: urlDeMigracao(process.env['DATABASE_URL_MIGRACAO']) },
});
