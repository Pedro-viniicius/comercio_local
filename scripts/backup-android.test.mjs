// Backup e transferência entre aparelhos dos apps Expo (plano 01b, etapa 12; S119). O plugin de
// `@bairrin/mobile-base` (`app.plugin.js`) troca as regras de extração do Android 12+ pelas do
// Bairrin: nada sai do aparelho, e o arquivo do SecureStore continua excluído como nas regras do
// plugin do `expo-secure-store`, que deixa de aplicá-las. O manifesto e o Info.plist vêm da
// introspecção do Expo (`expo config --type introspect`), que roda os plugins sem gerar `android/`
// nem `ios/` e sem rede.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const exigir = createRequire(join(RAIZ, 'packages/mobile-base/package.json'));
const plugin = exigir('./app.plugin.js');

/** Configuração introspectada do app, com os `modResults` do manifesto e do Info.plist. */
function introspectar(app) {
  const pasta = join(RAIZ, 'apps', app);
  const cli = createRequire(join(pasta, 'package.json')).resolve('expo/bin/cli');
  const saida = execFileSync(process.execPath, [cli, 'config', '--type', 'introspect', '--json'], {
    cwd: pasta,
    env: { ...process.env, EXPO_OFFLINE: '1', CI: '1' },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(saida);
}

describe('regras de extração do Android (S119)', () => {
  it('excluem todos os domínios na nuvem e na transferência, e o arquivo do SecureStore', () => {
    const xml = plugin.regrasDeExtracao();
    const secoes = [...xml.matchAll(/<(cloud-backup|device-transfer)>([\s\S]*?)<\/\1>/g)];

    assert.deepEqual(
      secoes.map((secao) => secao[1]),
      ['cloud-backup', 'device-transfer'],
    );
    assert.doesNotMatch(xml, /<include/);
    for (const [, , corpo] of secoes) {
      for (const dominio of plugin.DOMINIOS) {
        assert.match(corpo, new RegExp(`<exclude domain="${dominio}" path="\\."/>`), dominio);
      }
      assert.match(corpo, /<exclude domain="sharedpref" path="SecureStore"\/>/);
    }
    assert.deepEqual(plugin.DOMINIOS, [
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
  });

  for (const app of ['consumidor', 'lojista']) {
    it(`o manifesto gerado do ${app} usa as regras do Bairrin, sem as do SecureStore, e o iOS fica sem Face ID`, () => {
      const config = introspectar(app);
      const [aplicacao] = config._internal.modResults.android.manifest.manifest.application;
      const atributos = aplicacao.$;

      assert.equal(atributos['android:dataExtractionRules'], plugin.RECURSO_DAS_REGRAS);
      assert.equal(atributos['android:allowBackup'], 'false');
      assert.equal(atributos['android:fullBackupContent'], undefined);
      assert.doesNotMatch(JSON.stringify(aplicacao), /secure_store_/);
      assert.equal(config._internal.modResults.ios.infoPlist.NSFaceIDUsageDescription, undefined);
    });
  }
});
