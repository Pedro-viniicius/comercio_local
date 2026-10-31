// O arquivo das regras de extração do Android (plano 01b, etapa 12; S119) é gravado por um mod
// "perigoso" do config plugin, que a introspecção do Expo (`scripts/backup-android.test.mjs`) não
// roda. Aqui o plugin roda de verdade num projeto Android mínimo em pasta temporária, sem rede e sem
// `expo prebuild`: o manifesto tem de apontar para um arquivo que existe, com o conteúdo certo.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const exigir = createRequire(join(RAIZ, 'packages/mobile-base/package.json'));
const plugin = exigir('./app.plugin.js');
const { compileModsAsync } = exigir('expo/config-plugins');

const MANIFESTO =
  '<manifest xmlns:android="http://schemas.android.com/apk/res/android">' +
  '<application android:name=".MainApplication" android:allowBackup="false"/></manifest>';
/** Domínios que o Android aceita nas regras de extração (documentação do Auto Backup). */
const DOMINIOS_DO_ANDROID = new Set([
  'root',
  'file',
  'database',
  'sharedpref',
  'external',
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
]);

const pastas = [];
after(() => {
  for (const pasta of pastas) rmSync(pasta, { recursive: true, force: true });
});

/** Projeto Android mínimo e o resultado de aplicar o plugin (`vezes` aplicações seguidas). */
async function aplicarPlugin(vezes = 1) {
  const projeto = mkdtempSync(join(tmpdir(), 'bairrin-plugin-'));
  pastas.push(projeto);
  const principal = join(projeto, 'android/app/src/main');
  mkdirSync(principal, { recursive: true });
  writeFileSync(join(principal, 'AndroidManifest.xml'), MANIFESTO);
  for (let i = 0; i < vezes; i += 1) {
    await compileModsAsync(plugin({ name: 'Bairrin', slug: 'bairrin' }), {
      projectRoot: projeto,
      platforms: ['android'],
      assertMissingModProviders: false,
    });
  }
  return {
    manifesto: readFileSync(join(principal, 'AndroidManifest.xml'), 'utf8'),
    pastaXml: join(principal, 'res/xml'),
  };
}

describe('arquivo das regras de extração gravado pelo plugin (S119)', () => {
  it('grava o XML do Bairrin e o manifesto aponta para ele pelo nome do arquivo', async () => {
    const { manifesto, pastaXml } = await aplicarPlugin();
    const recurso = manifesto.match(/android:dataExtractionRules="@xml\/([^"]+)"/)?.[1];

    assert.ok(recurso, 'o manifesto não aponta para regras de extração');
    assert.equal(`@xml/${recurso}`, plugin.RECURSO_DAS_REGRAS);
    assert.deepEqual(readdirSync(pastaXml), [`${recurso}.xml`]);
    assert.equal(readFileSync(join(pastaXml, `${recurso}.xml`), 'utf8'), plugin.regrasDeExtracao());
    // O manifesto mantém o que já tinha (allowBackup falso, nome da aplicação).
    assert.match(manifesto, /android:allowBackup="false"/);
    assert.match(manifesto, /android:name="\.MainApplication"/);
  });

  it('aplicar duas vezes (prebuild sem --clean) deixa o mesmo arquivo e o mesmo atributo', async () => {
    const { manifesto, pastaXml } = await aplicarPlugin(2);

    assert.equal(manifesto.match(/android:dataExtractionRules=/g)?.length, 1);
    assert.deepEqual(readdirSync(pastaXml), [`${plugin.RECURSO_DAS_REGRAS.slice(5)}.xml`]);
    assert.equal(
      readFileSync(join(pastaXml, `${plugin.RECURSO_DAS_REGRAS.slice(5)}.xml`), 'utf8'),
      plugin.regrasDeExtracao(),
    );
  });

  it('o nome do recurso é válido no Android (minúsculas, dígitos e sublinhado)', () => {
    assert.match(plugin.RECURSO_DAS_REGRAS, /^@xml\/[a-z][a-z0-9_]*$/);
  });

  it('o XML é bem formado e só usa domínios que o Android aceita', () => {
    const xml = plugin.regrasDeExtracao();
    const etiquetas = [...xml.matchAll(/<(\/?)([a-z-]+)([^>]*?)(\/?)>/g)];
    const pilha = [];
    for (const [, fecha, nome, , autoFecha] of etiquetas) {
      if (autoFecha) continue;
      if (fecha) assert.equal(pilha.pop(), nome, `fechamento de </${nome}> fora de ordem`);
      else pilha.push(nome);
    }
    assert.deepEqual(pilha, [], 'etiquetas sem fechar');
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>'));
    assert.equal(xml.match(/<data-extraction-rules>/g)?.length, 1);
    for (const [, dominio] of xml.matchAll(/domain="([^"]+)"/g)) {
      assert.ok(DOMINIOS_DO_ANDROID.has(dominio), `domínio ${dominio} não existe no Android`);
    }
  });
});
