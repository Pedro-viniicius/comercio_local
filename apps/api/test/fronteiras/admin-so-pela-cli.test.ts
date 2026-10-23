// CA-07: nenhum endpoint público concede `admin`; o perfil nasce só pela CLI `seed:admin`
// (plano 01b, etapa 13). A rota de HTTP é da etapa 16: este teste olha o código-fonte e
// quebra se algum arquivo de `http/` (controller, guarda, DTO) passar a chamar o que cria
// ou concede admin, ou se outro lugar da aplicação passar a conceder admin.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const raizDaApi = join(aqui, '..', '..');
const pastaSrc = join(raizDaApi, 'src');

/** Arquivos `.ts` de produção (sem teste) de `src`, com o caminho relativo à API. */
function arquivosDeProducao(): { caminho: string; texto: string }[] {
  return readdirSync(pastaSrc, { recursive: true, encoding: 'utf8' })
    .filter((caminho) => caminho.endsWith('.ts') && !caminho.endsWith('.test.ts'))
    .map((caminho) => ({
      caminho: relative(raizDaApi, join(pastaSrc, caminho)).split('\\').join('/'),
      texto: readFileSync(join(pastaSrc, caminho), 'utf8'),
    }));
}

/** O texto sem comentários de linha e de bloco: citar a CLI num comentário não é chamar. */
function semComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function quemCita(termo: RegExp): string[] {
  return arquivosDeProducao()
    .filter(({ texto }) => termo.test(semComentarios(texto)))
    .map(({ caminho }) => caminho)
    .sort();
}

describe('admin só nasce pela CLI seed:admin (CA-07)', () => {
  it('só `Conta` concede admin (`concederAdmin`)', () => {
    expect(quemCita(/\bconcederAdmin\s*\(/)).toEqual(['src/modulos/identidade/dominio/conta.ts']);
  });

  it('só o caso de uso da CLI cria conta admin (`Conta.criarAdmin`)', () => {
    expect(quemCita(/\.criarAdmin\s*\(/)).toEqual([
      'src/modulos/identidade/aplicacao/cadastro/criar-admin.caso-de-uso.ts',
    ]);
  });

  it('nenhum arquivo de http/ conhece o caso de uso da CLI nem concede admin', () => {
    const proibidos = /\b(CriarAdminCasoDeUso|criarAdmin|concederAdmin|criar-admin\.caso-de-uso)\b/;
    const emHttp = arquivosDeProducao().filter(
      ({ caminho, texto }) => /\/http\//.test(caminho) && proibidos.test(semComentarios(texto)),
    );

    expect(emHttp.map(({ caminho }) => caminho)).toEqual([]);
  });

  it('só a CLI e o módulo importam o caso de uso da CLI', () => {
    const importadores = quemCita(/criar-admin\.caso-de-uso\.ts/);

    for (const caminho of importadores) {
      expect(caminho, `${caminho} não deveria importar CriarAdminCasoDeUso`).toMatch(
        /^src\/cli\/seed-admin\.ts$|^src\/modulos\/identidade\/identidade\.module\.ts$/,
      );
    }
    expect(importadores).toContain('src/cli/seed-admin.ts');
  });
});
