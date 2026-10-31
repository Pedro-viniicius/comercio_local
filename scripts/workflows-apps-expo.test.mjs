// Os workflows que exercitam os apps Expo não podem ter atalho (CA-F6 e CA-F8 do plano 01a, R2 da
// revisão de M1): antes dos apps existirem, o CI pulava o passo quando `app.config.ts` não estava
// lá (`hashFiles` e `if: steps.app.outputs.existe`). Com os apps no repositório, sumir a pasta ou o
// config de um app tem de reprovar o CI, e não passar em silêncio. Só lê arquivos; nada de rede.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const lerWorkflow = (nome) => readFileSync(join(RAIZ, '.github/workflows', nome), 'utf8');
/** Só o YAML que executa: os comentários explicam o que foi tirado e citam os termos proibidos. */
const semComentarios = (texto) => texto.replace(/^\s*#.*$/gm, '').replace(/\s+#\s.*$/gm, '');

/** Apps Expo do repositório: toda pasta de `apps/` com `app.config.ts`. */
const appsExpo = readdirSync(join(RAIZ, 'apps'))
  .filter((nome) => existsSync(join(RAIZ, 'apps', nome, 'app.config.ts')))
  .sort();

const WORKFLOWS = ['ci.yml', 'android-nativo.yml'];

describe('workflows dos apps Expo, sem atalho', () => {
  it('o repositório tem os dois apps Expo (a base das outras provas)', () => {
    assert.deepEqual(appsExpo, ['consumidor', 'lojista']);
  });

  for (const nome of WORKFLOWS) {
    describe(nome, () => {
      const codigo = semComentarios(lerWorkflow(nome));

      it('não pula passo por existência de arquivo nem por saída de passo anterior', () => {
        assert.doesNotMatch(codigo, /hashFiles\(/);
        assert.doesNotMatch(codigo, /steps\.[\w-]+\.outputs/);
        assert.doesNotMatch(codigo, /GITHUB_OUTPUT/);
        assert.doesNotMatch(codigo, /::notice::/);
        assert.doesNotMatch(codigo, /hashFiles|existe\s*==|pulado/);
      });

      it('não aceita falha de passo nem engole o código de saída', () => {
        assert.doesNotMatch(codigo, /continue-on-error/);
        assert.doesNotMatch(codigo, /\|\|\s*(true|echo|:)\b/);
        assert.doesNotMatch(codigo, /^\s*set \+e/m);
      });

      it('a única condição `if:` permitida é a dos logs de falha (failure())', () => {
        const condicoes = [...codigo.matchAll(/^\s+(?:-\s+)?if:\s*(.+)$/gm)].map((m) =>
          m[1].trim(),
        );
        for (const condicao of condicoes) assert.equal(condicao, 'failure()', condicao);
      });
    });
  }

  describe('ci.yml', () => {
    const codigo = semComentarios(lerWorkflow('ci.yml'));

    for (const app of appsExpo) {
      for (const plataforma of ['android', 'ios']) {
        it(`roda expo export de ${app} para ${plataforma}`, () => {
          assert.match(
            codigo,
            new RegExp(
              `^\\s+pnpm --filter ${app} exec expo export --platform ${plataforma}\\s*$`,
              'm',
            ),
          );
        });
      }
    }

    it('o expo export de cada app fica em passo próprio, depois do build, sem condição', () => {
      const posBuild = codigo.indexOf('run: pnpm build');
      assert.ok(posBuild > 0);
      for (const app of appsExpo) {
        const posPasso = codigo.indexOf(`pnpm --filter ${app} exec expo export`);
        assert.ok(posPasso > posBuild, `export de ${app} antes do build ou ausente`);
        const inicioDoPasso = codigo.lastIndexOf('- name:', posPasso);
        const trecho = codigo.slice(inicioDoPasso, posPasso);
        assert.doesNotMatch(trecho, /\bif:/, `o passo do ${app} tem condição`);
      }
    });
  });

  describe('android-nativo.yml', () => {
    const codigo = semComentarios(lerWorkflow('android-nativo.yml'));

    it('a matriz cobre exatamente os apps Expo do repositório', () => {
      const linha = codigo.match(/^\s+app:\s*\[([^\]]*)\]\s*$/m);
      assert.ok(linha, 'matriz `app: [...]` não encontrada');
      const matriz = linha[1]
        .split(',')
        .map((app) => app.trim())
        .sort();
      assert.deepEqual(matriz, appsExpo);
    });

    it('faz prebuild, Gradle e guarda o APK, falhando se ele não sair', () => {
      assert.match(codigo, /expo prebuild --platform android --clean --no-install/);
      assert.match(codigo, /\.\/gradlew assembleRelease/);
      assert.match(codigo, /if-no-files-found: error/);
      assert.doesNotMatch(codigo, /\bif:/);
    });

    it('a matriz não interrompe os outros apps, mas cada app falha por si', () => {
      assert.match(codigo, /fail-fast: false/);
    });
  });
});
