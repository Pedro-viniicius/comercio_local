// Bordas de conta, privacidade e admin pela API inteira (plano 01b, etapa 19; CA-07, CA-08,
// CA-10, CA-11, CA-12, CA-13). Estende os testes do dev (`privacidade`, `autorizacao`,
// `revogacao`, `rotas-protegidas`) com o que eles não percorrem:
//
// - CA-11 de ponta a ponta pela API: exclusão pela rota → tarefa diária → conta anonimizada,
//   registros preservados, e-mail livre, token e login recusados; pendência adia e o pedido
//   repetido depois conclui;
// - concorrência: duas exclusões e duas exportações simultâneas da mesma conta;
// - download da cópia: HEAD não gasta o uso único, acentos intactos, sem segredo no arquivo;
// - autorização: perfil lido do banco (`lojista` novo aparece, `admin` retirado dá 403),
//   caminho de admin com maiúsculas e barras, parâmetros de consulta que tentam trocar a conta;
// - CA-10: política nova vigente zera a data do aceite;
// - CA-13: senha da exclusão com tipo errado ou enorme não gasta o freio.
import { contaSchema, privacidadeSchema } from '@bairrin/contratos';
import { describe, expect, it } from 'vitest';
import { sensiveisEncontrados } from '../../helpers/captura-de-log.ts';
import { RegistroDePendencias } from '../../../src/modulos/identidade/aplicacao/portas/verificador-de-pendencias.ts';
import { GerarExportacaoCasoDeUso } from '../../../src/modulos/identidade/aplicacao/privacidade/gerar-exportacao.ts';
import { AnonimizarContasTarefa } from '../../../src/modulos/identidade/aplicacao/tarefas/anonimizar-contas.tarefa.ts';
import { chaveDoFreioPorEmail } from '../../../src/modulos/identidade/aplicacao/comum/chaves.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import { problemaDe, sessaoDe } from './api-http.ts';
import { type ContaComSessao, usarCenarioHttp, valoresPessoaisDe } from './cenario-http.ts';
import { cadastrar, eventosDaConta, T0, UM_DIA } from './pilha-de-casos-de-uso.ts';

const cenario = usarCenarioHttp();

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

async function statusDaConta(contaId: string): Promise<string | undefined> {
  const { rows } = await cenario.dono.query<{ status: string }>(
    'SELECT status::text FROM identidade.contas WHERE id = $1::uuid',
    [contaId],
  );
  return rows[0]?.status;
}

async function solicitacoes(contaId: string): Promise<{ tipo: string; status: string }[]> {
  const { rows } = await cenario.dono.query<{ tipo: string; status: string }>(
    'SELECT tipo::text, status::text FROM identidade.solicitacoes_titular WHERE conta_id = $1::uuid ORDER BY tipo',
    [contaId],
  );
  return rows;
}

async function contar(tabela: string, contaId: string): Promise<number> {
  const { rows } = await cenario.dono.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM identidade.${tabela} WHERE conta_id = $1::uuid`,
    [contaId],
  );
  return rows[0]?.n ?? 0;
}

async function falhasNoFreioPorEmail(email: string): Promise<number> {
  const chave = chaveDoFreioPorEmail(cenario.p.servicos.cifrador, Email.criar(email));
  const { rows } = await cenario.dono.query<{ falhas: number }>(
    "SELECT falhas FROM identidade.bloqueios_login WHERE chave_hmac = $1 AND tipo = 'email'",
    [chave],
  );
  return rows[0]?.falhas ?? 0;
}

/** Pede a cópia pela rota e a gera como o assinante geraria (o worker não roda aqui). */
async function copiaPronta(sessao: ContaComSessao): Promise<void> {
  await como(sessao).post('/v1/privacidade/exportacao').expect(202);
  const eventos = await eventosDaConta(cenario.dono, sessao.conta.id);
  const pedidos = eventos.filter(({ tipo }) => tipo === 'identidade.ExportacaoSolicitada');
  const { solicitacaoId } = pedidos.at(-1)?.payload as { solicitacaoId: string };
  const gerada = await cenario.api.app
    .get(GerarExportacaoCasoDeUso)
    .executar({ contaId: sessao.conta.id, solicitacaoId });
  expect(gerada.tipo).toBe('gerada');
}

// ---------------------------------------------------------------------------
// CA-11

describe('CA-11 de ponta a ponta pela API', () => {
  it('exclusão pela rota → tarefa diária: anonimiza, preserva aceites e solicitação, libera o e-mail e o token e o login seguem recusados', async () => {
    const sessao = await cenario.contaNoApp();
    const { conta } = sessao;
    await copiaPronta(sessao);

    await como(sessao).post('/v1/privacidade/exclusao').send({ senha: conta.senha }).expect(202);
    expect(await statusDaConta(conta.id)).toBe('desativada');
    // Desativada, a conta ainda não foi anonimizada: o pedido só entra na fila.
    expect(await solicitacoes(conta.id)).toContainEqual({ tipo: 'exclusao', status: 'pendente' });

    // Login de quem excluiu: recusado como o de senha errada, sem revelar a exclusão.
    const login = await cenario.api.http
      .post('/v1/sessoes')
      .set('X-Forwarded-For', cenario.ip())
      .send({ email: conta.email, senha: conta.senha, cliente: 'app_consumidor' });
    expect(login.status).toBe(401);
    expect(login.text).not.toMatch(/exclu|desativ|anonimiz/i);

    // O dia seguinte: a tarefa diária conclui a anonimização (dentro dos 30 dias do CA-11).
    cenario.api.relogio.definir(new Date(T0.getTime() + UM_DIA));
    const resultado = await cenario.api.app.get(AnonimizarContasTarefa).executar();
    expect(resultado.anonimizadas).toBeGreaterThanOrEqual(1);
    expect(resultado.falhas).toBe(0);

    expect(await statusDaConta(conta.id)).toBe('anonimizada');
    expect(await solicitacoes(conta.id)).toContainEqual({ tipo: 'exclusao', status: 'concluida' });
    // Registros que a lei manda guardar seguem: os dois aceites e o perfil.
    expect(await contar('consentimentos', conta.id)).toBe(2);
    expect(await contar('perfis_conta', conta.id)).toBe(1);
    // O que é pessoal se foi: sessões, cópia dos dados.
    expect(await contar('sessoes', conta.id)).toBe(0);
    expect(await contar('exportacoes_titular', conta.id)).toBe(0);
    const { rows } = await cenario.dono.query(
      'SELECT * FROM identidade.contas WHERE id = $1::uuid',
      [conta.id],
    );
    const linha = JSON.stringify(rows[0]);
    for (const { rotulo, valor } of valoresPessoaisDe(conta)) {
      expect(linha.toLowerCase(), rotulo).not.toContain(valor.toLowerCase());
    }

    // Depois de anonimizada: token antigo, login e recuperação não chegam a ela.
    await como(sessao).get('/v1/conta').expect(401);
    const outroLogin = await cenario.api.http
      .post('/v1/sessoes')
      .set('X-Forwarded-For', cenario.ip())
      .send({ email: conta.email, senha: conta.senha, cliente: 'app_consumidor' });
    expect(outroLogin.status).toBe(401);
    await cenario.api.http
      .post('/v1/senha/recuperacao')
      .set('X-Forwarded-For', cenario.ip())
      .send({ email: conta.email })
      .expect(202);
    const eventos = await eventosDaConta(cenario.dono, conta.id);
    expect(eventos.map(({ tipo }) => tipo)).not.toContain('identidade.RecuperacaoSolicitada');

    // O e-mail voltou a ser livre: um cadastro novo pela rota cria outra conta.
    const nova = await cenario.api.http
      .post('/v1/contas')
      .set('X-Forwarded-For', cenario.ip())
      .send({
        nome: conta.nome,
        email: conta.email,
        telefone: conta.telefone,
        senha: conta.senha,
        aceites: {
          termos: cenario.docs.termos.versao,
          privacidade: cenario.docs.privacidade.versao,
        },
      });
    expect(nova.status).toBe(202);
    const { rows: novas } = await cenario.dono.query<{ id: string }>(
      "SELECT id::text FROM identidade.contas WHERE status = 'ativa' AND email_normalizado = $1",
      [conta.email.toLowerCase()],
    );
    expect(novas).toHaveLength(1);
    expect(novas[0]?.id).not.toBe(conta.id);
    cenario.anotar({ id: novas[0]?.id ?? '', email: conta.email });
  });

  it('com pendência o pedido fica aguardando e a tarefa não anonimiza; resolvida a pendência, repetir conclui', async () => {
    const sessao = await cenario.contaNoApp();
    const { conta } = sessao;
    let pendente = true;
    const registro = cenario.api.app.get(RegistroDePendencias);
    registro.registrar({
      modulo: `pendencia-de-${conta.id}`,
      pendenciasDaConta: (contaId) =>
        Promise.resolve(
          pendente && contaId === conta.id
            ? [{ modulo: `pendencia-de-${conta.id}`, tipo: 'pedido_em_andamento' }]
            : [],
        ),
    });

    const adiada = await como(sessao)
      .post('/v1/privacidade/exclusao')
      .send({ senha: conta.senha })
      .expect(409);
    expect(problemaDe(adiada.body).codigo).toBe('exclusao_com_pendencias');
    expect(await statusDaConta(conta.id)).toBe('ativa');
    expect(await solicitacoes(conta.id)).toEqual([
      { tipo: 'exclusao', status: 'aguardando_pendencias' },
    ]);

    // A tarefa diária não toca em conta ativa nem em pedido aguardando.
    cenario.api.relogio.definir(new Date(T0.getTime() + 31 * UM_DIA));
    await cenario.api.app.get(AnonimizarContasTarefa).executar();
    expect(await statusDaConta(conta.id)).toBe('ativa');

    // A pessoa continua usando a conta (entra de novo: o token de antes venceu) e, resolvida a
    // pendência, repete o pedido.
    pendente = false;
    const depois = await cenario.entrarNoApp(conta);
    await como(depois).post('/v1/privacidade/exclusao').send({ senha: conta.senha }).expect(202);
    expect(await statusDaConta(conta.id)).toBe('desativada');
    expect(await solicitacoes(conta.id)).toEqual([{ tipo: 'exclusao', status: 'pendente' }]);
    await cenario.api.app.get(AnonimizarContasTarefa).executar();
    expect(await statusDaConta(conta.id)).toBe('anonimizada');
  });
});

// ---------------------------------------------------------------------------
// Concorrência

describe('concorrência na mesma conta', () => {
  it('duas exclusões simultâneas com a senha certa: nenhum 5xx, uma só solicitação e um só ContaDesativada', async () => {
    const sessao = await cenario.contaNoApp();
    const outroAparelho = await cenario.entrarNoApp(sessao.conta, 'app_lojista');
    const respostas = await Promise.all([
      como(sessao).post('/v1/privacidade/exclusao').send({ senha: sessao.conta.senha }),
      como(outroAparelho).post('/v1/privacidade/exclusao').send({ senha: sessao.conta.senha }),
    ]);
    const status = respostas.map((resposta) => resposta.status).sort();
    // Uma conclui; a outra ou também conclui (idempotente) ou já encontra a conta desativada.
    expect(status[0]).toBe(202);
    expect([202, 401]).toContain(status[1]);
    expect(await statusDaConta(sessao.conta.id)).toBe('desativada');
    expect(await solicitacoes(sessao.conta.id)).toEqual([{ tipo: 'exclusao', status: 'pendente' }]);
    const eventos = await eventosDaConta(cenario.dono, sessao.conta.id);
    expect(eventos.filter(({ tipo }) => tipo === 'identidade.ContaDesativada')).toHaveLength(1);
  });

  it('duas exportações simultâneas: um 202 e um 429, e um só ExportacaoSolicitada', async () => {
    const sessao = await cenario.contaNoApp();
    const respostas = await Promise.all([
      como(sessao).post('/v1/privacidade/exportacao'),
      como(sessao).post('/v1/privacidade/exportacao'),
    ]);
    expect(respostas.map(({ status }) => status).sort()).toEqual([202, 429]);
    const eventos = await eventosDaConta(cenario.dono, sessao.conta.id);
    expect(eventos.filter(({ tipo }) => tipo === 'identidade.ExportacaoSolicitada')).toHaveLength(
      1,
    );
    expect(
      (await solicitacoes(sessao.conta.id)).filter(({ tipo }) => tipo === 'exportacao'),
    ).toHaveLength(1);
  });
});

describe('exportação: prazo do Retry-After e sessão vencida', () => {
  it('pedido repetido meio segundo depois: Retry-After arredonda para cima (86400), nunca para baixo', async () => {
    const sessao = await cenario.contaNoApp();
    await como(sessao).post('/v1/privacidade/exportacao').expect(202);

    cenario.api.relogio.definir(new Date(T0.getTime() + 500));
    const repetido = await como(sessao).post('/v1/privacidade/exportacao').expect(429);
    expect(repetido.headers['retry-after']).toBe(String(UM_DIA / 1000));
  });

  it('sessão do `sid` vencida no banco (o JWT ainda dentro dos 15 min): as rotas que conferem a sessão dão 401', async () => {
    const sessao = await cenario.contaNoApp();
    await copiaPronta(sessao);
    await como(sessao).get('/v1/conta').expect(200);
    await cenario.dono.query(
      'UPDATE identidade.sessoes SET expira_em = $2 WHERE conta_id = $1::uuid',
      [sessao.conta.id, new Date(T0.getTime() - 1000)],
    );

    for (const [metodo, caminho] of [
      ['get', '/v1/conta'],
      ['get', '/v1/privacidade/exportacao/arquivo'],
      ['post', '/v1/privacidade/exportacao'],
    ] as const) {
      const resposta = await como(sessao)[metodo](caminho);
      expect(resposta.status, caminho).toBe(401);
      expect(problemaDe(resposta.body).codigo, caminho).toBe('nao_autenticado');
    }
  });
});

// ---------------------------------------------------------------------------
// Download da cópia

describe('download da cópia dos dados (S10)', () => {
  // Q31: o Express manda o HEAD para o handler do GET, que baixava e marcava a cópia como
  // entregue. Agora o HEAD recebe 405 com `Allow: GET`, sem decifrar nem marcar.
  it('HEAD não gasta o uso único: o GET seguinte ainda baixa o arquivo (Q31)', async () => {
    const sessao = await cenario.contaNoApp();
    await copiaPronta(sessao);

    const head = await como(sessao).head('/v1/privacidade/exportacao/arquivo');
    expect(head.status).toBe(405);
    expect(head.headers['allow']).toBe('GET');
    const resposta = await como(sessao).get('/v1/privacidade/exportacao/arquivo');
    expect(resposta.status).toBe(200);
  });

  it('arquivo em UTF-8 com o nome acentuado intacto, só da conta e sem hash de senha, segredo do 2FA nem token', async () => {
    const admin = await cenario.adminNoPainel();
    const sessao: ContaComSessao = {
      conta: admin.conta,
      tokenAcesso: admin.tokenAcesso,
      tokenRenovacao: admin.tokenRenovacao,
    };
    await copiaPronta(sessao);

    const resposta = await como(sessao).get('/v1/privacidade/exportacao/arquivo').expect(200);
    expect(resposta.headers['content-type']).toMatch(/charset=utf-8/i);
    expect(Number(resposta.headers['content-length'])).toBe(Buffer.byteLength(resposta.text));
    const arquivo = JSON.parse(resposta.text) as { identidade: { conta: { nome: string } } };
    expect(arquivo.identidade.conta.nome).toBe(admin.conta.nome);

    const proibidos = [
      { rotulo: 'hash da senha', valor: '$argon2' },
      { rotulo: 'segredo do segundo fator', valor: admin.segredo },
      ...admin.recuperacao.map((codigo) => ({ rotulo: 'código de recuperação', valor: codigo })),
      { rotulo: 'token de acesso', valor: admin.tokenAcesso },
      { rotulo: 'token de renovação', valor: admin.tokenRenovacao },
      { rotulo: 'senha', valor: admin.conta.senha },
    ];
    expect(sensiveisEncontrados({ arquivo: resposta.text }, proibidos)).toEqual([]);
  });

  it('o arquivo de uma conta nunca leva dado da outra', async () => {
    const dona = await cenario.contaNoApp();
    const outra = await cenario.contaNoApp();
    await copiaPronta(dona);
    await copiaPronta(outra);

    const resposta = await como(dona).get('/v1/privacidade/exportacao/arquivo').expect(200);
    expect(
      sensiveisEncontrados({ arquivo: resposta.text }, valoresPessoaisDe(outra.conta)),
    ).toEqual([]);
    expect(resposta.text).not.toContain(outra.conta.id);
  });
});

// ---------------------------------------------------------------------------
// Autorização e conta da sessão

describe('GET /v1/conta e /v1/admin/conta: perfis e caminhos', () => {
  it('perfil `lojista` concedido depois do login já aparece na conta (lido do banco, não do token)', async () => {
    const sessao = await cenario.contaNoApp();
    await cenario.dono.query(
      "INSERT INTO identidade.perfis_conta (conta_id, perfil, concedido_em) VALUES ($1::uuid, 'lojista', $2)",
      [sessao.conta.id, T0],
    );

    const resposta = await como(sessao).get('/v1/conta').expect(200);
    expect(contaSchema.parse(resposta.body).perfis.slice().sort()).toEqual([
      'consumidor',
      'lojista',
    ]);
  });

  it('perfil `admin` retirado no banco: o token do painel de antes recebe 403 em /v1/admin/conta, com log só do id', async () => {
    const admin = await cenario.adminNoPainel();
    await como(admin).get('/v1/admin/conta').expect(200);
    await cenario.dono.query(
      "DELETE FROM identidade.perfis_conta WHERE conta_id = $1::uuid AND perfil = 'admin'",
      [admin.conta.id],
    );
    const antes = cenario.api.registrosDoLog().length;

    const resposta = await como(admin).get('/v1/admin/conta');
    expect(resposta.status).toBe(403);
    const recusas = cenario.api
      .registrosDoLog()
      .slice(antes)
      .filter((registro) => String(registro['msg']).startsWith('acesso negado'));
    expect(recusas).toHaveLength(1);
    expect(recusas[0]?.['contaId']).toBe(admin.conta.id);
    expect(
      sensiveisEncontrados({ log: cenario.api.textoDoLog(), resposta: resposta.text }, [
        ...valoresPessoaisDe(admin.conta),
        { rotulo: 'token de acesso', valor: admin.tokenAcesso },
      ]),
    ).toEqual([]);
  });

  it.each([
    ['/V1/ADMIN/CONTA'],
    ['/v1/admin/conta/'],
    ['/v1/Admin/Conta'],
    ['/v1/admin/conta?contaId=00000000-0000-4000-8000-000000000001'],
  ])('conta sem admin em %s: 403 (nunca 200), e sem token, 401', async (caminho) => {
    const sessao = await cenario.contaNoApp();
    const comum = await como(sessao).get(caminho);
    expect(comum.status).toBe(403);
    expect(comum.text).not.toContain(sessao.conta.nome);
    const semToken = await cenario.api.http.get(caminho).set('X-Forwarded-For', cenario.ip());
    expect(semToken.status).toBe(401);
  });

  it('parâmetros que tentam trocar a conta (?contaId, ?id, ?email) são ignorados: a resposta é sempre a da sessão', async () => {
    const dona = await cenario.contaNoApp();
    const outra = await cenario.contaNoApp();
    for (const parametro of [
      `contaId=${outra.conta.id}`,
      `id=${outra.conta.id}`,
      `email=${encodeURIComponent(outra.conta.email)}`,
    ]) {
      const resposta = await como(dona).get(`/v1/conta?${parametro}`).expect(200);
      expect(contaSchema.parse(resposta.body).nome).toBe(dona.conta.nome);
      const privacidade = await como(dona).get(`/v1/privacidade?${parametro}`).expect(200);
      expect(privacidadeSchema.parse(privacidade.body).exportacaoDisponivelAte).toBeNull();
    }
  });

  it('o corpo não troca a conta: GET com `{ contaId }` e exclusão com `contaId` → 400, nada muda', async () => {
    const dona = await cenario.contaNoApp();
    const outra = await cenario.contaNoApp();
    const leitura = await como(dona).get('/v1/conta').send({ contaId: outra.conta.id });
    expect(leitura.status).toBe(400);
    expect(leitura.text).not.toContain(outra.conta.nome);
    const exclusao = await como(dona)
      .post('/v1/privacidade/exclusao')
      .send({ senha: outra.conta.senha, contaId: outra.conta.id });
    expect(exclusao.status).toBe(400);
    expect(await statusDaConta(outra.conta.id)).toBe('ativa');
    expect(await statusDaConta(dona.conta.id)).toBe('ativa');
  });
});

// ---------------------------------------------------------------------------
// CA-10

describe('GET /v1/privacidade com política nova vigente (CA-10)', () => {
  it('quem aceitou só a versão antiga vê a versão nova e `aceitoEm: null`', async () => {
    const sessao = await cenario.contaNoApp();
    const id = crypto.randomUUID();
    const versao = `e2e-p-nova-${id.slice(0, 8)}`;
    await cenario.dono.query(
      `INSERT INTO identidade.documentos_legais (id, tipo, versao, conteudo, vigente_desde)
       VALUES ($1, 'privacidade', $2, 'Texto novo da política', '2026-08-01T00:00:00Z')`,
      [id, versao],
    );
    try {
      const resposta = await como(sessao).get('/v1/privacidade').expect(200);
      const privacidade = privacidadeSchema.parse(resposta.body);
      expect(privacidade.politica).toEqual({ versao, conteudo: 'Texto novo da política' });
      expect(privacidade.aceitoEm).toBeNull();
    } finally {
      await cenario.dono.query('DELETE FROM identidade.documentos_legais WHERE id = $1::uuid', [
        id,
      ]);
    }
  });
});

// ---------------------------------------------------------------------------
// CA-13 na exclusão

describe('POST /v1/privacidade/exclusao: senha inválida na forma não gasta o freio (CA-13)', () => {
  it.each([
    ['número', 12345],
    ['nulo', null],
    ['lista', ['a', 'b']],
    ['objeto', { $ne: '' }],
    ['enorme', 'a'.repeat(200_000)],
  ])(
    'senha %s → 400 em português, sem eco do valor, conta ativa e freio intacto',
    async (_nome, senha) => {
      const sessao = await cenario.contaNoApp();
      const resposta = await como(sessao).post('/v1/privacidade/exclusao').send({ senha });
      expect([400, 413]).toContain(resposta.status);
      if (resposta.status === 400) {
        const problema = problemaDe(resposta.body);
        expect(problema.codigo).toBe('validacao');
        expect(problema.campos?.[0]?.campo).toBe('senha');
        expect(problema.campos?.[0]?.motivo.trim()).not.toBe('');
      }
      expect(resposta.text.length).toBeLessThan(2_000);
      expect(await statusDaConta(sessao.conta.id)).toBe('ativa');
      expect(await falhasNoFreioPorEmail(sessao.conta.email)).toBe(0);
    },
  );
});

// ---------------------------------------------------------------------------
// Conteúdo do arquivo (CA-10) e repetição da exclusão

describe('conteúdo da cópia dos dados (CA-10)', () => {
  it('traz o formato versionado, os dois aceites com versão e data, os perfis e nada de outra conta', async () => {
    const sessao = await cenario.contaNoApp();
    await cenario.dono.query(
      "INSERT INTO identidade.perfis_conta (conta_id, perfil, concedido_em) VALUES ($1::uuid, 'lojista', $2)",
      [sessao.conta.id, T0],
    );
    await copiaPronta(sessao);

    const resposta = await como(sessao).get('/v1/privacidade/exportacao/arquivo').expect(200);
    const arquivo = JSON.parse(resposta.text) as {
      formato: string;
      versao: number;
      geradaEm: string;
      identidade: {
        conta: { id: string; email: string; telefone: string };
        perfis: { perfil: string; concedidoEm: string }[];
        aceites: { documento: string; versao: string; aceitoEm: string }[];
        segundoFator: { configurado: boolean };
      };
    };
    expect(arquivo.formato).toBe('bairrin.exportacao-do-titular');
    expect(arquivo.versao).toBe(1);
    expect(arquivo.geradaEm).toBe(T0.toISOString());
    expect(arquivo.identidade.conta).toMatchObject({
      id: sessao.conta.id,
      email: sessao.conta.email,
      telefone: sessao.conta.telefone,
    });
    expect(arquivo.identidade.perfis.map(({ perfil }) => perfil).sort()).toEqual([
      'consumidor',
      'lojista',
    ]);
    expect(arquivo.identidade.aceites).toEqual(
      expect.arrayContaining([
        {
          documento: 'termos',
          versao: cenario.docs.termos.versao,
          aceitoEm: T0.toISOString(),
        },
        {
          documento: 'privacidade',
          versao: cenario.docs.privacidade.versao,
          aceitoEm: T0.toISOString(),
        },
      ]),
    );
    expect(arquivo.identidade.aceites).toHaveLength(2);
    expect(arquivo.identidade.segundoFator.configurado).toBe(false);
    expect(resposta.text).not.toContain('concedidoPor');
  });
});

describe('POST /v1/privacidade/exclusao repetida e freio por conta', () => {
  it('com pendência, pedir duas vezes dá 409 nas duas e uma solicitação só, aguardando', async () => {
    const sessao = await cenario.contaNoApp();
    const { conta } = sessao;
    const modulo = `pendencia-repetida-${conta.id}`;
    cenario.api.app.get(RegistroDePendencias).registrar({
      modulo,
      pendenciasDaConta: (contaId) =>
        Promise.resolve(contaId === conta.id ? [{ modulo, tipo: 'pedido_em_andamento' }] : []),
    });

    for (let vez = 0; vez < 2; vez += 1) {
      await como(sessao).post('/v1/privacidade/exclusao').send({ senha: conta.senha }).expect(409);
    }

    expect(await solicitacoes(conta.id)).toEqual([
      { tipo: 'exclusao', status: 'aguardando_pendencias' },
    ]);
    const eventos = await eventosDaConta(cenario.dono, conta.id);
    expect(eventos.map(({ tipo }) => tipo)).not.toContain('identidade.ContaDesativada');
    expect(await falhasNoFreioPorEmail(conta.email)).toBe(0);
  });

  it('outra conta que erra a senha da exclusão até ser freada não trava a exclusão da dona', async () => {
    const dona = await cenario.contaNoApp();
    const atacante = await cenario.contaNoApp();
    for (let vez = 0; vez < 5; vez += 1) {
      await como(atacante)
        .post('/v1/privacidade/exclusao')
        .send({ senha: dona.conta.senha })
        .expect(400);
    }
    // O atacante é freado (com a senha certa dele, inclusive); o freio é o e-mail dele.
    await como(atacante)
      .post('/v1/privacidade/exclusao')
      .send({ senha: atacante.conta.senha })
      .expect(429);
    expect(await falhasNoFreioPorEmail(dona.conta.email)).toBe(0);

    await como(dona).post('/v1/privacidade/exclusao').send({ senha: dona.conta.senha }).expect(202);
    expect(await statusDaConta(dona.conta.id)).toBe('desativada');
    expect(await statusDaConta(atacante.conta.id)).toBe('ativa');
  });
});

// ---------------------------------------------------------------------------
// Sessão renovada e reaproveitada (`@ConfereSessao()` com o `cliente-api`, que renova em todo 401)

describe('rotas que conferem a sessão depois de renovar o token', () => {
  async function renovar(sessao: ContaComSessao) {
    const resposta = await cenario.api.http
      .post('/v1/sessoes/renovacao')
      .set('X-Forwarded-For', cenario.ip())
      .send({ tokenRenovacao: sessao.tokenRenovacao, cliente: 'app_consumidor' });
    return resposta;
  }

  it('o token de acesso novo (renovação) lê a conta, pede e baixa a cópia: a sessão do `sid` segue viva', async () => {
    const sessao = await cenario.contaNoApp();
    cenario.api.relogio.definir(new Date(T0.getTime() + 60_000));
    const renovada = await renovar(sessao);
    expect(renovada.status).toBe(200);
    const nova = sessaoDe(renovada.body);
    expect(nova.tokenAcesso).not.toBe(sessao.tokenAcesso);

    const depois = { tokenAcesso: nova.tokenAcesso };
    await como(depois).get('/v1/conta').expect(200);
    await copiaPronta({ ...sessao, tokenAcesso: nova.tokenAcesso });
    await como(depois).get('/v1/privacidade/exportacao/arquivo').expect(200);
  });

  it('token de renovação antigo reaproveitado revoga a sessão: o token de acesso mais novo cai nessas rotas', async () => {
    const sessao = await cenario.contaNoApp();
    cenario.api.relogio.definir(new Date(T0.getTime() + 60_000));
    const primeira = sessaoDe((await renovar(sessao)).body);
    await como({ tokenAcesso: primeira.tokenAcesso }).get('/v1/conta').expect(200);

    // O token antigo volta depois da tolerância de 60 s (roubado ou repetido): a API o recusa.
    cenario.api.relogio.definir(new Date(T0.getTime() + 125_000));
    const reaproveitado = await renovar(sessao);
    expect(reaproveitado.status).toBe(401);

    // E a família de tokens fica revogada: nem o novo lê a conta ou a cópia.
    for (const [metodo, caminho] of [
      ['get', '/v1/conta'],
      ['post', '/v1/privacidade/exportacao'],
      ['get', '/v1/privacidade/exportacao/arquivo'],
    ] as const) {
      const resposta = await como({ tokenAcesso: primeira.tokenAcesso })[metodo](caminho);
      expect(resposta.status, caminho).toBe(401);
    }
  });
});

// ---------------------------------------------------------------------------
// CA-13 nas rotas autenticadas com corpo malformado

describe('corpo malformado nas rotas autenticadas (CA-13)', () => {
  it.each([
    ['POST', '/v1/privacidade/exclusao'],
    ['POST', '/v1/privacidade/exportacao'],
    ['GET', '/v1/conta'],
    ['GET', '/v1/privacidade'],
    ['GET', '/v1/privacidade/exportacao/arquivo'],
    ['GET', '/v1/admin/conta'],
  ] as const)(
    '%s %s com JSON truncado: 400 em Problem Details, sem eco do texto',
    async (metodo, caminho) => {
      const ehAdmin = caminho.startsWith('/v1/admin');
      const sessao = ehAdmin ? await cenario.adminNoPainel() : await cenario.contaNoApp();
      const segredo = 'fragmento-secreto-123';
      const pedido = como(sessao)[metodo === 'GET' ? 'get' : 'post'](caminho);
      const resposta = await pedido
        .set('Content-Type', 'application/json')
        .send(`{"senha":"${segredo}`);
      expect(resposta.status).toBe(400);
      expect(problemaDe(resposta.body).codigo).toBe('validacao');
      expect(resposta.text).not.toContain(segredo);
      expect(resposta.text.length).toBeLessThan(2_000);
      if (caminho === '/v1/privacidade/exclusao') {
        expect(await statusDaConta(sessao.conta.id)).toBe('ativa');
        expect(await falhasNoFreioPorEmail(sessao.conta.email)).toBe(0);
      }
    },
  );

  it('corpo com Content-Type de texto ou formulário na exclusão: 4xx sem gastar o freio nem desativar a conta', async () => {
    const sessao = await cenario.contaNoApp();
    for (const [tipo, corpo] of [
      ['text/plain', `senha=${sessao.conta.senha}`],
      ['application/x-www-form-urlencoded', `senha=${encodeURIComponent(sessao.conta.senha)}`],
    ] as const) {
      const resposta = await como(sessao)
        .post('/v1/privacidade/exclusao')
        .set('Content-Type', tipo)
        .send(corpo);
      expect(resposta.status, tipo).toBeGreaterThanOrEqual(400);
      expect(resposta.status, tipo).toBeLessThan(500);
      expect(resposta.text, tipo).not.toContain(sessao.conta.senha);
    }
    expect(await statusDaConta(sessao.conta.id)).toBe('ativa');
    expect(await falhasNoFreioPorEmail(sessao.conta.email)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Senha da exclusão

describe('senha da exclusão com acento', () => {
  it('a mesma senha digitada decomposta (NFD) confirma a exclusão, como no login', async () => {
    const conta = await cadastrar(cenario.p, cenario.docs, {
      senha: 'maçã-verde-canção-72',
      nome: 'Ana Qwerty',
    });
    cenario.anotar(conta);
    const sessao = await cenario.entrarNoApp(conta);
    const decomposta = conta.senha.normalize('NFD');
    expect(decomposta).not.toBe(conta.senha);

    // O login aceita a forma decomposta...
    await cenario.api.http
      .post('/v1/sessoes')
      .set('X-Forwarded-For', cenario.ip())
      .send({ email: conta.email, senha: decomposta, cliente: 'app_consumidor' })
      .expect(200);
    // ... e a exclusão também.
    await como(sessao).post('/v1/privacidade/exclusao').send({ senha: decomposta }).expect(202);
    expect(await statusDaConta(conta.id)).toBe('desativada');
  });
});

// ---------------------------------------------------------------------------
// Cópia adulterada no banco (S10: a conta entra como dado autenticado da cifra)

describe('cópia dos dados adulterada ou trocada de conta no banco', () => {
  async function guardada(contaId: string): Promise<string> {
    const { rows } = await cenario.dono.query<{ c: string }>(
      'SELECT conteudo_cifrado AS c FROM identidade.exportacoes_titular WHERE conta_id = $1::uuid',
      [contaId],
    );
    return rows[0]?.c ?? '';
  }

  it('a cifra de uma conta posta na linha de outra não é entregue: 5xx sem conteúdo, nada marcado como baixado', async () => {
    const dona = await cenario.contaNoApp();
    const vitima = await cenario.contaNoApp();
    await copiaPronta(dona);
    await copiaPronta(vitima);
    await cenario.dono.query(
      'UPDATE identidade.exportacoes_titular SET conteudo_cifrado = $2 WHERE conta_id = $1::uuid',
      [dona.conta.id, await guardada(vitima.conta.id)],
    );

    const resposta = await como(dona).get('/v1/privacidade/exportacao/arquivo');
    expect(resposta.status).toBe(500);
    expect(problemaDe(resposta.body).codigo).toBe('erro_interno');
    expect(
      sensiveisEncontrados({ resposta: resposta.text, log: cenario.api.textoDoLog() }, [
        ...valoresPessoaisDe(vitima.conta),
        ...valoresPessoaisDe(dona.conta),
      ]),
    ).toEqual([]);
    const { rows } = await cenario.dono.query<{ baixada: boolean }>(
      `SELECT baixada_em IS NOT NULL AS baixada
         FROM identidade.exportacoes_titular WHERE conta_id = $1::uuid`,
      [dona.conta.id],
    );
    expect(rows).toEqual([{ baixada: false }]);
  });

  it('um byte alterado na cifra: 5xx sem conteúdo, nada marcado como baixado', async () => {
    const sessao = await cenario.contaNoApp();
    await copiaPronta(sessao);
    const original = await guardada(sessao.conta.id);
    const meio = Math.floor(original.length / 2);
    const trocado = original[meio] === 'A' ? 'B' : 'A';
    await cenario.dono.query(
      'UPDATE identidade.exportacoes_titular SET conteudo_cifrado = $2 WHERE conta_id = $1::uuid',
      [sessao.conta.id, `${original.slice(0, meio)}${trocado}${original.slice(meio + 1)}`],
    );

    const resposta = await como(sessao).get('/v1/privacidade/exportacao/arquivo');
    expect(resposta.status).toBe(500);
    expect(resposta.text).not.toContain(sessao.conta.email);
    const { rows } = await cenario.dono.query<{ baixada: boolean }>(
      `SELECT baixada_em IS NOT NULL AS baixada
         FROM identidade.exportacoes_titular WHERE conta_id = $1::uuid`,
      [sessao.conta.id],
    );
    expect(rows).toEqual([{ baixada: false }]);
  });
});

describe('variantes de caminho nas rotas que conferem a sessão (S8)', () => {
  it.each([
    ['get', '/V1/CONTA'],
    ['get', '/v1/conta/'],
    ['get', '/v1/Privacidade/Exportacao/Arquivo'],
    ['post', '/V1/PRIVACIDADE/EXPORTACAO'],
  ] as const)(
    'depois do logout, %s %s dá 401 (a conferência vale pelo handler, não pela URL pedida)',
    async (metodo, caminho) => {
      const sessao = await cenario.contaNoApp();
      await como(sessao).get('/v1/conta').expect(200);
      await cenario.api.http
        .delete('/v1/sessoes/atual')
        .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
        .set('X-Forwarded-For', cenario.ip())
        .expect(204);

      const resposta = await como(sessao)[metodo](caminho);
      expect(resposta.status).toBe(401);
      expect(problemaDe(resposta.body).codigo).toBe('nao_autenticado');
    },
  );
});
