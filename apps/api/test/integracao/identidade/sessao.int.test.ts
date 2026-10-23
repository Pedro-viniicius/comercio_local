// Rotas de sessão da Identidade pela API inteira (plano 01b, etapa 16; CA-03, CA-04, CA-05,
// CA-07; S1, S8, S16, S23, S77, S80, S82), contra o Postgres de teste.
//
// - `POST /v1/sessoes`: sessão dos apps, desafio do painel, 403 `sem_acesso_painel`, 401
//   único, 429 com `Retry-After` (freio por e-mail e por origem) e o tempo das respostas (S23);
// - `POST /v1/sessoes/renovacao`: apps pelo corpo (com `cliente`), painel pelo cookie com
//   `X-Cliente: painel` da origem do painel (prova o `cookie-parser`), reuso (S77);
// - `DELETE /v1/sessoes/renovacao` (S80) e `DELETE /v1/sessoes/atual` (CA-05);
// - a guarda global nas rotas de `/v1/admin`: a sessão do `sid` conferida a cada requisição (S8).
import { performance } from 'node:perf_hooks';
import { Controller, Get } from '@nestjs/common';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ContaAutenticada } from '../../../src/compartilhado/autenticacao/verificador-de-acesso.ts';
import { ContaAtual } from '../../../src/compartilhado/http/autenticacao/conta-atual.decorator.ts';
import { ExigeMfa } from '../../../src/compartilhado/http/autenticacao/exige-mfa.guard.ts';
import { Perfis } from '../../../src/compartilhado/http/autenticacao/perfis.guard.ts';
import { chaveDoFreioPorOrigem } from '../../../src/modulos/identidade/aplicacao/sessao/comum.ts';
import { DURACAO_MAXIMA_NO_PAINEL_EM_MS } from '../../../src/modulos/identidade/dominio/sessao.ts';
import {
  type ApiDeTeste,
  comCookie,
  cookieDeRenovacao,
  ipNovo,
  ORIGEM_DO_PAINEL,
  problemaDe,
  semId,
  sessaoDe,
  setCookies,
  subirApi,
} from './api-http.ts';
import {
  apagarContasDoTeste,
  cadastrar,
  type ContaDeTeste,
  conectarDono,
  type DocumentosDeTeste,
  emailUnico,
  montarPilha,
  OUTRA_SENHA,
  type Pilha,
  prepararAdmin,
  semearDocumentos,
  sessoesDaConta,
  sessoesVivas,
  T0,
  UM_DIA,
  UM_MINUTO,
} from './pilha-de-casos-de-uso.ts';

/** Rota de admin só do teste: a guarda global confere a sessão do `sid` (S8). */
@Perfis('admin')
@ExigeMfa()
@Controller('v1/admin/sonda-da-sessao')
class RotaDeAdminDaSonda {
  @Get()
  ver(@ContaAtual() conta: ContaAutenticada) {
    return { contaId: conta.contaId };
  }
}

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
  api = await subirApi({ controllers: [RotaDeAdminDaSonda] });
});

beforeEach(() => {
  // O relógio da API volta a `T0` (o da pilha, que prepara as contas, fica em `T0`).
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

function freioPorEmail(email: string): string {
  return p.servicos.cifrador.hmac('bloqueio_email', [email]);
}

/** Conta comum cadastrada pelo caso de uso, com os freios dela anotados para a limpeza. */
async function novaConta(): Promise<ContaDeTeste> {
  const conta = await cadastrar(p, docs);
  contasDoTeste.push(conta.id);
  freiosDoTeste.push(freioPorEmail(conta.email));
  return conta;
}

async function adminComSegundoFator() {
  const admin = await prepararAdmin(p, docs, ip());
  contasDoTeste.push(admin.conta.id);
  freiosDoTeste.push(
    freioPorEmail(admin.conta.email),
    p.servicos.cifrador.hmac('bloqueio_segundo_fator', [admin.conta.id]),
  );
  return admin;
}

function entrar(corpo: { email: string; senha: string; cliente: string }, origem = ip()) {
  return api.http.post('/v1/sessoes').set('X-Forwarded-For', origem).send(corpo);
}

function renovarNoApp(tokenRenovacao: string, cliente = 'app_consumidor') {
  return api.http.post('/v1/sessoes/renovacao').send({ tokenRenovacao, cliente });
}

function renovarNoPainel(token: string | null, origem: string | null = ORIGEM_DO_PAINEL) {
  const pedido = api.http.post('/v1/sessoes/renovacao').set('X-Cliente', 'painel');
  if (origem !== null) pedido.set('Origin', origem);
  if (token !== null) pedido.set('Cookie', comCookie(token));
  return pedido;
}

function sairDoPainel(token: string | null, origem: string | null = ORIGEM_DO_PAINEL) {
  const pedido = api.http.delete('/v1/sessoes/renovacao').set('X-Cliente', 'painel');
  if (origem !== null) pedido.set('Origin', origem);
  if (token !== null) pedido.set('Cookie', comCookie(token));
  return pedido;
}

describe('POST /v1/sessoes nos apps (CA-03, CA-07, P1-dono)', () => {
  it('conta não verificada entra: 200 com a sessão no corpo, token de 15 min e sessão de 30 dias', async () => {
    const conta = await novaConta();
    const resposta = await entrar({
      email: conta.email,
      senha: conta.senha,
      cliente: 'app_consumidor',
    }).expect(200);

    const sessao = sessaoDe(resposta.body);
    expect(Object.keys(resposta.body as object).sort()).toEqual([
      'emailVerificado',
      'expiraEm',
      'tokenAcesso',
      'tokenRenovacao',
    ]);
    expect(sessao.emailVerificado).toBe(false);
    expect(new Date(sessao.expiraEm).getTime()).toBe(T0.getTime() + 15 * UM_MINUTO);
    expect(resposta.headers['cache-control']).toBe('no-store');
    expect(setCookies(resposta.headers)).toEqual([]);
    const [linha] = await sessoesDaConta(dono, conta.id);
    expect(linha?.cliente).toBe('app_consumidor');
    expect(linha?.expira_em.getTime()).toBe(T0.getTime() + 30 * UM_DIA);
  });

  it('a mesma conta entra nos dois apps (CA-07)', async () => {
    const conta = await novaConta();
    for (const cliente of ['app_consumidor', 'app_lojista']) {
      await entrar({ email: conta.email, senha: conta.senha, cliente }).expect(200);
    }
    expect((await sessoesDaConta(dono, conta.id)).map((s) => s.cliente).sort()).toEqual([
      'app_consumidor',
      'app_lojista',
    ]);
  });

  it('e-mail sem conta e senha errada: 401 com o mesmo corpo (CA-04)', async () => {
    const conta = await novaConta();
    const semConta = emailUnico('sem-conta');
    freiosDoTeste.push(freioPorEmail(semConta));
    const a = await entrar({ email: semConta, senha: conta.senha, cliente: 'app_consumidor' });
    const b = await entrar({ email: conta.email, senha: OUTRA_SENHA, cliente: 'app_consumidor' });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(semId(a.body)).toEqual(semId(b.body));
    expect(problemaDe(a.body).codigo).toBe('nao_autenticado');
  });

  it('cinco falhas pelo e-mail → 429 com Retry-After, também com a senha certa e para e-mail sem conta (CA-04)', async () => {
    const conta = await novaConta();
    const semConta = emailUnico('sem-conta');
    freiosDoTeste.push(freioPorEmail(semConta));
    for (let vez = 0; vez < 5; vez += 1) {
      await entrar({ email: conta.email, senha: OUTRA_SENHA, cliente: 'app_consumidor' }).expect(
        401,
      );
      await entrar({ email: semConta, senha: OUTRA_SENHA, cliente: 'app_consumidor' }).expect(401);
    }
    const certa = await entrar({
      email: conta.email,
      senha: conta.senha,
      cliente: 'app_consumidor',
    }).expect(429);
    const inexistente = await entrar({
      email: semConta,
      senha: OUTRA_SENHA,
      cliente: 'app_consumidor',
    }).expect(429);
    expect(certa.headers['retry-after']).toBe('60');
    expect(inexistente.headers['retry-after']).toBe('60');
    expect(semId(certa.body)).toEqual(semId(inexistente.body));
    expect(problemaDe(certa.body).codigo).toBe('limite_excedido');
  });

  it('freio por origem ativo → 429 mesmo com a senha certa; outro IP entra', async () => {
    const conta = await novaConta();
    const freada = ip();
    await dono.query(
      `INSERT INTO identidade.bloqueios_login (chave_hmac, tipo, falhas, nivel, janela_inicio, bloqueado_ate)
       VALUES ($1, 'ip', 50, 1, $2, $3)`,
      [
        chaveDoFreioPorOrigem(p.servicos.cifrador, freada),
        T0,
        new Date(T0.getTime() + 5 * UM_MINUTO),
      ],
    );
    const corpo = { email: conta.email, senha: conta.senha, cliente: 'app_consumidor' };
    const resposta = await entrar(corpo, freada).expect(429);
    expect(resposta.headers['retry-after']).toBe('300');
    await entrar(corpo, ip()).expect(200);
  });
});

describe('POST /v1/sessoes no painel (S1, S23, CA-09)', () => {
  it('conta sem admin e senha certa: 403 sem_acesso_painel, sem sessão nem cookie, log só com o id', async () => {
    const conta = await novaConta();
    const resposta = await entrar({
      email: conta.email,
      senha: conta.senha,
      cliente: 'painel',
    }).expect(403);
    expect(problemaDe(resposta.body).codigo).toBe('sem_acesso_painel');
    expect(setCookies(resposta.headers)).toEqual([]);
    expect(await sessoesDaConta(dono, conta.id)).toEqual([]);
    const log = api.textoDoLog();
    expect(log).toContain('login no painel sem perfil admin');
    expect(log).toContain(conta.id);
    expect(log).not.toContain(conta.email);
    expect(log).not.toContain(conta.senha);
  });

  it('admin sem segundo fator: 200 com o desafio de etapa configurar, sem sessão nem cookie', async () => {
    const conta = await novaConta();
    const carregada = await p.repos.contas.buscarPorId(conta.id);
    if (carregada === null) throw new Error('conta sumiu');
    carregada.concederAdmin(p.relogio.agora());
    await p.repos.contas.atualizar(carregada);

    const resposta = await entrar({
      email: conta.email,
      senha: conta.senha,
      cliente: 'painel',
    }).expect(200);
    expect(Object.keys(resposta.body as object).sort()).toEqual(['desafio', 'etapa']);
    expect((resposta.body as { etapa: string }).etapa).toBe('configurar');
    expect(setCookies(resposta.headers)).toEqual([]);
    expect(await sessoesDaConta(dono, conta.id)).toEqual([]);
  });
});

describe('POST /v1/sessoes no painel, conta no freio (S23)', () => {
  it('conta sem admin no freio por e-mail e senha certa: 429 genérico, não 403', async () => {
    const conta = await novaConta();
    for (let vez = 0; vez < 5; vez += 1) {
      await entrar({ email: conta.email, senha: OUTRA_SENHA, cliente: 'painel' }).expect(401);
    }
    const resposta = await entrar({
      email: conta.email,
      senha: conta.senha,
      cliente: 'painel',
    }).expect(429);
    expect(problemaDe(resposta.body).codigo).toBe('limite_excedido');
    expect(resposta.headers['retry-after']).toBe('60');
  });
});

describe('POST /v1/sessoes/renovacao nos apps (CA-05, S16, S77)', () => {
  it('troca o par; o corpo sem `cliente` dá 400; token desconhecido dá 401, nunca 5xx', async () => {
    const conta = await novaConta();
    const login = sessaoDe(
      (
        await entrar({ email: conta.email, senha: conta.senha, cliente: 'app_consumidor' }).expect(
          200,
        )
      ).body,
    );
    await api.http
      .post('/v1/sessoes/renovacao')
      .send({ tokenRenovacao: login.tokenRenovacao })
      .expect(400);
    const renovada = sessaoDe((await renovarNoApp(login.tokenRenovacao ?? '').expect(200)).body);
    expect(renovada.tokenRenovacao).toBeDefined();
    expect(renovada.tokenRenovacao).not.toBe(login.tokenRenovacao);

    const desconhecido = await renovarNoApp('token-que-nao-existe').expect(401);
    expect(problemaDe(desconhecido.body).codigo).toBe('nao_autenticado');
  });

  it('três rotações e o primeiro token reapresentado → 401 e a família inteira revogada (S77)', async () => {
    const conta = await novaConta();
    const login = sessaoDe(
      (
        await entrar({ email: conta.email, senha: conta.senha, cliente: 'app_consumidor' }).expect(
          200,
        )
      ).body,
    );
    const primeiro = login.tokenRenovacao ?? '';
    let atual = primeiro;
    for (let vez = 0; vez < 3; vez += 1) {
      // Fora da tolerância de 60 s entre uma rotação e outra.
      api.relogio.avancar(2 * UM_MINUTO);
      atual = sessaoDe((await renovarNoApp(atual).expect(200)).body).tokenRenovacao ?? '';
    }

    await renovarNoApp(primeiro).expect(401);
    await renovarNoApp(atual).expect(401);
    expect(await sessoesVivas(dono, conta.id)).toBe(0);
    expect((await sessoesDaConta(dono, conta.id))[0]?.motivo_revogacao).toBe('reuso_detectado');
  });

  it('token de app pelo cookie com X-Cliente: painel → 401 (o cliente vem da requisição, S16)', async () => {
    const conta = await novaConta();
    const login = sessaoDe(
      (
        await entrar({ email: conta.email, senha: conta.senha, cliente: 'app_consumidor' }).expect(
          200,
        )
      ).body,
    );
    await renovarNoPainel(login.tokenRenovacao ?? '').expect(401);
    // A sessão do app continua de pé.
    await renovarNoApp(login.tokenRenovacao ?? '').expect(200);
  });
});

describe('sessão do painel pelo cookie (S9, S80)', () => {
  it('a renovação funciona só com o cookie e X-Cliente: painel, e regrava o cookie', async () => {
    const admin = await adminComSegundoFator();
    const resposta = await renovarNoPainel(admin.sessao.tokenRenovacao).expect(200);

    expect(Object.keys(resposta.body as object).sort()).toEqual([
      'emailVerificado',
      'expiraEm',
      'tokenAcesso',
    ]);
    const cookie = cookieDeRenovacao(resposta.headers);
    expect(cookie?.valor).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(cookie?.valor).not.toBe(admin.sessao.tokenRenovacao);
    expect(cookie?.atributos).toEqual(
      expect.arrayContaining([
        'Path=/v1/sessoes/renovacao',
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
        `Max-Age=${DURACAO_MAXIMA_NO_PAINEL_EM_MS / 1000}`,
      ]),
    );
    // O token novo do cookie renova de novo.
    await renovarNoPainel(cookie?.valor ?? '').expect(200);
  });

  it('sem cookie → 401; sem Origin ou com origem de fora → 403, sem renovar', async () => {
    const admin = await adminComSegundoFator();
    await renovarNoPainel(null).expect(401);
    await renovarNoPainel(admin.sessao.tokenRenovacao, null).expect(403);
    await renovarNoPainel(admin.sessao.tokenRenovacao, 'https://malicioso.example').expect(403);
    // Nada foi gasto: o cookie original ainda renova.
    await renovarNoPainel(admin.sessao.tokenRenovacao).expect(200);
  });

  it('o corpo da renovação do painel é vazio: campo no corpo → 400', async () => {
    const admin = await adminComSegundoFator();
    const resposta = await renovarNoPainel(admin.sessao.tokenRenovacao)
      .send({ tokenRenovacao: admin.sessao.tokenRenovacao })
      .expect(400);
    expect(problemaDe(resposta.body).campos).toEqual([
      expect.objectContaining({ campo: 'tokenRenovacao', codigo: 'desconhecido' }),
    ]);
  });

  it('logout só com o cookie: 204, revoga a sessão e apaga o cookie no mesmo Path', async () => {
    const admin = await adminComSegundoFator();
    const resposta = await sairDoPainel(admin.sessao.tokenRenovacao).expect(204);

    const apagado = cookieDeRenovacao(resposta.headers);
    expect(apagado?.valor).toBe('');
    expect(apagado?.atributos).toEqual(
      expect.arrayContaining([
        'Path=/v1/sessoes/renovacao',
        'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      ]),
    );
    expect(await sessoesVivas(dono, admin.conta.id)).toBe(0);
    await renovarNoPainel(admin.sessao.tokenRenovacao).expect(401);
  });

  it('logout sem cookie e com cookie desconhecido: 204', async () => {
    await sairDoPainel(null).expect(204);
    await sairDoPainel('cookie-que-nao-existe').expect(204);
  });

  it('logout sem X-Cliente ou fora da origem do painel: 403 e nada revogado', async () => {
    const admin = await adminComSegundoFator();
    await api.http
      .delete('/v1/sessoes/renovacao')
      .set('Origin', ORIGEM_DO_PAINEL)
      .set('Cookie', comCookie(admin.sessao.tokenRenovacao))
      .expect(403);
    await sairDoPainel(admin.sessao.tokenRenovacao, 'https://malicioso.example').expect(403);
    expect(await sessoesVivas(dono, admin.conta.id)).toBe(1);
  });
});

describe('rotas de /v1/admin conferem a sessão do sid (S8, CA-08, CA-09)', () => {
  it('admin com segundo fator entra; depois do logout, o mesmo token de acesso dá 401', async () => {
    const admin = await adminComSegundoFator();
    const comToken = () =>
      api.http
        .get('/v1/admin/sonda-da-sessao')
        .set('Authorization', `Bearer ${admin.sessao.tokenAcesso}`);
    expect((await comToken().expect(200)).body).toEqual({ contaId: admin.conta.id });

    await sairDoPainel(admin.sessao.tokenRenovacao).expect(204);
    await comToken().expect(401);
  });

  it('a conta admin que entrou pelo app não passa (403); sem token, 401', async () => {
    const admin = await adminComSegundoFator();
    const noApp = sessaoDe(
      (
        await entrar({
          email: admin.conta.email,
          senha: admin.conta.senha,
          cliente: 'app_consumidor',
        }).expect(200)
      ).body,
    );
    await api.http
      .get('/v1/admin/sonda-da-sessao')
      .set('Authorization', `Bearer ${noApp.tokenAcesso}`)
      .expect(403);
    await api.http.get('/v1/admin/sonda-da-sessao').expect(401);
  });
});

describe('DELETE /v1/sessoes/atual (CA-05)', () => {
  it('revoga a sessão do sid: 204, de novo 204, e a renovação seguinte dá 401', async () => {
    const conta = await novaConta();
    const login = sessaoDe(
      (
        await entrar({ email: conta.email, senha: conta.senha, cliente: 'app_consumidor' }).expect(
          200,
        )
      ).body,
    );
    const sair = () =>
      api.http.delete('/v1/sessoes/atual').set('Authorization', `Bearer ${login.tokenAcesso}`);
    await sair().expect(204);
    await sair().expect(204);
    await renovarNoApp(login.tokenRenovacao ?? '').expect(401);
    expect((await sessoesDaConta(dono, conta.id))[0]?.motivo_revogacao).toBe('logout');
  });

  it('sem token → 401 (só a guarda responde 401)', async () => {
    await api.http.delete('/v1/sessoes/atual').expect(401);
  });
});

describe('limite por IP do login antes do pipe (S82)', () => {
  it('a 101ª requisição do mesmo IP em 15 min é recusada com 429 antes de validar o corpo', async () => {
    const origem = ip();
    for (let vez = 0; vez < 100; vez += 1) {
      await api.http.post('/v1/sessoes').set('X-Forwarded-For', origem).send({}).expect(400);
    }
    const resposta = await api.http
      .post('/v1/sessoes')
      .set('X-Forwarded-For', origem)
      .send({})
      .expect(429);
    expect(resposta.headers['retry-after']).toMatch(/^[1-9]\d*$/);
    await api.http.post('/v1/sessoes').set('X-Forwarded-For', ip()).send({}).expect(400);
  });
});

describe('tempo das respostas do login (S23, CA-02, CA-04)', () => {
  function mediana(tempos: readonly number[]): number {
    const ordenados = [...tempos].sort((x, y) => x - y);
    return ordenados[Math.floor(ordenados.length / 2)] ?? 0;
  }

  it('401 (sem conta, senha errada) e 403 sem_acesso_painel levam o tempo do desafio e do sucesso', async () => {
    const VEZES = 9;
    const comuns: ContaDeTeste[] = [];
    for (let vez = 0; vez < VEZES; vez += 1) comuns.push(await novaConta());
    const admin = await adminComSegundoFator();
    // Aquecimento: a primeira chamada paga a carga do Argon2 e do pool.
    await entrar({ email: emailUnico('tempo'), senha: OUTRA_SENHA, cliente: 'app_consumidor' });

    type Caso = 'sucesso' | 'desafio' | 'semConta' | 'senhaErrada' | 'semAcessoAoPainel';
    const tempos: Record<Caso, number[]> = {
      sucesso: [],
      desafio: [],
      semConta: [],
      senhaErrada: [],
      semAcessoAoPainel: [],
    };
    // Os casos se alternam a cada rodada: a carga da máquina pesa igual em todos.
    for (const conta of comuns) {
      const semConta = emailUnico('tempo');
      freiosDoTeste.push(freioPorEmail(semConta));
      const casos: [Caso, { email: string; senha: string; cliente: string }, number][] = [
        ['sucesso', { email: conta.email, senha: conta.senha, cliente: 'app_consumidor' }, 200],
        ['desafio', { email: admin.conta.email, senha: admin.conta.senha, cliente: 'painel' }, 200],
        ['semConta', { email: semConta, senha: OUTRA_SENHA, cliente: 'app_consumidor' }, 401],
        ['senhaErrada', { email: conta.email, senha: OUTRA_SENHA, cliente: 'app_consumidor' }, 401],
        ['semAcessoAoPainel', { email: conta.email, senha: conta.senha, cliente: 'painel' }, 403],
      ];
      for (const [caso, corpo, status] of casos) {
        const inicio = performance.now();
        await entrar(corpo).expect(status);
        tempos[caso].push(performance.now() - inicio);
      }
    }

    // Todos pagam um Argon2id (o sem conta, contra o hash fictício); a diferença fica no acesso
    // ao banco, bem menor que o hash. Pular o hash sai da faixa; um hash a mais não é detectado
    // (a faixa vai até 2,0 da referência por causa do ruído entre amostras).
    const referencia = mediana([...tempos.sucesso, ...tempos.desafio]);
    const resumo = JSON.stringify(
      Object.fromEntries(Object.entries(tempos).map(([caso, lista]) => [caso, mediana(lista)])),
    );
    for (const [caso, lista] of Object.entries(tempos)) {
      expect(mediana(lista) / referencia, `${caso}: ${resumo}`).toBeGreaterThan(0.4);
      expect(mediana(lista) / referencia, `${caso}: ${resumo}`).toBeLessThan(2);
    }
  });
});
