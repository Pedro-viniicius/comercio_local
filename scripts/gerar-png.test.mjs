// `assets/brand/gerar-png.sh` (plano 01b, etapa 12a; R17): o script não pode dar sucesso quando o
// Chrome não gravou o PNG, gravou com o tamanho errado ou falhou. Usa um `google-chrome` falso no
// PATH (o CI não tem Chrome) e uma cópia do script num diretório temporário: o repositório não é
// tocado. O script confere o arquivo com o Pillow, então estes casos precisam de `python3` com
// Pillow, como o próprio script.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../assets/brand/gerar-png.sh', import.meta.url));
const TEM_PILLOW =
  spawnSync('python3', ['-I', '-c', 'import PIL'], { encoding: 'utf8' }).status === 0;
const MOTIVO = 'precisa de python3 com Pillow, como o próprio gerar-png.sh';

const SAIDAS = [
  'icone-ios-1024.png',
  'icone-play-512.png',
  'icone-android-frente-1024.png',
  'icone-android-mono-1024.png',
  'splash-1024.png',
  'lojista-icone-ios-1024.png',
  'lojista-icone-play-512.png',
  'lojista-icone-android-frente-1024.png',
];

const raiz = mkdtempSync(join(tmpdir(), 'bairrin-gerar-png-'));
after(() => rmSync(raiz, { recursive: true, force: true }));
let contador = 0;

/** Chrome falso: `comportamento` é o corpo bash; recebe `$SAIDA` e `$LADO` já extraídos. */
function montar(comportamento) {
  contador += 1;
  const base = join(raiz, `caso-${contador}`);
  const marca = join(base, 'brand');
  const bin = join(base, 'bin');
  mkdirSync(join(marca, 'png'), { recursive: true });
  mkdirSync(bin, { recursive: true });
  copyFileSync(SCRIPT, join(marca, 'gerar-png.sh'));
  chmodSync(join(marca, 'gerar-png.sh'), 0o755);
  writeFileSync(
    join(bin, 'google-chrome'),
    `#!/usr/bin/env bash
SAIDA=""; LADO=""
for argumento in "$@"; do
  case "$argumento" in
    --screenshot=*) SAIDA="\${argumento#--screenshot=}" ;;
    --window-size=*) LADO="\${argumento#--window-size=}"; LADO="\${LADO%%,*}" ;;
  esac
done
${comportamento}
`,
  );
  chmodSync(join(bin, 'google-chrome'), 0o755);
  return { marca, bin };
}

function rodar({ marca, bin }) {
  return spawnSync('bash', [join(marca, 'gerar-png.sh')], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
}

/** Linha de bash que grava um PNG RGBA transparente do tamanho `$1` x `$2` em `$SAIDA`. */
const gravarPng = (lado) =>
  `python3 -I -c 'import sys; from PIL import Image; Image.new("RGBA", (int(sys.argv[2]), int(sys.argv[2])), (0,0,0,0)).save(sys.argv[1])' "$SAIDA" ${lado}`;

describe('assets/brand/gerar-png.sh', () => {
  it(
    'com o Chrome gravando o tamanho pedido, gera os 8 PNG e termina com sucesso',
    { skip: !TEM_PILLOW && MOTIVO },
    () => {
      const caso = montar(gravarPng('"$LADO"'));
      const resultado = rodar(caso);

      assert.equal(resultado.status, 0, resultado.stderr);
      for (const nome of SAIDAS) assert.ok(existsSync(join(caso.marca, 'png', nome)), nome);
    },
  );

  it(
    'o Chrome sai com 0 sem gravar: falha e não deixa um PNG velho no lugar',
    { skip: !TEM_PILLOW && MOTIVO },
    () => {
      const caso = montar('exit 0');
      // PNG velho de uma execução anterior: não pode ser tomado como o resultado desta.
      writeFileSync(join(caso.marca, 'png', 'icone-ios-1024.png'), 'velho');
      const resultado = rodar(caso);

      assert.notEqual(resultado.status, 0);
      assert.match(resultado.stderr, /icone-ios-1024\.png/);
      assert.equal(existsSync(join(caso.marca, 'png', 'icone-ios-1024.png')), false);
    },
  );

  it('o Chrome falha: o script mostra o log dele e falha, sem seguir para os outros arquivos', () => {
    const caso = montar('echo "chrome quebrou aqui" >&2; exit 1');
    const resultado = rodar(caso);

    assert.notEqual(resultado.status, 0);
    assert.match(resultado.stderr, /chrome quebrou aqui/);
    assert.match(resultado.stderr, /o Chrome falhou ao gerar icone-ios-1024\.png/);
    assert.doesNotMatch(resultado.stdout, /PNG gerados/);
  });

  it(
    'o Chrome grava um PNG de outro tamanho: falha dizendo o tamanho obtido e o esperado',
    { skip: !TEM_PILLOW && MOTIVO },
    () => {
      const caso = montar(gravarPng('100'));
      const resultado = rodar(caso);

      assert.notEqual(resultado.status, 0);
      assert.match(resultado.stderr, /100x100/);
      assert.match(resultado.stderr, /esperado 1024x1024/);
      assert.doesNotMatch(resultado.stdout, /PNG gerados/);
    },
  );

  it(
    'os ícones "sem-alfa" saem sem canal alfa e os outros mantêm o alfa',
    { skip: !TEM_PILLOW && MOTIVO },
    () => {
      const caso = montar(gravarPng('"$LADO"'));
      assert.equal(rodar(caso).status, 0);

      const modo = (nome) =>
        spawnSync(
          'python3',
          [
            '-I',
            '-c',
            'import sys; from PIL import Image; print(Image.open(sys.argv[1]).mode)',
            join(caso.marca, 'png', nome),
          ],
          { encoding: 'utf8' },
        ).stdout.trim();
      for (const nome of ['icone-ios-1024.png', 'splash-1024.png', 'lojista-icone-ios-1024.png']) {
        assert.equal(modo(nome), 'RGB', nome);
      }
      for (const nome of ['icone-play-512.png', 'icone-android-frente-1024.png']) {
        assert.equal(modo(nome), 'RGBA', nome);
      }
    },
  );

  it('o script em si não tem `|| true` nem `set +e` escondendo falha', () => {
    const texto = readFileSync(SCRIPT, 'utf8');
    assert.match(texto, /set -euo pipefail/);
    assert.doesNotMatch(texto, /\|\|\s*true|set \+e/);
  });
});
