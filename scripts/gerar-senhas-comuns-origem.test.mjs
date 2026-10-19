// QA da etapa 5b do plano 01b (S74): o que o teste do gerador não prova. Origem e SHA-256 no
// cabeçalho (CA1), fontes e filtros sem e-mail (CA2), nenhum download em install, build ou CI
// (CA3) e a lista pública fora do que vai para painel e apps (CA8).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  NUCLEOS_DA_LISTA_PUBLICA,
  SENHAS_DA_LISTA_PUBLICA,
} from '../apps/api/src/modulos/identidade/http/dados/senhas-comuns-publicas.ts';
import {
  filtrarNucleos,
  filtrarSenhas,
  FONTES,
  gerar,
  montarModulo,
  SAIDA_PADRAO,
} from './gerar-senhas-comuns.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(RAIZ, 'scripts', 'gerar-senhas-comuns.mjs');
const TEMPORARIA = mkdtempSync(join(tmpdir(), 'senhas-comuns-qa-'));

after(() => rmSync(TEMPORARIA, { recursive: true, force: true }));

const entradas = (texto) => texto.split(/\s+/u).filter((entrada) => entrada.length > 0);

/** Todos os arquivos de texto sob `pasta`, sem as pastas de dependência e de saída. */
function arquivos(pasta, aceita) {
  if (!existsSync(pasta)) return [];
  const achados = [];
  for (const item of readdirSync(pasta, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.expo', 'build', 'coverage'].includes(item.name)) continue;
    const caminho = join(pasta, item.name);
    if (item.isDirectory()) achados.push(...arquivos(caminho, aceita));
    else if (aceita(item.name)) achados.push(caminho);
  }
  return achados;
}

function criarPastaDePacote(nome, conteudo) {
  const pasta = join(TEMPORARIA, nome);
  mkdirSync(join(pasta, 'src'), { recursive: true });
  writeFileSync(join(pasta, 'package.json'), JSON.stringify(conteudo));
  return pasta;
}

describe('CA1: o cabeçalho do arquivo gerado diz de onde vem cada coisa', () => {
  const arquivo = readFileSync(SAIDA_PADRAO, 'utf8');
  const cabecalho = arquivo.slice(0, arquivo.indexOf('export const'));

  it('as contagens do cabeçalho são as do arquivo', () => {
    const senhas = entradas(SENHAS_DA_LISTA_PUBLICA);
    const nucleos = entradas(NUCLEOS_DA_LISTA_PUBLICA);
    assert.match(
      cabecalho,
      new RegExp(`SENHAS_DA_LISTA_PUBLICA: .* \\(${senhas.length}\\)\\.`, 'u'),
    );
    assert.match(cabecalho, new RegExp(`só letras \\(${nucleos.length}\\)\\.`, 'u'));
  });

  it('cada fonte do cabeçalho tem URL de origem fixada (commit ou versão) e SHA-256 de 64 hex', () => {
    const origens = cabecalho.match(/^\/\/ - .*: https:\/\/.*$/gmu) ?? [];
    // SecLists, nomes e palavras; as licenças e o NOTICE são lidos, mas não geram entrada.
    assert.equal(origens.length, 3);
    assert.match(origens[0], /SecLists \(commit [0-9a-f]{40}\).*\/[0-9a-f]{40}\//u);
    assert.match(origens[1], /language-pt-br-4\.1\.1\.tgz/u);
    assert.match(origens[2], /language-pt-br-4\.1\.1\.tgz/u);
    const hashes = cabecalho.match(/SHA-256 [0-9a-f]{64}/gu) ?? [];
    assert.deepEqual(
      hashes,
      [FONTES.senhas, FONTES.nomes, FONTES.palavras].map(({ sha256 }) => `SHA-256 ${sha256}`),
    );
  });

  it('nenhuma URL do cabeçalho aponta para ramo móvel (main, master, latest)', () => {
    for (const url of cabecalho.match(/https:\/\/\S+/gu) ?? []) {
      assert.doesNotMatch(url, /\/(main|master|HEAD)\/|@latest|\/latest\//u, url);
    }
  });

  it('as listas estão em ordem e sem repetir, como o gerador as grava', () => {
    for (const lista of [entradas(SENHAS_DA_LISTA_PUBLICA), entradas(NUCLEOS_DA_LISTA_PUBLICA)]) {
      assert.deepEqual(lista, [...lista].sort());
      assert.equal(new Set(lista).size, lista.length);
    }
  });

  it('o arquivo gerado só exporta as duas listas em texto, sem código', () => {
    const corpo = arquivo.slice(arquivo.indexOf('export const'));
    const instrucoes = corpo.match(/^(export|import|const|let|var|function)\b.*$/gmu) ?? [];
    assert.deepEqual(instrucoes, [
      'export const SENHAS_DA_LISTA_PUBLICA: string = `',
      'export const NUCLEOS_DA_LISTA_PUBLICA: string = `',
    ]);
  });
});

describe('CA2: filtros e fonte sem e-mail', () => {
  it('a lista gerada não tem e-mail, nem arroba, nem URL', () => {
    for (const entrada of [
      ...entradas(SENHAS_DA_LISTA_PUBLICA),
      ...entradas(NUCLEOS_DA_LISTA_PUBLICA),
    ]) {
      assert.doesNotMatch(entrada, /@|:\/\/|www\./u, entrada);
    }
  });

  it('a lista gerada só tem entradas que o filtro deixaria passar', () => {
    const senhas = entradas(SENHAS_DA_LISTA_PUBLICA);
    const nucleos = entradas(NUCLEOS_DA_LISTA_PUBLICA);
    assert.deepEqual(filtrarSenhas(senhas.join('\n')), senhas);
    assert.deepEqual(filtrarNucleos(nucleos), nucleos);
  });

  it('senha: aborta com e-mail em qualquer forma que um vazamento costuma ter', () => {
    for (const linha of [
      'ana@exemplo.com',
      'ANA@EXEMPLO.COM.BR',
      'ana+loja@sub.exemplo.com.br',
      'ana@exemplo.com:senha12345',
      'senha12345:ana@exemplo.com',
      'x@y.io',
      'senha12 ana@exemplo.com',
    ]) {
      assert.throws(
        () => filtrarSenhas(`password\n${linha}\nqwertyuiop\n`),
        /linha 2 da lista de senhas parece um e-mail/u,
        linha,
      );
    }
  });

  it('senha: arroba em senha comum não é e-mail e entra, com o arroba', () => {
    assert.deepEqual(filtrarSenhas('p@ssword1\nsenha@123\n'), ['p@ssword1', 'senha@123']);
  });

  it('senha: a mensagem de abortar não repete o e-mail', () => {
    assert.throws(
      () => filtrarSenhas('ana.secreta@exemplo.com\n'),
      (erro) => !erro.message.includes('ana.secreta') && !erro.message.includes('exemplo.com'),
    );
  });

  it('núcleos: nada que não seja só letras entra, inclusive e-mail, URL e número', () => {
    assert.deepEqual(
      filtrarNucleos(
        ['ana@exemplo.com', 'https://exemplo.com', '12345', 'a1b2c3', 'joão-pedro', "d'água"],
        ['Maria', 'Ç', 'çã', 'ação'],
      ),
      // `joão-pedro` perde o hífen interno na forma comparável e vira só letras.
      ['acao', 'joaopedro', 'maria'],
    );
  });

  it('senha: 7 caracteres ficam de fora, 8 entram; conta caracteres, não bytes', () => {
    assert.deepEqual(filtrarSenhas('1234567\n12345678\nabcdefg\n'), ['12345678']);
    assert.deepEqual(filtrarSenhas('😀😀😀😀😀😀😀\n😀😀😀😀😀😀😀😀\n'), ['😀😀😀😀😀😀😀😀']);
  });

  it('núcleos: 2 letras ficam de fora, 3 entram', () => {
    assert.deepEqual(filtrarNucleos(['ab', 'abc', 'çã']), ['abc']);
  });
});

describe('CA1: o módulo que o gerador monta', () => {
  it('as senhas saem em ordem, para o arquivo versionado mudar só quando a fonte muda', () => {
    assert.deepEqual(filtrarSenhas('zzzzzzzz\naaaaaaaa\nmmmmmmmm\n'), [
      'aaaaaaaa',
      'mmmmmmmm',
      'zzzzzzzz',
    ]);
    assert.deepEqual(filtrarNucleos(['zzz', 'aaa', 'mmm']), ['aaa', 'mmm', 'zzz']);
  });

  it('o cabeçalho leva a origem, o SHA-256, as duas licenças e o aviso, nessa ordem', () => {
    const modulo = montarModulo({
      senhas: ['abcdefgh'],
      nucleos: ['abc'],
      origem: [
        { nome: 'Fonte A', url: 'https://a.exemplo/a.txt', sha256: 'a'.repeat(64) },
        { nome: 'Fonte B', url: 'https://b.exemplo/b.json', sha256: 'b'.repeat(64) },
      ],
      licencaSeclists: 'LICENCA-DO-SECLISTS',
      licencaZxcvbn: 'LICENCA-DO-ZXCVBN',
      aviso: 'AVISO-DO-ODC-BY',
    });
    const cabecalho = modulo.slice(0, modulo.indexOf('export const'));
    assert.ok(
      cabecalho
        .split('\n')
        .filter((linha) => linha.length > 0 && !linha.startsWith('/**'))
        .every((linha) => linha.startsWith('//')),
    );
    const ordem = [
      '- Fonte A: https://a.exemplo/a.txt',
      `SHA-256 ${'a'.repeat(64)}`,
      '- Fonte B: https://b.exemplo/b.json',
      `SHA-256 ${'b'.repeat(64)}`,
      'LICENCA-DO-SECLISTS',
      'LICENCA-DO-ZXCVBN',
      'AVISO-DO-ODC-BY',
    ].map((trecho) => cabecalho.indexOf(trecho));
    assert.ok(
      ordem.every((posicao) => posicao >= 0),
      JSON.stringify(ordem),
    );
    assert.deepEqual(
      ordem,
      [...ordem].sort((a, b) => a - b),
    );
    assert.match(cabecalho, /\(1\)\./u);
  });
});

describe('CA1 e CA2: o gerador recusa fonte fora do combinado e não grava nada', () => {
  it('pacote com outro nome, outra versão ou outra licença', () => {
    const casos = [
      [
        { name: 'outro', version: '4.1.1', license: 'MIT' },
        /esperava @zxcvbn-ts\/language-pt-br 4\.1\.1/u,
      ],
      [
        { name: '@zxcvbn-ts/language-pt-br', version: '4.2.0', license: 'MIT' },
        /esperava @zxcvbn-ts\/language-pt-br 4\.1\.1, veio .* 4\.2\.0/u,
      ],
      [
        { name: '@zxcvbn-ts/language-pt-br', version: '4.1.1', license: 'CC-BY-SA-3.0' },
        /licença do pacote inesperada: CC-BY-SA-3\.0/u,
      ],
    ];
    for (const [pacote, esperado] of casos) {
      const zxcvbn = criarPastaDePacote(`zxcvbn-${pacote.version}-${pacote.license}`, pacote);
      assert.throws(() => gerar({ seclists: TEMPORARIA, zxcvbn }), esperado);
    }
  });

  it('arquivo de fonte que falta dá erro claro, não lista vazia', () => {
    const zxcvbn = criarPastaDePacote('zxcvbn-sem-arquivos', {
      name: '@zxcvbn-ts/language-pt-br',
      version: '4.1.1',
      license: 'MIT',
    });
    assert.throws(() => gerar({ seclists: TEMPORARIA, zxcvbn }), /ENOENT/u);
  });

  it('a CLI com SHA-256 diferente sai com 1, explica e não cria nem muda o arquivo de saída', () => {
    const seclists = join(TEMPORARIA, 'cli-seclists');
    mkdirSync(seclists);
    writeFileSync(join(seclists, FONTES.senhas.arquivo), 'password\n');
    const zxcvbn = criarPastaDePacote('cli-zxcvbn', {
      name: '@zxcvbn-ts/language-pt-br',
      version: '4.1.1',
      license: 'MIT',
    });
    const saida = join(TEMPORARIA, 'saida-que-nao-deve-existir.ts');
    const antes = readFileSync(SAIDA_PADRAO, 'utf8');
    const resultado = spawnSync(
      process.execPath,
      [SCRIPT, '--seclists', seclists, '--zxcvbn', zxcvbn, '--saida', saida],
      { encoding: 'utf8' },
    );
    assert.equal(resultado.status, 1);
    assert.match(resultado.stderr, /Não gerei a lista: .*difere do fixado/u);
    assert.equal(existsSync(saida), false);
    assert.equal(readFileSync(SAIDA_PADRAO, 'utf8'), antes);
  });

  it('a CLI recusa argumento desconhecido ou sem valor, sem tocar a saída padrão', () => {
    const antes = readFileSync(SAIDA_PADRAO, 'utf8');
    for (const argumentos of [
      ['--download', 'sim'],
      ['--seclists'],
      ['--saida', join(TEMPORARIA, 'x.ts'), '--seclists', 'a', '--zxcvbn'],
      ['--url', 'https://exemplo.com/lista.txt'],
    ]) {
      const resultado = spawnSync(process.execPath, [SCRIPT, ...argumentos], {
        encoding: 'utf8',
      });
      assert.equal(resultado.status, 1, argumentos.join(' '));
      assert.match(resultado.stderr, /Não gerei a lista: /u);
    }
    assert.equal(readFileSync(SAIDA_PADRAO, 'utf8'), antes);
  });
});

describe('CA3: nada é baixado em install, build ou CI', () => {
  const pacotes = [
    join(RAIZ, 'package.json'),
    ...['apps', 'packages'].flatMap((pasta) =>
      readdirSync(join(RAIZ, pasta)).map((nome) => join(RAIZ, pasta, nome, 'package.json')),
    ),
  ].filter((caminho) => existsSync(caminho));

  it('há package.json para olhar: raiz, api, painel, contratos e cliente-api', () => {
    const nomes = pacotes.map((caminho) => relative(RAIZ, caminho));
    for (const esperado of [
      'package.json',
      'apps/api/package.json',
      'apps/painel/package.json',
      'packages/contratos/package.json',
      'packages/cliente-api/package.json',
    ]) {
      assert.ok(nomes.includes(esperado), esperado);
    }
  });

  it('nenhum script de nenhum pacote roda o gerador nem baixa a lista', () => {
    for (const caminho of pacotes) {
      const { scripts = {} } = JSON.parse(readFileSync(caminho, 'utf8'));
      for (const [nome, comando] of Object.entries(scripts)) {
        assert.doesNotMatch(
          comando,
          /gerar-senhas|senhas-comuns|seclists|zxcvbn|curl|wget|fetch|https?:\/\//iu,
          `${relative(RAIZ, caminho)} -> ${nome}`,
        );
      }
    }
  });

  it('nenhum pacote declara dependência de lista de senhas (zxcvbn, SecLists, senhas comuns)', () => {
    for (const caminho of pacotes) {
      const pacote = JSON.parse(readFileSync(caminho, 'utf8'));
      const nomes = [
        ...Object.keys(pacote.dependencies ?? {}),
        ...Object.keys(pacote.devDependencies ?? {}),
        ...Object.keys(pacote.optionalDependencies ?? {}),
        ...Object.keys(pacote.peerDependencies ?? {}),
      ];
      assert.deepEqual(
        nomes.filter((nome) => /zxcvbn|seclists|common-passwords|password|senha/iu.test(nome)),
        [],
        relative(RAIZ, caminho),
      );
    }
  });

  it('o pnpm-lock.yaml e o pnpm-workspace.yaml não trazem pacote de lista de senhas', () => {
    for (const arquivo of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
      assert.doesNotMatch(
        readFileSync(join(RAIZ, arquivo), 'utf8'),
        /zxcvbn|seclists|common-passwords/iu,
        arquivo,
      );
    }
  });

  it('os fluxos do GitHub não rodam o gerador nem baixam fonte', () => {
    const fluxos = arquivos(join(RAIZ, '.github'), (nome) => /\.ya?ml$/u.test(nome));
    assert.ok(fluxos.length >= 1);
    for (const caminho of fluxos) {
      assert.doesNotMatch(
        readFileSync(caminho, 'utf8'),
        /gerar-senhas|senhas-comuns|seclists|zxcvbn/iu,
        relative(RAIZ, caminho),
      );
    }
  });

  it('o Dockerfile e o fly.toml da API não rodam o gerador', () => {
    for (const arquivo of ['apps/api/Dockerfile', 'apps/api/fly.toml']) {
      const texto = readFileSync(join(RAIZ, arquivo), 'utf8');
      assert.doesNotMatch(texto, /gerar-senhas|seclists|zxcvbn/iu, arquivo);
    }
  });

  it('o gerador não abre rede nem executa nada: só lê arquivo local e grava o resultado', () => {
    const fonte = readFileSync(SCRIPT, 'utf8');
    const codigo = fonte
      .split('\n')
      .filter((linha) => !linha.trimStart().startsWith('//'))
      .join('\n');
    assert.doesNotMatch(
      codigo,
      /\bfetch\s*\(|node:https?|node:net|node:dns|node:child_process|node:vm|node:worker_threads|\beval\s*\(|new Function|\brequire\s*\(|\bimport\s*\(|XMLHttpRequest|WebSocket|spawn|exec(Sync|File)?\s*\(/u,
    );
    const importacoes = [...codigo.matchAll(/^import .* from '([^']+)';$/gmu)].map(
      ([, nome]) => nome,
    );
    assert.deepEqual(importacoes.sort(), ['node:crypto', 'node:fs', 'node:path', 'node:url']);
  });

  it('o gerador só escreve num lugar: o arquivo de saída', () => {
    const codigo = readFileSync(SCRIPT, 'utf8');
    assert.equal((codigo.match(/writeFileSync\(/gu) ?? []).length, 1);
    assert.doesNotMatch(
      codigo,
      /appendFile|createWriteStream|mkdirSync|rmSync|unlinkSync|renameSync/u,
    );
  });
});

describe('CA8: a lista pública não vai para painel, apps nem pacotes compartilhados', () => {
  const ehFonte = (nome) =>
    /\.(ts|tsx|js|jsx|mjs|cjs|json)$/u.test(nome) && !/\.test\./u.test(nome);
  const clientes = [
    'apps/painel/src',
    'apps/consumidor/src',
    'apps/lojista/src',
    'packages/contratos/src',
    'packages/cliente-api/src',
    'packages/tokens/src',
    'packages/mobile-base/src',
  ];

  it('nenhum arquivo de cliente ou de pacote compartilhado importa o arquivo gerado', () => {
    for (const pasta of clientes) {
      for (const caminho of arquivos(join(RAIZ, pasta), ehFonte)) {
        assert.doesNotMatch(
          readFileSync(caminho, 'utf8'),
          /senhas-comuns-publicas|LISTA_PUBLICA_DE_SENHAS|SENHAS_DA_LISTA_PUBLICA|NUCLEOS_DA_LISTA_PUBLICA/u,
          relative(RAIZ, caminho),
        );
      }
    }
  });

  it('os pacotes de cliente não têm arquivo grande de dados (a lista pesa cerca de 380 KB)', () => {
    for (const pasta of clientes) {
      for (const caminho of arquivos(join(RAIZ, pasta), (nome) => !/\.test\./u.test(nome))) {
        assert.ok(
          statSync(caminho).size < 100_000,
          `${relative(RAIZ, caminho)} tem ${statSync(caminho).size} bytes`,
        );
      }
    }
  });

  it('nenhuma palavra que só existe na lista pública aparece no fonte dos clientes', () => {
    const lista = new Set(entradas(NUCLEOS_DA_LISTA_PUBLICA));
    // Palavras de cultura pop e nomes sem uso na interface; confira que ainda estão na lista.
    const sentinelas = ['pikachu', 'naruto', 'wisconsin', 'fellini', 'sorvete'];
    for (const palavra of sentinelas) assert.ok(lista.has(palavra), `${palavra} saiu da lista`);
    for (const pasta of clientes) {
      for (const caminho of arquivos(join(RAIZ, pasta), ehFonte)) {
        const texto = readFileSync(caminho, 'utf8').toLowerCase();
        for (const palavra of sentinelas) {
          assert.ok(!texto.includes(palavra), `${palavra} em ${relative(RAIZ, caminho)}`);
        }
      }
    }
  });

  it('o pacote contratos não exporta caminho nenhum de dados', () => {
    const { exports } = JSON.parse(
      readFileSync(join(RAIZ, 'packages/contratos/package.json'), 'utf8'),
    );
    assert.deepEqual(Object.keys(exports).sort(), ['.', './validadores']);
    assert.ok(!existsSync(join(RAIZ, 'packages/contratos/src/validadores/dados')));
  });

  it('a regra do dependency-cruiser que impede cliente de importar a API continua no arquivo', () => {
    const regras = readFileSync(join(RAIZ, '.dependency-cruiser.cjs'), 'utf8');
    assert.match(regras, /fora-da-api-nao-importa-api/u);
  });
});
