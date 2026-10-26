// Teste transversal das rotas (plano 01b, etapa 19; S7, CA-07, revisão do grupo B): percorre
// o roteador da aplicação inteira, e não uma lista escrita à mão, para que uma rota nova
// entre sozinha em cada conferência.
//
// - Toda rota do Express é de um controller do Nest (as guardas globais só valem para elas):
//   nenhuma rota crua, montada fora do Nest, escapa da guarda `Autenticado`.
// - Toda rota sem `@Publico()` responde 401 sem token; toda rota de `/v1/admin` tem
//   `@Perfis('admin')` e `@ExigeMfa()` e nenhuma é pública.
// - Com token válido, nenhuma rota autenticada responde 401 (só a guarda devolve 401; a
//   exceção registrada, `conta_indisponivel`, está em `privacidade.int.test.ts`).
// - CA-07: nenhuma rota concede `admin`: nenhuma resposta traz token com `admin` ou `mfa`
//   para quem não passou pelo segundo fator no painel, e a conta não ganha perfil.
import { describe, expect, it } from 'vitest';
import { ehDeAdmin, rotasDaAplicacao } from '../../helpers/autorizacao.ts';
import { problemaDe, setCookies } from './api-http.ts';
import {
  type AdminComSessao,
  type ContaComSessao,
  pedidoPara,
  PEDIDOS_DAS_ROTAS,
  usarCenarioHttp,
} from './cenario-http.ts';

const cenario = usarCenarioHttp();

/** Camada do roteador do Express 5 (pacote `router`). */
interface CamadaDoRoteador {
  readonly name?: string;
  readonly route?: { readonly path: unknown; readonly methods: Record<string, boolean> };
  readonly handle?: { readonly stack?: unknown };
}

/** Caminho em que o Nest registra os middlewares de módulo (`forRoutes('*')`). */
const CAMINHO_DOS_MIDDLEWARES_DO_NEST = '{/*splat}';

/**
 * As camadas do Express que não são rota, na ordem: as do Express e do Nest (anônimas) e as
 * de `configurarAplicacao` (id da requisição, `no-store`, helmet, CORS, JSON, cookies).
 */
const MIDDLEWARES_CONHECIDOS = [
  '<anonymous>',
  'idRequisicaoMiddleware',
  'semCache',
  'helmetMiddleware',
  'corsMiddleware',
  'jsonParser',
  'cookieParser',
  '<anonymous>',
  '<anonymous>',
];

function camadasDoExpress(): CamadaDoRoteador[] {
  const express = cenario.api.app.getHttpAdapter().getInstance() as {
    router: { stack: CamadaDoRoteador[] };
  };
  return express.router.stack;
}

/** As claims (sem conferir a assinatura) de um JWT. */
function claimsDe(token: string): Record<string, unknown> {
  const meio = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(meio, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/** Todo texto com cara de JWT na resposta (corpo e cookies). */
function jwtsNaResposta(resposta: { text: string; headers: Record<string, unknown> }): string[] {
  const texto = `${resposta.text}\n${setCookies(resposta.headers).join('\n')}`;
  return texto.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g) ?? [];
}

async function perfisNoBanco(contaId: string): Promise<string[]> {
  const { rows } = await cenario.dono.query<{ perfil: string }>(
    'SELECT perfil::text FROM identidade.perfis_conta WHERE conta_id = $1::uuid ORDER BY perfil',
    [contaId],
  );
  return rows.map(({ perfil }) => perfil);
}

describe('inventário das rotas (S7)', () => {
  it('o catálogo do cenário cobre exatamente as rotas da aplicação', () => {
    const daAplicacao = rotasDaAplicacao(cenario.api.app).map((rota) => rota.nome);
    expect(daAplicacao).toEqual(Object.keys(PEDIDOS_DAS_ROTAS).sort());
  });

  it('toda rota do roteador do Express é de um controller do Nest (nenhuma rota crua escapa da guarda)', () => {
    const doNest = new Set(rotasDaAplicacao(cenario.api.app).map((rota) => rota.nome));
    const camadas = camadasDoExpress();
    const comRota = camadas.filter((camada) => camada.route !== undefined);
    // Os middlewares do Nest (`MiddlewareConsumer`, o do pino-http) entram como rota de todos
    // os métodos em `{/*splat}` e só chamam o próximo; o resto tem de ser rota de controller.
    const rotasDoExpress = comRota
      .filter((camada) => camada.route?.path !== CAMINHO_DOS_MIDDLEWARES_DO_NEST)
      .flatMap((camada) =>
        Object.keys(camada.route?.methods ?? {}).map(
          (metodo) => `${metodo.toUpperCase()} ${String(camada.route?.path)}`,
        ),
      );
    expect(new Set(rotasDoExpress)).toEqual(doNest);
    // Os middlewares globais (fora das rotas) são os conhecidos: um novo pode responder
    // antes da guarda e precisa de revisão antes de entrar nesta lista.
    expect(
      camadas.filter((camada) => camada.route === undefined).map((camada) => camada.name),
    ).toEqual(MIDDLEWARES_CONHECIDOS);
    // Nenhum roteador montado à parte (`app.use('/x', router)`), onde as guardas não chegam.
    expect(camadas.filter((camada) => Array.isArray(camada.handle?.stack))).toEqual([]);
  });

  it('toda rota de /v1/admin exige `admin` e segundo fator, e nenhuma é pública', () => {
    const deAdmin = rotasDaAplicacao(cenario.api.app).filter(ehDeAdmin);
    expect(deAdmin.map((rota) => rota.nome)).toContain('GET /v1/admin/conta');
    for (const rota of deAdmin) {
      expect(rota.publica, rota.nome).toBe(false);
      expect(rota.exigeMfa, rota.nome).toBe(true);
      expect(rota.perfis, rota.nome).toEqual(['admin']);
    }
  });

  it('as rotas públicas são as do catálogo marcadas como públicas, e só elas', () => {
    const publicas = rotasDaAplicacao(cenario.api.app)
      .filter((rota) => rota.publica)
      .map((rota) => rota.nome);
    const doCatalogo = Object.entries(PEDIDOS_DAS_ROTAS)
      .filter(([, pedido]) => pedido.acesso === 'publica' || pedido.acesso === 'cookie_do_painel')
      .map(([nome]) => nome)
      .sort();
    expect(publicas).toEqual(doCatalogo);
  });

  it('toda rota sem `@Publico()` responde 401 sem token, antes de olhar o corpo', async () => {
    const autenticadas = rotasDaAplicacao(cenario.api.app).filter((rota) => !rota.publica);
    for (const rota of autenticadas) {
      const resposta = await pedidoPara(cenario, rota.nome).send({ intruso: 1 });
      expect(resposta.status, rota.nome).toBe(401);
      expect(problemaDe(resposta.body).codigo, rota.nome).toBe('nao_autenticado');
    }
  });
});

describe('com token válido, nenhuma rota autenticada responde 401 (revisão do grupo B)', () => {
  it('cada rota, com uma sessão nova e o corpo do catálogo, responde sem 401', async () => {
    const autenticadas = rotasDaAplicacao(cenario.api.app).filter((rota) => !rota.publica);
    expect(autenticadas.length).toBeGreaterThanOrEqual(9);
    for (const rota of autenticadas) {
      const pedido = PEDIDOS_DAS_ROTAS[rota.nome];
      // Sessão nova por rota: o logout de uma não pode derrubar a seguinte.
      const sessao: ContaComSessao | AdminComSessao =
        pedido?.acesso === 'admin' ? await cenario.adminNoPainel() : await cenario.contaNoApp();
      const resposta = await pedidoPara(cenario, rota.nome, {
        tokenAcesso: sessao.tokenAcesso,
      }).send(pedido?.corpo?.(sessao.conta) ?? {});
      expect(resposta.status, rota.nome).not.toBe(401);
      expect(resposta.status, rota.nome).toBeLessThan(500);
    }
  });
});

describe('CA-07: nenhuma rota concede admin', () => {
  it.each([
    ['conta comum', 'comum'],
    ['conta admin que entrou pelo app', 'admin-no-app'],
  ] as const)(
    '%s percorre todas as rotas: nenhum token devolvido traz `admin` ou `mfa`, e os perfis não mudam',
    async (_nome, quem) => {
      const sessao =
        quem === 'comum'
          ? await cenario.contaNoApp()
          : await cenario.entrarNoApp((await cenario.adminNoPainel()).conta);
      const perfisAntes = await perfisNoBanco(sessao.conta.id);

      const tokens: string[] = [];
      for (const rota of rotasDaAplicacao(cenario.api.app)) {
        const pedido = PEDIDOS_DAS_ROTAS[rota.nome];
        // O logout encerraria a sessão no meio da volta: fica para o fim.
        if (rota.nome === 'DELETE /v1/sessoes/atual') continue;
        const corpo = { ...(pedido?.corpo?.(sessao.conta) ?? {}), perfis: ['admin'], admin: true };
        for (const comCampoDeAdmin of [false, true]) {
          const resposta = await pedidoPara(cenario, rota.nome, {
            tokenAcesso: sessao.tokenAcesso,
          }).send(comCampoDeAdmin ? corpo : (pedido?.corpo?.(sessao.conta) ?? {}));
          if (rota.nome === 'GET /v1/admin/conta') expect(resposta.status).toBe(403);
          if (comCampoDeAdmin && pedido?.corpo !== undefined) {
            expect(resposta.status, `${rota.nome} com perfis no corpo`).toBe(400);
          }
          tokens.push(...jwtsNaResposta(resposta));
        }
      }
      const conta = await pedidoPara(cenario, 'GET /v1/conta', {
        tokenAcesso: sessao.tokenAcesso,
      }).send();
      expect(conta.status).toBe(200);
      expect((conta.body as { perfis: string[] }).perfis).not.toContain('admin');

      // Ao menos o login da própria conta devolveu token; nenhum com admin.
      expect(tokens.length).toBeGreaterThan(0);
      for (const token of tokens) {
        const claims = claimsDe(token);
        expect(claims['perfis']).not.toContain('admin');
        expect(claims['mfa']).not.toBe(true);
      }
      expect(await perfisNoBanco(sessao.conta.id)).toEqual(perfisAntes);
    },
  );
});
