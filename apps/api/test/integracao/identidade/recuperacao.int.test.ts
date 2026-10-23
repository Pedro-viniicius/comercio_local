// Recuperação e redefinição de senha pela API inteira (plano 01b, etapa 16; CA-05, CA-06;
// P1-dono, S14, S74, S82, S93), contra o Postgres de teste.
//
// - `POST /v1/senha/recuperacao`: 202 sempre, exista ou não a conta; 10 por hora por IP,
//   conferido antes do de 3 por hora por e-mail (S109);
// - `POST /v1/senha/redefinicao`: 204 revoga todas as sessões (inclusive as de quem criou a
//   conta antes com o e-mail de outra pessoa) e verifica o e-mail; código errado → 400; senha
//   comum pela lista pública → 400; freio por e-mail → 429; o `ip` da requisição vai para o
//   freio por origem (dois IPs, cada um com o seu freio).
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  chaveDoFreioPorOrigem,
  ORIGEM_DESCONHECIDA,
} from '../../../src/modulos/identidade/aplicacao/sessao/comum.ts';
import { type ApiDeTeste, ipNovo, problemaDe, sessaoDe, subirApi } from './api-http.ts';
import {
  apagarContasDoTeste,
  cadastrar,
  type ContaDeTeste,
  conectarDono,
  type DocumentosDeTeste,
  emailUnico,
  eventosDaConta,
  inserirCodigo,
  montarPilha,
  OUTRA_SENHA,
  type Pilha,
  semearDocumentos,
  sessoesVivas,
  T0,
  UM_MINUTO,
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

async function novaConta(): Promise<ContaDeTeste> {
  const conta = await cadastrar(p, docs);
  contasDoTeste.push(conta.id);
  freiosDoTeste.push(p.servicos.cifrador.hmac('bloqueio_email', [conta.email]));
  return conta;
}

function recuperar(email: string, origem = ip()) {
  return api.http.post('/v1/senha/recuperacao').set('X-Forwarded-For', origem).send({ email });
}

function redefinir(corpo: object, origem = ip()) {
  return api.http.post('/v1/senha/redefinicao').set('X-Forwarded-For', origem).send(corpo);
}

function entrarNoApp(conta: ContaDeTeste, senha = conta.senha) {
  return api.http
    .post('/v1/sessoes')
    .set('X-Forwarded-For', ip())
    .send({ email: conta.email, senha, cliente: 'app_consumidor' });
}

async function falhasDoFreio(chave: string): Promise<number | null> {
  const { rows } = await dono.query<{ falhas: number }>(
    "SELECT falhas FROM identidade.bloqueios_login WHERE chave_hmac = $1 AND tipo = 'ip'",
    [chave],
  );
  return rows[0]?.falhas ?? null;
}

describe('POST /v1/senha/recuperacao (CA-06)', () => {
  it('202 sem corpo, igual com e sem conta; só a conta existente recebe RecuperacaoSolicitada', async () => {
    const conta = await novaConta();
    const semConta = emailUnico('sem-conta');

    const comConta = await recuperar(conta.email).expect(202);
    const inexistente = await recuperar(semConta).expect(202);

    expect(comConta.text).toBe('');
    expect(inexistente.text).toBe('');
    expect(comConta.headers['content-length']).toBe(inexistente.headers['content-length']);
    expect((await eventosDaConta(dono, conta.id)).map(({ tipo }) => tipo)).toContain(
      'identidade.RecuperacaoSolicitada',
    );
  });

  it('3 por hora por e-mail (normalizado), de qualquer IP; outro e-mail segue', async () => {
    const email = emailUnico('limite');
    for (let vez = 0; vez < 3; vez += 1) await recuperar(vez === 1 ? email.toUpperCase() : email);
    const recusado = await recuperar(` ${email} `).expect(429);
    expect(recusado.headers['retry-after']).toMatch(/^[1-9]\d*$/);
    await recuperar(emailUnico('limite')).expect(202);
  });

  it('10 por hora por IP, antes do pipe', async () => {
    const origem = ip();
    for (let vez = 0; vez < 10; vez += 1) await recuperar('nao-e-email', origem).expect(400);
    await recuperar(emailUnico('limite'), origem).expect(429);
  });

  it('IP bloqueado não gasta o contador do e-mail: de outro IP, o mesmo e-mail ainda passa 3 vezes (S109)', async () => {
    const origem = ip();
    for (let vez = 0; vez < 10; vez += 1) await recuperar('nao-e-email', origem).expect(400);
    const email = emailUnico('s109');
    // O IP é conferido antes do e-mail: estas recusas não contam para o e-mail.
    for (let vez = 0; vez < 4; vez += 1) await recuperar(email, origem).expect(429);
    for (let vez = 0; vez < 3; vez += 1) await recuperar(email).expect(202);
    await recuperar(email).expect(429);
  });
});

describe('POST /v1/senha/redefinicao (CA-05, CA-06, P1-dono)', () => {
  it('204: troca a senha, verifica o e-mail e revoga as sessões de quem criou a conta antes', async () => {
    // Alguém cadastrou o e-mail de outra pessoa e entrou no app (P1-dono).
    const conta = await novaConta();
    const doIntruso = sessaoDe((await entrarNoApp(conta).expect(200)).body);
    // A dona do e-mail recupera a senha.
    await inserirCodigo(p, conta.id, 'recuperacao_senha', '654321');

    await redefinir({ email: conta.email, codigo: '654321', novaSenha: OUTRA_SENHA }).expect(204);

    expect(await sessoesVivas(dono, conta.id)).toBe(0);
    await api.http
      .post('/v1/sessoes/renovacao')
      .send({ tokenRenovacao: doIntruso.tokenRenovacao, cliente: 'app_consumidor' })
      .expect(401);
    await entrarNoApp(conta).expect(401);
    const nova = sessaoDe((await entrarNoApp(conta, OUTRA_SENHA).expect(200)).body);
    expect(nova.emailVerificado).toBe(true);
    // Uso único (CA-06): o mesmo código não serve de novo.
    await redefinir({
      email: conta.email,
      codigo: '654321',
      novaSenha: 'outra-senha-boa-93',
    }).expect(400);
  });

  it('o código vale 30 minutos (CA-06): depois disso, 400 no código', async () => {
    const conta = await novaConta();
    await inserirCodigo(p, conta.id, 'recuperacao_senha', '654321');
    api.relogio.avancar(30 * UM_MINUTO + 1_000);
    const resposta = await redefinir({
      email: conta.email,
      codigo: '654321',
      novaSenha: OUTRA_SENHA,
    }).expect(400);
    expect(problemaDe(resposta.body).campos).toEqual([
      expect.objectContaining({ campo: 'codigo', codigo: 'invalido' }),
    ]);
    await entrarNoApp(conta).expect(200);
  });

  it('código errado → 400 `campos[codigo].invalido`; e-mail sem conta, o mesmo 400', async () => {
    const conta = await novaConta();
    await inserirCodigo(p, conta.id, 'recuperacao_senha', '654321');
    const errado = await redefinir({
      email: conta.email,
      codigo: '000000',
      novaSenha: OUTRA_SENHA,
    }).expect(400);
    const semConta = emailUnico('sem-conta');
    freiosDoTeste.push(p.servicos.cifrador.hmac('bloqueio_email', [semConta]));
    const inexistente = await redefinir({
      email: semConta,
      codigo: '000000',
      novaSenha: OUTRA_SENHA,
    }).expect(400);

    for (const resposta of [errado, inexistente]) {
      expect(problemaDe(resposta.body).campos).toEqual([
        { campo: 'codigo', codigo: 'invalido', motivo: expect.any(String) as string },
      ]);
    }
  });

  it('senha só da lista pública (`sorvete123`) → 400 `campos[novaSenha].comum`, sem gastar o código', async () => {
    const conta = await novaConta();
    await inserirCodigo(p, conta.id, 'recuperacao_senha', '654321');
    const resposta = await redefinir({
      email: conta.email,
      codigo: '654321',
      novaSenha: 'sorvete123',
    }).expect(400);
    expect(problemaDe(resposta.body).campos).toEqual([
      expect.objectContaining({ campo: 'novaSenha', codigo: 'comum' }),
    ]);
    await redefinir({ email: conta.email, codigo: '654321', novaSenha: OUTRA_SENHA }).expect(204);
  });

  it('cinco códigos errados pelo e-mail → 429 com Retry-After, mesmo com o código certo (S14)', async () => {
    const conta = await novaConta();
    await inserirCodigo(p, conta.id, 'recuperacao_senha', '654321');
    for (let vez = 0; vez < 5; vez += 1) {
      await redefinir({ email: conta.email, codigo: '000000', novaSenha: OUTRA_SENHA }).expect(400);
    }
    const freado = await redefinir({
      email: conta.email,
      codigo: '654321',
      novaSenha: OUTRA_SENHA,
    }).expect(429);
    expect(problemaDe(freado.body).codigo).toBe('limite_excedido');
    expect(freado.headers['retry-after']).toBe('60');
  });

  it('o IP da requisição vai para o freio por origem: dois IPs, cada um com o seu (S93)', async () => {
    const conta = await novaConta();
    await inserirCodigo(p, conta.id, 'recuperacao_senha', '654321');
    const [freado, livre, errado] = [ip(), ip(), ip()];
    await dono.query(
      `INSERT INTO identidade.bloqueios_login (chave_hmac, tipo, falhas, nivel, janela_inicio, bloqueado_ate)
       VALUES ($1, 'ip', 50, 1, $2, $3)`,
      [chaveDoFreioPorOrigem(p.servicos.cifrador, freado), T0, new Date(T0.getTime() + UM_MINUTO)],
    );
    const desconhecida = await falhasDoFreio(
      p.servicos.cifrador.hmac('bloqueio_ip', [ORIGEM_DESCONHECIDA]),
    );

    // O código errado soma no freio do IP de quem pediu, não no `origem:desconhecida`.
    await redefinir(
      { email: conta.email, codigo: '000000', novaSenha: OUTRA_SENHA },
      errado,
    ).expect(400);
    expect(await falhasDoFreio(chaveDoFreioPorOrigem(p.servicos.cifrador, errado))).toBe(1);
    expect(
      await falhasDoFreio(p.servicos.cifrador.hmac('bloqueio_ip', [ORIGEM_DESCONHECIDA])),
    ).toBe(desconhecida);

    const recusado = await redefinir(
      { email: conta.email, codigo: '654321', novaSenha: OUTRA_SENHA },
      freado,
    ).expect(429);
    expect(recusado.headers['retry-after']).toBe('60');
    await redefinir({ email: conta.email, codigo: '654321', novaSenha: OUTRA_SENHA }, livre).expect(
      204,
    );
  });

  it('21ª redefinição do mesmo IP em 15 min → 429 antes do pipe (S82)', async () => {
    const origem = ip();
    for (let vez = 0; vez < 20; vez += 1) await redefinir({}, origem).expect(400);
    await redefinir(
      { email: 'x@exemplo.com', codigo: '000000', novaSenha: 'sorvete123' },
      origem,
    ).expect(429);
  });
});
