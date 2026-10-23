// Prova as regras de `.dependency-cruiser.cjs` (CA-F7): cada regra reprova a
// fixture que a viola, as dependências permitidas passam e a árvore real não
// tem violação.
//
// Roda a CLI do dependency-cruiser (o mesmo caminho do `pnpm deps:verificar`),
// uma vez nas fixtures e uma vez na árvore real, em paralelo.
import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '../../../..');
const raizDasFixtures = join(aqui, 'fixtures');
const arquivoDeConfig = join(raiz, '.dependency-cruiser.cjs');

const exigir = createRequire(import.meta.url);
const cli = join(raiz, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs');
const regrasDaConfig = (exigir(arquivoDeConfig) as { forbidden: { name: string }[] }).forbidden.map(
  (regra) => regra.name,
);

interface Dependencia {
  module: string;
  resolved: string;
  couldNotResolve: boolean;
}
interface Resultado {
  modules: { source: string; dependencies: Dependencia[] }[];
  summary: { violations: { from: string; to: string; rule: { name: string } }[] };
}

/** Roda `depcruise apps packages` com a raiz dada e devolve o JSON (sai com 1 quando há violação). */
function cruzar(cwd: string): Promise<Resultado> {
  return new Promise((resolver, rejeitar) => {
    execFile(
      process.execPath,
      [cli, 'apps', 'packages', '--config', arquivoDeConfig, '--output-type', 'json'],
      { cwd, maxBuffer: 64 * 1024 * 1024 },
      (erro, stdout, stderr) => {
        try {
          resolver(JSON.parse(stdout) as Resultado);
        } catch {
          rejeitar(
            new Error(`depcruise não devolveu JSON (${erro?.message ?? 'sem erro'}): ${stderr}`),
          );
        }
      },
    );
  });
}

let fixtures: Resultado;
let real: Resultado;

beforeAll(async () => {
  [fixtures, real] = await Promise.all([cruzar(raizDasFixtures), cruzar(raiz)]);
}, 90_000);

const M = 'apps/api/src/modulos';
const N = 'apps/api/src/compartilhado';

/** Violação esperada: regra e arquivo de origem (uma por fixture `viola-*`). */
const esperadas: [regra: string, de: string][] = [
  // Domínio importando aplicação, infra, http, framework e pacotes (CA-F7 e regras extras).
  ['dominio-nao-importa-camadas-externas', `${M}/a/dominio/viola-aplicacao.ts`],
  ['dominio-nao-importa-camadas-externas', `${M}/a/dominio/viola-infra.ts`],
  ['dominio-nao-importa-camadas-externas', `${M}/a/dominio/viola-http.ts`],
  ['dominio-nao-importa-framework', `${M}/a/dominio/viola-nestjs.ts`],
  ['dominio-nao-importa-framework', `${M}/a/dominio/viola-prisma.ts`],
  ['dominio-so-importa-validadores', `${M}/a/dominio/viola-contratos-raiz.ts`],
  ['dominio-so-importa-validadores', `${M}/a/dominio/viola-contratos-outro-subcaminho.ts`],
  ['dominio-so-importa-validadores', `${M}/a/dominio/viola-pacote-do-workspace.ts`],
  // Aplicação importando infra ou http.
  ['aplicacao-nao-importa-infra-nem-http', `${M}/a/aplicacao/viola-infra.ts`],
  ['aplicacao-nao-importa-infra-nem-http', `${M}/a/aplicacao/viola-http.ts`],
  // Módulo importando outro fora do index.ts (este também é aplicação importando infra).
  ['modulo-so-importa-index-de-outro-modulo', `${M}/b/aplicacao/viola-interno-de-a.ts`],
  ['modulo-so-importa-index-de-outro-modulo', `${M}/b/aplicacao/viola-infra-de-a.ts`],
  ['aplicacao-nao-importa-infra-nem-http', `${M}/b/aplicacao/viola-infra-de-a.ts`],
  // Domínio e aplicação importando adaptador do núcleo (pasta ou sufixo `.adaptador.ts`).
  ['dominio-nao-importa-adaptador-do-nucleo', `${M}/a/dominio/viola-infra-do-nucleo.ts`],
  ['dominio-nao-importa-adaptador-do-nucleo', `${M}/a/dominio/viola-log-do-nucleo.ts`],
  ['aplicacao-nao-importa-adaptador-do-nucleo', `${M}/a/aplicacao/viola-infra-do-nucleo.ts`],
  ['aplicacao-nao-importa-adaptador-do-nucleo', `${M}/a/aplicacao/viola-adaptador-do-nucleo.ts`],
  // Núcleo importando um módulo; client gerado do Prisma fora da infra.
  ['nucleo-nao-importa-modulos', `${N}/viola-modulos.ts`],
  ['client-do-prisma-so-na-infra', `${M}/a/http/viola-client-gerado.ts`],
  // Apps e pacotes importando apps/api.
  ['fora-da-api-nao-importa-api', 'apps/consumidor/src/viola-api.ts'],
  ['fora-da-api-nao-importa-api', 'packages/comum/src/viola-api.ts'],
  // Código de produção importando fake de teste (Q7).
  ['producao-nao-importa-test', `${M}/a/aplicacao/viola-fake-de-teste.ts`],
];

describe('fronteiras de camadas: fixtures', () => {
  it('reprova exatamente as fixtures que violam, cada uma pela regra certa', () => {
    const encontradas = fixtures.summary.violations.map((v) => `${v.rule.name} | ${v.from}`).sort();
    const previstas = esperadas.map(([regra, de]) => `${regra} | ${de}`).sort();
    expect(encontradas).toEqual(previstas);
  });

  it('toda regra da configuração tem ao menos uma fixture que a reprova', () => {
    const reprovadas = new Set(fixtures.summary.violations.map((v) => v.rule.name));
    expect([...reprovadas].sort()).toEqual([...regrasDaConfig].sort());
  });

  it('as dependências permitidas (controles) passam', () => {
    const controles = [
      `${M}/a/dominio/regra.ts`,
      `${M}/a/dominio/usa-pacote-permitido.ts`,
      `${M}/a/dominio/usa-validadores-nao-resolvido.ts`,
      `${M}/a/dominio/usa-porta-do-nucleo.ts`,
      `${M}/a/aplicacao/caso-de-uso.ts`,
      `${M}/a/aplicacao/usa-porta-do-nucleo.ts`,
      `${M}/a/infra/repositorio.ts`,
      `${M}/a/infra/usa-client-gerado.ts`,
      `${N}/infra/usa-client-gerado.ts`,
      `${M}/a/http/controlador.ts`,
      `${M}/b/aplicacao/usa-index-de-a.ts`,
      'apps/consumidor/src/usa-pacote.ts',
    ];
    const origens = new Set(fixtures.modules.map((m) => m.source));
    const reprovados = new Set(fixtures.summary.violations.map((v) => v.from));
    for (const controle of controles) {
      expect(origens.has(controle), `${controle} não foi analisado`).toBe(true);
      expect(reprovados.has(controle), `${controle} foi reprovado`).toBe(false);
    }
  });

  it('a resolução enxerga os imports: só o subcaminho inexistente fica sem resolver', () => {
    const naoResolvidas = fixtures.modules
      .flatMap((m) =>
        m.dependencies.filter((d) => d.couldNotResolve).map((d) => `${m.source} -> ${d.module}`),
      )
      .sort();
    expect(naoResolvidas).toEqual([
      `${M}/a/dominio/viola-contratos-outro-subcaminho.ts -> @bairrin/contratos/outro`,
    ]);
  });

  it('@bairrin/contratos/validadores resolve para o fonte do subcaminho no pacote real', () => {
    const fixture = fixtures.modules.find(
      (m) => m.source === `${M}/a/dominio/usa-validadores-nao-resolvido.ts`,
    );
    const destinos = fixture?.dependencies.map((d) => d.resolved) ?? [];
    expect(destinos).toHaveLength(1);
    // Fora da raiz das fixtures, o caminho do pacote real vem com `../`.
    expect(destinos[0]).toMatch(/^(\.\.\/)+packages\/contratos\/src\/validadores\/index\.ts$/);
  });
});

describe('fronteiras de camadas: árvore real', () => {
  it('não tem violação', () => {
    expect(real.summary.violations).toEqual([]);
  });

  it('fakes ficam em apps/api/test: nenhum arquivo *falso* em apps/api/src (Q7)', () => {
    const fonte = join(raiz, 'apps/api/src');
    const falsos = readdirSync(fonte, { recursive: true, encoding: 'utf8' }).filter((caminho) =>
      /falso/i.test(basename(caminho)),
    );
    expect(falsos).toEqual([]);
  });

  it('fakes ficam em apps/api/test: nenhum arquivo fake, mock ou stub em apps/api/src (Q7, QA)', () => {
    // O nome em português é o do teste acima; este cobre os nomes em inglês, que a regra de
    // importação não pega (um fake de src/ que não importa nada de test/ passa por ela).
    const fonte = join(raiz, 'apps/api/src');
    const suspeitos = readdirSync(fonte, { recursive: true, encoding: 'utf8' }).filter((caminho) =>
      /(^|[^a-z])(fake|mock|stub)s?([^a-z]|$)/i.test(basename(caminho)),
    );
    expect(suspeitos).toEqual([]);
  });

  it('o teste do SMTP importa o fake de test/fakes sem violar producao-nao-importa-test (Q7)', () => {
    const teste = real.modules.find((m) => m.source === `${N}/infra/smtp.adaptador.test.ts`);
    expect(teste?.dependencies.map((d) => d.resolved)).toContain(
      'apps/api/test/fakes/compartilhado/enviador-de-email-falso.ts',
    );
  });

  it('analisa a API e os pacotes, resolvendo @bairrin/* pelo código-fonte, sem as fixtures', () => {
    const origens = real.modules.map((m) => m.source);
    expect(origens).toContain('apps/api/src/main.ts');
    expect(origens.some((o) => o.startsWith('packages/contratos/src/'))).toBe(true);
    expect(origens.filter((o) => o.startsWith('apps/api/test/fronteiras/fixtures/'))).toEqual([]);
    // O client gerado entra só como folha (destino da regra do client), sem ser percorrido.
    const gerados = real.modules.filter((m) => m.source.includes('/gerado/'));
    expect(gerados.map((m) => m.source)).toEqual([`${N}/infra/gerado/prisma/client.ts`]);
    expect(gerados.flatMap((m) => m.dependencies)).toEqual([]);

    const resolvidas = real.modules.flatMap((m) => m.dependencies.map((d) => d.resolved));
    expect(resolvidas).toContain('packages/contratos/src/index.ts');
  });

  it('as portas do núcleo não importam Nest, Prisma, o client gerado nem adaptador', () => {
    const portas = [
      `${N}/transacao/unidade-de-trabalho.ts`,
      `${N}/tempo/relogio.ts`,
      `${N}/eventos/publicador.ts`,
      `${N}/auditoria/repositorio-de-auditoria.ts`,
      `${N}/email/enviador-de-email.ts`,
      `${N}/titular/dado-pessoal.ts`,
      // A guarda global consulta esta porta; a Identidade a implementa (01b, etapa 16).
      `${N}/autenticacao/verificador-de-acesso.ts`,
    ];
    const proibido = new RegExp(
      `node_modules/(@nestjs|@prisma|nestjs-pino|pg|pg-boss|nodemailer)/|^${N}/(infra|http|log|observabilidade|config)/|\\.adaptador\\.ts$`,
    );
    for (const porta of portas) {
      const modulo = real.modules.find((m) => m.source === porta);
      expect(modulo, `${porta} não foi analisada`).toBeDefined();
      const indevidas = (modulo?.dependencies ?? [])
        .map((d) => d.resolved)
        .filter((destino) => proibido.test(destino));
      expect(indevidas, porta).toEqual([]);
    }
  });
});
