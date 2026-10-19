// Gerador da lista pública de senhas comuns (etapa 5b do plano 01b, S74).
//
// Roda à mão, nunca em `install`, `build` ou CI. Lê arquivos já baixados e conferidos e grava
// `apps/api/src/modulos/identidade/http/dados/senhas-comuns-publicas.ts`: a lista é dado de
// terceiros e fica só na API, sem ir em bundle de app ou do painel. Não baixa nada e não
// executa nada das fontes: só lê texto e JSON.
//
//   node scripts/gerar-senhas-comuns.mjs \
//     --seclists <pasta com xato-net-10-million-passwords-10000.txt e LICENSE> \
//     --zxcvbn <pasta "package" extraída do tarball do @zxcvbn-ts/language-pt-br>
//
// Cada arquivo lido precisa ter o SHA-256 fixado em `FONTES`: outra versão das listas só entra
// trocando a fonte aqui, com a licença e o conteúdo conferidos de novo (o roteiro está no
// README do `@bairrin/contratos`).
//
// Fontes (P11 do plano 01b, opção 1, decisão do dono de 2026-10-17): senhas do SecLists (MIT),
// nomes do IBGE (`firstnames.json`) e palavras do OpenSubtitles (`commonWords.json`, ODC-BY),
// os dois do `@zxcvbn-ts/language-pt-br`. O `lastnames.json` (pt.wiktionary, CC BY-SA) não
// entra: os sobrenomes mais comuns ficam escritos à mão em `senhas-comuns.ts` do pacote.
//
// Filtros, na forma comparável (a mesma de `formaComparavelDaSenha`):
// - senhas do SecLists: 8 caracteres ou mais (a senha mais curta já é recusada pelo tamanho);
//   uma linha com cara de e-mail aborta a geração (lista de vazamento com identificador não
//   entra);
// - nomes e palavras: 3 letras ou mais e só letras (R34), porque viram núcleo e parte de
//   núcleo composto, e o núcleo mais curto que 3 não é comparado.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SAIDA_PADRAO = fileURLToPath(
  new URL(
    '../apps/api/src/modulos/identidade/http/dados/senhas-comuns-publicas.ts',
    import.meta.url,
  ),
);

export const TAMANHO_MINIMO_DA_SENHA = 8;
export const TAMANHO_MINIMO_DO_NUCLEO = 3;

const COMMIT_SECLISTS = '913b327317496d062bcc7cace524aaad8a693be2';
const BASE_SECLISTS = `https://raw.githubusercontent.com/danielmiessler/SecLists/${COMMIT_SECLISTS}`;
const VERSAO_ZXCVBN = '4.1.1';
const TARBALL_ZXCVBN = `https://registry.npmjs.org/@zxcvbn-ts/language-pt-br/-/language-pt-br-${VERSAO_ZXCVBN}.tgz`;

/** Origem fixada de cada arquivo lido: caminho relativo à pasta passada, URL e SHA-256. */
export const FONTES = {
  senhas: {
    arquivo: 'xato-net-10-million-passwords-10000.txt',
    url: `${BASE_SECLISTS}/Passwords/Common-Credentials/xato-net-10-million-passwords-10000.txt`,
    sha256: 'c63d5e4ccc31344d662583cc39ca4bd5bd20517ff1d24501f0c4e0c22d9b722a',
  },
  licencaSeclists: {
    arquivo: 'LICENSE',
    url: `${BASE_SECLISTS}/LICENSE`,
    sha256: '3dbdc93d5f8829de0941744841730a09c106d0732e5ae0e98ca1d77be7ded66c',
  },
  nomes: {
    arquivo: 'src/firstnames.json',
    url: `${TARBALL_ZXCVBN} (package/src/firstnames.json)`,
    sha256: '69a94c5d32aedb956e98b23d5c5798cfa45e1bf1fea467940adbe4c40a8d4e4b',
  },
  palavras: {
    arquivo: 'src/commonWords.json',
    url: `${TARBALL_ZXCVBN} (package/src/commonWords.json)`,
    sha256: 'a67d516b5c9addbb5a53acbc73528f2691c91a5f7a6017fae54b3edc26a62f67',
  },
  licencaZxcvbn: {
    arquivo: 'LICENSE.txt',
    url: `${TARBALL_ZXCVBN} (package/LICENSE.txt)`,
    sha256: 'c376f457b9569b2a88506f78fe420511a3ca3be5819b69dda405b988b784735f',
  },
  avisoZxcvbn: {
    arquivo: 'NOTICE.md',
    url: `${TARBALL_ZXCVBN} (package/NOTICE.md)`,
    sha256: '7e0d37cbb4ce3541cc4447ab3fa1c836cf87729572490f421bc0599885b311f0',
  },
};

const INVISIVEL = /[\s\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
const SEPARADOR_INTERNO = /(?<=[^-_.])[-_.]+(?=[^-_.])/gu;
const SO_LETRAS = /^\p{L}+$/u;
const CARA_DE_EMAIL = /[^@\s]@[^@\s]+\.[a-z]{2,}/iu;

/**
 * Cópia de `formaComparavelDaSenha` (`packages/contratos/src/validadores/senhas-comuns.ts`):
 * o gerador roda no Node sem carregar TypeScript. O teste do pacote confere que cada entrada
 * gerada já está na forma da função de lá.
 */
export function formaComparavel(texto) {
  return texto
    .normalize('NFKC')
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .replaceAll(INVISIVEL, '')
    .toLowerCase()
    .replaceAll(SEPARADOR_INTERNO, '');
}

function tamanho(texto) {
  return [...texto].length;
}

export function sha256(conteudo) {
  return createHash('sha256').update(conteudo).digest('hex');
}

/** Senhas do SecLists, uma por linha: forma comparável, 8 caracteres ou mais, sem repetir. */
export function filtrarSenhas(texto) {
  const linhas = texto.split(/\r?\n/u).filter((linha) => linha.length > 0);
  const comEmail = linhas.findIndex((linha) => CARA_DE_EMAIL.test(linha));
  if (comEmail !== -1) {
    throw new Error(
      `a linha ${comEmail + 1} da lista de senhas parece um e-mail: lista com identificador não entra`,
    );
  }
  const senhas = linhas
    .map(formaComparavel)
    .filter((senha) => tamanho(senha) >= TAMANHO_MINIMO_DA_SENHA);
  return [...new Set(senhas)].sort();
}

/** Palavras dos dicionários: forma comparável, 3 letras ou mais e só letras, sem repetir. */
export function filtrarNucleos(...listas) {
  const nucleos = listas
    .flat()
    .map((palavra) => {
      if (typeof palavra !== 'string') throw new Error('o dicionário tem entrada que não é texto');
      return formaComparavel(palavra);
    })
    .filter((palavra) => tamanho(palavra) >= TAMANHO_MINIMO_DO_NUCLEO && SO_LETRAS.test(palavra));
  return [...new Set(nucleos)].sort();
}

/** Texto de template literal: só `\`, crase e `$` precisam de escape. */
function escaparNoTemplate(texto) {
  return texto.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('$', '\\$');
}

/** Entradas separadas por espaço, em linhas de até `largura` caracteres. */
export function emLinhas(entradas, largura = 100) {
  const linhas = [];
  let atual = '';
  for (const entrada of entradas.map(escaparNoTemplate)) {
    if (atual.length > 0 && atual.length + 1 + entrada.length > largura) {
      linhas.push(atual);
      atual = entrada;
    } else {
      atual = atual.length > 0 ? `${atual} ${entrada}` : entrada;
    }
  }
  if (atual.length > 0) linhas.push(atual);
  return linhas.join('\n');
}

function comentario(texto) {
  return texto
    .trimEnd()
    .split('\n')
    .map((linha) => (linha.trim().length > 0 ? `// ${linha.trimEnd()}` : '//'))
    .join('\n');
}

/**
 * O módulo gerado: cabeçalho com origem, SHA-256, licenças e filtro, e duas listas em texto
 * (uma entrada por palavra, separadas por espaço ou quebra de linha).
 */
export function montarModulo({ senhas, nucleos, origem, licencaSeclists, licencaZxcvbn, aviso }) {
  const cabecalho = [
    'ARQUIVO GERADO por `node scripts/gerar-senhas-comuns.mjs` (etapa 5b do plano 01b, S74).',
    'Não edite à mão: rode o gerador com as fontes conferidas (README do `@bairrin/contratos`).',
    '',
    'Fontes (cada arquivo conferido pelo SHA-256 antes da leitura):',
    ...origem.flatMap(({ nome, url, sha256: hash }) => [`- ${nome}: ${url}`, `  SHA-256 ${hash}`]),
    '',
    'Filtro, na forma de `formaComparavelDaSenha` (NFKC, sem acento, espaço, caractere',
    'invisível nem maiúscula; `-`, `_` e `.` internos retirados):',
    `- SENHAS_DA_LISTA_PUBLICA: senhas do SecLists com ${TAMANHO_MINIMO_DA_SENHA} caracteres ou mais (${senhas.length}).`,
    `- NUCLEOS_DA_LISTA_PUBLICA: nomes (IBGE) e palavras (OpenSubtitles) com ${TAMANHO_MINIMO_DO_NUCLEO} letras ou`,
    `  mais, só letras (${nucleos.length}).`,
    '',
    'Nomes: Fonte: IBGE, API de nomes do Censo 2010',
    '(https://servicodados.ibge.gov.br/api/v1/censos/nomes/faixa), como o @zxcvbn-ts/language-pt-br',
    'os reuniu em firstnames.json.',
    '',
    'Licença do SecLists (Passwords/Common-Credentials):',
    '',
    licencaSeclists,
    '',
    'Licença do @zxcvbn-ts/language-pt-br:',
    '',
    licencaZxcvbn,
    '',
    'Aviso do @zxcvbn-ts/language-pt-br sobre commonWords.json (mantido como pede o aviso):',
    '',
    aviso,
  ].join('\n');
  return `${comentario(cabecalho)}

/** Senhas frequentes do SecLists, já na forma comparável. O tipo \`string\` evita o literal no .d.ts. */
export const SENHAS_DA_LISTA_PUBLICA: string = \`
${emLinhas(senhas)}
\`;

/** Nomes e palavras comuns em português do Brasil, já na forma comparável. */
export const NUCLEOS_DA_LISTA_PUBLICA: string = \`
${emLinhas(nucleos)}
\`;
`;
}

/** Lê o arquivo da fonte e confere o SHA-256 fixado. */
function lerFonte(pasta, fonte) {
  const caminho = join(pasta, fonte.arquivo);
  const conteudo = readFileSync(caminho);
  const hash = sha256(conteudo);
  if (hash !== fonte.sha256) {
    throw new Error(
      `${fonte.arquivo}: SHA-256 ${hash} difere do fixado (${fonte.sha256}). Confira a fonte antes de trocar.`,
    );
  }
  return { texto: conteudo.toString('utf8'), hash };
}

function lerDicionario(pasta, fonte) {
  const { texto, hash } = lerFonte(pasta, fonte);
  const lista = JSON.parse(texto);
  if (!Array.isArray(lista)) throw new Error(`${fonte.arquivo}: esperava uma lista JSON`);
  return { lista, hash };
}

function exigirMit(texto, nome) {
  if (!texto.includes('Permission is hereby granted, free of charge')) {
    throw new Error(`${nome}: o arquivo de licença não tem o texto da licença MIT`);
  }
  return texto;
}

function lerVersaoDoPacote(pasta) {
  const pacote = JSON.parse(readFileSync(join(pasta, 'package.json'), 'utf8'));
  if (pacote.name !== '@zxcvbn-ts/language-pt-br' || pacote.version !== VERSAO_ZXCVBN) {
    throw new Error(
      `esperava @zxcvbn-ts/language-pt-br ${VERSAO_ZXCVBN}, veio ${pacote.name} ${pacote.version}`,
    );
  }
  if (pacote.license !== 'MIT') throw new Error(`licença do pacote inesperada: ${pacote.license}`);
}

/** Lê as fontes das duas pastas e devolve o texto do módulo. */
export function gerar({ seclists, zxcvbn }) {
  lerVersaoDoPacote(zxcvbn);
  const senhas = lerFonte(seclists, FONTES.senhas);
  const licencaSeclists = exigirMit(lerFonte(seclists, FONTES.licencaSeclists).texto, 'SecLists');
  const licencaZxcvbn = exigirMit(lerFonte(zxcvbn, FONTES.licencaZxcvbn).texto, 'zxcvbn-ts');
  const aviso = lerFonte(zxcvbn, FONTES.avisoZxcvbn).texto;
  const nomes = lerDicionario(zxcvbn, FONTES.nomes);
  const palavras = lerDicionario(zxcvbn, FONTES.palavras);
  const origem = [
    { nome: `SecLists (commit ${COMMIT_SECLISTS})`, url: FONTES.senhas.url, sha256: senhas.hash },
    {
      nome: `@zxcvbn-ts/language-pt-br ${VERSAO_ZXCVBN}, nomes (Fonte: IBGE)`,
      url: FONTES.nomes.url,
      sha256: nomes.hash,
    },
    {
      nome: `@zxcvbn-ts/language-pt-br ${VERSAO_ZXCVBN}, palavras (OpenSubtitles, ODC-BY)`,
      url: FONTES.palavras.url,
      sha256: palavras.hash,
    },
  ];
  return montarModulo({
    senhas: filtrarSenhas(senhas.texto),
    nucleos: filtrarNucleos(nomes.lista, palavras.lista),
    origem,
    licencaSeclists,
    licencaZxcvbn,
    aviso,
  });
}

function lerArgumentos(argumentos) {
  const valores = {};
  for (let i = 0; i < argumentos.length; i += 2) {
    const nome = argumentos[i];
    const valor = argumentos[i + 1];
    if (!['--seclists', '--zxcvbn', '--saida'].includes(nome ?? '') || valor === undefined) {
      throw new Error(`argumento inválido: ${nome ?? ''}`);
    }
    valores[nome.slice(2)] = resolve(valor);
  }
  if (valores.seclists === undefined || valores.zxcvbn === undefined) {
    throw new Error('informe --seclists <pasta> e --zxcvbn <pasta>');
  }
  return valores;
}

function executar(argumentos) {
  try {
    const { seclists, zxcvbn, saida = SAIDA_PADRAO } = lerArgumentos(argumentos);
    writeFileSync(saida, gerar({ seclists, zxcvbn }));
    console.log(`Lista de senhas comuns gravada em ${saida}.`);
    return 0;
  } catch (erro) {
    console.error(`Não gerei a lista: ${erro instanceof Error ? erro.message : String(erro)}`);
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = executar(process.argv.slice(2));
}
