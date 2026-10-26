// O token de acesso deixa de valer na hora em que a sessão ou a conta acaba (plano 01b,
// etapa 19; S8, CA-05, CA-11; vindo do grupo D):
//
// - em `/v1/admin`, logo depois do logout (pela rota com o token ou pelo cookie do painel);
// - em qualquer rota, logo depois da exclusão da conta;
// - nas rotas sensíveis sem senha (`@ConfereSessao()`: cópia dos dados e dados da conta),
//   logo depois de `revogarDaConta` (logout, redefinição de senha, reconfiguração do
//   segundo fator, P16), mesmo com o JWT dentro dos 15 min.
import { describe, expect, it } from 'vitest';
import { ehDeAdmin, rotasDaAplicacao } from '../../helpers/autorizacao.ts';
import { comCookie, ORIGEM_DO_PAINEL, problemaDe } from './api-http.ts';
import {
  type AdminComSessao,
  type ContaComSessao,
  pedidoPara,
  PEDIDOS_DAS_ROTAS,
  usarCenarioHttp,
} from './cenario-http.ts';
import { inserirCodigo, OUTRA_SENHA, sessoesVivas } from './pilha-de-casos-de-uso.ts';

const cenario = usarCenarioHttp();

/** As rotas sensíveis sem senha, que conferem a sessão fora de `/v1/admin`. */
const ROTAS_QUE_CONFEREM_A_SESSAO = [
  'GET /v1/conta',
  'GET /v1/privacidade/exportacao/arquivo',
  'POST /v1/privacidade/exportacao',
];

function com(sessao: ContaComSessao | AdminComSessao, nome: string) {
  return pedidoPara(cenario, nome, { tokenAcesso: sessao.tokenAcesso }).send(
    PEDIDOS_DAS_ROTAS[nome]?.corpo?.(sessao.conta) ?? {},
  );
}

async function esperar401(sessao: ContaComSessao | AdminComSessao, nome: string): Promise<void> {
  const resposta = await com(sessao, nome);
  expect(resposta.status, nome).toBe(401);
  expect(problemaDe(resposta.body).codigo, nome).toBe('nao_autenticado');
}

describe('/v1/admin depois do logout (S8)', () => {
  it('`DELETE /v1/sessoes/atual` do painel: o mesmo token de acesso já recebe 401 em /v1/admin/conta', async () => {
    const admin = await cenario.adminNoPainel();
    await com(admin, 'GET /v1/admin/conta').expect(200);

    await com(admin, 'DELETE /v1/sessoes/atual').expect(204);

    await esperar401(admin, 'GET /v1/admin/conta');
  });

  it('logout do painel pelo cookie: o token de acesso em memória já recebe 401 em /v1/admin/conta', async () => {
    const admin = await cenario.adminNoPainel();
    await cenario.api.http
      .delete('/v1/sessoes/renovacao')
      .set('X-Cliente', 'painel')
      .set('Origin', ORIGEM_DO_PAINEL)
      .set('Cookie', comCookie(admin.tokenRenovacao))
      .expect(204);

    await esperar401(admin, 'GET /v1/admin/conta');
  });
});

describe('depois da exclusão da conta, em qualquer rota (S8, CA-11)', () => {
  it('conta de app: toda rota autenticada responde 401 com o token de antes', async () => {
    const sessao = await cenario.contaNoApp();
    const outroAparelho = await cenario.entrarNoApp(sessao.conta, 'app_lojista');
    await pedidoPara(cenario, 'POST /v1/privacidade/exclusao', { tokenAcesso: sessao.tokenAcesso })
      .send({ senha: sessao.conta.senha })
      .expect(202);

    const autenticadas = rotasDaAplicacao(cenario.api.app).filter((rota) => !rota.publica);
    expect(autenticadas.length).toBeGreaterThanOrEqual(9);
    for (const rota of autenticadas) {
      await esperar401(sessao, rota.nome);
      await esperar401(outroAparelho, rota.nome);
    }
  });

  it('admin no painel: /v1/admin e as demais rotas respondem 401 com o token de antes', async () => {
    const admin = await cenario.adminNoPainel();
    await pedidoPara(cenario, 'POST /v1/privacidade/exclusao', { tokenAcesso: admin.tokenAcesso })
      .send({ senha: admin.conta.senha })
      .expect(202);

    const autenticadas = rotasDaAplicacao(cenario.api.app).filter((rota) => !rota.publica);
    expect(autenticadas.some(ehDeAdmin)).toBe(true);
    for (const rota of autenticadas) await esperar401(admin, rota.nome);
  });
});

describe('rotas sensíveis sem senha conferem a sessão (vindo do grupo D, P16)', () => {
  it('o inventário marca exatamente essas rotas com `@ConfereSessao()`', () => {
    const marcadas = rotasDaAplicacao(cenario.api.app)
      .filter((rota) => rota.confereSessao)
      .map((rota) => rota.nome);
    expect(marcadas).toEqual(ROTAS_QUE_CONFEREM_A_SESSAO);
  });

  it('logout pela rota: a mesma sessão já não pede, não baixa a cópia nem lê a conta (401)', async () => {
    const sessao = await cenario.contaNoApp();
    await com(sessao, 'GET /v1/conta').expect(200);
    await com(sessao, 'DELETE /v1/sessoes/atual').expect(204);

    for (const nome of ROTAS_QUE_CONFEREM_A_SESSAO) await esperar401(sessao, nome);
  });

  it('logout de um aparelho não derruba o outro: a outra sessão da conta segue pedindo a cópia', async () => {
    const saiu = await cenario.contaNoApp();
    const ficou = await cenario.entrarNoApp(saiu.conta, 'app_lojista');
    await com(saiu, 'DELETE /v1/sessoes/atual').expect(204);

    await esperar401(saiu, 'POST /v1/privacidade/exportacao');
    await com(ficou, 'POST /v1/privacidade/exportacao').expect(202);
    await com(ficou, 'GET /v1/conta').expect(200);
  });

  it('redefinição de senha (revoga todas as sessões): o token de antes recebe 401 nessas rotas', async () => {
    const sessao = await cenario.contaNoApp();
    await inserirCodigo(cenario.p, sessao.conta.id, 'recuperacao_senha', '482913');
    await cenario.api.http
      .post('/v1/senha/redefinicao')
      .set('X-Forwarded-For', cenario.ip())
      .send({ email: sessao.conta.email, codigo: '482913', novaSenha: OUTRA_SENHA })
      .expect(204);
    expect(await sessoesVivas(cenario.dono, sessao.conta.id)).toBe(0);

    for (const nome of ROTAS_QUE_CONFEREM_A_SESSAO) await esperar401(sessao, nome);
  });

  it('reconfiguração do segundo fator pela CLI (revoga as sessões do admin): 401 nessas rotas e em /v1/admin', async () => {
    const admin = await cenario.adminNoPainel();
    await com(admin, 'POST /v1/privacidade/exportacao').expect(202);
    const reconfiguracao = await cenario.p.casos.reconfigurarSegundoFator.executar({
      conta: { contaId: admin.conta.id },
      operadorId: admin.conta.id,
    });
    expect(reconfiguracao.tipo).toBe('reconfigurado');

    for (const nome of [...ROTAS_QUE_CONFEREM_A_SESSAO, 'GET /v1/admin/conta']) {
      await esperar401(admin, nome);
    }
  });
});
