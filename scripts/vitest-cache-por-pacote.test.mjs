// Contrato do cache de módulos do Vitest (Q35): cada pacote que roda `vitest` usa um diretório de
// cache próprio. Com um cache só, em `pnpm -r test`, quando o lockfile muda, o primeiro vitest que
// sobe apaga `node_modules/.vitest-cache` da raiz enquanto os outros ainda gravam nele, e o erro é
// `Startup Error: ENOTEMPTY`. Aceito: `--fsModuleCachePath` diferente por pacote, ou cache desligado
// (`--no-fsModuleCache` ou `fsModuleCache: false`). Lê os arquivos do repositório, sem rede.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const lerJson = (caminho) => JSON.parse(readFileSync(join(RAIZ, caminho), 'utf8'));

/** Pacotes de `apps/` e `packages/` cujo script `test` roda o `vitest`. */
function pacotesComVitest() {
  const achados = [];
  for (const pasta of ['apps', 'packages']) {
    for (const nome of readdirSync(join(RAIZ, pasta))) {
      const dir = join(pasta, nome);
      if (!existsSync(join(RAIZ, dir, 'package.json'))) continue;
      const teste = lerJson(`${dir}/package.json`).scripts?.test ?? '';
      if (/\bvitest\b/.test(teste)) achados.push({ dir, teste });
    }
  }
  return achados;
}

/**
 * Diretório de cache de módulos usado pelo pacote: pela flag no script, pela configuração do
 * vitest, ou o padrão do vitest 5 (`<raiz do workspace>/node_modules/.vitest-cache`, igual para todos).
 */
function cacheDoPacote({ dir, teste }) {
  if (/--no-fsModuleCache\b|--fsModuleCache=false/.test(teste)) return { desligado: true };
  const flag = teste.match(/--fsModuleCachePath[= ](\S+)/)?.[1];
  let config = '';
  for (const arq of ['vitest.config.ts', 'vite.config.ts']) {
    if (existsSync(join(RAIZ, dir, arq))) config += readFileSync(join(RAIZ, dir, arq), 'utf8');
  }
  if (/fsModuleCache\s*:\s*false/.test(config)) return { desligado: true };
  const daConfig = config.match(/fsModuleCachePath\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
  // O caminho é relativo ao pacote: resolve contra o diretório dele para comparar caminhos reais.
  if (flag ?? daConfig) return { caminho: join(dir, flag ?? daConfig) };
  return { caminho: 'PADRAO-RAIZ-DO-WORKSPACE' };
}

it('os pacotes que rodam vitest em paralelo não dividem o diretório de cache de módulos', () => {
  const pacotes = pacotesComVitest();
  assert.ok(pacotes.length >= 2, 'esperava ao menos 2 pacotes com vitest');
  const porCaminho = new Map();
  for (const p of pacotes) {
    const c = cacheDoPacote(p);
    if (c.desligado) continue;
    porCaminho.set(c.caminho, [...(porCaminho.get(c.caminho) ?? []), p.dir]);
  }
  const divididos = [...porCaminho].filter(([, dirs]) => dirs.length > 1);
  assert.deepEqual(divididos, [], 'pacotes que dividem o mesmo cache do vitest');
});
