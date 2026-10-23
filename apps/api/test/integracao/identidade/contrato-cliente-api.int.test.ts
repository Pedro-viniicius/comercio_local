// Contrato entre o `cliente-api` (o que apps e painel mandam) e a API (o que ela aceita),
// ponta a ponta (plano 01b, etapa 16; revisão do `qa`): a API sobe de verdade numa porta, e o
// `criarClienteAutenticado` do pacote `@bairrin/cliente-api` fala com ela por um `fetch` que
// imita o navegador do painel: guarda e devolve cookies (com `Path`, `Max-Age` e `Secure`),
// manda `Origin`, faz a pré-verificação do CORS antes de cabeçalho não simples e recusa a
// resposta sem `Access-Control-Allow-Origin` e `Access-Control-Allow-Credentials`, como o
// navegador recusaria (`TypeError`). Prova: login do painel (desafio + TOTP), cookie
// de renovação, renovação silenciosa em 401, logout pelo cookie, `X-Cliente`, corpo de erro
// (`ErroDeApi` com `codigo` e `campos`) e os apps (token no corpo, `cliente` na renovação).
//
// O pacote é importado pelo caminho do código-fonte: a API não o declara como dependência
// (só o `@bairrin/contratos`), e este é o único teste que precisa dele.
import { Controller, Get } from '@nestjs/common';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type ArmazenamentoDeRevogacao,
  type ArmazenamentoDeSessao,
  criarClienteApi,
  criarClienteAutenticado,
  ErroDeApi,
  type FetchInjetavel,
  type PedidoMinimo,
  type RespostaMinima,
  type RevogacaoPendente,
} from '../../../../../packages/cliente-api/src/index.ts';
import {
  desafioDeSegundoFatorSchema,
  entrarSchema,
  respostaDeEntrarSchema,
  sessaoSchema,
  type Sessao,
  z,
} from '@bairrin/contratos';
import type { ContaAutenticada } from '../../../src/compartilhado/autenticacao/verificador-de-acesso.ts';
import { ContaAtual } from '../../../src/compartilhado/http/autenticacao/conta-atual.decorator.ts';
import { ExigeMfa } from '../../../src/compartilhado/http/autenticacao/exige-mfa.guard.ts';
import { Perfis } from '../../../src/compartilhado/http/autenticacao/perfis.guard.ts';
import { COOKIE_DE_RENOVACAO } from '../../../src/modulos/identidade/http/sessao-no-http.ts';
import { type ApiDeTeste, ipNovo, ORIGEM_DO_PAINEL, subirApi } from './api-http.ts';
import {
  apagarContasDoTeste,
  cadastrar,
  type ContaDeTeste,
  conectarDono,
  type DocumentosDeTeste,
  montarPilha,
  OUTRA_SENHA,
  type Pilha,
  prepararAdmin,
  semearDocumentos,
  sessoesDaConta,
  sessoesVivas,
  T0,
  totpDe,
  UM_MINUTO,
} from './pilha-de-casos-de-uso.ts';

@Perfis('admin')
@ExigeMfa()
@Controller('v1/admin/qa-contrato')
class RotaDeAdminDoContrato {
  @Get()
  ver(@ContaAtual() conta: ContaAutenticada) {
    return { contaId: conta.contaId };
  }
}

@Controller('v1/qa-contrato')
class RotaAutenticadaDoContrato {
  @Get()
  ver(@ContaAtual() conta: ContaAutenticada) {
    return { contaId: conta.contaId };
  }
}

const respostaDaRota = z.object({ contaId: z.string() });

let p: Pilha;
let dono: pg.Client;
let docs: DocumentosDeTeste;
let api: ApiDeTeste;
let baseUrl = '';
const contasDoTeste: string[] = [];
const freiosDoTeste: string[] = [];

beforeAll(async () => {
  p = montarPilha();
  dono = await conectarDono();
  docs = await semearDocumentos(dono);
  api = await subirApi({ controllers: [RotaDeAdminDoContrato, RotaAutenticadaDoContrato] });
  await api.app.listen(0, '127.0.0.1');
  baseUrl = (await api.app.getUrl()).replace('[::1]', '127.0.0.1');
});

beforeEach(() => {
  api.relogio.definir(T0);
});

afterAll(async () => {
  await api?.fechar();
  if (dono !== undefined) {
    await apagarContasDoTeste(dono, contasDoTeste, freiosDoTeste);
    await docs?.remover();
    await dono.end();
  }
  await p?.prisma.$disconnect();
});

function anotar(conta: { id: string; email: string }): void {
  contasDoTeste.push(conta.id);
  freiosDoTeste.push(
    p.servicos.cifrador.hmac('bloqueio_email', [conta.email]),
    p.servicos.cifrador.hmac('bloqueio_segundo_fator', [conta.id]),
  );
}

async function novaConta(): Promise<ContaDeTeste> {
  const conta = await cadastrar(p, docs);
  anotar(conta);
  return conta;
}

// ---------------------------------------------------------------------------
// O navegador do painel, em código: cookies, `Origin` e CORS.

interface CookieGuardado {
  valor: string;
  caminho: string;
  secure: boolean;
}

class Navegador {
  readonly cookies = new Map<string, CookieGuardado>();
  /** Cada requisição (depois da pré-verificação), na ordem: para conferir o que viajou. */
  readonly enviadas: { metodo: string; caminho: string; cabecalhos: Record<string, string> }[] = [];
  readonly preVerificacoes: { metodo: string; cabecalhos: string }[] = [];
  readonly #ip: string;

  constructor(
    readonly origem: string,
    ip: string,
  ) {
    this.#ip = ip;
  }

  readonly buscar: FetchInjetavel = async (url: string, pedido: PedidoMinimo) => {
    const alvo = new URL(url);
    const metodo = pedido.method.toUpperCase();
    const cabecalhos: Record<string, string> = { ...pedido.headers };
    const naoSimples = Object.keys(cabecalhos)
      .map((nome) => nome.toLowerCase())
      .filter((nome) => {
        if (nome === 'content-type') {
          return !/^(application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)/.test(
            (cabecalhos['Content-Type'] ?? '').toLowerCase(),
          );
        }
        return !['accept', 'accept-language', 'content-language'].includes(nome);
      })
      .sort();

    // Pré-verificação do CORS: o navegador a faz para método ou cabeçalho não simples.
    if (metodo !== 'GET' || naoSimples.length > 0) {
      this.preVerificacoes.push({ metodo, cabecalhos: naoSimples.join(',') });
      const pre = await fetch(url, {
        method: 'OPTIONS',
        headers: {
          Origin: this.origem,
          'Access-Control-Request-Method': metodo,
          'Access-Control-Request-Headers': naoSimples.join(','),
          'X-Forwarded-For': this.#ip,
        },
      });
      const permitidos = (pre.headers.get('access-control-allow-headers') ?? '')
        .toLowerCase()
        .split(',')
        .map((nome) => nome.trim());
      const metodos = (pre.headers.get('access-control-allow-methods') ?? '')
        .toUpperCase()
        .split(',')
        .map((nome) => nome.trim());
      if (
        !pre.ok ||
        pre.headers.get('access-control-allow-origin') !== this.origem ||
        pre.headers.get('access-control-allow-credentials') !== 'true' ||
        !metodos.includes(metodo) ||
        !naoSimples.every((nome) => permitidos.includes(nome))
      ) {
        throw new TypeError('Failed to fetch (CORS: pré-verificação recusada)');
      }
    }

    // `credentials: 'include'` do painel: manda os cookies cujo `Path` casa.
    const cookie = [...this.cookies.entries()]
      .filter(([, c]) => alvo.pathname === c.caminho || alvo.pathname.startsWith(`${c.caminho}/`))
      .map(([nome, c]) => `${nome}=${c.valor}`)
      .join('; ');
    const enviados: Record<string, string> = {
      ...cabecalhos,
      Origin: this.origem,
      'X-Forwarded-For': this.#ip,
      ...(cookie === '' ? {} : { Cookie: cookie }),
    };
    this.enviadas.push({ metodo, caminho: alvo.pathname, cabecalhos: enviados });
    const resposta = await fetch(url, {
      method: metodo,
      headers: enviados,
      ...(pedido.body === undefined ? {} : { body: pedido.body }),
    });

    // Resposta entre origens com credenciais: o navegador exige as duas marcas.
    if (
      resposta.headers.get('access-control-allow-origin') !== this.origem ||
      resposta.headers.get('access-control-allow-credentials') !== 'true'
    ) {
      throw new TypeError('Failed to fetch (CORS: resposta sem permissão para a origem)');
    }
    this.#guardarCookies(resposta.headers.getSetCookie());
    const corpo = await resposta.text();
    const minima: RespostaMinima = {
      status: resposta.status,
      ok: resposta.ok,
      text: () => Promise.resolve(corpo),
    };
    return minima;
  };

  #guardarCookies(linhas: string[]): void {
    for (const linha of linhas) {
      const [par = '', ...atributos] = linha.split(';').map((parte) => parte.trim());
      const igual = par.indexOf('=');
      const nome = par.slice(0, igual);
      const valor = par.slice(igual + 1);
      let caminho = '/';
      let secure = false;
      let apagar = valor === '';
      for (const atributo of atributos) {
        const [chave = '', v = ''] = atributo.split('=');
        const k = chave.toLowerCase();
        if (k === 'path') caminho = v;
        if (k === 'secure') secure = true;
        if (k === 'max-age' && Number(v) <= 0) apagar = true;
        if (k === 'expires' && new Date(v).getTime() <= Date.now()) apagar = true;
      }
      if (apagar) this.cookies.delete(nome);
      else this.cookies.set(nome, { valor: decodeURIComponent(valor), caminho, secure });
    }
  }
}

function armazenamentoDeSessaoEmMemoria(): ArmazenamentoDeSessao & { atual: Sessao | null } {
  const estado: { atual: Sessao | null } = { atual: null };
  return {
    get atual() {
      return estado.atual;
    },
    ler: () => Promise.resolve(estado.atual),
    gravar: (sessao) => {
      estado.atual = sessao;
      return Promise.resolve();
    },
    limpar: () => {
      estado.atual = null;
      return Promise.resolve();
    },
  };
}

function revogacaoEmMemoria(): ArmazenamentoDeRevogacao {
  let pendente: RevogacaoPendente | null = null;
  return {
    ler: () => Promise.resolve(pendente),
    gravar: (valor) => {
      pendente = valor;
      return Promise.resolve();
    },
    limpar: () => {
      pendente = null;
      return Promise.resolve();
    },
  };
}

function montarPainel(origem = ORIGEM_DO_PAINEL) {
  const navegador = new Navegador(origem, ipNovo(p, freiosDoTeste));
  const base = criarClienteApi({ baseUrl, fetch: navegador.buscar });
  const armazenamento = armazenamentoDeSessaoEmMemoria();
  const encerradas: string[] = [];
  const falhas: string[] = [];
  const autenticado = criarClienteAutenticado({
    cliente: base,
    armazenamento,
    revogacaoPendente: revogacaoEmMemoria(),
    modoDeRenovacao: 'cookie',
    aoEncerrarSessao: (motivo) => encerradas.push(motivo),
    aoFalharEmSegundoPlano: (falha) => falhas.push(falha.origem),
  });
  return { navegador, base, armazenamento, autenticado, encerradas, falhas };
}

function montarApp(clienteDoApp: 'app_consumidor' | 'app_lojista') {
  // Os apps nativos não têm CORS nem cookie nem `Origin`: `fetch` direto, só com o IP de teste.
  const ip = ipNovo(p, freiosDoTeste);
  const enviadas: { metodo: string; caminho: string; cabecalhos: Record<string, string> }[] = [];
  const buscar: FetchInjetavel = async (url, pedido) => {
    enviadas.push({
      metodo: pedido.method,
      caminho: new URL(url).pathname,
      cabecalhos: { ...pedido.headers },
    });
    const resposta = await fetch(url, {
      method: pedido.method,
      headers: { ...pedido.headers, 'X-Forwarded-For': ip },
      ...(pedido.body === undefined ? {} : { body: pedido.body }),
    });
    const corpo = await resposta.text();
    return { status: resposta.status, ok: resposta.ok, text: () => Promise.resolve(corpo) };
  };
  const base = criarClienteApi({ baseUrl, fetch: buscar });
  const armazenamento = armazenamentoDeSessaoEmMemoria();
  const autenticado = criarClienteAutenticado({
    cliente: base,
    armazenamento,
    revogacaoPendente: revogacaoEmMemoria(),
    modoDeRenovacao: 'token',
    clienteDoApp,
  });
  return { base, armazenamento, autenticado, enviadas };
}

/** `POST /v1/sessoes`, como as telas fazem (corpo conferido pelo contrato do cliente). */
function entrarPeloCliente(
  base: ReturnType<typeof criarClienteApi>,
  corpo: { email: string; senha: string; cliente: 'painel' | 'app_consumidor' | 'app_lojista' },
) {
  return base.requisitar({
    metodo: 'POST',
    caminho: '/v1/sessoes',
    corpo: entrarSchema.parse(corpo),
    esquema: respostaDeEntrarSchema,
  });
}

// ---------------------------------------------------------------------------

describe('contrato cliente-api <-> API: painel (cookie, X-Cliente, Origin, CORS)', () => {
  it('login do painel (senha + TOTP), cookie gravado com o Path certo, rota de admin, renovação silenciosa em 401 e logout pelo cookie', async () => {
    const admin = await prepararAdmin(p, docs, ipNovo(p, freiosDoTeste));
    anotar(admin.conta);
    const painel = montarPainel();

    // O código do TOTP da confirmação (T0) já foi gasto: o próximo passo de 30 s é outro.
    api.relogio.avancar(31_000);
    // 1. Senha: a API devolve o desafio (e nunca sessão nem cookie antes do segundo fator).
    const desafio = desafioDeSegundoFatorSchema.parse(
      await entrarPeloCliente(painel.base, {
        email: admin.conta.email,
        senha: admin.conta.senha,
        cliente: 'painel',
      }),
    );
    expect(desafio.etapa).toBe('verificar');
    expect(painel.navegador.cookies.size).toBe(0);

    // 2. Segundo fator: sessão no corpo SEM `tokenRenovacao`; o cookie fica no navegador.
    const sessao = await painel.base.requisitar({
      metodo: 'POST',
      caminho: '/v1/sessoes/segundo-fator',
      corpo: { desafio: desafio.desafio, codigo: totpDe(admin.segredo, api.relogio.agora()) },
      esquema: sessaoSchema,
    });
    expect(sessao.tokenRenovacao).toBeUndefined();
    const cookie = painel.navegador.cookies.get(COOKIE_DE_RENOVACAO);
    expect(cookie).toMatchObject({ caminho: '/v1/sessoes/renovacao', secure: true });
    await painel.autenticado.iniciarSessao(sessao);

    // 3. Rota de admin com o Bearer do cliente.
    const dadosDaConta = await painel.autenticado.requisitar({
      caminho: '/v1/admin/qa-contrato',
      esquema: respostaDaRota,
    });
    expect(dadosDaConta.contaId).toBe(admin.conta.id);
    // O cookie só viaja na renovação e no logout, nunca nas outras rotas (Path).
    const adminEnviada = painel.navegador.enviadas.find(
      (e) => e.caminho === '/v1/admin/qa-contrato',
    );
    expect(adminEnviada?.cabecalhos['Cookie']).toBeUndefined();
    expect(adminEnviada?.cabecalhos['Authorization']).toMatch(/^Bearer /);

    // 4. O token de acesso vence (15 min): o 401 da guarda faz o cliente renovar pelo cookie e repetir.
    api.relogio.avancar(16 * UM_MINUTO);
    const depois = await painel.autenticado.requisitar({
      caminho: '/v1/admin/qa-contrato',
      esquema: respostaDaRota,
    });
    expect(depois.contaId).toBe(admin.conta.id);
    const renovacao = painel.navegador.enviadas.find(
      (e) => e.metodo === 'POST' && e.caminho === '/v1/sessoes/renovacao',
    );
    expect(renovacao?.cabecalhos['X-Cliente']).toBe('painel');
    expect(renovacao?.cabecalhos['Origin']).toBe(ORIGEM_DO_PAINEL);
    expect(renovacao?.cabecalhos['Cookie']).toContain(`${COOKIE_DE_RENOVACAO}=`);
    // O cookie foi trocado (rotação), e o antigo não renova mais fora da tolerância.
    expect(painel.navegador.cookies.get(COOKIE_DE_RENOVACAO)?.valor).not.toBe(cookie?.valor);

    // 5. Logout: DELETE /v1/sessoes/renovacao só com cookie, X-Cliente e Origin.
    const resultado = await painel.autenticado.encerrarSessao();
    expect(resultado.revogadaNoServidor).toBe(true);
    const logout = painel.navegador.enviadas.find((e) => e.metodo === 'DELETE');
    expect(logout?.caminho).toBe('/v1/sessoes/renovacao');
    expect(logout?.cabecalhos['X-Cliente']).toBe('painel');
    expect(painel.navegador.cookies.has(COOKIE_DE_RENOVACAO)).toBe(false);
    // A sessão da preparação do teste segue viva; a do cookie, a mais nova, foi revogada.
    expect(await sessoesVivas(dono, admin.conta.id)).toBe(1);
    const linhas = await sessoesDaConta(dono, admin.conta.id);
    expect(linhas.at(-1)?.revogada_em).not.toBeNull();
    expect(linhas.at(-1)?.motivo_revogacao).toBe('logout');
    expect(await painel.autenticado.renovarSessao()).toBeNull();
    expect(painel.falhas).toEqual([]);
  });

  it('as pré-verificações do CORS aceitam X-Cliente, Authorization, Content-Type e os métodos POST e DELETE', async () => {
    const admin = await prepararAdmin(p, docs, ipNovo(p, freiosDoTeste));
    anotar(admin.conta);
    const painel = montarPainel();
    api.relogio.avancar(31_000);
    const desafio = desafioDeSegundoFatorSchema.parse(
      await entrarPeloCliente(painel.base, {
        email: admin.conta.email,
        senha: admin.conta.senha,
        cliente: 'painel',
      }),
    );
    await painel.base.requisitar({
      metodo: 'POST',
      caminho: '/v1/sessoes/segundo-fator',
      corpo: { desafio: desafio.desafio, codigo: totpDe(admin.segredo, api.relogio.agora()) },
      esquema: sessaoSchema,
    });
    const sessao = await painel.autenticado.renovarSessao();
    expect(sessao).not.toBeNull();
    await painel.autenticado.encerrarSessao();
    const pre = painel.navegador.preVerificacoes;
    expect(pre.some((x) => x.metodo === 'POST' && x.cabecalhos.includes('x-cliente'))).toBe(true);
    expect(pre.some((x) => x.metodo === 'DELETE' && x.cabecalhos.includes('x-cliente'))).toBe(true);
    // Só cabeçalhos que a API libera: nada além desses três pede pré-verificação.
    const nomes = new Set(pre.flatMap((x) => x.cabecalhos.split(',').filter((n) => n !== '')));
    expect(
      [...nomes].every((n) => ['content-type', 'authorization', 'x-cliente'].includes(n)),
    ).toBe(true);
  });

  it('painel servido de uma origem fora de CORS_ORIGENS: o navegador bloquearia (pré-verificação recusada), e nada chega à API', async () => {
    const conta = await novaConta();
    const painel = montarPainel('https://malicioso.example');
    await expect(
      entrarPeloCliente(painel.base, {
        email: conta.email,
        senha: conta.senha,
        cliente: 'painel',
      }),
    ).rejects.toMatchObject({ tipo: 'sem_conexao' });
    expect(await sessoesDaConta(dono, conta.id)).toEqual([]);
  });

  it('erro da API chega ao cliente como `ErroDeApi` com status, `codigo` e `campos` (400, 401 e 429)', async () => {
    const conta = await novaConta();
    const painel = montarPainel();

    // 400: senha curta no cadastro, validada pela API (o cliente não valida o corpo aqui).
    const erro400 = await painel.base
      .requisitar({
        metodo: 'POST',
        caminho: '/v1/senha/redefinicao',
        corpo: { email: conta.email, codigo: 'x', novaSenha: 'curta', extra: 1 },
        esquema: z.unknown(),
      })
      .catch((e: unknown) => e);
    expect(erro400).toBeInstanceOf(ErroDeApi);
    const e400 = erro400 as ErroDeApi;
    expect(e400.status).toBe(400);
    expect(e400.codigo).toBe('validacao');
    expect(e400.campos.map((c) => c.campo).sort()).toEqual(['codigo', 'extra', 'novaSenha']);

    // 401: senha errada.
    const erro401 = await entrarPeloCliente(painel.base, {
      email: conta.email,
      senha: OUTRA_SENHA,
      cliente: 'app_consumidor',
    }).catch((e: unknown) => e);
    expect(erro401).toBeInstanceOf(ErroDeApi);
    expect((erro401 as ErroDeApi).status).toBe(401);
    expect((erro401 as ErroDeApi).codigo).toBe('nao_autenticado');

    // 429: o freio depois de cinco falhas.
    for (let i = 0; i < 4; i += 1) {
      await entrarPeloCliente(painel.base, {
        email: conta.email,
        senha: OUTRA_SENHA,
        cliente: 'app_consumidor',
      }).catch(() => undefined);
    }
    const erro429 = await entrarPeloCliente(painel.base, {
      email: conta.email,
      senha: conta.senha,
      cliente: 'app_consumidor',
    }).catch((e: unknown) => e);
    expect(erro429).toBeInstanceOf(ErroDeApi);
    expect((erro429 as ErroDeApi).status).toBe(429);
    expect((erro429 as ErroDeApi).codigo).toBe('limite_excedido');
  });

  it('renovação do painel recusada (cookie de outra sessão já revogada): o cliente encerra a sessão com `renovacao_recusada`', async () => {
    const admin = await prepararAdmin(p, docs, ipNovo(p, freiosDoTeste));
    anotar(admin.conta);
    const painel = montarPainel();
    api.relogio.avancar(31_000);
    const desafio = desafioDeSegundoFatorSchema.parse(
      await entrarPeloCliente(painel.base, {
        email: admin.conta.email,
        senha: admin.conta.senha,
        cliente: 'painel',
      }),
    );
    const sessao = await painel.base.requisitar({
      metodo: 'POST',
      caminho: '/v1/sessoes/segundo-fator',
      corpo: { desafio: desafio.desafio, codigo: totpDe(admin.segredo, api.relogio.agora()) },
      esquema: sessaoSchema,
    });
    await painel.autenticado.iniciarSessao(sessao);
    // A sessão é revogada no servidor (redefinição de senha, por exemplo).
    await dono.query(
      "UPDATE identidade.sessoes SET revogada_em = now(), motivo_revogacao = 'logout' WHERE conta_id = $1::uuid",
      [admin.conta.id],
    );
    api.relogio.avancar(16 * UM_MINUTO);
    await expect(
      painel.autenticado.requisitar({ caminho: '/v1/admin/qa-contrato', esquema: respostaDaRota }),
    ).rejects.toMatchObject({ tipo: 'api', status: 401 });
    expect(painel.encerradas).toEqual(['renovacao_recusada']);
  });
});

describe('contrato cliente-api <-> API: apps (token no corpo, `cliente` na renovação)', () => {
  it.each(['app_consumidor', 'app_lojista'] as const)(
    'login, rota autenticada, renovação em 401 com `cliente` no corpo e logout pelo Bearer (%s)',
    async (clienteDoApp) => {
      const conta = await novaConta();
      const app = montarApp(clienteDoApp);
      const sessao = sessaoSchema.parse(
        await entrarPeloCliente(app.base, {
          email: conta.email,
          senha: conta.senha,
          cliente: clienteDoApp,
        }),
      );
      expect(sessao.tokenRenovacao).toBeTruthy();
      await app.autenticado.iniciarSessao(sessao);

      const lida = await app.autenticado.requisitar({
        caminho: '/v1/qa-contrato',
        esquema: respostaDaRota,
      });
      expect(lida.contaId).toBe(conta.id);

      api.relogio.avancar(16 * UM_MINUTO);
      const depois = await app.autenticado.requisitar({
        caminho: '/v1/qa-contrato',
        esquema: respostaDaRota,
      });
      expect(depois.contaId).toBe(conta.id);
      const renovacao = app.enviadas.find((e) => e.caminho === '/v1/sessoes/renovacao');
      expect(renovacao).toBeDefined();
      // O token do app não vai por cookie nem com `X-Cliente: painel`.
      expect(renovacao?.cabecalhos['Cookie']).toBeUndefined();
      expect(renovacao?.cabecalhos['X-Cliente']).toBeUndefined();
      // O token de renovação guardado foi trocado pela rotação.
      expect(app.armazenamento.atual?.tokenRenovacao).toBeTruthy();
      expect(app.armazenamento.atual?.tokenRenovacao).not.toBe(sessao.tokenRenovacao);

      const logout = await app.autenticado.encerrarSessao();
      expect(logout.revogadaNoServidor).toBe(true);
      expect(await sessoesVivas(dono, conta.id)).toBe(0);
      expect((await sessoesDaConta(dono, conta.id))[0]?.cliente).toBe(clienteDoApp);
    },
  );
});
