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
// - `GRANT` para papel que não seja `bairrin_app` nem `bairrin_migracao` (P8 do 01b): `PUBLIC`,
//   `anon`, `authenticated` e `service_role` (papéis do Supabase), `postgres`, `supabase_*`,
//   `CURRENT_USER`, `SESSION_USER`, `CURRENT_ROLE`, papel qualquer e papel montado em tempo de
//   execução (`format('... TO %I', ...)`);
// - `GRANT` de `UPDATE`, `DELETE`, `TRUNCATE` ou `ALL` em tabela somente-acréscimo
//   (`compartilhado.auditoria`), inclusive por `ON ALL TABLES IN SCHEMA compartilhado`;
// - função ou procedimento `SECURITY DEFINER` sem `SET search_path` no mesmo comando;
// - pendências do 01a (Q6 e Seg-2, `docs/produto/decisoes.md`), em qualquer pasta:
//   - `EXECUTE` do PL/pgSQL com `||` no argumento, ou com argumento que não seja um texto
//     literal único (`'...'`, `E'...'`) nem `format(<literal único>, ...)`.
//     Não contam o `EXECUTE FUNCTION|PROCEDURE` de trigger nem o privilégio `EXECUTE`;
//   - `ALTER DEFAULT PRIVILEGES ... GRANT` (o `REVOKE` passa);
//   - `CREATE POLICY` sem `TO`, ou com `TO` para `PUBLIC`, `anon`, `authenticated` ou
//     `service_role`. `TO bairrin_app USING (true)` continua aceito (premissa P5 do 01b);
//   - `CREATE` ou `ALTER` de `ROLE`, `USER` ou `GROUP`; as palavras `SUPERUSER`, `BYPASSRLS`
//     e `CREATEROLE`; `GRANT <papel> TO` sem `ON` (pertencimento a papel);
//   - `SET ROLE`, `SET SESSION AUTHORIZATION` e as formas de parâmetro (`SET "role" TO`,
//     `SET session_authorization`) no início de um comando, `SET role` como opção de função
//     ou de `ALTER DATABASE`, `set_config('role', ...)` e `row_security` no código e em texto
//     executável (`set_config('row_security', ...)`);
//   - `COPY ... PROGRAM`;
//   - `OWNER TO` para papel que não seja `bairrin_migracao` nem `CURRENT_USER`.
// - rodada 1 do 01b, grupo 0 (S33, S34, R14 e R16), em qualquer pasta:
//   - corpo `$tag$` fora de `DO` ou `AS` no topo (usado como texto) ou dentro de outro corpo
//     `$tag$`, e texto ou comentário `/* */` que passa do fim do corpo: o Postgres lê esses
//     trechos como texto, e uma aspa ou um `--` ali esconderia o comando seguinte;
//   - `CREATE SCHEMA ... AUTHORIZATION` e `REASSIGN OWNED BY ... TO` com a regra do `OWNER TO`;
//   - `GRANT CREATE` ou `ALL` em `SCHEMA` ou `DATABASE` para papel que não seja
//     `bairrin_migracao`; `GRANT ... WITH GRANT OPTION`;
//   - `format` de `EXECUTE` com especificador que não seja `%I`, `%L` (também `%1$I`) ou `%%`;
//   - `ALTER POLICY ... TO` com a checagem de papéis do `CREATE POLICY`, que também recusa os
//     papéis administrativos (`postgres`, `authenticator`, `pgbouncer`, `dashboard_user`,
//     `supabase_*`, `pg_*`);
//   - `CREATE [OR REPLACE] RULE`;
//   - SQL dinâmico com mais de 4 níveis (texto dentro de texto) que ainda tenha comando.
//
// Comentários e textos entre aspas simples não contam como comando: a nota de reversão com
// `DROP SCHEMA` passa. `BEFORE TRUNCATE` de trigger e `GRANT TRUNCATE` também, porque
// TRUNCATE só conta no início de um comando. O argumento literal de `EXECUTE` (direto ou modelo
// de `format`) e todo texto entre aspas que começa como comando (inclusive aninhado) são
// analisados como SQL dinâmico pelas mesmas regras, menos a mensagem de `RAISE` e a descrição
// de `COMMENT ... IS`, que não são executadas; tabela criada ali com nome montado em tempo de
// execução (`%I`, `||`) é recusada, porque não dá para conferir schema nem RLS. `ALTER COLUMN
// ... DROP NOT NULL` e `DROP DEFAULT` não são destrutivos: só relaxam restrições, sem perder
// dado. `SELECT ... INTO` dentro de corpo `$$ ... $$` (PL/pgSQL) é atribuição a variável, não
// cria tabela. `UPDATE ... SET role = ...` é coluna, não troca de papel. `EXECUTE` no topo,
// fora de corpo de DO ou de função, é comando preparado ou coluna, não o do PL/pgSQL.
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

/**
 * Únicos papéis que recebem privilégio numa migração (P8 do 01b): a aplicação e o papel de
 * migração. Comparados depois de normalizar (`"bairrin_app"` passa; `"BAIRRIN_APP"` é outro).
 */
const PAPEIS_COM_PRIVILEGIO = new Set(['bairrin_app', 'bairrin_migracao']);

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
 * `EXECUTE` do PL/pgSQL (também `FOR ... IN EXECUTE` e `RETURN QUERY EXECUTE`). Não conta o de
 * trigger (`EXECUTE FUNCTION|PROCEDURE`) nem o privilégio (`GRANT EXECUTE ON`, `SELECT,
 * EXECUTE ON`, `EXECUTE, USAGE ON`).
 */
const EXECUTE_DINAMICO = /\bEXECUTE\b(?!\s+(?:FUNCTION|PROCEDURE)\b|\s*(?:,|ON\b))/gi;

/** Fim do argumento de `EXECUTE`: `INTO`, `USING` ou o `LOOP` de `FOR ... IN EXECUTE`. */
const FIM_DO_ARGUMENTO_DE_EXECUTE = /\b(?:INTO|USING|LOOP)\b/i;

/** O texto que começa logo depois disto é o argumento de `EXECUTE` (direto ou em `format`). */
const ANTES_DE_ARGUMENTO_DE_EXECUTE = /\bEXECUTE\s+(?:format\s*\(\s*)?E?$/i;

/** `ALTER DEFAULT PRIVILEGES [FOR ROLE ...] [IN SCHEMA ...] GRANT`; o `REVOKE` passa. */
const PRIVILEGIO_PADRAO_CONCEDIDO =
  /\bALTER\s+DEFAULT\s+PRIVILEGES\b(?:(?!\b(?:GRANT|REVOKE)\b)[^;])*\bGRANT\b/gi;

/** `CREATE POLICY` e `ALTER POLICY` (este pode trocar os papéis com `TO`). */
const POLITICA = /\b(CREATE|ALTER)\s+POLICY\b[^;]*/gi;

/**
 * Papéis que nunca recebem política: os sem privilégio e os administrativos do Postgres e do
 * Supabase (`postgres`, `authenticator`, `pgbouncer`, `dashboard_user`, `supabase_*`, `pg_*`).
 */
const PAPEIS_ADMINISTRATIVOS = new Set([
  'postgres',
  'authenticator',
  'pgbouncer',
  'dashboard_user',
]);
function papelSemPolitica(papel) {
  return (
    PAPEIS_SEM_PRIVILEGIO.has(papel) ||
    PAPEIS_ADMINISTRATIVOS.has(papel) ||
    /^(?:supabase_|pg_)/.test(papel)
  );
}

/** `CREATE SCHEMA ... AUTHORIZATION <papel>`: o papel vira dono do schema. */
const SCHEMA_COM_DONO = /\bCREATE\s+SCHEMA\b[^;]*?\bAUTHORIZATION\s+/gi;

/** `REASSIGN OWNED BY ... TO <papel>`: o papel vira dono de tudo o que era dos outros. */
const DONO_REATRIBUIDO = /\bREASSIGN\s+OWNED\s+BY\b[^;]*?\bTO\s+/gi;

/** Privilégio que deixa criar objeto (`CREATE` ou `ALL`) em schema ou banco. */
const PRIVILEGIO_DE_CRIAR = /\b(?:CREATE|ALL)\b/i;
const EM_SCHEMA_OU_BANCO = /^\s*(SCHEMA|DATABASE)\b/i;

/** `WITH GRANT OPTION`: quem recebe pode repassar o privilégio sem migração. */
const REPASSE_DE_PRIVILEGIO = /\bWITH\s+GRANT\s+OPTION\b/gi;

/** `CREATE [OR REPLACE] RULE`: reescreve comandos na tabela, por fora das triggers. */
const REGRA_DE_REESCRITA = /\bCREATE\s+(?:OR\s+REPLACE\s+)?RULE\b/gi;

/**
 * Última recursão da busca de SQL dinâmico (a primeira é 0, no arquivo): são conferidos até
 * `NIVEIS_DE_SQL_DINAMICO + 1` níveis de texto dentro de texto. Mais fundo, reprova (S34).
 */
const NIVEIS_DE_SQL_DINAMICO = 3;

/** `CREATE|ALTER ROLE|USER|GROUP` (inclui `USER MAPPING`): papéis ficam fora das migrações. */
const PAPEL_CRIADO_OU_ALTERADO = /\b(CREATE|ALTER)\s+(ROLE|USER|GROUP)\b/gi;
const ATRIBUTO_DE_PAPEL = /\b(SUPERUSER|BYPASSRLS|CREATEROLE)\b/gi;

/**
 * `SET [SESSION|LOCAL] ROLE`, `SET [SESSION|LOCAL] SESSION AUTHORIZATION` e as formas de
 * parâmetro (`SET "role" TO ...`, `SET session_authorization = ...`), só no início de um
 * comando (visão `codigo`, com o nome entre aspas): `UPDATE ... SET role = ...` é coluna.
 * O corpo de função em SQL (`AS $$ SET ROLE ...`) e `BEGIN ATOMIC` também abrem comando.
 */
const TROCA_DE_PAPEL = new RegExp(
  String.raw`(?:^|;|\b(?:BEGIN|ATOMIC|THEN|ELSE|LOOP|AS)\b)\s*SET\s+(?:(?:SESSION|LOCAL)\s+)?` +
    String.raw`(ROLE|"role"|SESSION\s+AUTHORIZATION|"?session_authorization"?)(?![\w$])`,
  'gi',
);
/** Comando que fixa parâmetro com `SET`: opção de função ou procedimento, ou do banco. */
const COMANDO_COM_PARAMETRO =
  /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)|ALTER\s+(?:FUNCTION|PROCEDURE|ROUTINE|DATABASE))\b/gi;
/** A troca de papel como parâmetro desses comandos (`SET role = postgres`). */
const PAPEL_COMO_PARAMETRO =
  /\bSET\s+"?(role|session_authorization)"?\s*(?:=|TO\b|FROM\s+CURRENT\b)/i;
/** A mesma troca pela função (`set_config('role', ...)`); o nome vem entre aspas. */
const TROCA_DE_PAPEL_POR_FUNCAO = /\bset_config\s*\(\s*'(?:role|session_authorization)'/gi;

/**
 * `row_security = off` faz a consulta falhar em vez de filtrar. Vale no código e em texto que
 * pode ser executado (`set_config('row_security', ...)`), mas não na mensagem de `RAISE` nem na
 * descrição de `COMMENT ... IS` (Q11).
 */
const SEGURANCA_DE_LINHA_DA_SESSAO = /\brow_security\b/gi;

const COPIA_POR_PROGRAMA = /\bCOPY\b[^;]*?\bPROGRAM\b/gi;

const DONO = /\bOWNER\s+TO\s+/gi;

/** Dono aceito pelo nome; `CURRENT_USER` sem aspas também passa (as migrações rodam como ele). */
const DONO_ACEITO = 'bairrin_migracao';

/**
 * Texto entre aspas que começa como comando: candidato a SQL dinâmico. Exige a forma do
 * comando (`DELETE FROM`, `GRANT ... TO`), para que 'DELETE recusado' não conte.
 */
const PARECE_COMANDO = new RegExp(
  String.raw`^\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?` +
    String.raw`(?:TABLE|VIEW|MATERIALIZED|SEQUENCE|TYPE|DOMAIN|FUNCTION|PROCEDURE|EXTENSION|SCHEMA|POLICY|ROLE|USER|GROUP|RULE)\b|` +
    String.raw`ALTER\s+(?:TABLE|FUNCTION|PROCEDURE|ROUTINE|DEFAULT\s+PRIVILEGES|EXTENSION|VIEW|SEQUENCE|TYPE|SCHEMA|ROLE|USER|GROUP|POLICY|DATABASE)\b|` +
    String.raw`ALTER\s+\w[^;]*\bOWNER\s+TO\b|COPY\b|REASSIGN\s+OWNED\b|` +
    String.raw`GRANT\b[^;]*\bTO\b|(?:SELECT|WITH)\b|INSERT\s+INTO\b|DELETE\s+FROM\b|DROP\s+\w|TRUNCATE\b|` +
    String.raw`SET\s+(?:(?:LOCAL|SESSION)\s+)?(?:(?:"[^"]*"|\w+)\s*(?:=|TO\b)|ROLE\b|SESSION\s+AUTHORIZATION\b)|DO\b|BEGIN\b|DECLARE\b)`,
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
 * Delimitador `$tag$`; a tag aceita letras fora do ASCII, como no Postgres (`$ção$`).
 * `$1` (parâmetro) não é delimitador.
 */
const DELIMITADOR = /^\$(?:[A-Za-z_\u0080-\uFFFF][\w\u0080-\uFFFF]*)?\$/;

/** Logo antes de um `$tag$` que abre corpo de código: `DO [LANGUAGE <nome>]` ou `AS`. */
const ANTES_DE_CORPO_DE_CODIGO = /\b(?:DO(?:\s+LANGUAGE\s+(?:"[^"]*"|[A-Za-z_][\w$]*))?|AS)\s*$/i;

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
 *
 * Como no Postgres, o corpo `$tag$` termina na primeira ocorrência do delimitador, mesmo
 * dentro de comentário ou de texto (S33): nenhum trecho passa do fim do corpo. O corpo só
 * é lido como código quando o Postgres também o lê assim (depois de `DO` ou de `AS`, no
 * topo). Os outros usos, em que o Postgres lê o corpo como texto e o verificador o leria
 * como código, vão para `delimitadoresRecusados` (`{ indice, motivo }`, com `motivo`
 * `texto`, `aninhado` ou `atravessa`), e a análise os reprova.
 */
export function separarSql(sql) {
  let codigo = '';
  let comandos = '';
  let topo = '';
  let semComentarios = '';
  const profundidade = [];
  const textos = [];
  const posicoesDosTextos = [];
  const delimitadoresRecusados = [];
  /**
   * Corpos abertos: `fim` é onde começa o delimitador que fecha; `comprimento`, o tamanho dele;
   * `recusado`, se o corpo já foi para `delimitadoresRecusados`.
   */
  const corpos = [];
  const emBranco = (trecho) => trecho.replace(/[^\n]/g, ' ');
  const acrescentar = (trechoCodigo, trechoComandos, trechoSemComentarios) => {
    codigo += trechoCodigo;
    comandos += trechoComandos;
    topo += corpos.length === 0 ? trechoComandos : emBranco(trechoComandos);
    semComentarios += trechoSemComentarios;
    for (let k = 0; k < trechoCodigo.length; k += 1) profundidade.push(corpos.length);
  };
  /** Comentário, texto ou identificador que não fecha antes do fim do corpo é cortado ali. */
  const cortar = (inicio, fim, limite, recusar) => {
    if (fim <= limite) return fim;
    // Dentro de um `$tag$` já recusado, um aviso basta.
    if (recusar && corpos.length > 0 && !corpos.some(({ recusado }) => recusado)) {
      delimitadoresRecusados.push({ indice: inicio, motivo: 'atravessa' });
    }
    return limite;
  };
  /** Colado a um identificador (`a$b$`, `ação$x$`), o `$` faz parte do nome, como no Postgres. */
  const coladoANome = (inicio) => {
    const anterior = /[\w$\u0080-\uFFFF]*$/.exec(sql.slice(Math.max(0, inicio - 200), inicio))[0];
    return /^[A-Za-z_\u0080-\uFFFF]/.test(anterior);
  };
  let i = 0;
  while (i < sql.length) {
    const corpo = corpos.at(-1);
    if (corpo !== undefined && i === corpo.fim) {
      corpos.pop();
      const delimitador = sql.slice(i, i + corpo.comprimento);
      acrescentar(emBranco(delimitador), emBranco(delimitador), delimitador);
      i += corpo.comprimento;
      continue;
    }
    const limite = corpo === undefined ? sql.length : corpo.fim;
    const comeca = (marca) => sql.startsWith(marca, i) && i + marca.length <= limite;
    if (comeca('--')) {
      // No fim do corpo o comentário de linha acaba, como no PL/pgSQL; não é recusado.
      const quebra = sql.indexOf('\n', i);
      const fim = cortar(i, quebra === -1 ? sql.length : quebra, limite, false);
      const trecho = sql.slice(i, fim);
      acrescentar(emBranco(trecho), emBranco(trecho), emBranco(trecho));
      i = fim;
      continue;
    }
    if (comeca('/*')) {
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
      const fim = cortar(i, nivel === 0 ? j : sql.length + 1, limite, true);
      const trecho = sql.slice(i, fim);
      acrescentar(emBranco(trecho), emBranco(trecho), emBranco(trecho));
      i = fim;
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
      // `j` é a aspa que fecha; sem ela, o texto vai até o fim.
      const fim = cortar(i, j + 1, limite, true);
      const trecho = sql.slice(i, fim);
      const fechado = fim === j + 1;
      textos.push(sql.slice(i + 1, fechado ? j : fim).replace(/''/g, "'"));
      posicoesDosTextos.push(i);
      const vazio = `'${emBranco(trecho.slice(1, fechado ? -1 : undefined))}${fechado ? "'" : ''}`;
      acrescentar(vazio.slice(0, trecho.length), vazio.slice(0, trecho.length), trecho);
      i = fim;
      continue;
    }
    if (sql[i] === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2;
        else if (sql[j] === '"') break;
        else j += 1;
      }
      const fim = cortar(i, j + 1, limite, true);
      const trecho = sql.slice(i, fim);
      const fechado = fim === j + 1;
      const vazio = `"${emBranco(trecho.slice(1, fechado ? -1 : undefined))}${fechado ? '"' : ''}`;
      acrescentar(trecho, vazio.slice(0, trecho.length), trecho);
      i = fim;
      continue;
    }
    const cifrao = sql[i] === '$' ? DELIMITADOR.exec(sql.slice(i, limite)) : null;
    if (cifrao && !coladoANome(i)) {
      const delimitador = cifrao[0];
      let motivo;
      if (corpo !== undefined) motivo = 'aninhado';
      else if (!ANTES_DE_CORPO_DE_CODIGO.test(comandos.slice(-200))) motivo = 'texto';
      if (motivo !== undefined) delimitadoresRecusados.push({ indice: i, motivo });
      acrescentar(emBranco(delimitador), emBranco(delimitador), delimitador);
      i += delimitador.length;
      // O corpo termina na primeira ocorrência do mesmo delimitador, dentro do corpo de fora.
      const fecha = sql.indexOf(delimitador, i);
      const cabe = fecha !== -1 && fecha + delimitador.length <= limite;
      corpos.push({
        fim: cabe ? fecha : limite,
        comprimento: cabe ? delimitador.length : 0,
        recusado: motivo !== undefined,
      });
      continue;
    }
    acrescentar(sql[i], sql[i], sql[i]);
    i += 1;
  }
  return {
    codigo,
    comandos,
    topo,
    semComentarios,
    profundidade,
    textos,
    posicoesDosTextos,
    delimitadoresRecusados,
  };
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
 * Textos entre aspas com cara de comando, fora de `RAISE` e `COMMENT ... IS`, e todo argumento
 * literal de `EXECUTE` (direto ou modelo de `format`), inclusive os de dentro deles, até
 * `NIVEIS_DE_SQL_DINAMICO` níveis abaixo do primeiro. Se ainda houver texto assim mais fundo,
 * acrescenta o nível em `excedidos` (a migração reprova; S34).
 */
function textosDeSqlDinamico(visoes, nivel = 0, excedidos = []) {
  const { comandos, textos, posicoesDosTextos } = visoes;
  const candidatos = textos.filter((texto, indice) => {
    const posicao = posicoesDosTextos[indice];
    const antes = comandos.slice(Math.max(0, posicao - 200), posicao);
    if (ANTES_DE_ARGUMENTO_DE_EXECUTE.test(antes)) return true;
    return !ANTES_DE_TEXTO_NAO_EXECUTADO.test(antes) && PARECE_COMANDO.test(texto);
  });
  if (nivel > NIVEIS_DE_SQL_DINAMICO) {
    if (candidatos.length > 0) excedidos.push(nivel);
    return [];
  }
  return candidatos.flatMap((texto) => [
    texto,
    ...textosDeSqlDinamico(separarSql(texto), nivel + 1, excedidos),
  ]);
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

/**
 * Texto do comando em `[inicio, fim)` só no nível de `inicio` (corpos internos em branco), na
 * visão `comandos` ou na indicada em `visao`.
 */
function comandoNoNivel(visoes, inicio, fim, visao = 'comandos') {
  const { profundidade } = visoes;
  const fonte = visoes[visao];
  const nivel = profundidade[inicio];
  let texto = '';
  for (let i = inicio; i < fim; i += 1) texto += profundidade[i] === nivel ? fonte[i] : ' ';
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

/**
 * Papéis de `GRANT ... TO <papéis>` (visão `codigo`), normalizados, cada um com `GROUP`
 * opcional, até o que vem depois da lista (`WITH GRANT OPTION`, `GRANTED BY`). Papel que não é
 * um nome (`%I` de `format`, texto montado) vira `undefined`: não dá para conferir quem recebe.
 */
function papeisDoGrant(destino) {
  const papeis = [];
  const papel = new RegExp(String.raw`^\s*(?:GROUP\s+)?(${IDENTIFICADOR})`, 'i');
  let resto = destino;
  for (;;) {
    const achado = papel.exec(resto);
    if (achado === null) {
      papeis.push(undefined);
      break;
    }
    papeis.push(normalizarIdentificador(achado[1]));
    resto = resto.slice(achado[0].length);
    const virgula = /^\s*,/.exec(resto);
    if (virgula === null) break;
    resto = resto.slice(virgula[0].length);
  }
  return papeis;
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
 * O trecho é um único texto literal (`'...'`, `E'...'` ou corpo `$tag$ ... $tag$`)? `nivel` é o
 * trecho na visão `comandos` com os corpos internos em branco; `bruto`, o mesmo trecho com o
 * conteúdo, para reconhecer o corpo `$tag$` (que no nível aparece só como espaço).
 */
function ehLiteralUnico(nivel, bruto) {
  if (/\S/.test(nivel)) return /^\s*E?'[^']*'\s*$/i.test(nivel);
  return /^\s*(\$(?:[A-Za-z_]\w*)?\$)[\s\S]*\1\s*$/.test(bruto);
}

/** Conteúdo de `E'...'` como o Postgres o lê (`\x25` é `%`, `''` é `'`), numa passada só. */
function decodificarEscapes(texto) {
  const simples = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
  return texto.replace(
    /''|\\(x[0-9A-Fa-f]{1,2}|[0-7]{1,3}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|[\s\S])/g,
    (escape, corpo) => {
      if (escape === "''") return "'";
      let codigo;
      if (/^[xuU]./.test(corpo)) codigo = Number.parseInt(corpo.slice(1), 16);
      else if (/^[0-7]/.test(corpo)) codigo = Number.parseInt(corpo, 8);
      else return simples[corpo] ?? corpo;
      // Ponto de código inválido o Postgres recusa; aqui vira um caractere qualquer.
      return codigo <= 0x10ffff ? String.fromCodePoint(codigo) : '\uFFFD';
    },
  );
}

/** Conteúdo de um literal único (`'...'`, `E'...'` ou `$tag$...$tag$`), como o Postgres o lê. */
function conteudoDoLiteral(bruto) {
  const comAspas = /^\s*(E?)'([\s\S]*)'\s*$/i.exec(bruto);
  if (comAspas === null) {
    return /^\s*(\$[^$]*\$)([\s\S]*)\1\s*$/.exec(bruto)?.[2] ?? '';
  }
  if (comAspas[1] === '') return comAspas[2].replace(/''/g, "'");
  return decodificarEscapes(comAspas[2]);
}

/**
 * Especificadores de `format` aceitos no modelo de `EXECUTE`: `%I`, `%L` (também com posição,
 * `%1$I`) e `%%`. `%s` insere o valor sem aspas: o comando executado não dá para conferir (S34).
 */
function modeloDeFormatAceito(modelo) {
  return [...modelo.matchAll(/%(%|(?:\d+\$)?[IL])?/g)].every((especificador) => especificador[1]);
}

/**
 * Problema do argumento de um `EXECUTE` em `[inicio, fim)`: concatenação (`||`), argumento
 * que não é literal único nem `format(<literal único>, ...)` ou modelo de `format` com
 * especificador que não é `%I`, `%L` nem `%%`. Sem problema, `undefined`.
 */
function problemaDoArgumentoDeExecute(visoes, inicio, fim) {
  const nivel = comandoNoNivel(visoes, inicio, fim);
  const bruto = visoes.semComentarios.slice(inicio, fim);
  if (nivel.includes('||')) return 'concatenado';
  const chamada = /^(\s*format\s*\()[\s\S]*\)\s*$/i.exec(nivel);
  if (chamada) {
    const abre = chamada[1].length;
    const virgula = nivel.indexOf(',', abre);
    const fimDoModelo = virgula === -1 ? nivel.lastIndexOf(')') : virgula;
    const modelo = bruto.slice(abre, fimDoModelo);
    if (!ehLiteralUnico(nivel.slice(abre, fimDoModelo), modelo)) return 'nao-literal';
    return modeloDeFormatAceito(conteudoDoLiteral(modelo)) ? undefined : 'formato';
  }
  return ehLiteralUnico(nivel, bruto) ? undefined : 'nao-literal';
}

/** Papel normalizado de `OWNER TO`, ou `undefined` se for um dos aceitos. */
function donoRecusado(codigo, inicioDoPapel) {
  const papel = new RegExp(`^${IDENTIFICADOR}`).exec(codigo.slice(inicioDoPapel))?.[0];
  if (papel === undefined) return '(sem papel)';
  const normalizado = normalizarIdentificador(papel);
  if (normalizado === DONO_ACEITO) return undefined;
  // `CURRENT_USER` só sem aspas: entre aspas é um papel com esse nome.
  if (!papel.startsWith('"') && normalizado === 'current_user') return undefined;
  return normalizado;
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

  const mensagensDoDelimitador = {
    texto:
      '$tag$ usado como texto (S33): o Postgres lê o corpo como texto e o verificador, como ' +
      "código; $tag$ só abre corpo de DO ou de função (depois de DO ou AS); use '...' ou " +
      "format('...')",
    aninhado:
      '$tag$ dentro de outro corpo $tag$ (S33): o Postgres lê o de dentro como texto; em SQL ' +
      "dinâmico use '...' ou format('...')",
    atravessa:
      'texto, identificador entre aspas ou comentário /* */ passa do fim do corpo $tag$ (S33): ' +
      'o corpo termina no primeiro delimitador igual ao que o abriu',
  };
  for (const { indice, motivo } of visoes.delimitadoresRecusados) {
    problemas.push({ linha: linha(indice), mensagem: mensagensDoDelimitador[motivo] + sufixo });
  }

  for (const ocorrencia of comandos.matchAll(REPASSE_DE_PRIVILEGIO)) {
    problemas.push({
      linha: linha(ocorrencia.index),
      mensagem:
        'GRANT ... WITH GRANT OPTION (S34): quem recebe repassaria o privilégio sem migração ' +
        `nem revisão${sufixo}`,
    });
  }

  for (const ocorrencia of codigo.matchAll(GRANT)) {
    const [, alvo, destino] = ocorrencia;
    const destinos = papeisDoGrant(destino);
    const papeis = destinos.filter((nome) => nome !== undefined);
    for (const papel of destinos.filter((nome) => !PAPEIS_COM_PRIVILEGIO.has(nome))) {
      let mensagem;
      if (papel === undefined) {
        mensagem =
          'GRANT para papel montado em tempo de execução (P8): não dá para conferir quem ' +
          'recebe; escreva o nome (bairrin_app ou bairrin_migracao) no texto';
      } else if (PAPEIS_SEM_PRIVILEGIO.has(papel)) {
        mensagem =
          `GRANT para ${papel} (S2): PUBLIC e os papéis do Supabase (anon, authenticated, ` +
          'service_role) não recebem privilégio';
      } else {
        mensagem =
          `GRANT para ${papel} (P8): só bairrin_app e bairrin_migracao recebem privilégio ` +
          'em migração';
      }
      problemas.push({ linha: linha(ocorrencia.index), mensagem: mensagem + sufixo });
    }
    const separado = /^([\s\S]*?)\bON\b([\s\S]*)$/i.exec(alvo);
    if (!separado) {
      problemas.push({
        linha: linha(ocorrencia.index),
        mensagem:
          'GRANT de papel sem ON (Q6): dar um papel a outro (pertencimento) é feito fora das ' +
          `migrações; aqui só GRANT de privilégio em objeto${sufixo}`,
      });
      continue;
    }
    const emSchemaOuBanco = EM_SCHEMA_OU_BANCO.exec(separado[2]);
    if (emSchemaOuBanco && PRIVILEGIO_DE_CRIAR.test(separado[1])) {
      const objeto = emSchemaOuBanco[1].toUpperCase();
      const criadores = papeis.filter((nome) => nome !== DONO_ACEITO && nome !== 'current_user');
      for (const papel of criadores) {
        problemas.push({
          linha: linha(ocorrencia.index),
          mensagem:
            `GRANT CREATE (ou ALL) em ${objeto} para ${papel} (S34): só ${DONO_ACEITO} cria ` +
            `objetos; quem cria é dono e o dono ignora o RLS${sufixo}`,
        });
      }
    }
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

  for (const ocorrencia of comandos.matchAll(EXECUTE_DINAMICO)) {
    // No topo do arquivo, fora de corpo de DO ou de função, não há PL/pgSQL: `EXECUTE` ali é
    // o de comando preparado ou uma coluna chamada execute. Em SQL dinâmico continua valendo,
    // porque o texto pode ser corpo de função (`AS 'BEGIN EXECUTE c; END'`).
    if (!dinamico && visoes.profundidade[ocorrencia.index] === 0) continue;
    const inicio = ocorrencia.index + ocorrencia[0].length;
    const fimDoComandoAtual = fimDoComando(visoes, ocorrencia.index);
    const resto = comandoNoNivel(visoes, inicio, fimDoComandoAtual);
    const corte = resto.search(FIM_DO_ARGUMENTO_DE_EXECUTE);
    const fim = corte === -1 ? fimDoComandoAtual : inicio + corte;
    const problema = problemaDoArgumentoDeExecute(visoes, inicio, fim);
    if (problema === undefined) continue;
    const mensagensDoExecute = {
      concatenado:
        'EXECUTE com SQL concatenado (||) (Q6): não dá para conferir o comando executado; ' +
        "use EXECUTE '<literal>' ou format('<literal>', ...) com %I e %L",
      'nao-literal':
        "EXECUTE com argumento que não é literal único nem format('<literal>', ...) (Q6): " +
        'não dá para conferir o comando executado',
      formato:
        'EXECUTE de format com especificador que não é %I, %L nem %% (S34): %s insere o valor ' +
        'sem aspas e não dá para conferir o comando executado',
    };
    problemas.push({
      linha: linha(ocorrencia.index),
      mensagem: mensagensDoExecute[problema] + sufixo,
    });
  }

  for (const ocorrencia of comandos.matchAll(PRIVILEGIO_PADRAO_CONCEDIDO)) {
    problemas.push({
      linha: linha(ocorrencia.index),
      mensagem:
        'ALTER DEFAULT PRIVILEGES ... GRANT (Q6): privilégio padrão vale para objetos futuros ' +
        `sem revisão; use GRANT explícito em cada objeto (o REVOKE é aceito)${sufixo}`,
    });
  }

  for (const ocorrencia of comandos.matchAll(POLITICA)) {
    const acao = `${ocorrencia[1].toUpperCase()} POLICY`;
    const cabecalho = ocorrencia[0].split(/\b(?:USING|WITH\s+CHECK)\b/i)[0];
    // `ALTER POLICY ... RENAME TO` só troca o nome (e já reprova como destrutivo).
    if (acao === 'ALTER POLICY' && /\bRENAME\b/i.test(cabecalho)) continue;
    const para = /\bTO\b/i.exec(cabecalho);
    if (para === null) {
      // Sem TO, o ALTER POLICY mantém os papéis da política.
      if (acao === 'ALTER POLICY') continue;
      problemas.push({
        linha: linha(ocorrencia.index),
        mensagem:
          'CREATE POLICY sem TO (Seg-2): a política valeria para PUBLIC; restrinja ao papel ' +
          `da aplicação (TO bairrin_app)${sufixo}`,
      });
      continue;
    }
    const inicioDosPapeis = ocorrencia.index + para.index + para[0].length;
    const papeis = listaDeNomes(
      codigo.slice(inicioDosPapeis, ocorrencia.index + cabecalho.length),
    ).map(({ nome }) => nome);
    for (const papel of papeis.filter(papelSemPolitica)) {
      problemas.push({
        linha: linha(ocorrencia.index),
        mensagem:
          `${acao} para ${papel} (Q6): PUBLIC, os papéis do Supabase (anon, authenticated, ` +
          `service_role) e os administrativos (postgres, supabase_*, pg_*) não recebem ` +
          `política${sufixo}`,
      });
    }
  }

  for (const ocorrencia of comandos.matchAll(PAPEL_CRIADO_OU_ALTERADO)) {
    const acao = `${ocorrencia[1]} ${ocorrencia[2]}`.toUpperCase();
    problemas.push({
      linha: linha(ocorrencia.index),
      mensagem: `${acao} (Q6): papéis são criados e alterados fora das migrações${sufixo}`,
    });
  }
  for (const ocorrencia of comandos.matchAll(ATRIBUTO_DE_PAPEL)) {
    problemas.push({
      linha: linha(ocorrencia.index),
      mensagem: `${ocorrencia[1].toUpperCase()} (Q6): atributo de papel privilegiado não é aceito em migração${sufixo}`,
    });
  }

  const trocaDePapel = (indice, acao) =>
    problemas.push({
      linha: linha(indice),
      mensagem: `troca de papel (${acao}) (Q6): a migração roda só como bairrin_migracao${sufixo}`,
    });
  for (const ocorrencia of codigo.matchAll(TROCA_DE_PAPEL)) {
    const parametro = ocorrencia[1].replace(/"/g, '').replace(/\s+/g, ' ').toUpperCase();
    const acao = parametro === 'SESSION_AUTHORIZATION' ? 'SESSION AUTHORIZATION' : parametro;
    trocaDePapel(ocorrencia.index + ocorrencia[0].search(/SET/i), `SET ${acao}`);
  }
  for (const ocorrencia of comandos.matchAll(COMANDO_COM_PARAMETRO)) {
    const fim = fimDoComando(visoes, ocorrencia.index);
    const comando = comandoNoNivel(visoes, ocorrencia.index, fim, 'codigo');
    const opcao = PAPEL_COMO_PARAMETRO.exec(comando);
    if (opcao === null) continue;
    trocaDePapel(ocorrencia.index + opcao.index, `SET ${opcao[1].toLowerCase()} como parâmetro`);
  }
  for (const ocorrencia of visoes.semComentarios.matchAll(TROCA_DE_PAPEL_POR_FUNCAO)) {
    trocaDePapel(ocorrencia.index, 'set_config');
  }

  // Q11: no código e nos textos que podem ser executados; não na mensagem de RAISE nem na
  // descrição de COMMENT ... IS.
  const ondeHaRowSecurity = [...codigo.matchAll(SEGURANCA_DE_LINHA_DA_SESSAO)].map(
    (ocorrencia) => ocorrencia.index,
  );
  visoes.textos.forEach((texto, indice) => {
    const posicao = visoes.posicoesDosTextos[indice];
    const antes = comandos.slice(Math.max(0, posicao - 200), posicao);
    if (ANTES_DE_TEXTO_NAO_EXECUTADO.test(antes)) return;
    if (/\brow_security\b/i.test(texto)) ondeHaRowSecurity.push(posicao);
  });
  for (const indice of ondeHaRowSecurity.sort((a, b) => a - b)) {
    problemas.push({
      linha: linha(indice),
      mensagem: `row_security (Q6): o RLS da sessão não é configurado em migração${sufixo}`,
    });
  }

  for (const ocorrencia of comandos.matchAll(REGRA_DE_REESCRITA)) {
    problemas.push({
      linha: linha(ocorrencia.index),
      mensagem:
        'CREATE RULE (S34): a regra reescreve o comando antes das triggers e contornaria a ' +
        `imutabilidade da auditoria; não é aceita em migração${sufixo}`,
    });
  }

  for (const ocorrencia of comandos.matchAll(COPIA_POR_PROGRAMA)) {
    problemas.push({
      linha: linha(ocorrencia.index),
      mensagem: `COPY ... PROGRAM (Q6): executa comando no servidor do banco; não é aceito em migração${sufixo}`,
    });
  }

  const regrasDeDono = [
    [DONO, 'OWNER TO', 'Seg-2'],
    [SCHEMA_COM_DONO, 'CREATE SCHEMA ... AUTHORIZATION', 'S34'],
    [DONO_REATRIBUIDO, 'REASSIGN OWNED BY ... TO', 'S34'],
  ];
  for (const [regex, comando, origem] of regrasDeDono) {
    for (const ocorrencia of comandos.matchAll(regex)) {
      const papel = donoRecusado(codigo, ocorrencia.index + ocorrencia[0].length);
      if (papel === undefined) continue;
      problemas.push({
        linha: linha(ocorrencia.index),
        mensagem:
          `${comando} ${papel} (${origem}): o dono dos objetos é ${DONO_ACEITO} (ou ` +
          `CURRENT_USER); o dono ignora o RLS${sufixo}`,
      });
    }
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
  const excedidos = [];
  const dinamicos = textosDeSqlDinamico(visoes, 0, excedidos);

  if (!temNotaDeReversao(sql)) {
    problemas.push({
      mensagem:
        'falta a nota "-- reversao: <como desfazer>" no cabeçalho, antes do primeiro comando',
    });
  }
  if (excedidos.length > 0) {
    problemas.push({
      mensagem:
        `SQL dinâmico com mais de ${NIVEIS_DE_SQL_DINAMICO + 1} níveis (texto dentro de texto) ` +
        '(S34): o verificador não confere o comando mais fundo; use menos níveis',
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
