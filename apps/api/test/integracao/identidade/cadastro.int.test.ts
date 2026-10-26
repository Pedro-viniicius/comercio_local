// Cadastro e verificação de e-mail pela API inteira (plano 01b, etapa 16; CA-01, CA-02,
// CA-13; P1-dono, S24, S74, S82, S93, S100), contra o Postgres de teste.
//
// - `POST /v1/contas`: 202 com a mensagem fixa, igual para e-mail novo e em uso (CA-02, sem
//   alterar a conta existente); senha comum pela lista pública com o mesmo 400 nos dois
//   casos; versão de documento divergente; limite de 10 por hora por IP antes do pipe (S100,
//   S82);
// - `POST /v1/conta/verificacao-email` e `.../reenvio` (com sessão): 401 sem sessão; código
//   errado → 400 e uma tentativa a mais (não duas); freio por e-mail → 429; código certo →
//   sessão nova com `emailVerificado`; reenvio 3 por hora por conta.
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import { type ApiDeTeste, ipNovo, problemaDe, semId, sessaoDe, subirApi } from './api-http.ts';
import {
  apagarContasDoTeste,
  conectarDono,
  type DocumentosDeTeste,
  emailUnico,
  eventosDaConta,
  inserirCodigo,
  montarPilha,
  NOME_PADRAO,
  OUTRA_SENHA,
  type Pilha,
  SENHA,
  semearDocumentos,
  sessoesDaConta,
  T0,
} from './pilha-de-casos-de-uso.ts';

let p: Pilha;
let dono: pg.Client;
let docs: DocumentosDeTeste;
let api: ApiDeTeste;
const contasDoTeste: string[] = [];
const freiosDoTeste: string[] = [];

beforeAll(async () => {
  p = montarPilha();
  dono = await conectarDono();
  docs = await semearDocumentos(dono);
  api = await subirApi();
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

function ip(): string {
  return ipNovo(p, freiosDoTeste);
}

function corpoDoCadastro(email: string, extra: Record<string, unknown> = {}) {
  return {
    nome: NOME_PADRAO,
    email,
    telefone: '(35) 99999-1234',
    senha: SENHA,
    aceites: { termos: docs.termos.versao, privacidade: docs.privacidade.versao },
    ...extra,
  };
}

function cadastrar(corpo: unknown, origem = ip()) {
  return api.http
    .post('/v1/contas')
    .set('X-Forwarded-For', origem)
    .send(corpo as object);
}

/** A conta gravada para o e-mail, anotada para a limpeza (com o freio por e-mail). */
async function contaDoEmail(email: string) {
  const conta = await p.repos.contas.buscarPorEmail(Email.criar(email));
  if (conta !== null && !contasDoTeste.includes(conta.id)) {
    contasDoTeste.push(conta.id);
    freiosDoTeste.push(p.servicos.cifrador.hmac('bloqueio_email', [email]));
  }
  return conta;
}

async function linhaDaConta(id: string) {
  const { rows } = await dono.query<Record<string, unknown>>(
    `SELECT nome, telefone_e164, senha_hash, email_verificado_em FROM identidade.contas WHERE id = $1::uuid`,
    [id],
  );
  return rows[0];
}

/** Cadastra pela rota e entra no app pela rota: a conta e a sessão. */
async function cadastrarEEntrar() {
  const email = emailUnico('cadastro');
  await cadastrar(corpoDoCadastro(email)).expect(202);
  const conta = await contaDoEmail(email);
  if (conta === null) throw new Error('a conta não foi gravada');
  const login = await api.http
    .post('/v1/sessoes')
    .set('X-Forwarded-For', ip())
    .send({ email, senha: SENHA, cliente: 'app_consumidor' })
    .expect(200);
  return { email, conta, sessao: sessaoDe(login.body) };
}

describe('POST /v1/contas (CA-01, CA-02)', () => {
  it('202 com a mensagem fixa; grava a conta com o celular em E.164, os aceites e ContaCriada', async () => {
    const email = emailUnico('cadastro');
    const resposta = await cadastrar(corpoDoCadastro(email)).expect(202);

    expect(resposta.body).toEqual({ mensagem: 'Verifique seu e-mail para continuar.' });
    expect(resposta.headers['cache-control']).toBe('no-store');
    const conta = await contaDoEmail(email);
    if (conta === null) throw new Error('a conta não foi gravada');
    expect(await linhaDaConta(conta.id)).toMatchObject({
      nome: NOME_PADRAO,
      telefone_e164: '+5535999991234',
      email_verificado_em: null,
    });
    const { rows } = await dono.query(
      'SELECT count(*)::int AS n FROM identidade.consentimentos WHERE conta_id = $1::uuid',
      [conta.id],
    );
    expect(rows[0]).toEqual({ n: 2 });
    expect(await eventosDaConta(dono, conta.id)).toEqual([
      { tipo: 'identidade.ContaCriada', payload: { contaId: conta.id } },
    ]);
  });

  it('e-mail já cadastrado: a mesma resposta, nada muda na conta e o dono recebe o aviso (CA-02)', async () => {
    const email = emailUnico('cadastro');
    const primeira = await cadastrar(corpoDoCadastro(email)).expect(202);
    const conta = await contaDoEmail(email);
    if (conta === null) throw new Error('a conta não foi gravada');
    const antes = await linhaDaConta(conta.id);

    const segunda = await cadastrar(
      corpoDoCadastro(email.toUpperCase(), {
        nome: 'Outra Pessoa',
        telefone: '(11) 98888-7777',
        senha: OUTRA_SENHA,
      }),
    ).expect(202);

    expect(segunda.body).toEqual(primeira.body);
    expect(await linhaDaConta(conta.id)).toEqual(antes);
    expect((await eventosDaConta(dono, conta.id)).map(({ tipo }) => tipo)).toEqual([
      'identidade.CadastroRepetidoTentado',
      'identidade.ContaCriada',
    ]);
    // A senha antiga continua sendo a única que entra.
    await api.http
      .post('/v1/sessoes')
      .set('X-Forwarded-For', ip())
      .send({ email, senha: OUTRA_SENHA, cliente: 'app_consumidor' })
      .expect(401);
  });

  it('senha só da lista pública (`sorvete123`): 400 `campos[senha].comum`, igual para e-mail novo e em uso (S74, CA-02)', async () => {
    const emUso = emailUnico('cadastro');
    await cadastrar(corpoDoCadastro(emUso)).expect(202);
    const conta = await contaDoEmail(emUso);
    const novo = emailUnico('cadastro');

    const paraNovo = await cadastrar(corpoDoCadastro(novo, { senha: 'sorvete123' })).expect(400);
    const paraEmUso = await cadastrar(corpoDoCadastro(emUso, { senha: 'sorvete123' })).expect(400);

    expect(problemaDe(paraNovo.body).campos).toEqual([
      expect.objectContaining({ campo: 'senha', codigo: 'comum' }),
    ]);
    expect(semId(paraNovo.body)).toEqual(semId(paraEmUso.body));
    expect(await contaDoEmail(novo)).toBeNull();
    expect((await eventosDaConta(dono, conta?.id ?? '')).map(({ tipo }) => tipo)).toEqual([
      'identidade.ContaCriada',
    ]);
  });

  it('versão de documento diferente da vigente → 400 `campos[aceites.termos].invalido` (S24)', async () => {
    const email = emailUnico('cadastro');
    const resposta = await cadastrar(
      corpoDoCadastro(email, {
        aceites: { termos: 'versao-antiga', privacidade: docs.privacidade.versao },
      }),
    ).expect(400);
    expect(problemaDe(resposta.body).campos).toEqual([
      expect.objectContaining({ campo: 'aceites.termos', codigo: 'invalido' }),
    ]);
    expect(await contaDoEmail(email)).toBeNull();
  });

  it('celular fixo e campo desconhecido → 400 com os campos em português (CA-01, CA-13)', async () => {
    const resposta = await cadastrar(
      corpoDoCadastro(emailUnico('cadastro'), { telefone: '(35) 3531-1234', apelido: 'x' }),
    ).expect(400);
    const campos = problemaDe(resposta.body).campos ?? [];
    expect(campos.map(({ campo, codigo }) => ({ campo, codigo }))).toEqual(
      expect.arrayContaining([
        { campo: 'telefone', codigo: 'invalido' },
        { campo: 'apelido', codigo: 'desconhecido' },
      ]),
    );
  });

  it('11º cadastro do mesmo IP na hora → 429 antes do pipe (S100, S82); outro IP segue', async () => {
    const origem = ip();
    for (let vez = 0; vez < 10; vez += 1) {
      await cadastrar({}, origem).expect(400);
    }
    const recusado = await cadastrar(
      corpoDoCadastro(emailUnico('cadastro'), { senha: 'sorvete123' }),
      origem,
    ).expect(429);
    expect(problemaDe(recusado.body).codigo).toBe('limite_excedido');
    expect(recusado.headers['retry-after']).toMatch(/^[1-9]\d*$/);
    await cadastrar({}, ip()).expect(400);
  });
});

describe('POST /v1/conta/verificacao-email (CA-01, P1-dono, S93)', () => {
  it('sem sessão → 401', async () => {
    await api.http.post('/v1/conta/verificacao-email').send({ codigo: '123456' }).expect(401);
    await api.http.post('/v1/conta/verificacao-email/reenvio').expect(401);
  });

  it('código errado → 400 `campos[codigo].invalido` e uma tentativa a mais no código, não duas', async () => {
    const { conta, sessao } = await cadastrarEEntrar();
    await inserirCodigo(p, conta.id, 'verificacao_email', '111111');

    const resposta = await api.http
      .post('/v1/conta/verificacao-email')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({ codigo: '222222' })
      .expect(400);

    expect(problemaDe(resposta.body).campos).toEqual([
      expect.objectContaining({ campo: 'codigo', codigo: 'invalido' }),
    ]);
    const { rows } = await dono.query(
      `SELECT tentativas FROM identidade.codigos_verificacao
        WHERE conta_id = $1::uuid AND finalidade = 'verificacao_email'`,
      [conta.id],
    );
    expect(rows).toEqual([{ tentativas: 1 }]);
  });

  it('código certo → 200 com a sessão nova e `emailVerificado`, e a antiga revogada', async () => {
    const { conta, sessao } = await cadastrarEEntrar();
    expect(sessao.emailVerificado).toBe(false);
    await inserirCodigo(p, conta.id, 'verificacao_email', '123456');

    const resposta = await api.http
      .post('/v1/conta/verificacao-email')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({ codigo: '123 456' })
      .expect(200);

    const nova = sessaoDe(resposta.body);
    expect(nova.emailVerificado).toBe(true);
    expect(nova.tokenRenovacao).toBeDefined();
    expect(resposta.headers['set-cookie']).toBeUndefined();
    const sessoes = await sessoesDaConta(dono, conta.id);
    // As duas nascem no mesmo instante do relógio parado: sem ordem entre elas.
    expect(sessoes.map((s) => s.motivo_revogacao ?? 'viva').sort()).toEqual([
      'substituida',
      'viva',
    ]);
    expect((await linhaDaConta(conta.id))?.['email_verificado_em']).toEqual(T0);
  });

  it('cinco códigos que não servem → o sexto pedido recebe 429 com Retry-After (freio por e-mail, S93)', async () => {
    const { conta, sessao } = await cadastrarEEntrar();
    await inserirCodigo(p, conta.id, 'verificacao_email', '111111');
    const verificar = (codigo: string) =>
      api.http
        .post('/v1/conta/verificacao-email')
        .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
        .send({ codigo });
    for (let vez = 0; vez < 5; vez += 1) await verificar('999999').expect(400);

    const freado = await verificar('111111').expect(429);
    expect(problemaDe(freado.body).codigo).toBe('limite_excedido');
    expect(freado.headers['retry-after']).toBe('60');
  });

  it('sessão encerrada entre a guarda e o caso de uso → 401 (exceção registrada ao "401 só da guarda")', async () => {
    const { conta, sessao } = await cadastrarEEntrar();
    await inserirCodigo(p, conta.id, 'verificacao_email', '123456');
    await api.http
      .delete('/v1/sessoes/atual')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(204);
    // O token de acesso ainda vale 15 min fora de /v1/admin (S8): a guarda deixa passar e o
    // caso de uso recusa a sessão revogada, sem gastar o código.
    await api.http
      .post('/v1/conta/verificacao-email')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({ codigo: '123456' })
      .expect(401);
    const { rows } = await dono.query(
      `SELECT tentativas, usado_em FROM identidade.codigos_verificacao
        WHERE conta_id = $1::uuid AND finalidade = 'verificacao_email'`,
      [conta.id],
    );
    expect(rows).toEqual([{ tentativas: 0, usado_em: null }]);
  });
});

describe('POST /v1/conta/verificacao-email/reenvio (CA-01)', () => {
  it('202 e VerificacaoReenviada; o quarto pedido da conta na hora → 429', async () => {
    const { conta, sessao } = await cadastrarEEntrar();
    const reenviar = () =>
      api.http
        .post('/v1/conta/verificacao-email/reenvio')
        .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
        .set('X-Forwarded-For', ip());
    for (let vez = 0; vez < 3; vez += 1) await reenviar().expect(202);
    const recusado = await reenviar().expect(429);
    expect(recusado.headers['retry-after']).toMatch(/^[1-9]\d*$/);
    const tipos = (await eventosDaConta(dono, conta.id)).map(({ tipo }) => tipo);
    expect(tipos.filter((tipo) => tipo === 'identidade.VerificacaoReenviada')).toHaveLength(3);
  });

  it('o limite por conta vem antes do por IP: a 4ª recusa da conta em diante não gasta a cota do IP (etapa 19, CGNAT)', async () => {
    // Todas as contas atrás do mesmo IP (operadora com CGNAT): 10 por hora para o IP.
    const ipDividido = ip();
    const contas = await Promise.all([1, 2, 3, 4, 5].map(() => cadastrarEEntrar()));
    const reenviar = (indice: number) =>
      api.http
        .post('/v1/conta/verificacao-email/reenvio')
        .set('Authorization', `Bearer ${contas[indice]?.sessao.tokenAcesso ?? ''}`)
        .set('X-Forwarded-For', ipDividido);

    for (let vez = 0; vez < 3; vez += 1) await reenviar(0).expect(202);
    // A conta insistente: sete recusas pelo limite dela (com o IP primeiro, teriam esgotado o IP).
    for (let vez = 0; vez < 7; vez += 1) await reenviar(0).expect(429);
    // O IP só contou os 3 aceitos: cabem mais 7 de outras contas.
    for (const indice of [1, 1, 1, 2, 2, 2, 3]) await reenviar(indice).expect(202);
    // Agora o IP chegou a 10: a conta 3 (no 2º pedido) e a 4 (no 1º) caem no limite do IP.
    await reenviar(3).expect(429);
    const peloIp = await reenviar(4).expect(429);
    expect(peloIp.headers['retry-after']).toMatch(/^[1-9]\d*$/);
  });

  it('corpo com campo → 400 `desconhecido`', async () => {
    const { sessao } = await cadastrarEEntrar();
    const resposta = await api.http
      .post('/v1/conta/verificacao-email/reenvio')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({ email: 'outro@exemplo.com' })
      .expect(400);
    expect(problemaDe(resposta.body).campos).toEqual([
      expect.objectContaining({ campo: 'email', codigo: 'desconhecido' }),
    ]);
  });
});
