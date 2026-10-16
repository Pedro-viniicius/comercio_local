import { BadRequestException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { firstValueFrom, throwError } from 'rxjs';
import { afterAll, describe, expect, it } from 'vitest';
import { VALOR_REDIGIDO } from '../log/redator.ts';
import {
  COLETA_DE_DADOS,
  iniciarSentry,
  InterceptadorDoSentry,
  opcoesDoSentry,
  redigirBreadcrumb,
  redigirEvento,
} from './sentry.ts';

/** DSN fictício: os testes usam um transport falso, nada sai da máquina. */
const DSN = 'https://chavepublica@o0.ingest.sentry.io/0';

/**
 * Valores pessoais e secretos que não podem chegar ao Sentry por nenhum caminho.
 * O teste com transport falso usa as constantes, nunca os literais: o evento
 * leva as linhas de código em volta de cada quadro da pilha (ContextLines), e
 * um literal ali faria o teste acusar o próprio código-fonte.
 */
const EMAIL = 'fulano@exemplo.com';
const IP = '200.123.45.67';
const TOKEN = 'Bearer segredo-do-token';
const COOKIE = 'sessao=abc';
const SENHA = 'senha-super-secreta';
const TELEFONE = '35999990000';
const QUERY = 'email=fulano';
const PROIBIDOS = [EMAIL, IP, TOKEN, COOKIE, SENHA, TELEFONE, QUERY];

function esperarSemProibidos(texto: string): void {
  for (const proibido of PROIBIDOS) expect(texto).not.toContain(proibido);
}

describe('iniciarSentry', () => {
  it('não liga sem SENTRY_DSN', () => {
    expect(iniciarSentry({ SENTRY_DSN: undefined })).toBe(false);
    expect(Sentry.isInitialized()).toBe(false);
  });
});

describe('opcoesDoSentry', () => {
  const opcoes = opcoesDoSentry(DSN);

  it('desliga toda coleta de dado pessoal do SDK (equivalente ao sendDefaultPii: false)', () => {
    expect(opcoes.dataCollection).toEqual(COLETA_DE_DADOS);
    expect(COLETA_DE_DADOS).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });

  it('não usa Replay, breadcrumbs do console nem variáveis locais, e mantém o resto', () => {
    const padrao = Sentry.getDefaultIntegrations(opcoes) ?? [];
    const escolha = opcoes.integrations;
    if (typeof escolha !== 'function') throw new Error('integrations deveria ser uma função');
    const nomes = escolha(padrao).map((i) => i.name);
    expect(nomes).not.toContain('Replay');
    expect(nomes).not.toContain('Console');
    expect(nomes).not.toContain('LocalVariablesAsync');
    expect(nomes).toEqual(
      expect.arrayContaining(['OnUncaughtException', 'OnUnhandledRejection', 'LinkedErrors']),
    );
  });

  it('não liga tracing', () => {
    expect(opcoes.tracesSampleRate).toBeUndefined();
    expect(opcoes.tracesSampler).toBeUndefined();
  });
});

describe('redigirEvento', () => {
  const evento: Sentry.ErrorEvent = {
    type: undefined,
    request: {
      method: 'POST',
      url: 'https://api.bairrin.com.br/v1/contas?email=fulano@exemplo.com#frag',
      query_string: 'email=fulano@exemplo.com',
      headers: { authorization: 'Bearer segredo-do-token', 'x-forwarded-for': '200.123.45.67' },
      cookies: { sessao: 'sessao=abc' },
      data: { senha: 'senha-super-secreta' },
      env: { REMOTE_ADDR: '200.123.45.67' },
    },
    user: {
      id: 'b3f0c1e2-0000-4000-8000-000000000001',
      email: 'fulano@exemplo.com',
      ip_address: '200.123.45.67',
    },
    transaction: '/v1/contas?email=fulano@exemplo.com',
    message: 'Falha ao avisar fulano@exemplo.com',
    logentry: { message: 'Falha ao avisar %s', params: ['fulano@exemplo.com'] },
    exception: {
      values: [
        {
          type: 'PrismaClientKnownRequestError',
          value: 'Unique constraint failed: fulano@exemplo.com',
          stacktrace: {
            frames: [
              { function: 'criar', filename: 'conta.ts', vars: { senha: 'senha-super-secreta' } },
            ],
          },
        },
      ],
    },
    extra: { email: 'fulano@exemplo.com', pedido: 'p1' },
    contexts: { conta: { telefone: '35999990000', id: 'c1' } },
    tags: { cpf: '000', rota: 'contas' },
    breadcrumbs: [
      { category: 'console', message: 'fulano@exemplo.com' },
      {
        category: 'http',
        data: {
          url: 'https://viacep.com.br/ws/1?email=fulano',
          'http.query': 'email=fulano',
          status_code: 200,
        },
      },
    ],
  };
  const redigido = redigirEvento(evento);

  it('deixa da requisição só o método e a URL sem query', () => {
    expect(redigido.request).toEqual({
      method: 'POST',
      url: 'https://api.bairrin.com.br/v1/contas',
    });
    expect(redigido.transaction).toBe('/v1/contas');
  });

  it('descarta o IP e tudo do usuário que não é o id', () => {
    expect(redigido.user).toEqual({ id: 'b3f0c1e2-0000-4000-8000-000000000001' });
  });

  it('troca a mensagem da exceção e tira as variáveis locais, mantendo tipo e pilha', () => {
    const [excecao] = redigido.exception?.values ?? [];
    expect(excecao?.type).toBe('PrismaClientKnownRequestError');
    expect(excecao?.value).toBe(VALOR_REDIGIDO);
    expect(excecao?.stacktrace?.frames).toEqual([{ function: 'criar', filename: 'conta.ts' }]);
  });

  it('troca `message` e `logentry` por [REDIGIDO], sem os parâmetros (S31)', () => {
    expect(redigido.message).toBe(VALOR_REDIGIDO);
    expect(redigido.logentry).toEqual({ message: VALOR_REDIGIDO });
  });

  it('sem `message` nem `logentry`, não inventa nenhum', () => {
    const semMensagem = redigirEvento({ type: undefined });
    expect(semMensagem).not.toHaveProperty('message');
    expect(semMensagem).not.toHaveProperty('logentry');
  });

  it('passa extra, contexts e tags pelo redator dos logs', () => {
    expect(redigido.extra).toEqual({ email: VALOR_REDIGIDO, pedido: 'p1' });
    expect(redigido.contexts).toEqual({ conta: { telefone: VALOR_REDIGIDO, id: 'c1' } });
    expect(redigido.tags).toEqual({ cpf: VALOR_REDIGIDO, rota: 'contas' });
  });

  it('descarta breadcrumb do console e tira a query dos outros', () => {
    expect(redigido.breadcrumbs).toEqual([
      { category: 'http', data: { url: 'https://viacep.com.br/ws/1', status_code: 200 } },
    ]);
  });

  it('não sobra nenhum valor pessoal e o original fica intacto', () => {
    esperarSemProibidos(JSON.stringify(redigido));
    expect(evento.user?.ip_address).toBe('200.123.45.67');
  });

  it('sem usuário, não inventa um', () => {
    expect(
      redigirEvento({ type: undefined, user: { ip_address: '200.123.45.67' } }).user,
    ).toBeUndefined();
  });
});

describe('redigirBreadcrumb', () => {
  it('redige chaves sensíveis nos dados e tira a query da mensagem', () => {
    expect(
      redigirBreadcrumb({
        category: 'fetch',
        message: 'GET https://exemplo.com/x?token=abc',
        data: { url: '/x?token=abc', authorization: 'Bearer segredo-do-token' },
      }),
    ).toEqual({
      category: 'fetch',
      message: 'GET https://exemplo.com/x',
      data: { url: '/x', authorization: VALOR_REDIGIDO },
    });
  });
});

describe('InterceptadorDoSentry', () => {
  const contexto = {} as ExecutionContext;
  const falhando = (erro: unknown): CallHandler => ({ handle: () => throwError(() => erro) });

  it('envia a exceção inesperada e a devolve para o filtro', async () => {
    const capturadas: unknown[] = [];
    const erro = new Error('falha inesperada');
    const interceptador = new InterceptadorDoSentry((e) => capturadas.push(e));
    await expect(firstValueFrom(interceptador.intercept(contexto, falhando(erro)))).rejects.toBe(
      erro,
    );
    expect(capturadas).toEqual([erro]);
  });

  it('não envia erro esperado (validação, 404, 429...)', async () => {
    const capturadas: unknown[] = [];
    const interceptador = new InterceptadorDoSentry((e) => capturadas.push(e));
    const erro = new BadRequestException();
    await expect(firstValueFrom(interceptador.intercept(contexto, falhando(erro)))).rejects.toBe(
      erro,
    );
    expect(capturadas).toEqual([]);
  });
});

describe('Sentry ligado, com transport falso', () => {
  const enviados: string[] = [];
  const decodificador = new TextDecoder();

  afterAll(async () => {
    await Sentry.close(1_000);
  });

  it('o evento que sai do processo não leva dado pessoal, IP, cabeçalho nem query', async () => {
    const ligado = iniciarSentry(
      { SENTRY_DSN: DSN },
      {
        transport: (opcoes) =>
          Sentry.createTransport(opcoes, (requisicao) => {
            const corpo = requisicao.body;
            enviados.push(typeof corpo === 'string' ? corpo : decodificador.decode(corpo));
            return Promise.resolve({ statusCode: 200 });
          }),
      },
    );
    expect(ligado).toBe(true);

    Sentry.withIsolationScope((escopo) => {
      // O que a integração HTTP do SDK anexaria numa requisição real.
      escopo.setSDKProcessingMetadata({
        normalizedRequest: {
          method: 'POST',
          url: `https://api.bairrin.com.br/v1/contas?${QUERY}`,
          query_string: QUERY,
          headers: { authorization: TOKEN, cookie: COOKIE, 'x-forwarded-for': IP },
          cookies: { sessao: COOKIE },
          data: JSON.stringify({ senha: SENHA }),
        },
        ipAddress: IP,
      });
      escopo.setUser({ id: 'u1', email: EMAIL, ip_address: IP });
      escopo.setExtra('telefone', TELEFONE);
      Sentry.addBreadcrumb({ category: 'http', data: { url: `/x?${QUERY}` } });
      Sentry.captureException(new Error(`falhou para ${EMAIL}`));
    });
    await Sentry.flush(2_000);

    expect(enviados).toHaveLength(1);
    const envelope = enviados[0] ?? '';
    expect(envelope).toContain('"type":"Error"');
    expect(envelope).toContain('https://api.bairrin.com.br/v1/contas');
    esperarSemProibidos(envelope);
    // Envelope: cabeçalho, cabeçalho do item e o evento, um JSON por linha.
    const corpoDoEvento = JSON.parse(envelope.split('\n')[2] ?? '{}') as Sentry.ErrorEvent;
    expect(corpoDoEvento.user).toEqual({ id: 'u1' });
    expect(corpoDoEvento.request).toEqual({
      method: 'POST',
      url: 'https://api.bairrin.com.br/v1/contas',
    });
  });
});
