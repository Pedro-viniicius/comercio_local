// Contrato do cache de módulos do Vitest (Q35, R16): cada script que roda `vitest` usa um
// diretório de cache próprio, inclusive dois scripts do mesmo pacote (`test` e `test:integracao`).
// Com um cache só, em `pnpm -r test`, quando o lockfile muda, o primeiro vitest que sobe apaga o
// diretório enquanto os outros ainda gravam nele, e o erro é `Startup Error: ENOTEMPTY`. Aceito:
// `--fsModuleCachePath` diferente por script, ou cache desligado (`--no-fsModuleCache` ou
// `fsModuleCache: false`). Lê os arquivos do repositório, sem rede.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const lerJson = (caminho) => JSON.parse(readFileSync(join(RAIZ, caminho), 'utf8'));

/**
 * Cada script de `apps/` e `packages/` que roda o `vitest` (`test`, `test:integracao`...): dois
 * scripts do mesmo pacote também podem rodar juntos (R16), então cada um conta por si.
 */
function scriptsComVitest() {
  const achados = [];
  for (const pasta of ['apps', 'packages']) {
    for (const nome of readdirSync(join(RAIZ, pasta))) {
      const dir = join(pasta, nome);
      if (!existsSync(join(RAIZ, dir, 'package.json'))) continue;
      const scripts = lerJson(`${dir}/package.json`).scripts ?? {};
      for (const [script, comando] of Object.entries(scripts)) {
        if (/\bvitest\b/.test(comando)) achados.push({ dir, script, comando });
      }
    }
  }
  return achados;
}

/**
 * Diretório de cache de módulos usado pelo script: pela flag, pela configuração do vitest (a do
 * `--config`, ou a padrão do pacote), ou o padrão do vitest 5 (`<raiz do workspace>/node_modules/
 * .vitest-cache`, igual para todos).
 */
function cacheDoScript({ dir, comando }) {
  if (/--no-fsModuleCache\b|--fsModuleCache=false/.test(comando)) return { desligado: true };
  const flag = comando.match(/--fsModuleCachePath[= ](\S+)/)?.[1];
  const configDoScript = comando.match(/(?:--config|-c)[= ](\S+)/)?.[1];
  let config = '';
  for (const arq of configDoScript ? [configDoScript] : ['vitest.config.ts', 'vite.config.ts']) {
    if (existsSync(join(RAIZ, dir, arq))) config += readFileSync(join(RAIZ, dir, arq), 'utf8');
  }
  if (/fsModuleCache\s*:\s*false/.test(config)) return { desligado: true };
  const daConfig = config.match(/fsModuleCachePath\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
  // O caminho é relativo ao pacote (ou absoluto): resolve para comparar caminhos reais.
  if (flag ?? daConfig) return { caminho: resolve(RAIZ, dir, flag ?? daConfig) };
  return { caminho: 'PADRAO-RAIZ-DO-WORKSPACE' };
}

it('os scripts que rodam vitest em paralelo não dividem o diretório de cache de módulos', () => {
  const scripts = scriptsComVitest();
  assert.ok(scripts.length >= 2, 'esperava ao menos 2 scripts com vitest');
  // O teste olha além do `test`: a integração da API também roda vitest.
  assert.ok(
    scripts.some((s) => s.dir === join('apps', 'api') && s.script === 'test:integracao'),
    'o test:integracao da API não foi encontrado',
  );
  const porCaminho = new Map();
  for (const s of scripts) {
    const c = cacheDoScript(s);
    if (c.desligado) continue;
    porCaminho.set(c.caminho, [...(porCaminho.get(c.caminho) ?? []), `${s.dir}#${s.script}`]);
  }
  const divididos = [...porCaminho].filter(([, nomes]) => nomes.length > 1);
  assert.deepEqual(divididos, [], 'scripts que dividem o mesmo cache do vitest');
});
