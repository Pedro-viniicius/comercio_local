// `seed:admin` de ponta a ponta (plano 01b, etapa 16, "Vindo do grupo D"; CA-07, CA-09): a
// CLI compilada, num processo à parte, sobe o `AppModule` inteiro (com o `IdentidadeModule`),
// pega `CriarAdminCasoDeUso` da injeção de dependência e cria a conta admin no Postgres de
// teste. Depois, pelos casos de uso: a conta define a senha pelo código do e-mail e o login no
// painel pede a configuração do segundo fator.
//
// O build vai para uma pasta temporária (o `dist/` do repositório não muda). O
// `@bairrin/contratos` é lido do código-fonte (`--conditions=@bairrin/fonte`), para o teste
// não depender de um build antigo do pacote.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import { URL_APP_TESTE } from '../preparar-banco.ts';
import { ipNovo } from './api-http.ts';
import {
  apagarContasDoTeste,
  CHAVES,
  conectarDono,
  type DocumentosDeTeste,
  emailUnico,
  eventosDaConta,
  inserirCodigo,
  montarPilha,
  operadorAdmin,
  OUTRA_SENHA,
  type Pilha,
  semearDocumentos,
} from './pilha-de-casos-de-uso.ts';

const PASTA_DA_API = fileURLToPath(new URL('../../../', import.meta.url));
const TSC = createRequire(join(PASTA_DA_API, 'package.json')).resolve('typescript/bin/tsc');

let p: Pilha;
let dono: pg.Client;
let docs: DocumentosDeTeste;
let pastaDoBuild: string;
const contasDoTeste: string[] = [];
const freiosDoTeste: string[] = [];

beforeAll(() => {
  pastaDoBuild = mkdtempSync(join(tmpdir(), 'bairrin-seed-admin-'));
  const build = spawnSync(
    process.execPath,
    [TSC, '-p', 'tsconfig.build.json', '--outDir', join(pastaDoBuild, 'dist')],
    { cwd: PASTA_DA_API, encoding: 'utf8' },
  );
  if (build.status !== 0) throw new Error(`o build da API falhou:\n${build.stdout}`);
  // `lerVersaoDaApi` lê o `package.json` ao lado do `dist/`; as dependências são as da API.
  cpSync(join(PASTA_DA_API, 'package.json'), join(pastaDoBuild, 'package.json'));
  symlinkSync(join(PASTA_DA_API, 'node_modules'), join(pastaDoBuild, 'node_modules'), 'dir');
}, 60_000);

beforeAll(async () => {
  p = montarPilha();
  dono = await conectarDono();
  docs = await semearDocumentos(dono);
});

afterAll(async () => {
  if (dono !== undefined) {
    await apagarContasDoTeste(dono, contasDoTeste, freiosDoTeste);
    await docs?.remover();
    await dono.end();
  }
  await p?.prisma.$disconnect();
  if (pastaDoBuild !== undefined) rmSync(pastaDoBuild, { recursive: true, force: true });
});

/** Roda a CLI compilada com o ambiente da API de teste e as linhas na entrada padrão. */
function rodarCli(argumentos: string[], linhas: string[]) {
  return spawnSync(
    process.execPath,
    ['--conditions=@bairrin/fonte', join(pastaDoBuild, 'dist/cli/seed-admin.js'), ...argumentos],
    {
      cwd: pastaDoBuild,
      env: {
        PATH: process.env['PATH'] ?? '',
        NODE_ENV: 'test',
        PORTA: '3000',
        DATABASE_URL: URL_APP_TESTE,
        CORS_ORIGENS: 'https://painel.bairrin.com.br',
        ...CHAVES,
        SMTP_URL: 'smtp://127.0.0.1:1025',
        EMAIL_REMETENTE: 'nao-responda@bairrin.com.br',
        LOG_NIVEL: 'info',
      },
      input: linhas.map((linha) => `${linha}\n`).join(''),
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
}

describe('seed:admin com o Nest completo (CA-07, CA-09)', () => {
  it('cria o admin sem senha; a senha vem pelo código do e-mail e o painel pede o segundo fator', async () => {
    const operador = await operadorAdmin(p, docs);
    contasDoTeste.push(operador.id);
    const email = emailUnico('seed-admin');
    freiosDoTeste.push(p.servicos.cifrador.hmac('bloqueio_email', [email]));

    const resultado = rodarCli(
      ['--operador', operador.id],
      [email, email, 'Admin do Seed', '(35) 99999-4321'],
    );

    expect(resultado.stderr).toBe('');
    expect(resultado.status).toBe(0);
    const criada = await p.repos.contas.buscarPorEmail(Email.criar(email));
    if (criada === null) throw new Error('a CLI não criou a conta');
    contasDoTeste.push(criada.id);
    expect(resultado.stdout).toContain(`Conta admin ${criada.id} criada, sem senha.`);
    // A saída cita só o id (S99).
    expect(resultado.stdout).not.toMatch(/seed-admin\.|Admin do Seed|99999|4321/);
    expect([...criada.perfis].sort()).toEqual(['admin', 'consumidor']);
    expect(criada.senhaHash).toBeNull();
    expect((await eventosDaConta(dono, criada.id)).map(({ tipo }) => tipo)).toContain(
      'identidade.RecuperacaoSolicitada',
    );
    const { rows } = await dono.query(
      'SELECT ator_id::text AS ator FROM compartilhado.auditoria WHERE recurso_id = $1',
      [criada.id],
    );
    expect(rows).toEqual([{ ator: operador.id }]);

    // A primeira senha pela recuperação (o código chegaria pelo e-mail).
    const ip = ipNovo(p, freiosDoTeste);
    await inserirCodigo(p, criada.id, 'recuperacao_senha', '246810');
    await expect(
      p.casos.redefinirSenha.executar({
        email,
        codigo: '246810',
        novaSenha: OUTRA_SENHA,
        ip,
      }),
    ).resolves.toEqual({ tipo: 'redefinida' });
    await expect(
      p.casos.entrar.executar({ email, senha: OUTRA_SENHA, cliente: 'painel', ip }),
    ).resolves.toMatchObject({ tipo: 'desafio', desafio: { etapa: 'configurar' } });
  });

  it('sem --operador, com admin ativo no banco, recusa sem criar nada', async () => {
    const operador = await operadorAdmin(p, docs);
    contasDoTeste.push(operador.id);
    const email = emailUnico('seed-admin');

    const resultado = rodarCli([], [email, email, 'Admin do Seed', '(35) 99999-4321']);

    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toContain('Já existe admin: informe --operador');
    expect(await p.repos.contas.buscarPorEmail(Email.criar(email))).toBeNull();
  });
});
