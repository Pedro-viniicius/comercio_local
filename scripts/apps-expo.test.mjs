// Contratos de configuração dos apps Expo e do `@bairrin/mobile-base` (etapas 8 e 9 do 01a, etapa
// 1b do 01b): identificadores definitivos nas lojas, perfis do EAS sem segredo, versões exatas do
// SDK do Expo e nenhum arquivo de teste dentro de `src/app` (no Expo Router, todo arquivo ali vira
// rota). Lê os arquivos do repositório, sem rede e sem rodar o Metro.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

const APPS = {
  consumidor: {
    nome: 'Bairrin',
    slug: 'bairrin',
    scheme: 'bairrin',
    identificador: 'br.com.bairrin.consumidor',
  },
  lojista: {
    nome: 'Bairrin Lojista',
    slug: 'bairrin-lojista',
    scheme: 'bairrin-lojista',
    identificador: 'br.com.bairrin.lojista',
  },
};

const lerJson = (caminho) => JSON.parse(readFileSync(join(RAIZ, caminho), 'utf8'));

/**
 * Lê o `app.config.ts` de um app (o Node tira os tipos; o aviso de módulo sem `type` no
 * `package.json` do app vai para o stderr e não afeta o teste).
 */
async function lerConfiguracao(app) {
  return (await import(`../apps/${app}/app.config.ts`)).default;
}

/** Versão exata (sem `^`, `~` nem faixa), ou uma referência do workspace ou do catálogo. */
const ehVersaoFixa = (valor) =>
  /^\d+\.\d+\.\d+$/.test(valor) || valor === 'workspace:*' || valor === 'catalog:';

/** Arquivos de uma pasta, de forma recursiva, com o caminho relativo a ela. */
function listar(pasta, prefixo = '') {
  return readdirSync(join(pasta, prefixo), { withFileTypes: true }).flatMap((entrada) =>
    entrada.isDirectory()
      ? listar(pasta, join(prefixo, entrada.name))
      : [join(prefixo, entrada.name)],
  );
}

for (const [app, esperado] of Object.entries(APPS)) {
  describe(`app ${app}`, () => {
    it('tem nome, slug, scheme e identificadores definitivos (permanentes nas lojas)', async () => {
      const config = await lerConfiguracao(app);

      assert.equal(config.name, esperado.nome);
      assert.equal(config.slug, esperado.slug);
      assert.equal(config.scheme, esperado.scheme);
      assert.equal(config.ios?.bundleIdentifier, esperado.identificador);
      assert.equal(config.android?.package, esperado.identificador);
    });

    it('usa o Expo Router, sem expo-updates e sem nada de segredo na configuração', async () => {
      const config = await lerConfiguracao(app);

      assert.ok(config.plugins.some((plugin) => [plugin].flat()[0] === 'expo-router'));
      assert.ok(!JSON.stringify(config.plugins).includes('expo-updates'));
      assert.equal(config.updates, undefined);
      assert.equal(config.extra, undefined);
      assert.doesNotMatch(JSON.stringify(config), /secret|senha|token|password|chave/i);
    });

    it('fecha o que o prebuild deixa aberto: backup do Android, permissões sem uso e _sitemap (S119, S120, S122)', async () => {
      const config = await lerConfiguracao(app);
      const plugin = (nome) => config.plugins.find((p) => [p].flat()[0] === nome);

      assert.equal(config.android.allowBackup, false);
      assert.deepEqual([...config.android.blockedPermissions].sort(), [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.VIBRATE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ]);
      assert.deepEqual(plugin('expo-router'), ['expo-router', { sitemap: false }]);
      // As regras de backup são as do plugin do Bairrin (etapa 12 do 01b), que também excluem o
      // SecureStore; sem biometria, sem `NSFaceIDUsageDescription` (o manifesto gerado é conferido
      // em `scripts/backup-android.test.mjs`).
      assert.deepEqual(plugin('expo-secure-store'), [
        'expo-secure-store',
        { configureAndroidBackup: false, faceIDPermission: false },
      ]);
      assert.ok(config.plugins.includes('@bairrin/mobile-base'));
      // Os plugins são resolvidos a partir da pasta do app: os pacotes têm de estar nas dependências dele.
      assert.ok(lerJson(`apps/${app}/package.json`).dependencies['expo-secure-store']);
      assert.ok(lerJson(`apps/${app}/package.json`).dependencies['@bairrin/mobile-base']);
    });

    it('tem os três perfis do EAS e só EXPO_PUBLIC_API_URL como variável, apontando para HTTPS', () => {
      const eas = lerJson(`apps/${app}/eas.json`);

      assert.deepEqual(Object.keys(eas.build).sort(), ['development', 'preview', 'production']);
      for (const [perfil, definicao] of Object.entries(eas.build)) {
        assert.deepEqual(
          Object.keys(definicao.env ?? {}).filter((nome) => nome !== 'EXPO_PUBLIC_API_URL'),
          [],
          `perfil ${perfil}: variável além de EXPO_PUBLIC_API_URL`,
        );
      }
      for (const perfil of ['preview', 'production']) {
        const endereco = new URL(eas.build[perfil].env.EXPO_PUBLIC_API_URL);
        assert.equal(endereco.protocol, 'https:');
        assert.equal(endereco.username + endereco.password, '', 'credencial na URL');
      }
      assert.equal(eas.submit, undefined, 'chave de envio às lojas não entra no eas.json');
    });

    it('declara só versões exatas e as versões do SDK do Expo', () => {
      const manifesto = lerJson(`apps/${app}/package.json`);
      const doSdk = lerJson(`apps/${app}/node_modules/expo/bundledNativeModules.json`);
      const todas = { ...manifesto.dependencies, ...manifesto.devDependencies };

      for (const [pacote, versao] of Object.entries(todas)) {
        assert.ok(ehVersaoFixa(versao), `${pacote}: ${versao} não é versão exata`);
        if (doSdk[pacote] !== undefined) {
          assert.equal(
            versao,
            doSdk[pacote].replace(/^[~^]/, ''),
            `${pacote} fora da versão do SDK (${doSdk[pacote]})`,
          );
        }
      }
      assert.equal(manifesto.dependencies['@bairrin/mobile-base'], 'workspace:*');
      assert.equal(manifesto.main, 'expo-router/entry');
    });

    it('não tem arquivo de teste dentro de src/app (viraria rota do Expo Router)', () => {
      const rotas = listar(join(RAIZ, `apps/${app}/src/app`));

      assert.ok(rotas.includes('_layout.tsx') && rotas.includes('index.tsx'), rotas.join(', '));
      assert.deepEqual(
        rotas.filter((arquivo) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(arquivo)),
        [],
      );
    });

    it('não deixa pasta nativa gerada (android/, ios/) fora do .gitignore', () => {
      const ignorados = readFileSync(join(RAIZ, '.gitignore'), 'utf8');

      assert.match(ignorados, /^apps\/\*\/android\/$/m);
      assert.match(ignorados, /^apps\/\*\/ios\/$/m);
      assert.match(ignorados, /^\.expo\/$/m);
      assert.ok(existsSync(join(RAIZ, `apps/${app}/package.json`)));
    });
  });
}

describe('identificadores dos dois apps', () => {
  it('são diferentes entre si (a loja trata cada app como produto próprio)', async () => {
    const [a, b] = await Promise.all(Object.keys(APPS).map(lerConfiguracao));

    assert.notEqual(a.slug, b.slug);
    assert.notEqual(a.scheme, b.scheme);
    assert.notEqual(a.ios.bundleIdentifier, b.ios.bundleIdentifier);
    assert.notEqual(a.android.package, b.android.package);
  });
});

describe('@bairrin/mobile-base', () => {
  const manifesto = lerJson('packages/mobile-base/package.json');
  const doSdk = lerJson('apps/consumidor/node_modules/expo/bundledNativeModules.json');

  it('traz as dependências da trilha mobile do plano, em versão exata', () => {
    for (const pacote of [
      '@bairrin/cliente-api',
      '@bairrin/contratos',
      '@bairrin/tokens',
      '@tanstack/react-query',
      'expo-file-system',
      'expo-secure-store',
      'expo-sharing',
      'react-native-svg',
    ]) {
      assert.ok(manifesto.dependencies[pacote], `${pacote} ausente`);
    }
    for (const [pacote, versao] of Object.entries({
      ...manifesto.dependencies,
      ...manifesto.devDependencies,
    })) {
      assert.ok(ehVersaoFixa(versao), `${pacote}: ${versao} não é versão exata`);
      if (doSdk[pacote] !== undefined) {
        assert.equal(versao, doSdk[pacote].replace(/^[~^]/, ''), `${pacote} fora do SDK`);
      }
    }
  });

  it('usa a mesma versão de React, React Native e Expo dos apps (uma cópia só)', () => {
    for (const app of Object.keys(APPS)) {
      const doApp = lerJson(`apps/${app}/package.json`).dependencies;
      for (const pacote of ['expo', 'react', 'react-native']) {
        assert.equal(manifesto.devDependencies[pacote], doApp[pacote], `${pacote} em ${app}`);
      }
    }
  });

  it('não depende do AsyncStorage (a sessão só usa o SecureStore)', () => {
    const todas = JSON.stringify({ ...manifesto.dependencies, ...manifesto.devDependencies });

    assert.doesNotMatch(todas, /async-storage/);
  });
});
