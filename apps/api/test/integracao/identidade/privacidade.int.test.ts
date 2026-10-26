// Rotas de conta e privacidade pela API inteira (plano 01b, etapa 19; CA-10, CA-11, S10,
// S14; revisão do grupo B; resultado → HTTP do grupo C):
//
// - `GET /v1/conta`: nome, e-mail mascarado e perfis da conta da sessão;
// - `GET /v1/privacidade`: versões, data do aceite e prazo da cópia pronta (CA-10);
// - `POST /v1/privacidade/exportacao`: 202, um por 24 h (`ja_solicitada` → 429 com
//   `Retry-After` até `proximaEm`);
// - `GET /v1/privacidade/exportacao/arquivo`: 200 com o JSON, uma vez só e por 7 dias
//   (`indisponivel` → 404, S10);
// - `POST /v1/privacidade/exclusao`: 202 desativa e revoga na hora (CA-11); senha errada →
//   400 `campos[senha].invalido` com uma falha só no freio por e-mail; freio ativo → 429;
//   pendências → 409 `exclusao_com_pendencias`; `conta_indisponivel` → 401 (a única
//   exceção, com a conta desativada entre a guarda e o caso de uso); conta com perfil
//   `admin` fora da sessão do painel com segundo fator → 403
//   `exclusao_de_admin_so_pelo_painel`, antes da senha e sem gastar o freio (S113).
import {
  contaSchema,
  ERROS,
  MOTIVO_SENHA_INCORRETA,
  privacidadeSchema,
  type Privacidade,
} from '@bairrin/contratos';
import { describe, expect, it } from 'vitest';
import { chaveDoFreioPorEmail } from '../../../src/modulos/identidade/aplicacao/comum/chaves.ts';
import { EmissorDeJwt } from '../../../src/modulos/identidade/aplicacao/portas/emissor-de-jwt.ts';
import { RegistroDePendencias } from '../../../src/modulos/identidade/aplicacao/portas/verificador-de-pendencias.ts';
import { GerarExportacaoCasoDeUso } from '../../../src/modulos/identidade/aplicacao/privacidade/gerar-exportacao.ts';
import { SolicitarExclusaoCasoDeUso } from '../../../src/modulos/identidade/aplicacao/privacidade/solicitar-exclusao.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import { problemaDe } from './api-http.ts';
import { type AdminComSessao, type ContaComSessao, usarCenarioHttp } from './cenario-http.ts';
import { eventosDaConta, pausarAntes, sessoesVivas, T0, UM_DIA } from './pilha-de-casos-de-uso.ts';

const cenario = usarCenarioHttp();

const SENHA_ERRADA = 'senha-que-nao-e-esta-91';
/** O motivo do zod `ptBR` do contrato para campo desconhecido (CA-13). */
const MOTIVO_DESCONHECIDO = 'Campo desconhecido.';
const UMA_HORA_EM_S = 60 * 60;

function como(sessao: { tokenAcesso: string }) {
  const { http } = cenario.api;
  const comToken = <T extends { set(nome: string, valor: string): T }>(pedido: T) =>
    pedido
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .set('X-Forwarded-For', cenario.ip());
  return {
    get: (caminho: string) => comToken(http.get(caminho)),
    post: (caminho: string) => comToken(http.post(caminho)),
  };
}

function privacidadeDe(corpo: unknown): Privacidade {
  return privacidadeSchema.parse(corpo);
}

/** O `solicitacaoId` do último `ExportacaoSolicitada` da conta, na outbox. */
async function ultimaSolicitacaoDeExportacao(contaId: string): Promise<string> {
  const eventos = await eventosDaConta(cenario.dono, contaId);
  const pedidos = eventos.filter(({ tipo }) => tipo === 'identidade.ExportacaoSolicitada');
  const payload = pedidos.at(-1)?.payload as { solicitacaoId?: string } | undefined;
  if (payload?.solicitacaoId === undefined) throw new Error('sem ExportacaoSolicitada na outbox');
  return payload.solicitacaoId;
}

/** Pede a cópia pela rota e a gera como o assinante geraria (o worker não roda aqui). */
async function copiaPronta(sessao: ContaComSessao): Promise<Date> {
  await como(sessao).post('/v1/privacidade/exportacao').expect(202);
  const solicitacaoId = await ultimaSolicitacaoDeExportacao(sessao.conta.id);
  const gerada = await cenario.api.app
    .get(GerarExportacaoCasoDeUso)
    .executar({ contaId: sessao.conta.id, solicitacaoId });
  if (gerada.tipo !== 'gerada') throw new Error(`a cópia não foi gerada: ${gerada.tipo}`);
  return gerada.expiraEm;
}

async function falhasNoFreioPorEmail(email: string): Promise<number> {
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

async function solicitacoesDeExclusao(contaId: string): Promise<string[]> {
  const { rows } = await cenario.dono.query<{ status: string }>(
    "SELECT status::text FROM identidade.solicitacoes_titular WHERE conta_id = $1::uuid AND tipo = 'exclusao'",
    [contaId],
  );
  return rows.map(({ status }) => status);
}

// ---------------------------------------------------------------------------

describe('GET /v1/conta (spec A5)', () => {
  it('200 com nome, e-mail mascarado e perfis da conta da sessão, no contrato e sem cache', async () => {
    const sessao = await cenario.contaNoApp();
    const resposta = await como(sessao).get('/v1/conta').expect(200);
    const conta = contaSchema.parse(resposta.body);
    expect(conta).toEqual({
      nome: sessao.conta.nome,
      emailMascarado: Email.criar(sessao.conta.email).mascarado,
      perfis: ['consumidor'],
    });
    expect(resposta.text).not.toContain(sessao.conta.email);
    expect(resposta.text).not.toContain(sessao.conta.telefone);
    expect(resposta.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /v1/privacidade (CA-10)', () => {
  it('versão da política e dos termos, data do aceite no cadastro e nenhuma cópia pronta', async () => {
    const sessao = await cenario.contaNoApp();
    const resposta = await como(sessao).get('/v1/privacidade').expect(200);
    expect(privacidadeDe(resposta.body)).toEqual({
      politica: {
        versao: cenario.docs.privacidade.versao,
        conteudo: 'Texto de privacidade do teste',
      },
      termos: { versao: cenario.docs.termos.versao },
      aceitoEm: T0.toISOString(),
      exportacaoDisponivelAte: null,
    });
    expect(resposta.headers['cache-control']).toBe('no-store');
  });

  it('com a cópia pronta, mostra até quando ela pode ser baixada (7 dias)', async () => {
    const sessao = await cenario.contaNoApp();
    const expiraEm = await copiaPronta(sessao);
    expect(expiraEm.getTime()).toBe(T0.getTime() + 7 * UM_DIA);

    const resposta = await como(sessao).get('/v1/privacidade').expect(200);
    expect(privacidadeDe(resposta.body).exportacaoDisponivelAte).toBe(expiraEm.toISOString());
  });
});

describe('POST /v1/privacidade/exportacao (CA-10, S10)', () => {
  it('202 sem corpo e `ExportacaoSolicitada` só com ids na outbox', async () => {
    const sessao = await cenario.contaNoApp();
    const resposta = await como(sessao).post('/v1/privacidade/exportacao').expect(202);
    expect(resposta.text).toBe('');
    const eventos = await eventosDaConta(cenario.dono, sessao.conta.id);
    const pedido = eventos.find(({ tipo }) => tipo === 'identidade.ExportacaoSolicitada');
    expect(Object.keys(pedido?.payload as object).sort()).toEqual(['contaId', 'solicitacaoId']);
  });

  it('o segundo pedido em 24 h → 429 com `Retry-After` até poder pedir de novo; depois de 24 h, 202', async () => {
    const sessao = await cenario.contaNoApp();
    await como(sessao).post('/v1/privacidade/exportacao').expect(202);

    // Duas horas depois (o token de acesso de antes já venceu: entra de novo).
    cenario.api.relogio.definir(new Date(T0.getTime() + 2 * UMA_HORA_EM_S * 1000));
    const depoisDeDuasHoras = await cenario.entrarNoApp(sessao.conta);
    const repetido = await como(depoisDeDuasHoras).post('/v1/privacidade/exportacao').expect(429);
    expect(problemaDe(repetido.body).codigo).toBe('limite_excedido');
    expect(repetido.headers['retry-after']).toBe(String(22 * UMA_HORA_EM_S));

    cenario.api.relogio.definir(new Date(T0.getTime() + UM_DIA));
    const depoisDeUmDia = await cenario.entrarNoApp(sessao.conta);
    await como(depoisDeUmDia).post('/v1/privacidade/exportacao').expect(202);
  });

  it('corpo com campo → 400 `desconhecido` com o motivo em português, sem gravar pedido', async () => {
    const sessao = await cenario.contaNoApp();
    const resposta = await como(sessao)
      .post('/v1/privacidade/exportacao')
      .send({ formato: 'csv' })
      .expect(400);
    expect(problemaDe(resposta.body).campos).toEqual([
      { campo: 'formato', codigo: 'desconhecido', motivo: MOTIVO_DESCONHECIDO },
    ]);
    expect(await eventosDaConta(cenario.dono, sessao.conta.id)).not.toContainEqual(
      expect.objectContaining({ tipo: 'identidade.ExportacaoSolicitada' }),
    );
  });
});

describe('GET /v1/privacidade/exportacao/arquivo (S10)', () => {
  it('sem cópia pedida → 404 em Problem Details', async () => {
    const sessao = await cenario.contaNoApp();
    const resposta = await como(sessao).get('/v1/privacidade/exportacao/arquivo').expect(404);
    expect(problemaDe(resposta.body).codigo).toBe('nao_encontrado');
  });

  it('pedida mas ainda não gerada → 404', async () => {
    const sessao = await cenario.contaNoApp();
    await como(sessao).post('/v1/privacidade/exportacao').expect(202);
    await como(sessao).get('/v1/privacidade/exportacao/arquivo').expect(404);
  });

  it('200 com o arquivo JSON da conta, como anexo e sem cache; a segunda vez → 404 (uso único)', async () => {
    const sessao = await cenario.contaNoApp();
    await copiaPronta(sessao);

    const resposta = await como(sessao).get('/v1/privacidade/exportacao/arquivo').expect(200);
    expect(resposta.headers['content-type']).toMatch(/^application\/json/);
    expect(resposta.headers['content-disposition']).toBe(
      'attachment; filename="bairrin-meus-dados.json"',
    );
    expect(resposta.headers['cache-control']).toBe('no-store');
    const arquivo = JSON.parse(resposta.text) as {
      identidade: { conta: { id: string; email: string; nome: string } };
    };
    expect(arquivo.identidade.conta).toMatchObject({
      id: sessao.conta.id,
      email: sessao.conta.email,
      nome: sessao.conta.nome,
    });

    await como(sessao).get('/v1/privacidade/exportacao/arquivo').expect(404);
    const depois = await como(sessao).get('/v1/privacidade').expect(200);
    expect(privacidadeDe(depois.body).exportacaoDisponivelAte).toBeNull();
  });

  it('vencida (7 dias) → 404; no último instante ainda baixa', async () => {
    const vencida = await cenario.contaNoApp();
    const expiraEm = await copiaPronta(vencida);
    const noLimite = await cenario.contaNoApp();
    await copiaPronta(noLimite);

    // Sete dias depois, os tokens de acesso de antes já venceram: as duas entram de novo.
    cenario.api.relogio.definir(new Date(expiraEm.getTime() - 1));
    const noLimiteDeNovo = await cenario.entrarNoApp(noLimite.conta);
    await como(noLimiteDeNovo).get('/v1/privacidade/exportacao/arquivo').expect(200);
    cenario.api.relogio.definir(expiraEm);
    const vencidaDeNovo = await cenario.entrarNoApp(vencida.conta);
    await como(vencidaDeNovo).get('/v1/privacidade/exportacao/arquivo').expect(404);
  });

  it('dois downloads simultâneos: um 200 e um 404, nunca dois arquivos', async () => {
    const sessao = await cenario.contaNoApp();
    await copiaPronta(sessao);
    const respostas = await Promise.all([
      como(sessao).get('/v1/privacidade/exportacao/arquivo'),
      como(sessao).get('/v1/privacidade/exportacao/arquivo'),
    ]);
    expect(respostas.map(({ status }) => status).sort()).toEqual([200, 404]);
  });
});

describe('POST /v1/privacidade/exclusao (CA-11)', () => {
  it('202: conta desativada na hora, sessões revogadas, solicitação pendente e `ContaDesativada`', async () => {
    const sessao = await cenario.contaNoApp();
    const outraSessao = await cenario.entrarNoApp(sessao.conta, 'app_lojista');

    const resposta = await como(sessao)
      .post('/v1/privacidade/exclusao')
      .send({ senha: sessao.conta.senha })
      .expect(202);
    expect(resposta.text).toBe('');

    expect(await statusDaConta(sessao.conta.id)).toBe('desativada');
    expect(await sessoesVivas(cenario.dono, sessao.conta.id)).toBe(0);
    expect(await solicitacoesDeExclusao(sessao.conta.id)).toEqual(['pendente']);
    const tipos = (await eventosDaConta(cenario.dono, sessao.conta.id)).map(({ tipo }) => tipo);
    expect(tipos).toContain('identidade.ContaDesativada');
    // Os dois tokens de acesso, ainda dentro dos 15 min, já não valem (S8).
    await como(sessao).get('/v1/conta').expect(401);
    await como(outraSessao).get('/v1/privacidade').expect(401);
  });

  it('senha errada → 400 `campos[senha].invalido` (nunca 401) e uma falha só no freio por e-mail', async () => {
    const sessao = await cenario.contaNoApp();
    const resposta = await como(sessao)
      .post('/v1/privacidade/exclusao')
      .send({ senha: SENHA_ERRADA })
      .expect(400);
    expect(problemaDe(resposta.body).campos).toEqual([
      { campo: 'senha', codigo: 'invalido', motivo: MOTIVO_SENHA_INCORRETA },
    ]);
    expect(await falhasNoFreioPorEmail(sessao.conta.email)).toBe(1);
    expect(await statusDaConta(sessao.conta.id)).toBe('ativa');
    // A sessão segue: a recusa não derrubou nada.
    await como(sessao).get('/v1/conta').expect(200);
  });

  it('com o freio por e-mail ativo → 429 com `Retry-After`, sem conferir a senha (nem a certa)', async () => {
    const sessao = await cenario.contaNoApp();
    for (let vez = 0; vez < 5; vez += 1) {
      await como(sessao).post('/v1/privacidade/exclusao').send({ senha: SENHA_ERRADA }).expect(400);
    }
    const freada = await como(sessao)
      .post('/v1/privacidade/exclusao')
      .send({ senha: sessao.conta.senha })
      .expect(429);
    expect(problemaDe(freada.body).codigo).toBe('limite_excedido');
    expect(freada.headers['retry-after']).toBe('60');
    expect(await statusDaConta(sessao.conta.id)).toBe('ativa');
  });

  it('com pendência de outro módulo → 409 `exclusao_com_pendencias`; a conta e a sessão seguem', async () => {
    const sessao = await cenario.contaNoApp();
    const comPendencia = new Set([sessao.conta.id]);
    const registro = cenario.api.app.get(RegistroDePendencias);
    if (!registro.modulos().includes('pedidos-de-teste')) {
      registro.registrar({
        modulo: 'pedidos-de-teste',
        pendenciasDaConta: (contaId) =>
          Promise.resolve(
            comPendencia.has(contaId)
              ? [{ modulo: 'pedidos-de-teste', tipo: 'pedido_em_andamento' }]
              : [],
          ),
      });
    }

    const resposta = await como(sessao)
      .post('/v1/privacidade/exclusao')
      .send({ senha: sessao.conta.senha })
      .expect(409);
    expect(problemaDe(resposta.body).codigo).toBe('exclusao_com_pendencias');
    expect(resposta.text).not.toContain('pedidos-de-teste');
    expect(await statusDaConta(sessao.conta.id)).toBe('ativa');
    expect(await solicitacoesDeExclusao(sessao.conta.id)).toEqual(['aguardando_pendencias']);
    await como(sessao).get('/v1/conta').expect(200);
    comPendencia.clear();
  });

  it('conta desativada entre a guarda e o caso de uso → 401 (a exceção registrada)', async () => {
    const sessao = await cenario.contaNoApp();
    const pausa = pausarAntes(cenario.api.app.get(SolicitarExclusaoCasoDeUso), 'executar');
    const pedido = como(sessao)
      .post('/v1/privacidade/exclusao')
      .send({ senha: sessao.conta.senha })
      .then((resposta) => resposta);
    await pausa.chegou;
    // Outra exclusão da mesma conta (outro aparelho) confirma enquanto esta já passou da guarda.
    await expect(
      cenario.p.casos.solicitarExclusao.executar({
        contaId: sessao.conta.id,
        senha: sessao.conta.senha,
      }),
    ).resolves.toEqual({ tipo: 'desativada' });
    pausa.liberar();
    const resposta = await pedido;
    expect(resposta.status).toBe(401);
    expect(problemaDe(resposta.body).codigo).toBe('nao_autenticado');
  });

  it('sem senha ou com campo a mais → 400 com campos e motivos em português', async () => {
    const sessao = await cenario.contaNoApp();
    const semSenha = await como(sessao).post('/v1/privacidade/exclusao').send({}).expect(400);
    expect(problemaDe(semSenha.body).campos).toEqual([
      expect.objectContaining({ campo: 'senha', codigo: 'obrigatorio' }),
    ]);
    const comExtra = await como(sessao)
      .post('/v1/privacidade/exclusao')
      .send({ senha: sessao.conta.senha, confirmar: true })
      .expect(400);
    expect(problemaDe(comExtra.body).campos).toEqual([
      { campo: 'confirmar', codigo: 'desconhecido', motivo: MOTIVO_DESCONHECIDO },
    ]);
    expect(await statusDaConta(sessao.conta.id)).toBe('ativa');
    expect(await falhasNoFreioPorEmail(sessao.conta.email)).toBe(0);
  });
});

describe('POST /v1/privacidade/exclusao da conta admin (S113)', () => {
  /**
   * Token da sessão do painel do admin com `admin` e sem `mfa`. O login do painel sempre
   * passa pelo segundo fator, então o token é assinado aqui, com a chave da API: prova que a
   * regra pede os dois, não só o perfil.
   */
  async function painelSemMfa(admin: AdminComSessao): Promise<ContaComSessao> {
    const emissor = cenario.api.app.get(EmissorDeJwt);
    const agora = cenario.api.relogio.agora();
    const claims = await emissor.verificar(admin.tokenAcesso, agora);
    if (claims === null) throw new Error('token do painel recusado');
    expect(claims).toMatchObject({
      mfa: true,
      perfis: expect.arrayContaining(['admin']) as string[],
    });
    const { token } = await emissor.emitir({ ...claims, mfa: false }, agora);
    return { conta: admin.conta, tokenAcesso: token, tokenRenovacao: admin.tokenRenovacao };
  }

  it.each([
    ['pelo app (sem `admin` nem `mfa` no token)', 'app'],
    ['no painel sem segundo fator (`admin` sem `mfa`)', 'painel-sem-mfa'],
  ] as const)(
    '%s → 403 `exclusao_de_admin_so_pelo_painel` com a orientação, antes da senha e sem gastar o freio',
    async (_nome, origem) => {
      const admin = await cenario.adminNoPainel();
      const sessao =
        origem === 'app' ? await cenario.entrarNoApp(admin.conta) : await painelSemMfa(admin);

      for (const senha of [admin.conta.senha, SENHA_ERRADA]) {
        const resposta = await como(sessao)
          .post('/v1/privacidade/exclusao')
          .send({ senha })
          .expect(403);
        const problema = problemaDe(resposta.body);
        expect(problema.codigo).toBe('exclusao_de_admin_so_pelo_painel');
        expect(problema.title).toBe(ERROS.exclusao_de_admin_so_pelo_painel.title);
        expect(problema.title).toContain('painel');
        expect(resposta.text).not.toContain(admin.conta.email);
      }

      expect(await falhasNoFreioPorEmail(admin.conta.email)).toBe(0);
      expect(await statusDaConta(admin.conta.id)).toBe('ativa');
      expect(await solicitacoesDeExclusao(admin.conta.id)).toEqual([]);
      // A recusa não derruba a sessão do painel.
      await como(admin).get('/v1/admin/conta').expect(200);
    },
  );

  it('na sessão do painel com segundo fator (`admin` e `mfa`) → 202: desativa e revoga como a conta comum', async () => {
    const admin = await cenario.adminNoPainel();
    const noApp = await cenario.entrarNoApp(admin.conta);

    await como(admin)
      .post('/v1/privacidade/exclusao')
      .send({ senha: admin.conta.senha })
      .expect(202);

    expect(await statusDaConta(admin.conta.id)).toBe('desativada');
    expect(await sessoesVivas(cenario.dono, admin.conta.id)).toBe(0);
    expect(await solicitacoesDeExclusao(admin.conta.id)).toEqual(['pendente']);
    await como(admin).get('/v1/admin/conta').expect(401);
    await como(noApp).get('/v1/privacidade').expect(401);
  });

  it('conta comum segue igual: pelo app, senha certa → 202, senha errada → 400 com uma falha no freio', async () => {
    const errada = await cenario.contaNoApp();
    await como(errada).post('/v1/privacidade/exclusao').send({ senha: SENHA_ERRADA }).expect(400);
    expect(await falhasNoFreioPorEmail(errada.conta.email)).toBe(1);

    const certa = await cenario.contaNoApp();
    await como(certa)
      .post('/v1/privacidade/exclusao')
      .send({ senha: certa.conta.senha })
      .expect(202);
    expect(await statusDaConta(certa.conta.id)).toBe('desativada');
  });
});
