// Config plugin do Bairrin para os apps Expo (plano 01b, etapa 12; S119). Os apps o usam pelo nome
// do pacote (`plugins: ['@bairrin/mobile-base']` no `app.config.ts`).
//
// Regras de extração do Android 12+ (`android:dataExtractionRules`): nada do app vai para o backup
// na nuvem nem para a transferência entre aparelhos. O `allowBackup: false` do `app.config.ts` não
// vale para a transferência no Android 12+, e o app não tem nada que precise sair do aparelho
// (sessão no SecureStore, cache só público, fila offline da conta). Estas regras substituem as do
// plugin do `expo-secure-store` (que fica com `configureAndroidBackup: false`) e mantêm a exclusão
// do arquivo `SecureStore` das preferências, igual à dele.
const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

const NOME_DAS_REGRAS = 'bairrin_regras_de_extracao';
const RECURSO_DAS_REGRAS = `@xml/${NOME_DAS_REGRAS}`;

/** Todos os domínios das regras de extração (documentação do Auto Backup do Android). */
const DOMINIOS = [
  'root',
  'file',
  'database',
  'sharedpref',
  'external',
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
];

/** O XML das regras: em cada modo, exclui todos os domínios inteiros e o arquivo do SecureStore. */
function regrasDeExtracao() {
  const exclusoes = [
    ...DOMINIOS.map((dominio) => `    <exclude domain="${dominio}" path="."/>`),
    '    <exclude domain="sharedpref" path="SecureStore"/>',
  ].join('\n');
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- Gerado pelo app.plugin.js de @bairrin/mobile-base (S119): nada sai do aparelho. -->',
    '<data-extraction-rules>',
    '  <cloud-backup>',
    exclusoes,
    '  </cloud-backup>',
    '  <device-transfer>',
    exclusoes,
    '  </device-transfer>',
    '</data-extraction-rules>',
    '',
  ].join('\n');
}

function comRegrasDeExtracao(config) {
  config = withAndroidManifest(config, (configuracao) => {
    const aplicacao = AndroidConfig.Manifest.getMainApplicationOrThrow(configuracao.modResults);
    aplicacao.$['android:dataExtractionRules'] = RECURSO_DAS_REGRAS;
    return configuracao;
  });
  return withDangerousMod(config, [
    'android',
    (configuracao) => {
      const pasta = path.join(configuracao.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(pasta, { recursive: true });
      fs.writeFileSync(path.join(pasta, `${NOME_DAS_REGRAS}.xml`), regrasDeExtracao());
      return configuracao;
    },
  ]);
}

module.exports = comRegrasDeExtracao;
module.exports.regrasDeExtracao = regrasDeExtracao;
module.exports.RECURSO_DAS_REGRAS = RECURSO_DAS_REGRAS;
module.exports.DOMINIOS = DOMINIOS;
