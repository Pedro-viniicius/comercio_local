// Redação de dado pessoal no log (CA-F3), do jeito que o pino a aplica de verdade:
// o logger raiz da aplicação (`criarLoggerDaAplicacao`) com destino em memória,
// sem Nest nem rede.
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { criarLoggerDaAplicacao, serializarErro } from './logger.ts';

/** Logger real do pino com as opções da API; devolve também o texto de tudo o que saiu. */
function criarLogger() {
  const linhas: string[] = [];
  const destino = new Writable({
    write(trecho: Buffer, _codificacao, pronto) {
      linhas.push(trecho.toString());
      pronto();
    },
  });
  const logger = criarLoggerDaAplicacao({ LOG_NIVEL: 'info' }, destino);
  return { logger, texto: () => linhas.join('') };
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
