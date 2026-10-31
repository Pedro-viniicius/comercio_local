// Identidade visual (`assets/brand`) e os ícones dos apps Expo (plano 01b, etapas 1b e 12a; spec
// 00-nome-e-identidade.md, seções 2.5 e 2.7). Confere o que a loja e o sistema exigem e o Jest não
// vê: SVG sem script, texto nem fonte; PNG com o tamanho e o canal alfa certos; os ícones do
// `app.config.ts` apontando para arquivos que existem, na variação certa de cada app e com a cor
// de fundo do ícone adaptativo igual à do SVG. Lê só os arquivos do repositório, sem rede.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const MARCA = join(RAIZ, 'assets/brand');
const PNG = join(MARCA, 'png');

const AZUL_CONSUMIDOR = '#1F5BD1';
const AZUL_LOJISTA = '#18336B';

const svgs = readdirSync(MARCA).filter((nome) => nome.endsWith('.svg'));

/** Cabeçalho do PNG: largura, altura, profundidade e tipo de cor (2 = RGB, 6 = RGBA). */
function cabecalhoPng(caminho) {
  const bytes = readFileSync(caminho);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${caminho} não é PNG`);
  assert.equal(bytes.subarray(12, 16).toString('latin1'), 'IHDR');
  return {
    largura: bytes.readUInt32BE(16),
    altura: bytes.readUInt32BE(20),
    profundidade: bytes[24],
    tipoDeCor: bytes[25],
    // O PNG com paleta ou tons de cinza e alfa (4) ou RGBA (6) tem canal alfa; o tRNS também vale.
    temTrns: bytes.includes(Buffer.from('tRNS', 'latin1')),
  };
}

const temAlfa = (c) => c.tipoDeCor === 4 || c.tipoDeCor === 6 || c.temTrns;

async function lerConfiguracao(app) {
  return (await import(`../apps/${app}/app.config.ts`)).default;
}

describe('SVGs da marca', () => {
  it('há os desenhos que o README e os apps usam', () => {
    for (const nome of [
      'bairrin-logo-horizontal.svg',
      'bairrin-icone-ios-1024.svg',
      'bairrin-icone-android-fundo.svg',
      'bairrin-icone-android-frente.svg',
      'bairrin-icone-android-mono.svg',
      'bairrin-lojista-icone-ios-1024.svg',
      'bairrin-lojista-icone-android-fundo.svg',
      'bairrin-lojista-icone-android-frente.svg',
      'bairrin-splash.svg',
      'bairrin-simbolo.svg',
    ]) {
      assert.ok(svgs.includes(nome), `falta ${nome}`);
    }
  });

  for (const nome of svgs) {
    it(`${nome}: só viewBox, sem script, texto, fonte, imagem nem recurso externo`, () => {
      const texto = readFileSync(join(MARCA, nome), 'utf8');
      const raiz = texto.match(/<svg\b[^>]*>/)?.[0] ?? '';

      assert.ok(texto.trimStart().startsWith('<svg'), 'não começa em <svg');
      assert.match(raiz, /\bviewBox="[\d.\s-]+"/, 'sem viewBox');
      assert.doesNotMatch(raiz, /\b(width|height)=/, 'tem width/height na raiz');
      assert.doesNotMatch(texto, /<(script|text|tspan|image|foreignObject|style|use|a)\b/i);
      assert.doesNotMatch(texto, /\bon[a-z]+\s*=/i, 'atributo de evento');
      assert.doesNotMatch(texto, /(font-family|href=|src=|url\((?!#))/i);
      // O único endereço permitido é o namespace do SVG.
      const enderecos = [...texto.matchAll(/https?:\/\/[^"'\s)]+/g)].map((m) => m[0]);
      assert.deepEqual(
        enderecos.filter((e) => e !== 'http://www.w3.org/2000/svg'),
        [],
      );
      // Termina com o fechamento, sem lixo depois.
      assert.match(texto.trimEnd(), /<\/svg>$/);
    });
  }

  it('o fundo do ícone adaptativo é a cor de cada app (blue.600 e blue.900)', () => {
    const fundo = (arquivo) =>
      readFileSync(join(MARCA, arquivo), 'utf8').match(/<rect[^>]*fill="(#[0-9A-Fa-f]{6})"/)?.[1];
    assert.equal(fundo('bairrin-icone-android-fundo.svg')?.toUpperCase(), AZUL_CONSUMIDOR);
    assert.equal(fundo('bairrin-lojista-icone-android-fundo.svg')?.toUpperCase(), AZUL_LOJISTA);
    assert.equal(fundo('bairrin-icone-ios-1024.svg')?.toUpperCase(), AZUL_CONSUMIDOR);
    assert.equal(fundo('bairrin-lojista-icone-ios-1024.svg')?.toUpperCase(), AZUL_LOJISTA);
  });

  it('o pino do ícone adaptativo cabe na zona segura (círculo de 66 dp no centro de 108)', () => {
    // O pino é o `<g transform="translate(x y) scale(s)">` do ícone: caixa de 44×63 em (2,2).
    for (const arquivo of [
      'bairrin-icone-android-frente.svg',
      'bairrin-lojista-icone-android-frente.svg',
      'bairrin-icone-android-mono.svg',
    ]) {
      const texto = readFileSync(join(MARCA, arquivo), 'utf8');
      const [, x, y, escala] =
        texto.match(/translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)/)?.map(Number) ?? [];
      assert.ok(escala, `${arquivo} sem transform`);
      // Cantos extremos do pino (largura de 2 a 46, altura de 2 a 65) e a ponta de baixo.
      const pontos = [
        [x + 2 * escala, y + 24 * escala],
        [x + 46 * escala, y + 24 * escala],
        [x + 24 * escala, y + 2 * escala],
        [x + 24 * escala, y + 65 * escala],
      ];
      for (const [px, py] of pontos) {
        assert.ok(Math.hypot(px - 54, py - 54) <= 33, `${arquivo}: ponto (${px}, ${py}) fora`);
      }
    }
  });

  it('o contraste do pino, do toldo e do ponto "aberta" passa de 3:1 (WCAG 1.4.11) nas duas variações', () => {
    const luminancia = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
      const canal = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
    };
    const contraste = (a, b) => {
      const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
      return (claro + 0.05) / (escuro + 0.05);
    };
    for (const arquivo of ['bairrin-icone-ios-1024.svg', 'bairrin-lojista-icone-ios-1024.svg']) {
      const texto = readFileSync(join(MARCA, arquivo), 'utf8');
      const fundo = texto.match(/<rect[^>]*fill="(#[0-9A-Fa-f]{6})"/)?.[1];
      const [pino, toldo, , ponto] = [
        ...texto.matchAll(/<(?:path|circle)[^>]*fill="(#[0-9A-Fa-f]{6})"/g),
      ].map((m) => m[1]);
      assert.ok(fundo && pino && toldo && ponto, `${arquivo}: cores não encontradas`);
      assert.ok(contraste(pino, fundo) >= 3, `${arquivo}: pino sobre o fundo`);
      assert.ok(contraste(toldo, pino) >= 3, `${arquivo}: toldo sobre o pino`);
      assert.ok(contraste(ponto, pino) >= 3, `${arquivo}: ponto sobre o pino`);
    }
  });

  it('o ícone monocromático é uma silhueta só (preto sobre transparente, para o tema do Android)', () => {
    const texto = readFileSync(join(MARCA, 'bairrin-icone-android-mono.svg'), 'utf8');
    const cores = new Set([...texto.matchAll(/fill="([^"]+)"/g)].map((m) => m[1].toUpperCase()));
    assert.deepEqual([...cores], ['#000000']);
    assert.doesNotMatch(texto, /<rect/);
  });
});

describe('PNGs da marca', () => {
  const ESPERADOS = {
    'icone-ios-1024.png': { lado: 1024, alfa: false },
    'lojista-icone-ios-1024.png': { lado: 1024, alfa: false },
    'icone-play-512.png': { lado: 512, alfa: false },
    'lojista-icone-play-512.png': { lado: 512, alfa: false },
    'splash-1024.png': { lado: 1024, alfa: false },
    'icone-android-frente-1024.png': { lado: 1024, alfa: true },
    'lojista-icone-android-frente-1024.png': { lado: 1024, alfa: true },
    'icone-android-mono-1024.png': { lado: 1024, alfa: true },
  };

  it('não sobra PNG sem dono nem falta um que o README promete', () => {
    assert.deepEqual(
      readdirSync(PNG)
        .filter((n) => n.endsWith('.png'))
        .sort(),
      Object.keys(ESPERADOS).sort(),
    );
  });

  for (const [nome, { lado, alfa }] of Object.entries(ESPERADOS)) {
    it(`${nome}: ${lado}×${lado}, 8 bits, ${alfa ? 'com' : 'sem'} canal alfa`, () => {
      const c = cabecalhoPng(join(PNG, nome));
      assert.equal(c.largura, lado);
      assert.equal(c.altura, lado);
      assert.equal(c.profundidade, 8);
      // A App Store rejeita ícone com transparência; o ícone adaptativo do Android precisa dela.
      assert.equal(temAlfa(c), alfa, `canal alfa de ${nome}`);
    });
  }
});

describe('ícones nos app.config.ts', () => {
  const VARIACOES = {
    consumidor: {
      icone: 'icone-ios-1024.png',
      frente: 'icone-android-frente-1024.png',
      fundo: AZUL_CONSUMIDOR,
    },
    lojista: {
      icone: 'lojista-icone-ios-1024.png',
      frente: 'lojista-icone-android-frente-1024.png',
      fundo: AZUL_LOJISTA,
    },
  };

  for (const [app, esperado] of Object.entries(VARIACOES)) {
    it(`${app}: ícone, ícone adaptativo e monocromático apontam para os arquivos da variação`, async () => {
      const config = await lerConfiguracao(app);
      const pasta = join(RAIZ, 'apps', app);
      const adaptativo = config.android?.adaptiveIcon;

      assert.equal(resolve(pasta, config.icon), join(PNG, esperado.icone));
      assert.equal(resolve(pasta, adaptativo.foregroundImage), join(PNG, esperado.frente));
      assert.equal(
        resolve(pasta, adaptativo.monochromeImage),
        join(PNG, 'icone-android-mono-1024.png'),
      );
      assert.equal(adaptativo.backgroundColor.toUpperCase(), esperado.fundo);
      for (const caminho of [config.icon, adaptativo.foregroundImage, adaptativo.monochromeImage]) {
        assert.ok(existsSync(resolve(pasta, caminho)), `${caminho} não existe`);
      }
      // Sem a imagem de fundo do adaptativo: a cor é a que o SVG de fundo usa.
      assert.equal(adaptativo.backgroundImage, undefined);
    });
  }

  it('os dois apps não dividem o mesmo ícone (o lojista acha o app certo na tela inicial)', async () => {
    const [consumidor, lojista] = await Promise.all([
      lerConfiguracao('consumidor'),
      lerConfiguracao('lojista'),
    ]);
    assert.notEqual(
      resolve(RAIZ, 'apps/consumidor', consumidor.icon),
      resolve(RAIZ, 'apps/lojista', lojista.icon),
    );
    assert.notEqual(
      consumidor.android.adaptiveIcon.backgroundColor,
      lojista.android.adaptiveIcon.backgroundColor,
    );
  });
});
