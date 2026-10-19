// Testes do gerador da lista pública de senhas comuns (etapa 5b do plano 01b, S74). As fontes
// não ficam no repositório: aqui vão as funções puras, a recusa de fonte com outro SHA-256 e o
// cabeçalho do arquivo gerado que está versionado.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { formaComparavelDaSenha } from '../packages/contratos/src/validadores/senhas-comuns.ts';
import {
  emLinhas,
  filtrarNucleos,
  filtrarSenhas,
  FONTES,
  formaComparavel,
  gerar,
  montarModulo,
  SAIDA_PADRAO,
} from './gerar-senhas-comuns.mjs';

const SCRIPT = fileURLToPath(new URL('./gerar-senhas-comuns.mjs', import.meta.url));
const TEMPORARIA = mkdtempSync(join(tmpdir(), 'senhas-comuns-'));

after(() => rmSync(TEMPORARIA, { recursive: true, force: true }));

function rodarCli(...argumentos) {
  return spawnSync(process.execPath, [SCRIPT, ...argumentos], { encoding: 'utf8' });
}

describe('gerador de senhas comuns: forma comparável', () => {
  it('é a mesma de formaComparavelDaSenha do @bairrin/contratos', () => {
    for (const texto of [
      'São Paulo 123',
      'Bem-vindo_1.0',
      '--senha--',
      'ｓｅｎｈａ１２３',
      'se\u200bn\u00adha\u2060123\ufeff',
      'FAMÍLIA 2025',
      'İstanbul',
      'Straße',
      'acalmá-lo',
      'a-_.b',
      '........',
      '🔑🏠',
    ]) {
      assert.equal(formaComparavel(texto), formaComparavelDaSenha(texto), texto);
    }
  });
});

describe('gerador de senhas comuns: filtros', () => {
  it('senhas: forma comparável, 8 caracteres ou mais, sem repetir e em ordem', () => {
    assert.deepEqual(filtrarSenhas('Password\n123456\nPASSWORD\r\nqwe-rty-uiop\n\nsenha12\n'), [
      'password',
      'qwertyuiop',
    ]);
  });

  it('senhas: linha com cara de e-mail aborta a geração', () => {
    assert.throws(
      () => filtrarSenhas('password\nana@exemplo.com.br\n'),
      /linha 2 da lista de senhas parece um e-mail/,
    );
  });

  it('núcleos: forma comparável, 3 letras ou mais, só letras e sem repetir', () => {
    assert.deepEqual(filtrarNucleos(['João', 'de', 'ana'], ['Ana', '40.000', "d'água"], ['oi']), [
      'ana',
      'joao',
    ]);
    assert.throws(() => filtrarNucleos([1]), /entrada que não é texto/);
  });

  it('linhas: até 100 caracteres e escape de crase, cifrão e barra', () => {
    const linhas = emLinhas([
      'a`b',
      'c$d',
      'e\\f',
      ...Array.from({ length: 40 }, () => 'abcdefgh'),
    ]);
    assert.ok(linhas.startsWith('a\\`b c\\$d e\\\\f '));
    assert.ok(linhas.split('\n').every((linha) => linha.length <= 100));
  });

  it('o módulo montado devolve as mesmas entradas quando importado', async () => {
    const senhas = ['pass`word$1', 'barra\\invertida'];
    const nucleos = ['ana', 'joao'];
    const caminho = join(TEMPORARIA, 'modulo.ts');
    writeFileSync(
      caminho,
      montarModulo({
        senhas,
        nucleos,
        origem: [{ nome: 'teste', url: 'https://exemplo.com', sha256: '0'.repeat(64) }],
        licencaSeclists: 'MIT',
        licencaZxcvbn: 'MIT',
        aviso: 'aviso',
      }),
    );
    const modulo = await import(caminho);
    const entradas = (texto) => texto.split(/\s+/u).filter((entrada) => entrada.length > 0);
    assert.deepEqual(entradas(modulo.SENHAS_DA_LISTA_PUBLICA), senhas);
    assert.deepEqual(entradas(modulo.NUCLEOS_DA_LISTA_PUBLICA), nucleos);
  });
});

describe('gerador de senhas comuns: fontes', () => {
  it('recusa fonte com SHA-256 diferente do fixado', () => {
    const seclists = join(TEMPORARIA, 'seclists');
    const zxcvbn = join(TEMPORARIA, 'zxcvbn');
    mkdirSync(seclists);
    mkdirSync(join(zxcvbn, 'src'), { recursive: true });
    writeFileSync(
      join(zxcvbn, 'package.json'),
      JSON.stringify({ name: '@zxcvbn-ts/language-pt-br', version: '4.1.1', license: 'MIT' }),
    );
    writeFileSync(join(seclists, FONTES.senhas.arquivo), 'password\n');
    assert.throws(() => gerar({ seclists, zxcvbn }), /SHA-256 [0-9a-f]{64} difere do fixado/);
  });

  it('a CLI sem as pastas sai com 1 e não grava nada', () => {
    const resultado = rodarCli('--seclists', TEMPORARIA);
    assert.equal(resultado.status, 1);
    assert.match(resultado.stderr, /informe --seclists <pasta> e --zxcvbn <pasta>/);
  });
});

describe('lista gerada e versionada (apps/api/src/modulos/identidade/http/dados)', () => {
  const arquivo = readFileSync(SAIDA_PADRAO, 'utf8');
  const cabecalho = arquivo.slice(0, arquivo.indexOf('export const'));

  it('o cabeçalho traz URL, commit ou versão, SHA-256 fixado, licenças e filtro', () => {
    assert.match(cabecalho, /^\/\/ ARQUIVO GERADO por `node scripts\/gerar-senhas-comuns\.mjs`/);
    assert.match(
      SAIDA_PADRAO,
      /apps\/api\/src\/modulos\/identidade\/http\/dados\/senhas-comuns-publicas\.ts$/,
    );
    for (const fonte of [FONTES.senhas, FONTES.nomes, FONTES.palavras]) {
      assert.ok(cabecalho.includes(fonte.url), fonte.url);
      assert.ok(cabecalho.includes(`SHA-256 ${fonte.sha256}`), fonte.arquivo);
    }
    assert.match(cabecalho, /SecLists \(commit [0-9a-f]{40}\)/);
    assert.match(cabecalho, /@zxcvbn-ts\/language-pt-br 4\.1\.1/);
    assert.match(cabecalho, /Copyright \(c\) 2018 Daniel Miessler/);
    assert.match(cabecalho, /Copyright \(c\) 2012-2016 Dan Wheeler and Dropbox, Inc\./);
    assert.match(cabecalho, /Copyright \(c\) 2021 @zxcvbn-ts/);
    assert.equal(cabecalho.match(/Permission is hereby granted, free of charge/g)?.length, 2);
    assert.match(cabecalho, /License: ODC-BY/);
    assert.match(cabecalho, /palavras \(OpenSubtitles, ODC-BY\)/);
    assert.match(cabecalho, /com 8 caracteres ou mais/);
    assert.match(cabecalho, /com 3 letras ou\n\/\/ {3}mais, só letras/);
    assert.match(cabecalho, /Fonte: IBGE/);
    assert.doesNotMatch(cabecalho, /lastnames|sobrenomes|wiktionary/i);
    assert.equal(cabecalho.match(/SHA-256 [0-9a-f]{64}/g)?.length, 3);
  });
});
