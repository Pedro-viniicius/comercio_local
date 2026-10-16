// Variáveis de ambiente da API, validadas na subida. Se faltar ou estiver
// inválida alguma, a API não sobe. A mensagem de erro cita só o nome da
// variável e o motivo, nunca o valor (pode ser segredo).
import { readFileSync } from 'node:fs';
import { z } from '@bairrin/contratos';

/** Token de injeção do ambiente validado. */
export const AMBIENTE = Symbol('AMBIENTE');

/** Tamanho mínimo das chaves depois de decodificadas do base64 (S17). */
export const BYTES_MINIMOS_DA_CHAVE = 32;

/** Prefixo dos valores de exemplo do `.env.example`, recusados em produção. */
const PREFIXO_DE_EXEMPLO = 'EXEMPLO';

const NIVEIS_DE_LOG = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

const base64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

/**
 * Chave em base64 (padrão ou URL) com pelo menos 32 bytes depois de
 * decodificada, como sai de `openssl rand -base64 32`.
 */
const chave = z
  .string()
  .regex(base64, { error: 'Deve estar em base64 (gere com: openssl rand -base64 32).' })
  .refine((valor) => Buffer.from(valor, 'base64').length >= BYTES_MINIMOS_DA_CHAVE, {
    error: `Deve ter no mínimo ${BYTES_MINIMOS_DA_CHAVE} bytes depois de decodificada do base64.`,
  });

const urlDoPostgres = z
  .string()
  .regex(/^postgres(ql)?:\/\//, { error: 'Deve ser uma URL postgresql://.' });

/**
 * Origem do navegador aceita pelo CORS: só `http(s)://host[:porta]`, sem
 * caminho, sem barra no fim e nunca `*`.
 */
const origem = z
  .string()
  .trim()
  .regex(/^https?:\/\/[^/\s*?#]+$/, {
    error: 'Cada origem deve ser http(s)://host[:porta], sem caminho e sem "*".',
  });

const esquemaDoAmbiente = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORTA: z.coerce.number().int().min(1).max(65535),
    DATABASE_URL: urlDoPostgres,
    CORS_ORIGENS: z
      .string()
      .transform((valor) =>
        valor
          .split(',')
          .map((parte) => parte.trim())
          .filter((parte) => parte.length > 0),
      )
      .pipe(z.array(origem).min(1, { error: 'Informe ao menos uma origem.' })),
    JWT_SEGREDO: chave,
    CHAVE_CIFRAGEM_DADOS: chave,
    CHAVE_HMAC: chave,
    SMTP_URL: z.string().regex(/^smtps?:\/\//, { error: 'Deve ser uma URL smtp:// ou smtps://.' }),
    EMAIL_REMETENTE: z.email(),
    // Vazio desliga o Sentry.
    SENTRY_DSN: z
      .string()
      .optional()
      .transform((valor) => (valor && valor.trim().length > 0 ? valor.trim() : undefined))
      .pipe(z.url().optional()),
    LOG_NIVEL: z.enum(NIVEIS_DE_LOG),
  })
  .superRefine((ambiente, contexto) => {
    const chaves = ['JWT_SEGREDO', 'CHAVE_CIFRAGEM_DADOS', 'CHAVE_HMAC'] as const;
    const valores = new Set(chaves.map((nome) => ambiente[nome]));
    if (valores.size !== chaves.length) {
      contexto.addIssue({
        code: 'custom',
        path: ['CHAVE_HMAC'],
        message: 'JWT_SEGREDO, CHAVE_CIFRAGEM_DADOS e CHAVE_HMAC devem ser diferentes entre si.',
      });
    }
    if (ambiente.NODE_ENV !== 'production') return;
    for (const nome of chaves) {
      if (ambiente[nome].startsWith(PREFIXO_DE_EXEMPLO)) {
        contexto.addIssue({
          code: 'custom',
          path: [nome],
          message: 'Valor de exemplo do .env.example não pode ser usado em produção.',
        });
      }
    }
    for (const endereco of ambiente.CORS_ORIGENS) {
      if (!endereco.startsWith('https://')) {
        contexto.addIssue({
          code: 'custom',
          path: ['CORS_ORIGENS'],
          message: 'Em produção, toda origem deve usar https://.',
        });
      }
    }
  });

export type Ambiente = z.infer<typeof esquemaDoAmbiente>;

/** Erro de subida com a lista `VARIAVEL: motivo`, sem nenhum valor. */
export class ErroDeAmbiente extends Error {
  constructor(readonly problemas: readonly string[]) {
    super(`Variáveis de ambiente inválidas:\n- ${problemas.join('\n- ')}`);
    this.name = 'ErroDeAmbiente';
  }
}

/**
 * Valida e converte as variáveis (em geral `process.env`). Lança
 * `ErroDeAmbiente` se alguma faltar ou for inválida. A issue final do zod não
 * carrega o valor recebido, então a mensagem não expõe segredo.
 */
export function carregarAmbiente(fonte: Readonly<Record<string, string | undefined>>): Ambiente {
  const resultado = esquemaDoAmbiente.safeParse(fonte);
  if (resultado.success) return resultado.data;
  throw new ErroDeAmbiente(
    resultado.error.issues.map((issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`),
  );
}

/** Lê o arquivo da CA do banco; trocado nos testes. */
export type LerArquivo = (caminho: string) => string;

const lerDoDisco: LerArquivo = (caminho) => readFileSync(caminho, 'utf8');

/** Início de todo certificado em PEM. O arquivo-aviso do repositório não tem. */
const INICIO_DE_CERTIFICADO = '-----BEGIN CERTIFICATE-----';

/**
 * Problemas da conexão TLS com o banco em produção (S21): a URL precisa de
 * `sslmode=verify-full` (o `pg` confere a cadeia e o nome do servidor) e de
 * `sslrootcert` com a CA do Supabase. Nunca cita a URL (tem a senha).
 */
function problemasDoTlsDoBanco(nome: string, url: string, lerArquivo: LerArquivo): string[] {
  let endereco: URL;
  try {
    endereco = new URL(url);
  } catch {
    return [`${nome}: Não é uma URL válida.`];
  }
  const modo = endereco.searchParams.get('sslmode');
  const ca = endereco.searchParams.get('sslrootcert');
  if (modo !== 'verify-full' || ca === null || ca === '') {
    return [
      `${nome}: Em produção, use sslmode=verify-full e sslrootcert com o caminho da CA do Supabase.`,
    ];
  }
  let conteudo: string;
  try {
    conteudo = lerArquivo(ca);
  } catch {
    return [`${nome}: Não foi possível ler o arquivo indicado em sslrootcert.`];
  }
  if (!conteudo.includes(INICIO_DE_CERTIFICADO)) {
    return [
      `${nome}: O arquivo de sslrootcert não é um certificado PEM. Substitua ` +
        'infra/certificados/supabase-ca.crt pela CA do Supabase.',
    ];
  }
  return [];
}

/**
 * Regras que só valem em produção e olham além das variáveis validadas pelo
 * esquema. Chamada pelo `main.ts` e pelo `worker.ts` logo depois de
 * `carregarAmbiente`; lança `ErroDeAmbiente` e o processo não sobe:
 * - conexão com o banco com `verify-full` e a CA do Supabase (S21);
 * - `DATABASE_URL_MIGRACAO` ausente: o papel de migração só existe no
 *   `release_command` (S3). Os segredos do Fly chegam a todas as máquinas, então
 *   os processos `app` e `worker` do `fly.toml` a tiram do ambiente antes de
 *   iniciar (`env -u`); esta checagem garante que ninguém esqueça.
 */
export function verificarAmbienteDeProducao(
  ambiente: Pick<Ambiente, 'NODE_ENV' | 'DATABASE_URL'>,
  fonte: Readonly<Record<string, string | undefined>>,
  lerArquivo: LerArquivo = lerDoDisco,
): void {
  if (ambiente.NODE_ENV !== 'production') return;
  const problemas = problemasDoTlsDoBanco('DATABASE_URL', ambiente.DATABASE_URL, lerArquivo);
  if (fonte['DATABASE_URL_MIGRACAO'] !== undefined) {
    problemas.push(
      'DATABASE_URL_MIGRACAO: Não pode existir no processo da API nem do worker; ' +
        'o papel de migração só vale no release_command.',
    );
  }
  if (problemas.length > 0) throw new ErroDeAmbiente(problemas);
}
