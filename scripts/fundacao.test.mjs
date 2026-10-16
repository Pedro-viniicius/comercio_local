// Provas estáticas da fundação do repositório (plano 01a): CA-F2 (compose só em 127.0.0.1),
// CA-F8 (CI e imagens) e CA-F9 (documentação e `.env.example` sem segredo). Só lê arquivos do
// repositório; nada de rede, Docker ou banco.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const ler = (caminho) => readFileSync(join(RAIZ, caminho), 'utf8');

describe('CA-F2: infra local', () => {
  const compose = ler('infra/docker-compose.yml');

  it('todas as portas publicadas ficam presas a 127.0.0.1', () => {
    const portas = [...compose.matchAll(/^\s+-\s+['"]?([\d.:]+:\d+(?::\d+)?)['"]?\s*$/gm)].map(
      (achado) => achado[1],
    );
    // Postgres dev, Postgres de teste, web e SMTP do Mailpit.
    assert.equal(portas.length, 4, `portas encontradas: ${portas.join(', ')}`);
    for (const porta of portas) assert.match(porta, /^127\.0\.0\.1:/, porta);
  });

  it('sobe os três serviços, com imagens fixadas e healthcheck', () => {
    for (const servico of ['postgres', 'postgres-teste', 'mailpit']) {
      assert.match(compose, new RegExp(`^  ${servico}:`, 'm'), servico);
    }
    const imagens = [...compose.matchAll(/^\s+image:\s*(\S+)/gm)].map((achado) => achado[1]);
    assert.equal(imagens.length, 3);
    for (const imagem of imagens) assert.doesNotMatch(imagem, /:latest$|^[^:]+$/, imagem);
    assert.equal([...compose.matchAll(/^\s+healthcheck:/gm)].length, 3);
  });

  it('o papel da aplicação não é dono, superusuário nem ignora RLS (S3)', () => {
    const sql = ler('infra/postgres/init/01-papeis.sql');
    const app = /ALTER ROLE bairrin_app WITH([\s\S]*?)PASSWORD/.exec(sql)?.[1] ?? '';
    for (const atributo of ['NOSUPERUSER', 'NOCREATEDB', 'NOCREATEROLE', 'NOBYPASSRLS']) {
      assert.match(app, new RegExp(`\\b${atributo}\\b`), atributo);
    }
  });
});

describe('CA-F9: variáveis de exemplo e segredos', () => {
  const modelos = [
    'apps/api/.env.example',
    'apps/consumidor/.env.example',
    'apps/lojista/.env.example',
    'apps/painel/.env.example',
  ];

  it('os quatro .env.example existem', () => {
    for (const modelo of modelos) assert.ok(existsSync(join(RAIZ, modelo)), modelo);
  });

  it('só têm valores fictícios: chaves de EXEMPLO, hosts locais e nenhum formato de segredo real', () => {
    for (const modelo of modelos) {
      const linhas = ler(modelo)
        .split('\n')
        .filter((linha) => /^[A-Z_]+=/.test(linha));
      for (const linha of linhas) {
        const [nome, ...resto] = linha.split('=');
        const valor = resto.join('=');
        if (/SEGREDO|CHAVE|TOKEN|SENHA|SECRET/.test(nome)) {
          assert.match(valor, /^EXEMPLO/, `${modelo}: ${nome} deve ser um valor de EXEMPLO`);
        }
        if (nome === 'SENTRY_DSN')
          assert.equal(valor, '', `${modelo}: SENTRY_DSN deve ficar vazio`);
        for (const url of valor.match(/\w+:\/\/[^\s]+/g) ?? []) {
          const host = new URL(url).hostname;
          assert.ok(
            ['127.0.0.1', 'localhost', '10.0.2.2', 'bairrin.com.br'].includes(host) ||
              host.endsWith('.bairrin.com.br'),
            `${modelo}: ${nome} aponta para ${host}`,
          );
        }
      }
      const texto = ler(modelo);
      assert.doesNotMatch(
        texto,
        /-----BEGIN|eyJ[A-Za-z0-9_-]{20,}|sk_(live|test)_|AKIA[0-9A-Z]{16}/,
      );
    }
  });

  it('o .gitignore cobre todo .env e deixa só o .env.example versionável', () => {
    const ignorado = (caminho) =>
      spawnSync('git', ['check-ignore', '--no-index', '-q', caminho], { cwd: RAIZ }).status === 0;
    for (const caminho of [
      '.env',
      '.env.local',
      '.env.production',
      'apps/api/.env',
      'apps/api/.env.production',
      'apps/painel/.env.local',
      'apps/consumidor/.env',
    ]) {
      assert.ok(ignorado(caminho), `${caminho} deveria estar ignorado`);
    }
    for (const modelo of modelos) assert.ok(!ignorado(modelo), `${modelo} deveria ser versionado`);
  });
});

describe('CA-F9: documentação', () => {
  it('ADR-001 a ADR-015 existem, com contexto, decisão e consequências', () => {
    const arquivos = readdirSync(join(RAIZ, 'docs/adr'));
    for (let numero = 1; numero <= 15; numero += 1) {
      const prefixo = String(numero).padStart(4, '0');
      const arquivo = arquivos.find((nome) => nome.startsWith(`${prefixo}-`));
      assert.ok(arquivo, `falta o ADR ${prefixo}`);
      const texto = ler(`docs/adr/${arquivo}`);
      assert.match(texto, new RegExp(`^# ADR-0*${numero}\\b`, 'm'), arquivo);
      for (const secao of ['Contexto', 'Decisão', 'Consequências']) {
        assert.match(texto, new RegExp(`^## ${secao}\\s*$`, 'm'), `${arquivo}: falta "${secao}"`);
      }
    }
    assert.ok(arquivos.includes('README.md'));
  });

  it('README na raiz, em cada app e em cada pacote, e a lista de verificação de deploy', () => {
    const pastas = ['apps/api', 'apps/consumidor', 'apps/lojista', 'apps/painel'].concat(
      readdirSync(join(RAIZ, 'packages')).map((nome) => `packages/${nome}`),
    );
    for (const pasta of ['.', ...pastas]) {
      const texto = ler(`${pasta}/README.md`);
      assert.ok(texto.trim().length > 200, `${pasta}/README.md está vazio demais`);
    }
    assert.match(ler('docs/operacao/checklist-deploy.md'), /Data API/);
  });
});

describe('CA-F8: CI e imagens', () => {
  const ci = ler('.github/workflows/ci.yml');
  const android = ler('.github/workflows/android-nativo.yml');

  it('o audit de produção é bloqueante e roda em todo PR', () => {
    assert.match(ci, /pnpm audit --prod --audit-level=high/);
    assert.doesNotMatch(ci, /continue-on-error/);
    assert.match(ci, /^on:\s*\n\s+pull_request:/m);
  });

  it('o CI roda os comandos dos CAs F1, F4, F7, os testes de integração e o build', () => {
    for (const comando of [
      'pnpm install --frozen-lockfile',
      'pnpm lint',
      'pnpm typecheck',
      'pnpm deps:verificar',
      'pnpm migracoes:verificar',
      'pnpm test',
      'pnpm test:integracao',
      'pnpm build',
    ]) {
      assert.ok(ci.includes(`run: ${comando}`), `ci.yml não roda "${comando}"`);
    }
  });

  it('permissão mínima, sem segredos e sem pull_request_target; toda action fixada por SHA', () => {
    for (const [nome, texto] of [
      ['ci.yml', ci],
      ['android-nativo.yml', android],
    ]) {
      assert.match(texto, /^permissions:\s*\n\s+contents: read\s*$/m, nome);
      // Os comentários explicam as regras e citam os termos proibidos.
      const codigo = texto.replace(/^\s*#.*$/gm, '');
      assert.doesNotMatch(codigo, /pull_request_target/, nome);
      assert.doesNotMatch(codigo, /\$\{\{\s*secrets\./, nome);
      const usos = [...texto.matchAll(/^\s+(?:-\s+)?uses:\s*(\S+)/gm)].map((achado) => achado[1]);
      assert.ok(usos.length > 0, nome);
      for (const uso of usos) assert.match(uso, /@[0-9a-f]{40}$/, `${nome}: ${uso}`);
    }
  });

  it('o build Android nativo roda só na main (ou sob demanda), nunca em PR', () => {
    assert.match(android, /^on:\s*\n\s+push:\s*\n\s+branches: \[main\]/m);
    assert.doesNotMatch(android, /^\s+pull_request:/m);
  });

  it('as imagens rodam sem root e usam base com digest fixado', () => {
    for (const dockerfile of ['apps/api/Dockerfile', 'apps/painel/Dockerfile']) {
      const texto = ler(dockerfile);
      const usuarios = [...texto.matchAll(/^USER\s+(\S+)/gm)].map((achado) => achado[1]);
      assert.ok(usuarios.length > 0, `${dockerfile} não define USER`);
      assert.ok(!['root', '0', '0:0'].includes(usuarios.at(-1)), `${dockerfile} termina como root`);
      for (const base of texto.matchAll(/^FROM\s+(\S+)/gm)) {
        if (!/^\w+$/.test(base[1])) assert.match(base[1], /@sha256:[0-9a-f]{64}$/, base[1]);
      }
    }
  });

  it('o fly.toml da API tem app e worker em gru, e o painel também fica em gru', () => {
    const api = ler('apps/api/fly.toml');
    assert.match(api, /^primary_region = "gru"/m);
    assert.match(api, /^\s+app = "env -u DATABASE_URL_MIGRACAO /m);
    assert.match(api, /^\s+worker = "env -u DATABASE_URL_MIGRACAO /m);
    assert.match(api, /^\s*release_command = /m);
    assert.match(ler('apps/painel/fly.toml'), /^primary_region = "gru"/m);
  });
});
