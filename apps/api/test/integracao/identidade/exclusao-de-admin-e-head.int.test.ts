// Rodada 2 do qa da etapa 19: o que a correção do S113 e do Q31 ainda precisa provar.
//
// - S113 (conta com perfil `admin` só se exclui numa sessão com `admin` E `mfa`): o token com
//   `mfa` mas sem `admin` não basta; 12 recusas seguidas não geram 429 nem gastam o freio e a
//   conta continua livre no painel; o admin com segundo fator segue o fluxo comum (senha errada
//   400 com uma falha, 5 erradas → 429); com o freio já ativo, a recusa do app ainda é 403 (vem
//   antes do freio); sem token, 401.
// - Q31 (HEAD no download da cópia): 405 sem chamar o caso de uso (que decifra), cópia não
//   marcada como baixada, sem corpo, sem token → 401; o GET seguinte baixa, e só uma vez.
// - CA-12: o 403 do S113 e o 405 do HEAD entram na varredura de log, outbox inteira e Sentry,
//   com controle positivo (as linhas existem no log).
import { afterAll, describe, expect, it, vi } from 'vitest';
import { InterceptadorDoSentry } from '../../../src/compartilhado/observabilidade/sentry.ts';
import { chaveDoFreioPorEmail } from '../../../src/modulos/identidade/aplicacao/comum/chaves.ts';
import { EmissorDeJwt } from '../../../src/modulos/identidade/aplicacao/portas/emissor-de-jwt.ts';
import { BaixarExportacaoCasoDeUso } from '../../../src/modulos/identidade/aplicacao/privacidade/baixar-exportacao.ts';
import { GerarExportacaoCasoDeUso } from '../../../src/modulos/identidade/aplicacao/privacidade/gerar-exportacao.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import { sensiveisEncontrados, type ValorSensivel } from '../../helpers/captura-de-log.ts';
import { ligarSentryFalso } from '../../helpers/sentry-falso.ts';
import { problemaDe } from './api-http.ts';
import {
  type AdminComSessao,
  type ContaComSessao,
  usarCenarioHttp,
  valoresPessoaisDe,
} from './cenario-http.ts';
import { eventosDaConta } from './pilha-de-casos-de-uso.ts';

const sentry = ligarSentryFalso();
const cenario = usarCenarioHttp({
  antesDeIniciar: (app) => app.useGlobalInterceptors(new InterceptadorDoSentry()),
});

afterAll(async () => {
  await sentry.desligar();
});

const SENHA_ERRADA = 'senha-que-nao-e-esta-93';

type Pedido = ReturnType<typeof cenario.api.http.get>;

function como(sessao: { tokenAcesso: string }) {
  const { http } = cenario.api;
  const comToken = (pedido: Pedido): Pedido =>
    pedido
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .set('X-Forwarded-For', cenario.ip());
  return {
    get: (caminho: string) => comToken(http.get(caminho)),
    head: (caminho: string) => comToken(http.head(caminho)),
    post: (caminho: string) => comToken(http.post(caminho)),
  };
}

/** Token do painel do admin reassinado com as reivindicações trocadas (a chave é a da API). */
async function tokenComReivindicacoes(
  admin: AdminComSessao,
  troca: { mfa?: boolean; perfis?: readonly string[] },
): Promise<ContaComSessao> {
  const emissor = cenario.api.app.get(EmissorDeJwt);
  const agora = cenario.api.relogio.agora();
  const claims = await emissor.verificar(admin.tokenAcesso, agora);
  if (claims === null) throw new Error('token do painel recusado');
  const { token } = await emissor.emitir(
    { ...claims, ...(troca as Partial<typeof claims>) },
    agora,
  );
  return { conta: admin.conta, tokenAcesso: token, tokenRenovacao: admin.tokenRenovacao };
}

async function falhasNoFreio(email: string): Promise<number> {
  const chave = chaveDoFreioPorEmail(cenario.p.servicos.cifrador, Email.criar(email));
  const { rows } = await cenario.dono.query<{ falhas: number }>(
    "SELECT falhas FROM identidade.bloqueios_login WHERE chave_hmac = $1 AND tipo = 'email'",
    [chave],
  );
  return rows[0]?.falhas ?? 0;
}

async function statusDaConta(contaId: string): Promise<string | undefined> {
  const { rows } = await cenario.dono.query<{ status: string }>(
    'SELECT status::text FROM identidade.contas WHERE id = $1::uuid',
    [contaId],
  );
  return rows[0]?.status;
}

async function baixada(contaId: string): Promise<boolean[]> {
  const { rows } = await cenario.dono.query<{ baixada: boolean }>(
    `SELECT baixada_em IS NOT NULL AS baixada
       FROM identidade.exportacoes_titular WHERE conta_id = $1::uuid ORDER BY criada_em, id`,
    [contaId],
  );
  return rows.map((linha) => linha.baixada);
}

/** Pede a cópia pela rota e a gera como o assinante geraria (o worker não roda aqui). */
async function copiaPronta(sessao: ContaComSessao): Promise<void> {
  await como(sessao).post('/v1/privacidade/exportacao').expect(202);
  const eventos = await eventosDaConta(cenario.dono, sessao.conta.id);
  const pedidos = eventos.filter(({ tipo }) => tipo === 'identidade.ExportacaoSolicitada');
  const solicitacaoId = (pedidos.at(-1)?.payload as { solicitacaoId?: string } | undefined)
    ?.solicitacaoId;
  if (solicitacaoId === undefined) throw new Error('sem ExportacaoSolicitada na outbox');
  const gerada = await cenario.api.app
    .get(GerarExportacaoCasoDeUso)
    .executar({ contaId: sessao.conta.id, solicitacaoId });
  if (gerada.tipo !== 'gerada') throw new Error(`a cópia não foi gerada: ${gerada.tipo}`);
}

describe('exclusão da conta admin (S113): o que o token precisa trazer', () => {
  it('token com `mfa` mas sem `admin` nos perfis não basta: 403, freio intacto, conta ativa', async () => {
    const admin = await cenario.adminNoPainel();
    const semAdminNoToken = await tokenComReivindicacoes(admin, { mfa: true, perfis: [] });

    for (const senha of [admin.conta.senha, SENHA_ERRADA]) {
      const resposta = await como(semAdminNoToken)
        .post('/v1/privacidade/exclusao')
        .send({ senha })
        .expect(403);
      expect(problemaDe(resposta.body).codigo).toBe('exclusao_de_admin_so_pelo_painel');
    }
    expect(await falhasNoFreio(admin.conta.email)).toBe(0);
    expect(await statusDaConta(admin.conta.id)).toBe('ativa');
  });

  it('12 recusas seguidas pelo app: sempre 403 (nunca 429), freio em 0, e o painel com `mfa` ainda exclui', async () => {
    const admin = await cenario.adminNoPainel();
    const noApp = await cenario.entrarNoApp(admin.conta);

    for (let vez = 0; vez < 12; vez += 1) {
      const resposta = await como(noApp)
        .post('/v1/privacidade/exclusao')
        .send({ senha: vez % 2 === 0 ? SENHA_ERRADA : admin.conta.senha });
      expect(resposta.status).toBe(403);
    }
    expect(await falhasNoFreio(admin.conta.email)).toBe(0);

    await como(admin)
      .post('/v1/privacidade/exclusao')
      .send({ senha: admin.conta.senha })
      .expect(202);
    expect(await statusDaConta(admin.conta.id)).toBe('desativada');
  });

  it('admin no painel com `mfa` segue o fluxo comum: errada → 400 e uma falha; 5 erradas → 429 com Retry-After', async () => {
    const admin = await cenario.adminNoPainel();
    // Antes do freio: ele é o mesmo do login, então depois dele nem o login do app passa.
    const noApp = await cenario.entrarNoApp(admin.conta);

    await como(admin).post('/v1/privacidade/exclusao').send({ senha: SENHA_ERRADA }).expect(400);
    expect(await falhasNoFreio(admin.conta.email)).toBe(1);

    for (let vez = 0; vez < 4; vez += 1) {
      await como(admin).post('/v1/privacidade/exclusao').send({ senha: SENHA_ERRADA }).expect(400);
    }
    const freada = await como(admin)
      .post('/v1/privacidade/exclusao')
      .send({ senha: admin.conta.senha })
      .expect(429);
    expect(Number(freada.headers['retry-after'])).toBeGreaterThan(0);
    expect(await statusDaConta(admin.conta.id)).toBe('ativa');

    // Com o freio ativo, a recusa do app continua sendo 403: ela vem antes do freio.
    const recusada = await como(noApp)
      .post('/v1/privacidade/exclusao')
      .send({ senha: admin.conta.senha })
      .expect(403);
    expect(problemaDe(recusada.body).codigo).toBe('exclusao_de_admin_so_pelo_painel');
  });

  it('sem token, o admin recebe 401 (a recusa do S113 não é a primeira guarda)', async () => {
    const admin = await cenario.adminNoPainel();
    await cenario.api.http
      .post('/v1/privacidade/exclusao')
      .set('X-Forwarded-For', cenario.ip())
      .send({ senha: admin.conta.senha })
      .expect(401);
    expect(await statusDaConta(admin.conta.id)).toBe('ativa');
  });
});

describe('download da cópia com HEAD (Q31): o caso de uso não roda e o uso único fica', () => {
  it('HEAD → 405 `metodo_nao_permitido` com `Allow: GET`, sem corpo, sem chamar o caso de uso nem marcar a cópia', async () => {
    const sessao = await cenario.contaNoApp();
    await copiaPronta(sessao);
    const baixar = cenario.api.app.get(BaixarExportacaoCasoDeUso);
    const espiao = vi.spyOn(baixar, 'executar');

    try {
      const head = await como(sessao).head('/v1/privacidade/exportacao/arquivo');
      expect(head.status).toBe(405);
      expect(head.headers['allow']).toBe('GET');
      expect(head.text ?? '').toBe('');
      expect(espiao).not.toHaveBeenCalled();
      expect(await baixada(sessao.conta.id)).toEqual([false]);
    } finally {
      espiao.mockRestore();
    }
  });

  it('o GET que vem depois do HEAD baixa o arquivo da conta; um segundo GET dá 404', async () => {
    const sessao = await cenario.contaNoApp();
    await copiaPronta(sessao);
    await como(sessao).head('/v1/privacidade/exportacao/arquivo');
    await como(sessao).head('/v1/privacidade/exportacao/arquivo');

    const primeiro = await como(sessao).get('/v1/privacidade/exportacao/arquivo').expect(200);
    expect(primeiro.text).toContain(sessao.conta.email);
    expect(await baixada(sessao.conta.id)).toEqual([true]);
    await como(sessao).get('/v1/privacidade/exportacao/arquivo').expect(404);
  });

  it('HEAD sem token → 401, não 405', async () => {
    const resposta = await cenario.api.http
      .head('/v1/privacidade/exportacao/arquivo')
      .set('X-Forwarded-For', cenario.ip());
    expect(resposta.status).toBe(401);
  });
});

describe('CA-12: o 403 do S113 e o 405 do HEAD na varredura de log, outbox e Sentry', () => {
  it('nenhum dado pessoal, senha ou token sai nessas respostas, no log, na outbox nem no Sentry', async () => {
    const admin = await cenario.adminNoPainel();
    const noApp = await cenario.entrarNoApp(admin.conta);
    const comum = await cenario.contaNoApp();
    await copiaPronta(comum);
    const respostas: { fonte: string; texto: string }[] = [];
    const guardar = (
      fonte: string,
      resposta: { status: number; text: string; headers: Record<string, unknown> },
    ) => {
      respostas.push({
        fonte: `${fonte} → ${String(resposta.status)}`,
        texto: `${resposta.text}\n${JSON.stringify(resposta.headers)}`,
      });
      return resposta;
    };

    const s113 = guardar(
      'exclusão do admin pelo app',
      await como(noApp).post('/v1/privacidade/exclusao').send({ senha: admin.conta.senha }),
    );
    expect(s113.status).toBe(403);
    const s113Errada = guardar(
      'exclusão do admin pelo app, senha errada',
      await como(noApp).post('/v1/privacidade/exclusao').send({ senha: SENHA_ERRADA }),
    );
    expect(s113Errada.status).toBe(403);
    const head = guardar(
      'HEAD do download',
      await como(comum).head('/v1/privacidade/exportacao/arquivo'),
    );
    expect(head.status).toBe(405);

    // Controle positivo: as duas requisições estão no log, e a varredura tem o que olhar.
    const log = cenario.api.textoDoLog();
    expect(log).toContain('/v1/privacidade/exclusao');
    expect(log).toContain('/v1/privacidade/exportacao/arquivo');
    expect(log).toContain('403');
    expect(log).toContain('405');

    await sentry.esvaziar();
    const sensiveis: ValorSensivel[] = [
      ...valoresPessoaisDe(admin.conta),
      ...valoresPessoaisDe(comum.conta),
      { rotulo: 'senha errada', valor: SENHA_ERRADA },
      { rotulo: 'segredo do autenticador', valor: admin.segredo },
      ...admin.recuperacao.map((codigo, indice) => ({
        rotulo: `código de recuperação ${String(indice + 1)}`,
        valor: codigo,
      })),
      { rotulo: 'token do admin no app', valor: noApp.tokenAcesso },
      { rotulo: 'token do admin no painel', valor: admin.tokenAcesso },
      { rotulo: 'token da conta comum', valor: comum.tokenAcesso },
    ];
    const { rows: outboxInteira } = await cenario.dono.query('SELECT * FROM compartilhado.outbox');
    const fontes: Record<string, string> = {
      log,
      'outbox inteira': JSON.stringify(outboxInteira),
      'envelopes do Sentry': sentry.envelopes.join('\n'),
    };
    for (const { fonte, texto } of respostas) fontes[`resposta ${fonte}`] = texto;
    expect(sensiveisEncontrados(fontes, sensiveis)).toEqual([]);
  });
});
