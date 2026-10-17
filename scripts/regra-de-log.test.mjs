// Prova da regra de lint do texto do log da API (Seg-1, S36 e P8 do plano 01b): a regra
// `no-restricted-syntax` é lida da configuração real do repositório, como o ESLint a aplica a
// `apps/api/src/main.ts`, e roda sobre trechos com o parser do typescript-eslint, sem tipos.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

const configuracao = await new ESLint({ cwd: RAIZ }).calculateConfigForFile('apps/api/src/main.ts');
const regra = configuracao.rules?.['no-restricted-syntax'];

/** Mensagens da regra para um trecho de código da API. */
function violacoes(trecho) {
  const linter = new Linter({ cwd: RAIZ });
  const mensagens = linter.verify(
    trecho,
    [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: tseslint.parser },
        rules: { 'no-restricted-syntax': regra },
      },
    ],
    { filename: 'trecho.ts' },
  );
  const deParse = mensagens.filter((mensagem) => mensagem.fatal);
  assert.deepEqual(deParse, [], `o trecho não foi lido: ${trecho}`);
  return mensagens.filter((mensagem) => mensagem.ruleId === 'no-restricted-syntax');
}

const PREAMBULO =
  'declare const logger: any; declare const Logger: any; declare const a: string; ' +
  'declare const e: Error; declare const cond: boolean;\n';

describe('regra de lint do texto do log da API', () => {
  it('a configuração real liga a regra como erro', () => {
    assert.ok(Array.isArray(regra), 'no-restricted-syntax ausente na configuração da API');
    // Depois da normalização do ESLint, a severidade vem como número (2 = erro).
    assert.ok(regra[0] === 2 || regra[0] === 'error', `severidade: ${String(regra[0])}`);
  });

  for (const trecho of [
    'logger.info(`x ${a}`);',
    "logger.info('x' + a);",
    "logger.warn({ contaId: 'c-1' }, 'x' + a);",
    "logger.info({ m: 'x' + a });",
    "logger.info({ m: 'x' + a }, 'texto');",
    "logger.info({ m: 'x' + 'y' }, 'texto');",
    'logger.error(e.message);',
    "logger.error({ motivo: e.message }, 'falha');",
    "this.logger.error({ m: 'x' + a }, 'falha');",
  ]) {
    it(`reprova ${trecho}`, () => {
      assert.ok(violacoes(PREAMBULO + trecho).length > 0, `deveria reprovar: ${trecho}`);
    });
  }

  for (const trecho of [
    "const contaId = 'c-1'; logger.info({ contaId }, 'texto');",
    "logger.info('texto fixo');",
    "console.log('x' + a);",
    'console.error(`x ${a}`);',
    "const soma = 1 + 2; logger.info({ soma }, 'texto');",
  ]) {
    it(`aceita ${trecho}`, () => {
      assert.deepEqual(violacoes(PREAMBULO + trecho), [], `deveria aceitar: ${trecho}`);
    });
  }

  // Bordas do QA (grupo A): a regra vale para as formas de chamada comuns na API.
  for (const trecho of [
    'this.logger.info(`x ${a}`);',
    "this.logger.error({ contaId: 'c-1' }, 'x' + a);",
    "logger?.info('x' + a);",
    "logger.info?.('x' + a);",
    "logger.info(a + 'x');",
    "logger.info('x' + a + 'y');",
    "logger.info('texto', 'y' + a);",
    "logger.info(a, { m: 'x' + a });",
    "logger.child({ lojaId: 'l-1' }).info('x' + a);",
    "logger.error('texto', e.message);",
    "logger.info({ ['m']: 'x' + a }, 'texto');",
    "logger.info({ n: 1 + 2 }, 'texto');",
    ...['trace', 'debug', 'warn', 'fatal', 'verbose', 'log'].map(
      (nivel) => `logger.${nivel}('x' + a);`,
    ),
  ]) {
    it(`reprova também ${trecho}`, () => {
      assert.ok(violacoes(PREAMBULO + trecho).length > 0, `deveria reprovar: ${trecho}`);
    });
  }

  for (const trecho of [
    "this.logger.info({ contaId: 'c-1' }, 'texto');",
    "logger.info({ total: 1 }, 'texto fixo');",
    "logger.error({ err: e }, 'falha');",
    "logger.info('x', a);",
    "new Logger('Identidade');",
    "console.warn('x' + a);",
  ]) {
    it(`continua aceitando ${trecho}`, () => {
      assert.deepEqual(violacoes(PREAMBULO + trecho), [], `deveria aceitar: ${trecho}`);
    });
  }

  it('cada violação sai uma vez só por trecho com um problema, com a mensagem da regra', () => {
    const resultado = violacoes(`${PREAMBULO}logger.info('x' + a);`);
    assert.equal(resultado.length, 1);
    assert.match(resultado[0].message, /^Texto do log é fixo/);
    assert.match(resultado[0].message, /concatenação com `\+`/);
  });

  // Q15: `.message` com encadeamento opcional (`erro?.message`) escapa do seletor
  // `MemberExpression[property.name='message']`, porque o argumento é um `ChainExpression`.
  for (const trecho of [
    'logger.error(e?.message);',
    "logger.error({ motivo: e?.message }, 'falha');",
  ]) {
    it(`reprova .message com encadeamento opcional: ${trecho} (Q15)`, () => {
      assert.ok(violacoes(PREAMBULO + trecho).length > 0, `deveria reprovar: ${trecho}`);
    });
  }
});

// S70: o texto do log escapava pelos seletores de filho direto. A regra olha agora qualquer
// descendente dos argumentos da chamada de log, e também `String(...)`, `join`, `concat` e
// `toString`, que montam texto com o valor.
describe('regra de lint do texto do log: valor dentro de outra expressão (S70)', () => {
  for (const trecho of [
    'logger.error(e?.message);',
    "logger.error(cond ? e.message : 'x');",
    "logger.error({ motivo: cond ? 'x' : e.message }, 'falha');",
    "logger.error(e.message ?? 'x');",
    "logger.error({ motivo: e.message || 'x' }, 'falha');",
    'logger.error(String(e));',
    "logger.error({ motivo: String(e) }, 'falha');",
    "logger.error(e['message']);",
    "logger.error({ motivo: e['message'] }, 'falha');",
    'logger.error(e.message as string);',
    "logger.error({ motivo: e.message as string }, 'falha');",
    'logger.error(e.message!);',
    "logger.info(['x', a].join(' '));",
    "logger.info({ m: ['x', a].join(' ') }, 'texto');",
    "logger.info('x'.concat(a));",
    "logger.info({ m: 'x'.concat(a) }, 'texto');",
    'logger.info(e.toString());',
    "logger.info({ m: e.toString() }, 'texto');",
    "logger.info({ a: { b: 'x' + a } }, 'texto');",
    "logger.info({ a: [{ b: 'x' + a }] }, 'texto');",
    "logger.info({ a: { b: e.message } }, 'texto');",
    "logger.info({ a: { b: `x ${a}` } }, 'texto');",
    "logger.info(('x' + a) as string);",
    "this.logger.warn({ contaId: 'c-1', a: { m: String(a) } }, 'texto');",
  ]) {
    it(`reprova ${trecho}`, () => {
      assert.ok(violacoes(PREAMBULO + trecho).length > 0, `deveria reprovar: ${trecho}`);
    });
  }

  for (const trecho of [
    "const contaId = 'c-1'; logger.info({ contaId }, 'texto');",
    "logger.error({ err: e }, 'texto');",
    "const err = e; logger.error({ err }, 'texto');",
    "logger.info('texto');",
    'logger.info(`texto sem expressão`);',
    "logger.info({ total: 1, ativo: true, nada: null }, 'texto');",
    "logger.warn({ tipo: cond ? 'a' : 'b' }, 'texto');",
    "logger.info({ itens: [1, 2] }, 'texto');",
    'const texto = String(a); console.log(texto);',
    'e.message.trim();',
  ]) {
    it(`aceita ${trecho}`, () => {
      assert.deepEqual(violacoes(PREAMBULO + trecho), [], `deveria aceitar: ${trecho}`);
    });
  }
});

// S71: no `Logger` do `@nestjs/common` o último argumento depois do texto vira o contexto
// (`Logger.log('renovada', tokenRenovacao)`). O `Logger` estático e o `new Logger()` sem
// contexto ficam proibidos; a instância com contexto põe o próprio contexto no fim, e o que
// vem antes dele é interpolação, que o logger descarta.
describe('regra de lint do texto do log: contexto do Logger do Nest (S71)', () => {
  for (const trecho of [
    "Logger.log('renovada', a);",
    "Logger.error('falha', e.stack, 'Contexto');",
    ...['warn', 'debug', 'verbose', 'fatal'].map((nivel) => `Logger.${nivel}('texto');`),
    'const registro = new Logger();',
  ]) {
    it(`reprova ${trecho}`, () => {
      assert.ok(violacoes(PREAMBULO + trecho).length > 0, `deveria reprovar: ${trecho}`);
    });
  }

  for (const trecho of [
    'class Contas {} const registro = new Logger(Contas.name);',
    "const registro = new Logger('Identidade');",
    "this.logger.log('renovada');",
    "this.logger.log({ contaId: 'c-1' }, 'renovada');",
    "Logger.overrideLogger(['error']);",
  ]) {
    it(`aceita ${trecho}`, () => {
      assert.deepEqual(violacoes(PREAMBULO + trecho), [], `deveria aceitar: ${trecho}`);
    });
  }
});

// S70, rodada 3: a pilha (`erro.stack`) começa pela mensagem do erro e também fica fora dos
// argumentos de log, com as mesmas formas de `.message`. Os vínculos de logger filho
// (`child`, o `assign` do nestjs-pino e `setBindings`) vão para a linha como os argumentos.
describe('regra de lint do texto do log: pilha e vínculos de filho (S70)', () => {
  for (const trecho of [
    'this.logger.error(e, e.stack);',
    'logger.error({ err: e }, e.stack);',
    "logger.error({ m: e.stack }, 'falha');",
    "logger.error({ m: e?.stack }, 'falha');",
    "logger.error({ m: e['stack'] }, 'falha');",
    "logger.error({ m: e[`stack`] }, 'falha');",
    'logger.error(e[`message`]);',
    "logger.error({ m: e[`message`] }, 'falha');",
    "logger.error({ a: { b: e.stack } }, 'falha');",
    "logger.error(cond ? e.stack : 'x');",
    'logger.child({ m: e.message });',
    'logger.child({ m: e.stack });',
    "logger.child({ a: { m: e?.message } }).info('texto');",
    'this.logger.assign({ m: e.message });',
    "this.logger.assign({ m: e['stack'] });",
    'logger.setBindings({ m: e.stack });',
    'logger.setBindings({ m: e[`message`] });',
    "logger.child({ m: 'x' + a });",
    'logger.child({ m: `x ${a}` });',
    'this.logger.assign({ m: String(e) });',
  ]) {
    it(`reprova ${trecho}`, () => {
      assert.ok(violacoes(PREAMBULO + trecho).length > 0, `deveria reprovar: ${trecho}`);
    });
  }

  for (const trecho of [
    "logger.error({ err: e }, 'falha');",
    "logger.child({ lojaId: 'l-1' }).info('texto');",
    "this.logger.assign({ contaId: 'c-1' });",
    "logger.setBindings({ lojaId: 'l-1' });",
    "logger.info({ messageId: 'm-1', stackId: 's-1' }, 'texto');",
    'const pilha = e.stack; console.error(e.stack);',
    "const copia = Object.assign({}, { m: e.message, p: e.stack, t: 'x' + a });",
    'e.stack?.split(`\\n`);',
  ]) {
    it(`aceita ${trecho}`, () => {
      assert.deepEqual(violacoes(PREAMBULO + trecho), [], `deveria aceitar: ${trecho}`);
    });
  }
});

// S71, rodada 3: o `Logger` do `@nestjs/common` importado com outro nome ou pelo namespace
// escapa das regras que olham o nome `Logger`, e `new Logger(undefined)` é um logger sem
// contexto.
describe('regra de lint do texto do log: formas escondidas do Logger do Nest (S71)', () => {
  for (const trecho of [
    "import { Logger as L } from '@nestjs/common';",
    "import { Injectable, Logger as RegistroDoNest } from '@nestjs/common';",
    "import * as nest from '@nestjs/common';",
    'const registro = new Logger(undefined);',
  ]) {
    it(`reprova ${trecho}`, () => {
      assert.ok(violacoes(PREAMBULO + trecho).length > 0, `deveria reprovar: ${trecho}`);
    });
  }

  for (const trecho of [
    "import { Injectable, Logger } from '@nestjs/common';",
    "import { Logger as LoggerDoPino } from 'nestjs-pino';",
    "import * as pino from 'pino';",
    "const registro = new Logger('Identidade');",
    'class Contas {} const registro = new Logger(Contas.name, { timestamp: false });',
  ]) {
    it(`aceita ${trecho}`, () => {
      assert.deepEqual(violacoes(PREAMBULO + trecho), [], `deveria aceitar: ${trecho}`);
    });
  }
});
