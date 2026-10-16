// Redação de dado pessoal no log (CA-F3), do jeito que o pino a aplica de verdade:
// o logger raiz da aplicação (`criarLoggerDaAplicacao`) com destino em memória,
// sem Nest nem rede.
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { Writable } from 'node:stream';
import { Logger as LoggerDoNestCommon } from '@nestjs/common';
import { Logger as LoggerDoNest, PinoLogger } from 'nestjs-pino';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { describe, expect, it } from 'vitest';
import {
  CONTEXTO_DESCARTADO,
  criarLoggerDaAplicacao,
  opcoesDoPinoHttp,
  parametrosDoLogger,
  serializarErro,
  serializarRequisicao,
  serializarResposta,
  TEXTO_SEM_MENSAGEM,
} from './logger.ts';
import { VALOR_REDIGIDO } from './redator.ts';

/** Destino em memória: guarda tudo o que o pino escreveu. */
function criarDestino() {
  const linhas: string[] = [];
  const destino = new Writable({
    write(trecho: Buffer, _codificacao, pronto) {
      linhas.push(trecho.toString());
      pronto();
    },
  });
  const texto = () => linhas.join('');
  /** Linhas cruas, como saíram (sem `JSON.parse`, que esconde chave repetida). */
  const linhasCruas = () =>
    texto()
      .trim()
      .split('\n')
      .filter((linha) => linha !== '');
  const registros = () =>
    linhasCruas().map((linha) => JSON.parse(linha) as Record<string, unknown>);
  const limpar = () => {
    linhas.length = 0;
  };
  return { destino, texto, linhasCruas, registros, limpar };
}

/** Logger real do pino com as opções da API; devolve também o texto de tudo o que saiu. */
function criarLogger() {
  const { destino, texto, linhasCruas, registros } = criarDestino();
  const logger = criarLoggerDaAplicacao({ LOG_NIVEL: 'info' }, destino);
  return { logger, texto, linhasCruas, registros };
}

/**
 * O nestjs-pino cria o pino-http uma vez por processo: todo teste que passa
 * pelo `PinoLogger` (direto ou pelo `Logger` do nestjs-pino) escreve neste
 * destino, limpo no começo de cada um.
 */
const doNestjsPino = criarDestino();
const parametrosDoNestjsPino = parametrosDoLogger({ LOG_NIVEL: 'info' }, doNestjsPino.destino);

/** Quantas chaves `"msg"` a linha crua tem. */
function quantidadeDeMsg(linha: string): number {
  return linha.split('"msg":').length - 1;
}

class Cliente {
  constructor(
    readonly nome: string,
    readonly email: string,
    readonly cpf: string,
  ) {}
}

describe('log: dado pessoal em objetos que não são literais', () => {
  it('redige o e-mail e o CPF de uma instância de classe passada ao log', () => {
    const { logger, texto } = criarLogger();
    logger.info({ cliente: new Cliente('Ana', 'ana-classe@exemplo.com', '11122233344') }, 'teste');
    expect(texto()).not.toContain('ana-classe@exemplo.com');
    expect(texto()).not.toContain('11122233344');
  });

  it('redige a instância de classe aninhada dentro de objeto literal e de array', () => {
    const { logger, texto } = criarLogger();
    logger.info(
      {
        pedido: { comprador: new Cliente('Beto', 'beto-aninhado@exemplo.com', '55566677788') },
        lista: [new Cliente('Caio', 'caio-na-lista@exemplo.com', '99988877766')],
      },
      'teste',
    );
    for (const proibido of [
      'beto-aninhado@exemplo.com',
      '55566677788',
      'caio-na-lista@exemplo.com',
      '99988877766',
    ]) {
      expect(texto()).not.toContain(proibido);
    }
  });

  it('não vaza as propriedades próprias de um Error registrado fora da chave `err`', () => {
    const { logger, texto } = criarLogger();
    const falha = Object.assign(new Error('falha'), {
      email: 'erro-propriedade@exemplo.com',
      telefone: '35988887777',
    });
    logger.info({ falha }, 'teste');
    expect(texto()).not.toContain('erro-propriedade@exemplo.com');
    expect(texto()).not.toContain('35988887777');
  });

  it('redige os vínculos de um logger filho (`child` e `assign` do nestjs-pino)', () => {
    const { logger, texto } = criarLogger();
    logger.child({ email: 'vinculo@exemplo.com', usuarioId: 'u-1' }).info('teste');
    expect(texto()).not.toContain('vinculo@exemplo.com');
    expect(texto()).toContain('u-1');
  });

  it('Map e Date não carregam dado pessoal para a linha', () => {
    const { logger, texto } = criarLogger();
    logger.info({ mapa: new Map([['email', 'mapa@exemplo.com']]), quando: new Date(0) }, 'teste');
    expect(texto()).not.toContain('mapa@exemplo.com');
    expect(texto()).toContain('1970-01-01T00:00:00.000Z');
  });

  it.each(['E_MAIL', 'E-Mail', 'EMAIL', 'Telefone', 'CPF', 'CnPj', 'Set-Cookie', 'AUTHORIZATION'])(
    'redige a chave %s em qualquer combinação de caixa e separador',
    (chave) => {
      const { logger, texto } = criarLogger();
      logger.info({ [chave]: 'valor-pessoal-123' }, 'teste');
      expect(texto()).not.toContain('valor-pessoal-123');
    },
  );
});

describe('log: vínculos de logger filho e chaves com serializador', () => {
  it('redige os vínculos de `setBindings` e de filhos de filhos', () => {
    const { logger, texto } = criarLogger();
    const filho = logger.child({ lojaId: 'l-1' });
    filho.setBindings({ telefone: '35911112222' });
    filho
      .child({ cpf: '11122233344' })
      .child({ cliente: new Cliente('Dora', 'dora@exemplo.com', '1') })
      .info('teste');
    filho.info('outro');
    for (const proibido of ['35911112222', '11122233344', 'dora@exemplo.com', 'Dora']) {
      expect(texto()).not.toContain(proibido);
    }
    expect(texto()).toContain('l-1');
  });

  it('`err` continua indo para o serializador: tipo e código, sem mensagem', () => {
    const { logger, texto } = criarLogger();
    const erro = Object.assign(new Error('falha para err@exemplo.com'), { code: 'P2010' });
    logger.error({ err: erro }, 'teste');
    logger.error(erro, 'teste direto');
    const registros = texto()
      .trim()
      .split('\n')
      .map((linha) => JSON.parse(linha) as { err: unknown });
    for (const registro of registros) {
      expect(registro.err).toMatchObject({ tipo: 'Error', codigo: 'P2010' });
    }
    expect(texto()).not.toContain('err@exemplo.com');
  });

  it('erro de banco aninhado fora de `err` não leva `detail` nem a mensagem', () => {
    const { logger, texto } = criarLogger();
    const doPg = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      detail: 'Key (documento)=(52998224725) already exists.',
    });
    logger.warn({ contexto: { causa: doPg } }, 'teste');
    expect(texto()).not.toContain('52998224725');
    expect(texto()).not.toContain('duplicate key value');
    expect(texto()).toContain('23505');
  });

  it.each([
    'nome',
    'endereco',
    'logradouro',
    'cep',
    'celular',
    'whatsapp',
    'latitude',
    'longitude',
    'ip',
    'pix',
    'agencia',
    'contaBancaria',
    'codigo',
    'totp',
    'hash',
    'hmac',
    'mail',
    'E.Mail',
  ])('redige a chave %s, no objeto registrado e no vínculo de filho', (chave) => {
    const { logger, texto } = criarLogger();
    logger.info({ [chave]: 'valor-pessoal-456' }, 'teste');
    logger.child({ [chave]: 'valor-do-vinculo-789' }).info('teste');
    expect(texto()).not.toContain('valor-pessoal-456');
    expect(texto()).not.toContain('valor-do-vinculo-789');
  });
});

describe('serializarErro', () => {
  it('não leva a mensagem nem propriedades próprias do erro (podem ter parâmetros de query)', () => {
    const erro = Object.assign(new Error('falha para fulano@exemplo.com'), {
      code: 'P2010',
      email: 'fulano@exemplo.com',
    });
    const serializado = serializarErro(erro);
    expect(serializado).toMatchObject({ tipo: 'Error', codigo: 'P2010' });
    expect(JSON.stringify(serializado)).not.toContain('fulano@exemplo.com');
  });

  it('valor lançado que não é Error vira só o tipo', () => {
    expect(serializarErro('fulano@exemplo.com')).toEqual({ tipo: 'string' });
    expect(serializarErro({ email: 'fulano@exemplo.com' })).toEqual({ tipo: 'object' });
  });
});

describe('serializadores de requisição e resposta com valor que não é objeto (Q5)', () => {
  it.each([
    ['req nulo', { req: null }],
    ['res nulo', { res: null }],
    ['req texto', { req: 'fulano@exemplo.com' }],
    ['res texto', { res: 'fulano@exemplo.com' }],
    ['req número', { req: 35988887777 }],
  ])('%s: o log não lança e a linha não traz o valor', (_caso, objeto) => {
    const { logger, texto, registros } = criarLogger();
    expect(() => {
      logger.info(objeto, 'teste');
    }).not.toThrow();
    expect(registros()).toHaveLength(1);
    expect(texto()).not.toContain('fulano@exemplo.com');
    expect(texto()).not.toContain('35988887777');
  });

  it('devolvem objeto vazio direto, sem ler propriedade', () => {
    for (const valor of [null, undefined, 'fulano@exemplo.com', 42, true]) {
      expect(serializarRequisicao(valor)).toEqual({});
      expect(serializarResposta(valor)).toEqual({});
    }
  });

  it('com objeto, seguem com método, URL sem query e status', () => {
    expect(serializarRequisicao({ method: 'GET', url: '/v1/x?email=fulano@exemplo.com' })).toEqual({
      metodo: 'GET',
      url: '/v1/x',
    });
    expect(serializarResposta({ statusCode: 404 })).toEqual({ status: 404 });
  });
});

describe('texto do log sem mensagem de erro nem interpolação (Seg-1)', () => {
  const EMAIL = 'fulano@exemplo.com';

  it('`error(erro)` sem texto: o erro vai para `err` e o texto é fixo', () => {
    const { logger, texto, registros } = criarLogger();
    logger.error(new Error(EMAIL));
    expect(texto()).not.toContain(EMAIL);
    expect(registros()[0]).toMatchObject({ msg: TEXTO_SEM_MENSAGEM, err: { tipo: 'Error' } });
  });

  it('`error({ err })` sem texto: o texto é fixo, não a mensagem do erro', () => {
    const { logger, texto, registros } = criarLogger();
    logger.error({ err: new Error(EMAIL) });
    expect(texto()).not.toContain(EMAIL);
    expect(registros()[0]).toMatchObject({ msg: TEXTO_SEM_MENSAGEM, err: { tipo: 'Error' } });
  });

  it('objeto sem `err` e sem texto recebe o texto fixo', () => {
    const { logger, registros } = criarLogger();
    logger.info({ lojaId: 'l-1' });
    expect(registros()[0]).toMatchObject({ msg: TEXTO_SEM_MENSAGEM, lojaId: 'l-1' });
  });

  it('texto que não é string vira o texto fixo', () => {
    const { logger, texto, registros } = criarLogger();
    logger.info(35988887777 as unknown as string);
    logger.info({ lojaId: 'l-1' }, 35988887777 as unknown as string);
    expect(texto()).not.toContain('35988887777');
    expect(registros().map((r) => r['msg'])).toEqual([TEXTO_SEM_MENSAGEM, TEXTO_SEM_MENSAGEM]);
  });

  it('descarta os argumentos de interpolação, com ou sem objeto', () => {
    const { logger, texto, registros } = criarLogger();
    logger.info('conta %s', EMAIL);
    logger.info({ lojaId: 'l-1' }, 'conta %s de %s', EMAIL, 'Ana');
    logger.error(new Error(EMAIL), 'falha na conta %s', EMAIL);
    expect(texto()).not.toContain(EMAIL);
    expect(texto()).not.toContain('Ana');
    expect(registros().map((r) => r['msg'])).toEqual([
      'conta %s',
      'conta %s de %s',
      'falha na conta %s',
    ]);
  });

  it('vale também nos filhos e preserva texto, objeto e `err` de quem já registra certo', () => {
    const { logger, texto, registros } = criarLogger();
    const filho = logger.child({ idRequisicao: 'r-1' }).child({ lojaId: 'l-1' });
    filho.error(Object.assign(new Error(EMAIL), { code: 'P2010' }));
    filho.warn({ err: new Error(EMAIL), etapa: 'envio' }, 'falha no envio');
    logger.info('só texto');
    expect(texto()).not.toContain(EMAIL);
    expect(registros()).toMatchObject([
      { idRequisicao: 'r-1', lojaId: 'l-1', msg: TEXTO_SEM_MENSAGEM, err: { codigo: 'P2010' } },
      { idRequisicao: 'r-1', etapa: 'envio', msg: 'falha no envio', err: { tipo: 'Error' } },
      { msg: 'só texto' },
    ]);
  });

  it('`Logger` do nestjs-pino: texto + pilha, interpolação e `PinoLogger` com contexto não levam a mensagem', () => {
    doNestjsPino.limpar();
    const { texto, registros } = doNestjsPino;
    const logger = new LoggerDoNest(new PinoLogger(parametrosDoNestjsPino), parametrosDoNestjsPino);
    const pilha = `Error: ${EMAIL}\n    at Servico.executar (servico.ts:10:5)`;
    // `error(texto, pilha, contexto)`: o contrato antigo dos `ExceptionsHandler`
    // (`isWrongExceptionsHandlerContract`). O nestjs-pino monta um `Error` com o
    // texto e a pilha e chama `error({ context, err })` sem texto. O Nest 12 não
    // chama mais assim (ver o teste seguinte), mas outros chamadores ainda podem.
    logger.error(EMAIL, pilha, 'ExceptionsHandler');
    // Interpolação pelo `Logger` do nestjs-pino: o último argumento é o contexto.
    logger.log('conta %s', EMAIL, 'Contas');
    logger.error(new Error(EMAIL), 'Contas');
    // `PinoLogger` injetado nos serviços, com `setContext` (QA do grupo 0).
    const servico = new PinoLogger(parametrosDoNestjsPino);
    servico.setContext('Pedidos');
    servico.error(new Error(EMAIL));
    servico.error({ err: new Error(EMAIL) });
    servico.error(new Error(EMAIL), 'falha %s', EMAIL);
    servico.warn('conta %s', EMAIL);
    expect(texto()).not.toContain(EMAIL);
    expect(registros()).toMatchObject([
      {
        context: 'ExceptionsHandler',
        msg: TEXTO_SEM_MENSAGEM,
        err: { tipo: 'Error', pilha: '    at Servico.executar (servico.ts:10:5)' },
      },
      { context: 'Contas', msg: 'conta %s' },
      { context: 'Contas', msg: TEXTO_SEM_MENSAGEM, err: { tipo: 'Error' } },
      { context: 'Pedidos', msg: TEXTO_SEM_MENSAGEM, err: { tipo: 'Error' } },
      { context: 'Pedidos', msg: TEXTO_SEM_MENSAGEM, err: { tipo: 'Error' } },
      { context: 'Pedidos', msg: 'falha %s', err: { tipo: 'Error' } },
      { context: 'Pedidos', msg: 'conta %s' },
    ]);
  });
});

describe('caminhos reais do `Logger` do `@nestjs/common` no Nest 12 (R13, S35b)', () => {
  const EMAIL = 'fulano@exemplo.com';

  /**
   * Como o `app.useLogger(app.get(Logger))` do main: o `Logger` do
   * `@nestjs/common` passa a escrever pelo `Logger` do nestjs-pino. A troca é
   * global, então é desfeita no fim.
   */
  function comLoggerDoNestjsPino(executar: () => void): void {
    doNestjsPino.limpar();
    const estatico = LoggerDoNestCommon as unknown as { staticInstanceRef: unknown };
    const anterior = estatico.staticInstanceRef;
    LoggerDoNestCommon.overrideLogger(
      new LoggerDoNest(new PinoLogger(parametrosDoNestjsPino), parametrosDoNestjsPino),
    );
    try {
      executar();
    } finally {
      estatico.staticInstanceRef = anterior;
    }
  }

  it('`ExceptionsHandler` do Nest 12 (`logger.error(exception)` com contexto): chega como `error({ context, err }, undefined)`', () => {
    comLoggerDoNestjsPino(() => {
      // `BaseExceptionFilter.logger.error(exception)` e `ExceptionHandler.logger.error(exception)`.
      new LoggerDoNestCommon('ExceptionsHandler').error(new Error(EMAIL));
    });
    const [linha] = doNestjsPino.linhasCruas();
    expect(doNestjsPino.texto()).not.toContain(EMAIL);
    expect(quantidadeDeMsg(linha ?? '')).toBe(1);
    expect(doNestjsPino.registros()).toMatchObject([
      { context: 'ExceptionsHandler', msg: TEXTO_SEM_MENSAGEM, err: { tipo: 'Error' } },
    ]);
  });

  it('hooks de encerramento (`Logger.error(err, err?.stack)` estático): a pilha não vira o contexto', () => {
    const erro = new Error(EMAIL);
    comLoggerDoNestjsPino(() => {
      LoggerDoNestCommon.error(erro, erro.stack);
    });
    expect(doNestjsPino.texto()).not.toContain(EMAIL);
    expect(doNestjsPino.registros()).toMatchObject([
      { context: CONTEXTO_DESCARTADO, msg: TEXTO_SEM_MENSAGEM, err: { tipo: 'Error' } },
    ]);
  });
});

describe('chaves `msg` e `message` no objeto do log (R12, S35a, Q8)', () => {
  const EMAIL = 'fulano@exemplo.com';

  it.each([
    ['info({ msg })', (l: Logger) => l.info({ msg: EMAIL }), TEXTO_SEM_MENSAGEM],
    ['info({ msg }, texto)', (l: Logger) => l.info({ msg: EMAIL }, 'texto'), 'texto'],
    ['info({ message })', (l: Logger) => l.info({ message: EMAIL }), TEXTO_SEM_MENSAGEM],
    ['info({ message }, texto)', (l: Logger) => l.info({ message: EMAIL }, 'texto'), 'texto'],
    [
      'filho.warn({ msg, message }, texto)',
      (l: Logger) => l.child({ lojaId: 'l-1' }).warn({ msg: EMAIL, message: EMAIL }, 'texto'),
      'texto',
    ],
  ])('%s: a linha crua não traz o e-mail e tem um único "msg"', (_caso, registrar, esperado) => {
    const { logger, texto, linhasCruas } = criarLogger();
    registrar(logger);
    const linhas = linhasCruas();
    expect(linhas).toHaveLength(1);
    expect(texto()).not.toContain(EMAIL);
    expect(quantidadeDeMsg(linhas[0] ?? '')).toBe(1);
    expect(linhas[0]).toContain(`"msg":"${esperado}"`);
  });

  it('aninhadas, `msg` e `message` são redigidas', () => {
    const { logger, texto, registros } = criarLogger();
    logger.info({ detalhe: { msg: EMAIL, message: EMAIL, messageId: 'm-1' } }, 'texto');
    expect(texto()).not.toContain(EMAIL);
    expect(registros()).toMatchObject([
      {
        msg: 'texto',
        detalhe: { msg: VALOR_REDIGIDO, message: VALOR_REDIGIDO, messageId: 'm-1' },
      },
    ]);
  });

  it('não altera o objeto recebido e mantém as outras chaves', () => {
    const { logger, registros } = criarLogger();
    const objeto = { msg: EMAIL, lojaId: 'l-1' };
    logger.info(objeto, 'texto');
    expect(objeto).toEqual({ msg: EMAIL, lojaId: 'l-1' });
    expect(registros()).toMatchObject([{ msg: 'texto', lojaId: 'l-1' }]);
  });

  it('`Logger` do nestjs-pino com objeto que tem `msg`: um único "msg", sem o valor', () => {
    doNestjsPino.limpar();
    const logger = new LoggerDoNest(new PinoLogger(parametrosDoNestjsPino), parametrosDoNestjsPino);
    logger.log({ msg: EMAIL, message: EMAIL }, 'Contas');
    const [linha] = doNestjsPino.linhasCruas();
    expect(doNestjsPino.texto()).not.toContain(EMAIL);
    expect(quantidadeDeMsg(linha ?? '')).toBe(1);
    expect(doNestjsPino.registros()).toMatchObject([
      { context: 'Contas', msg: TEXTO_SEM_MENSAGEM },
    ]);
  });
});

describe('contexto do nestjs-pino só como texto curto de uma linha (S35b)', () => {
  const EMAIL = 'fulano@exemplo.com';

  it.each([
    ['com quebra de linha', `Error: ${EMAIL}\n    at x (y.ts:1:1)`],
    ['com retorno de carro', `Contas\r${EMAIL}`],
    ['com 81 caracteres', `${EMAIL}${'x'.repeat(81 - EMAIL.length)}`],
    ['que não é texto', { email: EMAIL }],
    ['número', 35988887777],
  ])('contexto %s vira o valor fixo', (_caso, contexto) => {
    const { logger, texto, registros } = criarLogger();
    logger.error({ context: contexto, err: new Error(EMAIL) }, 'falha');
    expect(texto()).not.toContain(EMAIL);
    expect(texto()).not.toContain('35988887777');
    expect(registros()).toMatchObject([{ context: CONTEXTO_DESCARTADO, msg: 'falha' }]);
  });

  it('objeto que lança ao ser lido não derruba o log: sai só o texto', () => {
    const { logger, texto, registros } = criarLogger();
    const traicoeiro = Object.defineProperty({ msg: EMAIL }, 'context', {
      enumerable: true,
      get() {
        throw new Error(EMAIL);
      },
    });
    expect(() => {
      logger.info(traicoeiro, 'texto');
    }).not.toThrow();
    expect(texto()).not.toContain(EMAIL);
    expect(registros()).toMatchObject([{ msg: 'texto' }]);
  });

  it('contexto de uma linha com até 80 caracteres passa como veio', () => {
    const { logger, registros } = criarLogger();
    const oitenta = 'C'.repeat(80);
    logger.info({ context: 'Contas' }, 'um');
    logger.info({ context: oitenta }, 'dois');
    logger.info({ lojaId: 'l-1' }, 'três');
    expect(registros()).toMatchObject([
      { context: 'Contas', msg: 'um' },
      { context: oitenta, msg: 'dois' },
      { msg: 'três' },
    ]);
    expect(registros()[2]).not.toHaveProperty('context');
  });
});

describe('pilha sem linhas que vêm da mensagem do erro (Q9)', () => {
  const EMAIL = 'fulano@exemplo.com';

  it('linha parecida com quadro dentro da mensagem não vai para `err.pilha`', () => {
    const { logger, texto, registros } = criarLogger();
    const erro = new Error(`falha\n    at ${EMAIL} (falso.ts:1:1)\n    at fim`);
    logger.error(erro, 'falha');
    expect(texto()).not.toContain(EMAIL);
    expect(texto()).not.toContain('falso.ts');
    const pilha = (registros()[0]?.['err'] as { pilha?: string }).pilha ?? '';
    // Os quadros de verdade continuam: o primeiro é este arquivo de teste.
    expect(pilha).toMatch(/^\s+at .*logger\.test\.ts/);
  });
});

describe('bordas do texto fixo do log (QA do grupo 0, Seg-1)', () => {
  const EMAIL = 'fulano@exemplo.com';

  it('erro com `cause` e `AggregateError`: nem a mensagem nem a causa nem os erros agregados vão', () => {
    const { logger, texto, registros } = criarLogger();
    logger.error(new Error(`falha ${EMAIL}`, { cause: new Error(`causa ${EMAIL}`) }));
    logger.error({ err: new AggregateError([new Error(EMAIL)], `agregado ${EMAIL}`) }, 'lote');
    expect(texto()).not.toContain(EMAIL);
    const [comCausa, agregado] = registros();
    expect(comCausa).toMatchObject({ msg: TEXTO_SEM_MENSAGEM, err: { tipo: 'Error' } });
    expect(Object.keys(comCausa?.['err'] as object).sort()).toEqual(['pilha', 'tipo']);
    expect(agregado).toMatchObject({ msg: 'lote', err: { tipo: 'AggregateError' } });
    expect(Object.keys(agregado?.['err'] as object).sort()).toEqual(['pilha', 'tipo']);
  });

  it.each(['warn', 'error', 'fatal'] as const)(
    'nível %s: o erro vai para `err` e a interpolação (com ou sem texto) é descartada',
    (nivel) => {
      const { logger, texto, registros } = criarLogger();
      logger[nivel](new Error(EMAIL));
      logger[nivel](new Error(EMAIL), 'conta %j %o %d', { email: EMAIL }, EMAIL, 35988887777);
      expect(texto()).not.toContain(EMAIL);
      expect(texto()).not.toContain('35988887777');
      expect(registros()).toMatchObject([
        { level: nivel, msg: TEXTO_SEM_MENSAGEM, err: { tipo: 'Error' } },
        { level: nivel, msg: 'conta %j %o %d', err: { tipo: 'Error' } },
      ]);
    },
  );

  it('texto com marcadores de formato e sem argumentos sai como foi escrito', () => {
    const { logger, registros } = criarLogger();
    logger.info('100% feito, %s, %%, %j');
    expect(registros()[0]).toMatchObject({ msg: '100% feito, %s, %%, %j' });
  });

  /** Requisição simulada, sem socket de rede: o pino-http só precisa de `req`, `res` e do `finish`. */
  function atender(
    caminho: string,
    aoAtender: (req: IncomingMessage, res: ServerResponse) => void,
  ) {
    const { destino, texto, registros } = criarDestino();
    const registrar = pinoHttp(
      opcoesDoPinoHttp(criarLoggerDaAplicacao({ LOG_NIVEL: 'info' }, destino)),
    );
    const req = new IncomingMessage(new Socket());
    req.method = 'GET';
    req.url = caminho;
    const res = new ServerResponse(req);
    registrar(req, res);
    aoAtender(req, res);
    res.emit('finish');
    return { texto, registros, req };
  }

  it('pino-http com erro (`res.err` e evento `error`): registra método, URL sem query, status e tipo, sem a mensagem', () => {
    const comErro = atender(`/v1/contas?email=${EMAIL}`, (_req, res) => {
      res.statusCode = 500;
      (res as ServerResponse & { err?: Error }).err = new Error(`falha ${EMAIL}`);
    });
    expect(comErro.texto()).not.toContain(EMAIL);
    expect(comErro.registros()).toHaveLength(1);
    expect(comErro.registros()[0]).toMatchObject({
      level: 'error',
      msg: 'requisição com erro',
      req: { metodo: 'GET', url: '/v1/contas' },
      res: { status: 500 },
      err: { tipo: 'Error' },
    });

    const comEvento = atender('/v1/contas', (_req, res) => {
      res.statusCode = 500;
      res.emit('error', new Error(`evento ${EMAIL}`));
    });
    expect(comEvento.texto()).not.toContain(EMAIL);
    expect(comEvento.registros().at(-1)).toMatchObject({ level: 'error', err: { tipo: 'Error' } });
  });

  it('pino-http: o logger da requisição (`req.log`) também usa o texto fixo e leva o id da requisição', () => {
    const { texto, registros } = atender('/v1/contas', (req) => {
      const log = (req as IncomingMessage & { log: ReturnType<typeof criarLoggerDaAplicacao> }).log;
      log.error(new Error(EMAIL));
      log.info('conta %s', EMAIL);
    });
    expect(texto()).not.toContain(EMAIL);
    const [erro, interpolado, conclusao] = registros();
    expect(erro).toMatchObject({ msg: TEXTO_SEM_MENSAGEM, err: { tipo: 'Error' } });
    expect(interpolado).toMatchObject({ msg: 'conta %s' });
    expect(erro?.['idRequisicao']).toEqual(expect.any(String));
    expect(conclusao).toMatchObject({ msg: 'requisição concluída', res: { status: 200 } });
  });
});
