import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { carregarAmbiente, ErroDeAmbiente, verificarAmbienteDeProducao } from './ambiente.ts';

const chave = (bytes = 32): string => randomBytes(bytes).toString('base64');

/** Valores fictícios; nenhum teste lê `.env`. */
function variaveis(extras: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'test',
    PORTA: '3000',
    DATABASE_URL: 'postgresql://usuario:senha@127.0.0.1:5432/banco',
    CORS_ORIGENS: 'http://localhost:5173, http://127.0.0.1:5173',
    JWT_SEGREDO: chave(),
    CHAVE_CIFRAGEM_DADOS: chave(),
    CHAVE_HMAC: chave(),
    SMTP_URL: 'smtp://127.0.0.1:1025',
    EMAIL_REMETENTE: 'nao-responda@bairrin.com.br',
    SENTRY_DSN: '',
    LOG_NIVEL: 'info',
    ...extras,
  };
}

function problemasDe(fonte: Record<string, string | undefined>): string[] {
  try {
    carregarAmbiente(fonte);
  } catch (erro) {
    if (erro instanceof ErroDeAmbiente) return [...erro.problemas];
    throw erro;
  }
  throw new Error('O ambiente deveria ter sido recusado.');
}

describe('carregarAmbiente', () => {
  it('aceita o ambiente completo e converte os tipos', () => {
    const ambiente = carregarAmbiente(variaveis());
    expect(ambiente.PORTA).toBe(3000);
    expect(ambiente.CORS_ORIGENS).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173']);
    expect(ambiente.SENTRY_DSN).toBeUndefined();
  });

  it('aceita as chaves de exemplo do .env.example fora de produção', () => {
    expect(() =>
      carregarAmbiente(
        variaveis({
          JWT_SEGREDO: 'EXEMPLOsomenteDEVnaoUSEemPRODjwt0000000000A=',
          CHAVE_CIFRAGEM_DADOS: 'EXEMPLOsomenteDEVnaoUSEemPRODcifra00000000A=',
          CHAVE_HMAC: 'EXEMPLOsomenteDEVnaoUSEemPRODhmac000000000A=',
        }),
      ),
    ).not.toThrow();
  });

  it.each(['JWT_SEGREDO', 'CHAVE_CIFRAGEM_DADOS', 'CHAVE_HMAC'])(
    'recusa %s com menos de 32 bytes sem mostrar o valor',
    (nome) => {
      const curta = chave(31);
      const problemas = problemasDe(variaveis({ [nome]: curta }));
      expect(problemas).toHaveLength(1);
      expect(problemas[0]).toMatch(new RegExp(`^${nome}: .*32 bytes`));
      expect(problemas.join('\n')).not.toContain(curta);
    },
  );

  it('recusa chave fora do base64 (texto qualquer de 32 caracteres)', () => {
    const problemas = problemasDe(variaveis({ JWT_SEGREDO: 'uma senha qualquer com espaços!!' }));
    expect(problemas[0]).toMatch(/^JWT_SEGREDO: .*base64/);
  });

  it('recusa chaves iguais entre si', () => {
    const mesma = chave();
    const problemas = problemasDe(
      variaveis({ JWT_SEGREDO: mesma, CHAVE_CIFRAGEM_DADOS: mesma, CHAVE_HMAC: mesma }),
    );
    expect(problemas.join('\n')).toMatch(/diferentes entre si/);
    expect(problemas.join('\n')).not.toContain(mesma);
  });

  it('recusa variável ausente, citando só o nome', () => {
    const problemas = problemasDe(variaveis({ DATABASE_URL: undefined, LOG_NIVEL: undefined }));
    expect(problemas.map((p) => p.split(':')[0])).toEqual(['DATABASE_URL', 'LOG_NIVEL']);
  });

  it.each(['*', 'http://localhost:5173/', 'https://painel.bairrin.com.br/caminho', ''])(
    'recusa a origem de CORS %j',
    (origem) => {
      expect(problemasDe(variaveis({ CORS_ORIGENS: origem }))[0]).toMatch(/^CORS_ORIGENS/);
    },
  );

  it('em produção, recusa a chave de exemplo e origem sem https', () => {
    const problemas = problemasDe(
      variaveis({
        NODE_ENV: 'production',
        JWT_SEGREDO: 'EXEMPLOsomenteDEVnaoUSEemPRODjwt0000000000A=',
        CORS_ORIGENS: 'http://painel.bairrin.com.br',
      }),
    );
    expect(problemas).toEqual([
      'JWT_SEGREDO: Valor de exemplo do .env.example não pode ser usado em produção.',
      'CORS_ORIGENS: Em produção, toda origem deve usar https://.',
    ]);
  });

  it('a mensagem do erro não contém nenhum valor recebido', () => {
    const fonte = variaveis({ PORTA: 'porta-invalida', EMAIL_REMETENTE: 'nao-e-email' });
    const erro = (() => {
      try {
        carregarAmbiente(fonte);
      } catch (e) {
        return e as Error;
      }
      throw new Error('deveria falhar');
    })();
    expect(erro.message).not.toContain('porta-invalida');
    expect(erro.message).not.toContain('nao-e-email');
    expect(erro.message).not.toContain(fonte.JWT_SEGREDO);
  });
});

describe('verificarAmbienteDeProducao', () => {
  const CA = '/app/certificados/supabase-ca.crt';
  const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
  const URL_SEGURA = `postgresql://bairrin_app:senha-do-banco@db.exemplo.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=${CA}`;
  const lerCa = (conteudo: string) => (caminho: string) => {
    if (caminho !== CA) throw new Error('arquivo inexistente');
    return conteudo;
  };

  function problemas(
    databaseUrl: string,
    fonte: Record<string, string | undefined> = {},
    lerArquivo = lerCa(PEM),
  ): string[] {
    try {
      verificarAmbienteDeProducao(
        { NODE_ENV: 'production', DATABASE_URL: databaseUrl },
        fonte,
        lerArquivo,
      );
      return [];
    } catch (erro) {
      if (erro instanceof ErroDeAmbiente) {
        expect(erro.message).not.toContain('senha-do-banco');
        return [...erro.problemas];
      }
      throw erro;
    }
  }

  it('aceita verify-full com a CA em PEM e sem o papel de migração', () => {
    expect(problemas(URL_SEGURA)).toEqual([]);
  });

  it('fora de produção não exige nada (banco local sem TLS)', () => {
    expect(() =>
      verificarAmbienteDeProducao(
        { NODE_ENV: 'development', DATABASE_URL: 'postgresql://a:b@127.0.0.1:5432/bairrin' },
        { DATABASE_URL_MIGRACAO: 'postgresql://m:n@127.0.0.1:5432/bairrin' },
        () => {
          throw new Error('não deveria ler arquivo');
        },
      ),
    ).not.toThrow();
  });

  it.each([
    ['sem sslmode', 'postgresql://a:senha-do-banco@db.exemplo:5432/postgres'],
    ['com sslmode=require', URL_SEGURA.replace('verify-full', 'require')],
    ['com sslmode=verify-ca', URL_SEGURA.replace('verify-full', 'verify-ca')],
    ['sem sslrootcert', URL_SEGURA.replace(`&sslrootcert=${CA}`, '')],
  ])('recusa DATABASE_URL %s', (_caso, url) => {
    expect(problemas(url)).toEqual([
      'DATABASE_URL: Em produção, use sslmode=verify-full e sslrootcert com o caminho da CA do Supabase.',
    ]);
  });

  it('recusa CA que não dá para ler', () => {
    expect(problemas(URL_SEGURA.replace(CA, '/nao/existe.crt'))).toEqual([
      'DATABASE_URL: Não foi possível ler o arquivo indicado em sslrootcert.',
    ]);
  });

  it('recusa o arquivo-aviso do repositório (CA ainda não substituída)', () => {
    const aviso = readFileSync(
      fileURLToPath(new URL('../../../../../infra/certificados/supabase-ca.crt', import.meta.url)),
      'utf8',
    );
    expect(problemas(URL_SEGURA, {}, lerCa(aviso))).toEqual([
      'DATABASE_URL: O arquivo de sslrootcert não é um certificado PEM. Substitua ' +
        'infra/certificados/supabase-ca.crt pela CA do Supabase.',
    ]);
  });

  it.each(['postgresql://m:senha-do-banco@db.exemplo:5432/postgres', ''])(
    'recusa DATABASE_URL_MIGRACAO no processo, mesmo vazia (S3)',
    (valor) => {
      expect(problemas(URL_SEGURA, { DATABASE_URL_MIGRACAO: valor })).toEqual([
        'DATABASE_URL_MIGRACAO: Não pode existir no processo da API nem do worker; ' +
          'o papel de migração só vale no release_command.',
      ]);
    },
  );

  it('recusa URL que não é URL sem mostrar o valor', () => {
    expect(problemas('nao-e-url-senha-do-banco')).toEqual(['DATABASE_URL: Não é uma URL válida.']);
  });
});
