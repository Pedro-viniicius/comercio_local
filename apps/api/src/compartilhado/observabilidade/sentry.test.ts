import { createServer, type IncomingHttpHeaders, request as requisicaoHttp } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BadRequestException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { firstValueFrom, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VALOR_REDIGIDO } from '../log/redator.ts';
import {
  COLETA_DE_DADOS,
  iniciarSentry,
  InterceptadorDoSentry,
  opcoesDoSentry,
  redigirBreadcrumb,
  redigirEvento,
  soItensPermitidos,
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

/** Id pseudônimo do usuário (uuid), o único dado do usuário que pode sair. */
const ID_DO_USUARIO = 'b3f0c1e2-0000-4000-8000-000000000001';

/** Release que o SDK deduziria sozinho do ambiente do CI, se deixasse. */
const SHA_DO_CI = 'd52331f0000000000000000000000000000000aa';
const RELEASE_DO_AMBIENTE = 'release-solta-no-ambiente';

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
    expect(nomes).not.toContain('ProcessSession');
    expect(nomes).toEqual(
      expect.arrayContaining([
        'OnUncaughtException',
        'OnUnhandledRejection',
        'LinkedErrors',
        'Http',
      ]),
    );
  });

  it('sem release configurada, impede o SDK de deduzir uma do ambiente (GITHUB_SHA, CIs)', () => {
    expect(opcoes.release).toBe('');
    expect(opcoesDoSentry(DSN, { release: 'release-de-teste' }).release).toBe('release-de-teste');
  });

  it('não liga tracing', () => {
    expect(opcoes.tracesSampleRate).toBeUndefined();
    expect(opcoes.tracesSampler).toBeUndefined();
  });

  it('não põe sentry-trace nem baggage em requisição de saída nenhuma (S60)', () => {
    expect(opcoes.tracePropagationTargets).toEqual([]);
    expect(opcoes.propagateTraceparent).toBeUndefined();
  });

  it('desliga Spotlight e debug de forma explícita, sem deixar o SDK ler do ambiente (S61)', () => {
    expect(opcoes.spotlight).toBe(false);
    expect(opcoes.debug).toBe(false);
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

  it.each([
    ['e-mail', 'fulano@exemplo.com'],
    ['telefone', '35999990000'],
    ['número', 42],
    ['uuid com sobra', 'b3f0c1e2-0000-4000-8000-000000000001 fulano'],
  ])('descarta o usuário cujo id não é uuid (%s), S62', (_forma, id) => {
    expect(
      redigirEvento({ type: undefined, user: { id, ip_address: '200.123.45.67' } }).user,
    ).toBeUndefined();
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

describe('soItensPermitidos (transport das opções do SDK)', () => {
  type Fabrica = Parameters<typeof soItensPermitidos>[0];
  type Envelope = Parameters<ReturnType<Fabrica>['send']>[0];

  function transportQueGuarda(): { enviados: Envelope[]; transport: ReturnType<Fabrica> } {
    const enviados: Envelope[] = [];
    const fabrica: Fabrica = () => ({
      send: (envelope) => {
        enviados.push(envelope);
        return Promise.resolve({ statusCode: 200 });
      },
      flush: () => Promise.resolve(true),
    });
    // Pelas opções do SDK: prova também que o `init` usa o filtro.
    const fabricaDoSdk = opcoesDoSentry(DSN, { transport: fabrica }).transport;
    if (fabricaDoSdk === undefined) throw new Error('as opções deveriam ter um transport');
    const transport = fabricaDoSdk({ url: DSN, recordDroppedEvent: () => undefined });
    return { enviados, transport };
  }

  function envelopeCom(...tipos: string[]): Envelope {
    return [{ sent_at: 'agora' }, tipos.map((type) => [{ type }, { de: type }])] as Envelope;
  }

  it('deixa sair o evento e o relatório do cliente e retém sessão, log, transação e o resto', async () => {
    const { enviados, transport } = transportQueGuarda();
    await transport.send(
      envelopeCom('session', 'event', 'sessions', 'attachment', 'transaction', 'log', 'check_in'),
    );
    await transport.send(envelopeCom('client_report', 'tipo_novo_do_sdk'));
    expect(enviados).toEqual([envelopeCom('event'), envelopeCom('client_report')]);
  });

  it('não envia o envelope que fica vazio', async () => {
    const { enviados, transport } = transportQueGuarda();
    await expect(transport.send(envelopeCom('session'))).resolves.toEqual({});
    expect(enviados).toEqual([]);
    await expect(transport.flush(10)).resolves.toBe(true);
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

  beforeEach(() => {
    enviados.length = 0;
  });

  afterEach(async () => {
    await Sentry.close(1_000);
    vi.unstubAllEnvs();
  });

  /** Liga o SDK com um transport que guarda cada envelope que sairia do processo. */
  function ligarComTransportFalso(release?: string): void {
    const ligado = iniciarSentry(
      { SENTRY_DSN: DSN, SENTRY_RELEASE: release },
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
  }

  /**
   * Sessões que o SDK chegou a montar para envio, antes do transport. Prova que
   * o release health está desligado na origem, não só retido pelo transport.
   */
  function sessoesMontadas(): unknown[] {
    const sessoes: unknown[] = [];
    Sentry.getClient()?.on('beforeSendSession', (sessao) => sessoes.push(sessao));
    return sessoes;
  }

  /** Itens de um envelope: cabeçalho do envelope e, depois, pares (cabeçalho do item, carga). */
  function itensDoEnvelope(envelope: string): { tipo: string; carga: unknown }[] {
    const linhas = envelope.split('\n').filter((linha) => linha !== '');
    const itens: { tipo: string; carga: unknown }[] = [];
    for (let i = 1; i + 1 < linhas.length; i += 2) {
      const { type } = JSON.parse(linhas[i] ?? '{}') as { type: string };
      itens.push({ tipo: type, carga: JSON.parse(linhas[i + 1] ?? 'null') });
    }
    return itens;
  }

  /** Captura uma exceção com tudo o que o SDK poderia anexar de dado pessoal. */
  function capturarExcecaoComDadoPessoal(): void {
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
      escopo.setUser({ id: ID_DO_USUARIO, email: EMAIL, ip_address: IP });
      escopo.setExtra('telefone', TELEFONE);
      Sentry.addBreadcrumb({ category: 'http', data: { url: `/x?${QUERY}` } });
      Sentry.captureException(new Error(`falhou para ${EMAIL}`));
    });
  }

  /**
   * O SDK pode mandar, além do evento, outros envelopes (sessão de release health,
   * client report...) conforme o ambiente. A regra vale para todos, e o envelope do
   * evento é achado pelo tipo do item, não pela posição nem pela contagem.
   */
  function conferirEnvelopes(): void {
    expect(enviados.length).toBeGreaterThan(0);
    for (const envelope of enviados) esperarSemProibidos(envelope);

    const eventos = enviados
      .flatMap(itensDoEnvelope)
      .filter((item) => item.tipo === 'event')
      .map((item) => item.carga as Sentry.ErrorEvent);
    expect(eventos).toHaveLength(1);
    const evento = eventos[0];
    expect(evento?.exception?.values?.[0]?.type).toBe('Error');
    expect(evento?.user).toEqual({ id: ID_DO_USUARIO });
    expect(evento?.request).toEqual({
      method: 'POST',
      url: 'https://api.bairrin.com.br/v1/contas',
    });
  }

  it('nenhum envelope que sai do processo leva dado pessoal, IP, cabeçalho nem query', async () => {
    ligarComTransportFalso();
    capturarExcecaoComDadoPessoal();
    await Sentry.flush(2_000);

    conferirEnvelopes();
  });

  it('com release configurada, nenhuma sessão é montada nem enviada', async () => {
    // Com release, o SDK abriria uma sessão de release health e a enviaria num envelope à
    // parte, sem passar pelo `beforeSend`, com o usuário (id ou e-mail) e o IP (Q12).
    ligarComTransportFalso('release-de-teste');
    const sessoes = sessoesMontadas();
    capturarExcecaoComDadoPessoal();
    await Sentry.flush(2_000);

    conferirEnvelopes();
    expect(sessoes).toEqual([]);
  });

  it('sessão de usuário só com e-mail não usa o e-mail como identificador do usuário', async () => {
    ligarComTransportFalso('release-de-teste');
    const sessoes = sessoesMontadas();
    Sentry.withIsolationScope((escopo) => {
      escopo.setUser({ email: EMAIL });
      Sentry.captureException(new Error('falha'));
    });
    await Sentry.flush(2_000);

    expect(sessoes).toEqual([]);
    expect(enviados.length).toBeGreaterThan(0);
    for (const envelope of enviados) expect(envelope).not.toContain(EMAIL);
  });

  it('a release vem só da configuração: GITHUB_SHA e SENTRY_RELEASE soltos no ambiente não entram', async () => {
    vi.stubEnv('GITHUB_SHA', SHA_DO_CI);
    vi.stubEnv('SENTRY_RELEASE', RELEASE_DO_AMBIENTE);
    ligarComTransportFalso();
    capturarExcecaoComDadoPessoal();
    await Sentry.flush(2_000);

    conferirEnvelopes();
    for (const envelope of enviados) {
      expect(envelope).not.toContain(SHA_DO_CI);
      expect(envelope).not.toContain(RELEASE_DO_AMBIENTE);
    }
    const [evento] = enviados.flatMap(itensDoEnvelope).filter((item) => item.tipo === 'event');
    expect(evento?.carga).not.toHaveProperty('release');
    // Nem a release vazia usada para barrar a dedução aparece no `trace` do cabeçalho.
    for (const envelope of enviados) {
      const cabecalho = JSON.parse(envelope.split('\n')[0] ?? '{}') as { trace?: object };
      expect(cabecalho.trace ?? {}).not.toHaveProperty('release');
    }
  });

  it('com release configurada, o evento a leva e só saem evento e relatório do cliente', async () => {
    ligarComTransportFalso('release-de-teste');
    const sessoes = sessoesMontadas();
    capturarExcecaoComDadoPessoal();
    await Sentry.flush(2_000);

    conferirEnvelopes();
    expect(sessoes).toEqual([]);
    const itens = enviados.flatMap(itensDoEnvelope);
    for (const { tipo } of itens) expect(['event', 'client_report']).toContain(tipo);
    const [evento] = itens.filter((item) => item.tipo === 'event');
    expect(evento?.carga).toMatchObject({ release: 'release-de-teste' });
  });

  it('SENTRY_SPOTLIGHT e SENTRY_DEBUG no ambiente não ligam o Spotlight nem o debug: nada sai fora do transport (S61)', async () => {
    // Sidecar do Spotlight de mentira: o Spotlight mandaria cada envelope para ele pelo
    // `beforeEnvelope`, antes do filtro do transport.
    const recebidosPeloSidecar: string[] = [];
    let avisarChegada: () => void = () => undefined;
    const chegouAlgo = new Promise<void>((chegou) => (avisarChegada = chegou));
    const sidecar = createServer((requisicao, resposta) => {
      recebidosPeloSidecar.push(requisicao.url ?? '');
      avisarChegada();
      resposta.end();
    });
    await new Promise<void>((pronto) => sidecar.listen(0, '127.0.0.1', pronto));
    const { port } = sidecar.address() as AddressInfo;
    try {
      vi.stubEnv('SENTRY_SPOTLIGHT', `http://127.0.0.1:${port}/stream`);
      vi.stubEnv('SENTRY_DEBUG', 'true');
      ligarComTransportFalso('release-de-teste');
      expect(Sentry.getClient()?.getIntegrationByName('Spotlight')).toBeUndefined();
      expect(Sentry.getClient()?.getOptions()).toMatchObject({ spotlight: false, debug: false });
      capturarExcecaoComDadoPessoal();
      await Sentry.flush(2_000);
      // O envio ao sidecar é assíncrono e não entra no `flush`: espera um pouco por ele.
      await Promise.race([chegouAlgo, new Promise((prazo) => setTimeout(prazo, 500))]);
    } finally {
      sidecar.closeAllConnections();
      await new Promise((fechado) => sidecar.close(fechado));
    }

    conferirEnvelopes();
    expect(recebidosPeloSidecar).toEqual([]);
  });

  it('numa requisição HTTP real (integração Http do SDK), não há sessão, dado pessoal nem cabeçalho de trace', async () => {
    // Todo `init` deste arquivo passa por `opcoesDoSentry` (via `iniciarSentry`): a
    // instrumentação HTTP do SDK é instalada uma vez por processo, com as opções do
    // primeiro `init`. Um `Sentry.init` com outras opções em qualquer teste daqui mudaria
    // o que este teste prova.
    ligarComTransportFalso('release-de-teste');
    const sessoes = sessoesMontadas();
    const cabecalhosRecebidos: IncomingHttpHeaders[] = [];
    const servidor = createServer((requisicao, resposta) => {
      cabecalhosRecebidos.push(requisicao.headers);
      if (requisicao.method === 'POST') {
        Sentry.setUser({ id: ID_DO_USUARIO, email: EMAIL, ip_address: IP });
        Sentry.captureException(new Error('falha na rota'));
        resposta.statusCode = 500;
      }
      resposta.end();
    });
    await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
    const { port } = servidor.address() as AddressInfo;
    try {
      // Requisição de saída pelo `fetch` (undici) ...
      await fetch(`http://127.0.0.1:${port}/v1/contas?${QUERY}`, {
        method: 'POST',
        headers: { authorization: TOKEN, cookie: COOKIE, 'x-forwarded-for': IP },
        body: JSON.stringify({ senha: SENHA }),
      });
      // ... e pelo `node:http`: o SDK instrumenta os dois por caminhos diferentes (S60).
      await new Promise<void>((pronto, falhou) => {
        requisicaoHttp(`http://127.0.0.1:${port}/saida`, (resposta) => {
          resposta.resume();
          resposta.on('end', pronto);
        })
          .on('error', falhou)
          .end();
      });
    } finally {
      await new Promise((fechado) => servidor.close(fechado));
    }
    await Sentry.flush(2_000);

    // Sem `sentry-trace` nem `baggage`: levariam a chave pública do DSN, a release e o
    // ambiente a quem recebe a requisição (S60).
    expect(cabecalhosRecebidos).toHaveLength(2);
    for (const cabecalhos of cabecalhosRecebidos) {
      expect(cabecalhos).not.toHaveProperty('sentry-trace');
      expect(cabecalhos).not.toHaveProperty('baggage');
      expect(cabecalhos).not.toHaveProperty('traceparent');
    }
    expect(sessoes).toEqual([]);
    expect(enviados.length).toBeGreaterThan(0);
    for (const envelope of enviados) esperarSemProibidos(envelope);
    const eventos = enviados
      .flatMap(itensDoEnvelope)
      .filter((item) => item.tipo === 'event')
      .map((item) => item.carga as Sentry.ErrorEvent);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.user).toEqual({ id: ID_DO_USUARIO });
    expect(eventos[0]?.request).toEqual({
      method: 'POST',
      url: `http://127.0.0.1:${port}/v1/contas`,
    });
  });
});
