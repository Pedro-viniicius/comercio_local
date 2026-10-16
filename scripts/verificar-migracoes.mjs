// Verificador das migrações do Prisma (`pnpm migracoes:verificar`, no CI de todo PR).
// Lê `apps/api/prisma/migrations/*/migration.sql` (ou a pasta passada como argumento) e
// reprova (ADR-004; S2, S3 e S27 das revisões de segurança de 2026-10-16):
// - migração sem comentário `-- reversao: ...` no cabeçalho;
// - comando destrutivo (DROP, RENAME, ALTER COLUMN ... TYPE, TRUNCATE, DELETE FROM) fora de
//   pasta `*_destrutiva` ou sem o bloco de guarda no início (`DO $$ ... SELECT ... RAISE
//   EXCEPTION ... $$;`, que aborta se a tabela tiver linhas);
// - `CREATE TABLE` (e `SELECT ... INTO`, que também cria tabela) sem `ENABLE ROW LEVEL
//   SECURITY` para a mesma tabela na mesma migração;
// - tabela, view, sequência, tipo, domínio, função ou procedimento criado em `public`, com
//   schema explícito ou sem schema (cairia no `public` pelo search_path), ou movido para lá;
//   `CREATE EXTENSION` sem `SCHEMA` (ou com `SCHEMA public`);
// - RLS desligado (`DISABLE` ou `NO FORCE ROW LEVEL SECURITY`) e trigger desligada
//   (`DISABLE TRIGGER`, `ENABLE REPLICA TRIGGER`, `session_replication_role`), em qualquer
//   pasta: não há migração que precise disso sem revisão à parte;
// - `GRANT` para `PUBLIC`, `anon`, `authenticated` ou `service_role` (papéis do Supabase);
// - `GRANT` de `UPDATE`, `DELETE`, `TRUNCATE` ou `ALL` em tabela somente-acréscimo
//   (`compartilhado.auditoria`), inclusive por `ON ALL TABLES IN SCHEMA compartilhado`;
// - função ou procedimento `SECURITY DEFINER` sem `SET search_path` no mesmo comando.
//
// Comentários e textos entre aspas simples não contam como comando: a nota de reversão com
// `DROP SCHEMA` passa. `BEFORE TRUNCATE` de trigger e `GRANT TRUNCATE` também, porque
// TRUNCATE só conta no início de um comando. Texto entre aspas que começa como comando (SQL
// dinâmico de `EXECUTE`, inclusive aninhado em `format`) é analisado pelas mesmas regras, menos
// a mensagem de `RAISE` e a descrição de `COMMENT ... IS`, que não são executadas; tabela
// criada ali com nome montado em tempo de execução (`%I`, `||`) é recusada, porque não dá
// para conferir schema nem RLS. `ALTER COLUMN ... DROP NOT NULL` e
// `DROP DEFAULT` não são destrutivos: só relaxam restrições, sem perder dado. `SELECT ...
// INTO` dentro de corpo `$$ ... $$` (PL/pgSQL) é atribuição a variável, não cria tabela.
//
// É uma rede de proteção contra engano, não um parser de SQL: a revisão do SQL continua
// obrigatória (`prisma migrate dev --create-only`).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Pasta das migrações da API, relativa à raiz do repositório. */
export const PASTA_PADRAO = fileURLToPath(
  new URL('../apps/api/prisma/migrations/', import.meta.url),
);

/** Sufixo obrigatório da pasta de migração com comando destrutivo. */
export const SUFIXO_DESTRUTIVA = '_destrutiva';

const IDENTIFICADOR = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;
const NOME = String.raw`${IDENTIFICADOR}(?:\s*\.\s*${IDENTIFICADOR})?`;

/** Início de comando: começo do texto, `;` ou palavra que abre bloco em PL/pgSQL. */
const INICIO_DE_COMANDO = String.raw`(?:^|;|\b(?:BEGIN|THEN|ELSE|LOOP)\b)\s*`;

const DESTRUTIVOS = [
  {
    nome: 'DROP',
    // Todo DROP, menos os que só relaxam restrição de coluna.
    regex: /\bDROP\b(?!\s+(?:NOT\s+NULL|DEFAULT)\b)/gi,
  },
  { nome: 'RENAME', regex: /\bRENAME\b/gi },
  {
    nome: 'ALTER COLUMN ... TYPE',
    regex: new RegExp(
      String.raw`\bALTER\s+(?:COLUMN\s+)?${IDENTIFICADOR}\s+(?:SET\s+DATA\s+)?TYPE\b`,
      'gi',
    ),
  },
  { nome: 'TRUNCATE', regex: new RegExp(String.raw`${INICIO_DE_COMANDO}(TRUNCATE)\b`, 'gi') },
  // `DELETE FROM` só existe como comando (inclusive em CTE); `ON DELETE`, `OR DELETE` de
  // trigger e `GRANT DELETE` não têm FROM depois.
  { nome: 'DELETE', regex: /\bDELETE\s+FROM\b/gi },
];

const CRIACAO = new RegExp(
  String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:(GLOBAL|LOCAL)\s+)?(?:(TEMP|TEMPORARY)\s+|UNLOGGED\s+)?` +
    String.raw`(TABLE|VIEW|MATERIALIZED\s+VIEW|SEQUENCE|TYPE|DOMAIN|FUNCTION|PROCEDURE)\s+` +
    String.raw`(?:IF\s+NOT\s+EXISTS\s+)?(${NOME})`,
  'gi',
);

const RLS = new RegExp(
  String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${NOME})\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\b`,
  'gi',
);

const MOVIDO_PARA_PUBLIC = /\bSET\s+SCHEMA\s+(?:public|"public")(?![\w$"])/gi;

/** Começo de `CREATE ... TABLE|VIEW|...` sem o nome, para achar nome montado em SQL dinâmico. */
const CRIACAO_SEM_NOME = new RegExp(
  String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:(GLOBAL|LOCAL)\s+)?(?:(TEMP|TEMPORARY)\s+|UNLOGGED\s+)?` +
    String.raw`(TABLE|VIEW|MATERIALIZED\s+VIEW|SEQUENCE|TYPE|DOMAIN|FUNCTION|PROCEDURE)\s+` +
    String.raw`(?:IF\s+NOT\s+EXISTS\s+)?`,
  'gi',
);

/** Nome inteiro e estático: não seguido de `.`, `%` ou aspas (parte montada em tempo de execução). */
const NOME_ESTATICO = new RegExp(String.raw`^(${NOME})(?![\w$."%])`);

/**
 * `SELECT ... INTO tabela` de topo cria tabela (como `CREATE TABLE AS`). `INSERT INTO` e
 * `MERGE INTO` não criam; o `[^;]` fica no mesmo comando.
 */
const SELECT_INTO = new RegExp(
  String.raw`\bSELECT\b[^;]*?(?<!\b(?:INSERT|MERGE)\s+)\bINTO\s+` +
    String.raw`(?:(TEMP|TEMPORARY)\s+|UNLOGGED\s+)?(?:TABLE\s+)?`,
  'gi',
);

const RLS_DESLIGADO = /\b(DISABLE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/gi;

/**
 * Trigger desligada: `DISABLE TRIGGER` e `ENABLE REPLICA TRIGGER` (só dispara em réplica).
 * `session_replication_role = replica` desliga todas da sessão; vale também dentro de texto
 * (`set_config('session_replication_role', ...)`).
 */
const TRIGGER_DESLIGADA = /\b(DISABLE\s+TRIGGER|ENABLE\s+REPLICA\s+TRIGGER)\b/gi;
const REPLICACAO_DE_SESSAO = /\bsession_replication_role\b/gi;

/** `GRANT <privilégios ou papel> [ON <objetos>] TO <papéis>` até o fim do comando. */
const GRANT = /\bGRANT\b([^;]*?)\bTO\b([^;]*)/gi;

/** Papéis que nunca recebem privilégio: todo mundo e os papéis da Data API do Supabase. */
const PAPEIS_SEM_PRIVILEGIO = new Set(['public', 'anon', 'authenticated', 'service_role']);

/** Tabelas somente-acréscimo: nenhum papel recebe UPDATE, DELETE nem TRUNCATE nelas (S3). */
export const TABELAS_SOMENTE_ACRESCIMO = ['compartilhado.auditoria'];

const PRIVILEGIO_QUE_ALTERA = /\b(UPDATE|DELETE|TRUNCATE|ALL)\b/gi;

/** Início de comando que cria ou altera função ou procedimento. */
const FUNCAO =
  /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)|ALTER\s+(?:FUNCTION|PROCEDURE|ROUTINE))\b/gi;

const EXTENSAO = new RegExp(
  String.raw`\bCREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?(${IDENTIFICADOR})([^;]*)`,
  'gi',
);

/**
 * Texto entre aspas que começa como comando: candidato a SQL dinâmico. Exige a forma do
 * comando (`DELETE FROM`, `GRANT ... TO`), para que 'DELETE recusado' não conte.
 */
const PARECE_COMANDO = new RegExp(
  String.raw`^\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?` +
    String.raw`(?:TABLE|VIEW|MATERIALIZED|SEQUENCE|TYPE|DOMAIN|FUNCTION|PROCEDURE|EXTENSION|SCHEMA)\b|` +
    String.raw`ALTER\s+(?:TABLE|FUNCTION|PROCEDURE|ROUTINE|DEFAULT\s+PRIVILEGES|EXTENSION|VIEW|SEQUENCE|TYPE|SCHEMA)\b|` +
    String.raw`GRANT\b[^;]*\bTO\b|(?:SELECT|WITH)\b|INSERT\s+INTO\b|DELETE\s+FROM\b|DROP\s+\w|TRUNCATE\b|` +
    String.raw`SET\s+(?:(?:LOCAL|SESSION)\s+)?\w+\s*(?:=|TO\b)|DO\b|BEGIN\b|DECLARE\b)`,
  'i',
);

/**
 * O texto que começa logo depois disto não é executado: mensagem de `RAISE` (até o fim do
 * comando) ou descrição de `COMMENT ON ... IS`.
 */
const ANTES_DE_TEXTO_NAO_EXECUTADO = /(?:\bRAISE\b[^;']*|\bIS\s*E?)$/i;

/**
 * Texto entre aspas que tem cara de comando destrutivo (SQL dinâmico de `EXECUTE`): DROP de
 * um tipo de objeto, TRUNCATE ou DELETE FROM de uma tabela (nome ou `%I` do `format`) ou
 * ALTER TABLE. Mensagem como 'DROP e TRUNCATE recusados' não casa.
 */
const COMANDO_EM_TEXTO = new RegExp(
  String.raw`^\s*(?:DROP\s+(?:TABLE|SCHEMA|VIEW|MATERIALIZED\s+VIEW|INDEX|SEQUENCE|TYPE|DOMAIN|` +
    String.raw`FUNCTION|PROCEDURE|TRIGGER|POLICY|EXTENSION|OWNED)\b|` +
    String.raw`TRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?(?:%[ILs]|${NOME})\s*(?:$|;|,|\b(?:CASCADE|RESTRICT|RESTART|CONTINUE)\b)|` +
    String.raw`DELETE\s+FROM\s+(?:ONLY\s+)?(?:%[ILs]|${NOME})|` +
    String.raw`ALTER\s+TABLE\b)`,
  'i',
);

/**
 * Separa o SQL em visões do mesmo tamanho (para achar a linha de cada ocorrência):
 * - `codigo`: sem comentários, com o conteúdo de textos entre aspas simples trocado por
 *   espaços e os delimitadores `$tag$` apagados (o corpo de DO e de função é código);
 * - `comandos`: como `codigo`, mas também com o conteúdo de identificadores entre aspas
 *   duplas trocado por espaços (uma coluna "DROP" não é comando);
 * - `topo`: como `comandos`, mas só com o que está fora de corpo `$tag$ ... $tag$`;
 * - `semComentarios`: só sem comentários.
 * `profundidade[i]` diz quantos corpos `$tag$` envolvem o caractere `i` (0 no topo; os
 * delimitadores contam como do nível de fora). Também devolve os textos entre aspas simples
 * (`textos`) e onde cada um começa (`posicoesDosTextos`), para achar SQL dinâmico.
 */
export function separarSql(sql) {
  let codigo = '';
  let comandos = '';
  let topo = '';
  let semComentarios = '';
  const profundidade = [];
  const textos = [];
  const posicoesDosTextos = [];
  const corpos = [];
  const emBranco = (trecho) => trecho.replace(/[^\n]/g, ' ');
  const acrescentar = (trechoCodigo, trechoComandos, trechoSemComentarios) => {
    codigo += trechoCodigo;
    comandos += trechoComandos;
    topo += corpos.length === 0 ? trechoComandos : emBranco(trechoComandos);
    semComentarios += trechoSemComentarios;
    for (let k = 0; k < trechoCodigo.length; k += 1) profundidade.push(corpos.length);
  };
  let i = 0;
  while (i < sql.length) {
    const resto = sql.slice(i);
    if (resto.startsWith('--')) {
      const fim = sql.indexOf('\n', i);
      const trecho = sql.slice(i, fim === -1 ? sql.length : fim);
      acrescentar(emBranco(trecho), emBranco(trecho), emBranco(trecho));
      i += trecho.length;
      continue;
    }
    if (resto.startsWith('/*')) {
      // Comentários de bloco aninham no Postgres.
      let nivel = 0;
      let j = i;
      while (j < sql.length) {
        if (sql.startsWith('/*', j)) {
          nivel += 1;
          j += 2;
        } else if (sql.startsWith('*/', j)) {
          nivel -= 1;
          j += 2;
          if (nivel === 0) break;
        } else {
          j += 1;
        }
      }
      const trecho = sql.slice(i, j);
      acrescentar(emBranco(trecho), emBranco(trecho), emBranco(trecho));
      i = j;
      continue;
    }
    if (sql[i] === "'") {
      const escapaComBarra = /[Ee]$/.test(sql.slice(0, i)) && !/[\w$]$/.test(sql.slice(0, i - 1));
      let j = i + 1;
      while (j < sql.length) {
        if (escapaComBarra && sql[j] === '\\') j += 2;
        else if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j += 1;
      }
      const trecho = sql.slice(i, j + 1);
      textos.push(sql.slice(i + 1, j).replace(/''/g, "'"));
      posicoesDosTextos.push(i);
      const vazio = `'${emBranco(trecho.slice(1, -1))}'`.slice(0, trecho.length);
      acrescentar(vazio, vazio, trecho);
      i += trecho.length;
      continue;
    }
    if (sql[i] === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2;
        else if (sql[j] === '"') break;
        else j += 1;
      }
      const trecho = sql.slice(i, j + 1);
      acrescentar(trecho, `"${emBranco(trecho.slice(1, -1))}"`.slice(0, trecho.length), trecho);
      i += trecho.length;
      continue;
    }
    const cifrao = /^\$([A-Za-z_][\w]*)?\$/.exec(resto);
    if (cifrao && !/[\w$]$/.test(sql.slice(0, i))) {
      const delimitador = cifrao[0];
      // O delimitador que fecha é o mesmo que abriu o corpo mais interno; outro abre um novo.
      const fecha = corpos.at(-1) === delimitador;
      if (fecha) corpos.pop();
      acrescentar(emBranco(delimitador), emBranco(delimitador), delimitador);
      if (!fecha) corpos.push(delimitador);
      i += delimitador.length;
      continue;
    }
    acrescentar(sql[i], sql[i], sql[i]);
    i += 1;
  }
  return { codigo, comandos, topo, semComentarios, profundidade, textos, posicoesDosTextos };
}

/** Nome sem aspas e em minúsculas quando não citado, como o Postgres resolve. */
function normalizarIdentificador(identificador) {
  const limpo = identificador.trim();
  if (limpo.startsWith('"')) return limpo.slice(1, -1).replace(/""/g, '"');
  return limpo.toLowerCase();
}

/** `schema.nome` → `{ schema, nome }`; sem schema, `schema` fica `undefined`. */
function separarNome(nomeCompleto) {
  const partes = nomeCompleto.match(new RegExp(IDENTIFICADOR, 'g')) ?? [];
  if (partes.length === 2) {
    return { schema: normalizarIdentificador(partes[0]), nome: normalizarIdentificador(partes[1]) };
  }
  return { schema: undefined, nome: normalizarIdentificador(partes[0] ?? '') };
}

function linhaDe(texto, indice) {
  return texto.slice(0, indice).split('\n').length;
}

/** Comandos destrutivos achados no código e em SQL dinâmico. */
function acharDestrutivos(codigo) {
  const achados = [];
  for (const { nome, regex } of DESTRUTIVOS) {
    for (const ocorrencia of codigo.matchAll(regex)) {
      const deslocamento =
        ocorrencia[1] === undefined ? 0 : ocorrencia[0].lastIndexOf(ocorrencia[1]);
      achados.push({ nome, indice: ocorrencia.index + deslocamento });
    }
  }
  return achados.sort((a, b) => a.indice - b.indice);
}

/** O cabeçalho (comentários antes do primeiro comando) tem `-- reversao: <texto>`? */
function temNotaDeReversao(sql) {
  for (const linha of sql.split('\n')) {
    const limpa = linha.trim();
    if (limpa === '') continue;
    if (!limpa.startsWith('--')) return false;
    if (/^--\s*revers[aã]o\s*:\s*\S/i.test(limpa)) return true;
  }
  return false;
}

/** O primeiro comando é `DO $$ ... SELECT ... RAISE EXCEPTION ... $$;`? */
function comecaComGuarda(semComentarios) {
  const bloco = /^\s*DO\s+(\$(?:[A-Za-z_]\w*)?\$)([\s\S]*?)\1\s*;/i.exec(semComentarios);
  if (!bloco) return false;
  const corpo = bloco[2];
  return /\bRAISE\s+EXCEPTION\b/i.test(corpo) && /\bSELECT\b/i.test(corpo);
}

/**
 * Textos entre aspas com cara de comando, fora de `RAISE` e `COMMENT ... IS`, inclusive os de
 * dentro deles (`format` em `EXECUTE`), até 3 níveis.
 */
function textosDeSqlDinamico(visoes, nivel = 0) {
  if (nivel > 3) return [];
  return textosExecutaveis(visoes)
    .filter((texto) => PARECE_COMANDO.test(texto))
    .flatMap((texto) => [texto, ...textosDeSqlDinamico(separarSql(texto), nivel + 1)]);
}

/** Textos entre aspas de primeiro nível, menos os de `RAISE` e `COMMENT ... IS`. */
function textosExecutaveis({ comandos, textos, posicoesDosTextos }) {
  return textos.filter((_texto, indice) => {
    const posicao = posicoesDosTextos[indice];
    return !ANTES_DE_TEXTO_NAO_EXECUTADO.test(comandos.slice(Math.max(0, posicao - 200), posicao));
  });
}

/** Fim do comando que começa em `inicio`: o próximo `;` no mesmo nível de corpo `$tag$`. */
function fimDoComando({ comandos, profundidade }, inicio) {
  const nivel = profundidade[inicio];
  for (let i = inicio; i < comandos.length; i += 1) {
    if (comandos[i] === ';' && profundidade[i] === nivel) return i;
  }
  return comandos.length;
}

/** Texto do comando em `[inicio, fim)` só no nível de `inicio` (corpos internos em branco). */
function comandoNoNivel({ comandos, profundidade }, inicio, fim) {
  const nivel = profundidade[inicio];
  let texto = '';
  for (let i = inicio; i < fim; i += 1) texto += profundidade[i] === nivel ? comandos[i] : ' ';
  return texto;
}

/** Nomes separados por vírgula (`a.b, "C".d`), normalizados. */
function listaDeNomes(trecho) {
  return trecho
    .split(',')
    .map((parte) => new RegExp(`^\\s*(${NOME})`).exec(parte)?.[1])
    .filter((nome) => nome !== undefined)
    .map(separarNome);
}

/** `GRANT ... ON <objetos>` alcança uma tabela somente-acréscimo? */
function alcancaSomenteAcrescimo(objetos) {
  const emSchema = /^\s*ALL\s+TABLES\s+IN\s+SCHEMA\s+([\s\S]*)$/i.exec(objetos);
  if (emSchema) {
    const schemas = new Set(listaDeNomes(emSchema[1]).map(({ nome }) => nome));
    return TABELAS_SOMENTE_ACRESCIMO.filter((tabela) => schemas.has(tabela.split('.')[0]));
  }
  // Só tabela: `ON SCHEMA`, `ON FUNCTION`, `ON SEQUENCE`, `ON TABLES` (privilégio padrão) etc.
  // não alcançam linhas da auditoria.
  const tabelas =
    /^\s*(?:TABLE\s+)?((?!(?:ALL|SCHEMA|FUNCTION|PROCEDURE|ROUTINE|SEQUENCE|TABLES|SEQUENCES|FUNCTIONS|ROUTINES|TYPES|DATABASE|DOMAIN|TYPE|LANGUAGE|LARGE|TABLESPACE|FOREIGN|PARAMETER)\b)[\s\S]*)$/i.exec(
      objetos,
    );
  if (!tabelas) return [];
  const nomes = listaDeNomes(tabelas[1]);
  return TABELAS_SOMENTE_ACRESCIMO.filter((tabela) => {
    const [schema, nome] = tabela.split('.');
    // Sem schema, depende do search_path: na dúvida, conta como a tabela protegida.
    return nomes.some((alvo) => alvo.nome === nome && (alvo.schema ?? schema) === schema);
  });
}

/**
 * Regras aplicadas a um trecho de SQL: o arquivo inteiro ou um texto de SQL dinâmico
 * (`dinamico`, sem linha). Devolve as tabelas criadas, as que ganham RLS e os problemas que
 * não dependem do resto da migração.
 */
function analisarTrecho(visoes, dinamico) {
  const { codigo, comandos, topo } = visoes;
  const linha = (indice) => (dinamico ? undefined : linhaDe(codigo, indice));
  const sufixo = dinamico ? ' (em SQL dinâmico)' : '';
  const problemas = [];
  const criacoes = [];
  const comRls = [];

  for (const ocorrencia of codigo.matchAll(RLS)) comRls.push(separarNome(ocorrencia[1]));

  // Em SQL dinâmico o nome pode vir de `format` (`%I`) ou de concatenação (`'pedidos.' || x`).
  for (const ocorrencia of codigo.matchAll(dinamico ? CRIACAO_SEM_NOME : CRIACAO)) {
    const [, global, temporaria, tipoBruto, nomeCompleto] = ocorrencia;
    // Tabela temporária vive em pg_temp, não em public, e some no fim da sessão.
    if (temporaria !== undefined || global !== undefined) continue;
    const tipo = tipoBruto.replace(/\s+/g, ' ').toUpperCase();
    const nome = dinamico
      ? NOME_ESTATICO.exec(codigo.slice(ocorrencia.index + ocorrencia[0].length))?.[1]
      : nomeCompleto;
    if (nome === undefined) {
      problemas.push({
        linha: undefined,
        mensagem:
          `${tipo} criado em SQL dinâmico com nome montado em tempo de execução: não dá para ` +
          'conferir schema nem RLS; use SQL estático',
      });
      continue;
    }
    criacoes.push({ tipo, ...separarNome(nome), linha: linha(ocorrencia.index), sufixo });
  }
  if (!dinamico) {
    // Em texto de EXECUTE, `SELECT ... INTO` nem é aceito pelo PL/pgSQL; dentro de corpo
    // `$$` é atribuição a variável. Só o de topo cria tabela.
    for (const ocorrencia of topo.matchAll(SELECT_INTO)) {
      if (ocorrencia[1] !== undefined) continue;
      const inicioDoNome = ocorrencia.index + ocorrencia[0].length;
      const nome = new RegExp(`^${NOME}`).exec(codigo.slice(inicioDoNome))?.[0];
      if (nome === undefined) continue;
      criacoes.push({
        tipo: 'SELECT ... INTO',
        tabela: true,
        ...separarNome(nome),
        linha: linha(inicioDoNome),
        sufixo,
      });
    }
  }

  for (const ocorrencia of comandos.matchAll(RLS_DESLIGADO)) {
    const acao = ocorrencia[1].replace(/\s+/g, ' ').toUpperCase();
    problemas.push({
      linha: linha(ocorrencia.index),
      mensagem: `RLS desligado (${acao} ROW LEVEL SECURITY) (S2): não é aceito em migração${sufixo}`,
    });
  }
  for (const ocorrencia of comandos.matchAll(TRIGGER_DESLIGADA)) {
    const acao = ocorrencia[1].replace(/\s+/g, ' ').toUpperCase();
    problemas.push({
      linha: linha(ocorrencia.index),
      mensagem:
        `trigger desligada (${acao}) (S3): a imutabilidade da auditoria depende de trigger; ` +
        `não é aceito em migração${sufixo}`,
    });
  }
  for (const ocorrencia of visoes.semComentarios.matchAll(REPLICACAO_DE_SESSAO)) {
    problemas.push({
      linha: linha(ocorrencia.index),
      mensagem: `session_replication_role desliga as triggers da sessão (S3): não é aceito em migração${sufixo}`,
    });
  }

  for (const ocorrencia of codigo.matchAll(GRANT)) {
    const [, alvo, destino] = ocorrencia;
    const papeis = listaDeNomes(destino.replace(/^\s*GROUP\s+/i, '')).map(({ nome }) => nome);
    for (const papel of papeis.filter((nome) => PAPEIS_SEM_PRIVILEGIO.has(nome))) {
      problemas.push({
        linha: linha(ocorrencia.index),
        mensagem:
          `GRANT para ${papel} (S2): PUBLIC e os papéis do Supabase (anon, authenticated, ` +
          `service_role) não recebem privilégio${sufixo}`,
      });
    }
    const separado = /^([\s\S]*?)\bON\b([\s\S]*)$/i.exec(alvo);
    if (!separado) continue;
    const privilegios = [...separado[1].matchAll(PRIVILEGIO_QUE_ALTERA)].map(([p]) =>
      p.toUpperCase(),
    );
    if (privilegios.length === 0) continue;
    for (const tabela of alcancaSomenteAcrescimo(separado[2])) {
      problemas.push({
        linha: linha(ocorrencia.index),
        mensagem:
          `GRANT ${[...new Set(privilegios)].join(', ')} em ${tabela} (S3): a tabela é somente ` +
          `acréscimo; só SELECT e INSERT${sufixo}`,
      });
    }
  }

  for (const ocorrencia of comandos.matchAll(FUNCAO)) {
    const fim = fimDoComando(visoes, ocorrencia.index);
    const comando = comandoNoNivel(visoes, ocorrencia.index, fim);
    if (!/\bSECURITY\s+DEFINER\b/i.test(comando) || /\bSET\s+search_path\b/i.test(comando)) {
      continue;
    }
    problemas.push({
      linha: linha(ocorrencia.index),
      mensagem:
        'função SECURITY DEFINER sem "SET search_path" (S27): fixe-o no mesmo comando (ex.: SET search_path = \'\')' +
        sufixo,
    });
  }

  for (const ocorrencia of codigo.matchAll(EXTENSAO)) {
    const nome = normalizarIdentificador(ocorrencia[1]);
    const schema = new RegExp(String.raw`\bSCHEMA\s+(${IDENTIFICADOR})`, 'i').exec(ocorrencia[2]);
    if (schema !== null && normalizarIdentificador(schema[1]) !== 'public') continue;
    problemas.push({
      linha: linha(ocorrencia.index),
      mensagem:
        `CREATE EXTENSION "${nome}" ${schema === null ? 'sem SCHEMA' : 'em public'} (S2): ` +
        `informe um schema que não seja public (WITH SCHEMA <schema>)${sufixo}`,
    });
  }

  for (const ocorrencia of codigo.matchAll(MOVIDO_PARA_PUBLIC)) {
    problemas.push({
      linha: linha(ocorrencia.index),
      mensagem: `objeto movido para o schema public (S2)${sufixo}`,
    });
  }
  return { problemas, criacoes, comRls };
}

/**
 * Problemas de uma migração. `pasta` é o nome da pasta (ex.: `20261016120000_nucleo`) e
 * `sql`, o conteúdo de `migration.sql`. Cada problema é `{ linha?, mensagem }`.
 */
export function analisarMigracao(pasta, sql) {
  const problemas = [];
  const visoes = separarSql(sql);
  const dinamicos = textosDeSqlDinamico(visoes);

  if (!temNotaDeReversao(sql)) {
    problemas.push({
      mensagem:
        'falta a nota "-- reversao: <como desfazer>" no cabeçalho, antes do primeiro comando',
    });
  }

  const destrutivos = acharDestrutivos(visoes.comandos).map(({ nome, indice }) => ({
    nome,
    linha: linhaDe(visoes.comandos, indice),
  }));
  for (const texto of new Set([...textosExecutaveis(visoes), ...dinamicos])) {
    if (!COMANDO_EM_TEXTO.test(texto)) continue;
    for (const { nome } of acharDestrutivos(separarSql(texto).comandos)) {
      destrutivos.push({ nome: `${nome} em SQL dinâmico`, linha: undefined });
    }
  }
  if (destrutivos.length > 0) {
    const ehDestrutiva = pasta.endsWith(SUFIXO_DESTRUTIVA);
    if (!ehDestrutiva) {
      for (const { nome, linha } of destrutivos) {
        problemas.push({
          linha,
          mensagem: `comando destrutivo (${nome}) só é aceito em pasta terminada em "${SUFIXO_DESTRUTIVA}"`,
        });
      }
    }
    if (!comecaComGuarda(visoes.semComentarios)) {
      problemas.push({
        mensagem:
          'migração destrutiva deve começar com o bloco de guarda "DO $$ ... SELECT ... RAISE ' +
          'EXCEPTION ... $$;" que aborta se a tabela tiver linhas',
      });
    }
  }

  const trechos = [
    analisarTrecho(visoes, false),
    ...dinamicos.map((texto) => analisarTrecho(separarSql(texto), true)),
  ];
  const comRls = new Set(
    trechos.flatMap((trecho) =>
      trecho.comRls.map(({ schema, nome }) => `${schema ?? 'public'}.${nome}`),
    ),
  );
  for (const { tipo, tabela, schema, nome, linha, sufixo } of trechos.flatMap((t) => t.criacoes)) {
    if (schema === undefined || schema === 'public') {
      problemas.push({
        linha,
        mensagem:
          `${tipo} "${nome}" ficaria no schema public (S2): crie no schema do módulo, ` +
          `sempre com o schema explícito${sufixo}`,
      });
    }
    if ((tipo === 'TABLE' || tabela === true) && !comRls.has(`${schema ?? 'public'}.${nome}`)) {
      problemas.push({
        linha,
        mensagem: `tabela "${schema ?? 'public'}.${nome}" criada sem "ALTER TABLE ... ENABLE ROW LEVEL SECURITY" na mesma migração${sufixo}`,
      });
    }
  }
  for (const trecho of trechos) problemas.push(...trecho.problemas);
  // Os sem linha (cabeçalho, guarda, SQL dinâmico) primeiro; depois na ordem do arquivo.
  return problemas.sort((a, b) => (a.linha ?? 0) - (b.linha ?? 0));
}

/** Problemas de todas as migrações de `pasta`, com o nome da pasta de cada uma. */
export function verificarMigracoes(pasta = PASTA_PADRAO) {
  if (!existsSync(pasta)) {
    return {
      total: 0,
      problemas: [
        { pasta: relative(process.cwd(), pasta), mensagem: 'pasta de migrações não encontrada' },
      ],
    };
  }
  const pastas = readdirSync(pasta, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name)
    .sort();
  const problemas = [];
  for (const nome of pastas) {
    const arquivo = join(pasta, nome, 'migration.sql');
    if (!existsSync(arquivo)) {
      problemas.push({ pasta: nome, mensagem: 'pasta sem migration.sql' });
      continue;
    }
    for (const problema of analisarMigracao(nome, readFileSync(arquivo, 'utf8'))) {
      problemas.push({ pasta: nome, ...problema });
    }
  }
  return { total: pastas.length, problemas };
}

function executar(argumentos) {
  const pasta = argumentos[0] === undefined ? PASTA_PADRAO : resolve(argumentos[0]);
  const { total, problemas } = verificarMigracoes(pasta);
  if (problemas.length === 0) {
    console.log(`Migrações verificadas: ${total}. Nenhum problema.`);
    return 0;
  }
  console.error(`Migrações com problema (${problemas.length}):`);
  for (const { pasta: nome, linha, mensagem } of problemas) {
    const onde = linha === undefined ? `${nome}/migration.sql` : `${nome}/migration.sql:${linha}`;
    console.error(`- ${onde}: ${mensagem}`);
  }
  return 1;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = executar(process.argv.slice(2));
}
