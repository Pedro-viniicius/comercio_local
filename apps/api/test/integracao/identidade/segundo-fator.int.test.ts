// Segundo fator do admin pela API inteira (plano 01b, etapa 16; CA-09; S1, S17, P3 da revisão
// do grupo A, R8), contra o Postgres de teste.
//
// - configuração: login no painel → desafio `configurar` → `configuracao` (só a URI e a chave,
//   com `no-store`) → `confirmacao` (os 10 códigos e a sessão, com o token de renovação só no
//   cookie); o desafio `verificar` e a conta com segundo fator já confirmado recebem 401 (S1);
// - "Respostas do 2FA", na ordem: quatro códigos errados → 400 no campo, o quinto → 401, o
//   sexto (mesmo certo) → 401; com o freio de segundo fator ativo → 429 com `Retry-After`; o
//   mesmo 401 para desafio vencido, usado e de outra etapa;
// - os dois casos concorrentes do R8 (o mesmo TOTP, o mesmo código de recuperação), com os
//   desafios gravados direto no banco.
import { Controller, Get } from '@nestjs/common';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ContaAutenticada } from '../../../src/compartilhado/autenticacao/verificador-de-acesso.ts';
import { ContaAtual } from '../../../src/compartilhado/http/autenticacao/conta-atual.decorator.ts';
import { ExigeMfa } from '../../../src/compartilhado/http/autenticacao/exige-mfa.guard.ts';
import { Perfis } from '../../../src/compartilhado/http/autenticacao/perfis.guard.ts';
import { DesafioDeSegundoFator } from '../../../src/modulos/identidade/dominio/desafio-de-segundo-fator.ts';
import { RepositorioDeSegundoFator } from '../../../src/modulos/identidade/dominio/repositorios.ts';
import {
  type ApiDeTeste,
  cookieDeRenovacao,
  ipNovo,
  problemaDe,
  semId,
  sessaoDe,
  subirApi,
} from './api-http.ts';
import {
  apagarContasDoTeste,
  cadastrar,
  conectarDono,
  type DocumentosDeTeste,
  esperarAlguemNaTrava,
  montarPilha,
  pausarAntes,
  type Pilha,
  prepararAdmin,
  semearDocumentos,
  T0,
  totpDe,
  UM_MINUTO,
} from './pilha-de-casos-de-uso.ts';

/** Rota de admin só do teste: prova que a sessão do segundo fator abre `/v1/admin`. */
@Perfis('admin')
@ExigeMfa()
@Controller('v1/admin/sonda-do-segundo-fator')
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

function anotarFreios(conta: { id: string; email: string }): void {
  contasDoTeste.push(conta.id);
  freiosDoTeste.push(
    p.servicos.cifrador.hmac('bloqueio_email', [conta.email]),
    p.servicos.cifrador.hmac('bloqueio_segundo_fator', [conta.id]),
  );
}

/** Admin com segundo fator já confirmado (pelos casos de uso, em `T0`). */
async function adminComSegundoFator() {
  const admin = await prepararAdmin(p, docs, ipNovo(p, freiosDoTeste));
  anotarFreios(admin.conta);
  return admin;
}

/** Admin ainda sem segundo fator (o perfil concedido direto, como a CLI faria). */
async function adminSemSegundoFator() {
  const conta = await cadastrar(p, docs);
  anotarFreios(conta);
  const carregada = await p.repos.contas.buscarPorId(conta.id);
  if (carregada === null) throw new Error('conta sumiu');
  carregada.concederAdmin(p.relogio.agora());
  await p.repos.contas.atualizar(carregada);
  return conta;
}

/** Login no painel pela rota: o desafio. */
async function entrarNoPainel(conta: { email: string; senha: string }) {
  const resposta = await api.http
    .post('/v1/sessoes')
    .set('X-Forwarded-For', ipNovo(p, freiosDoTeste))
    .send({ email: conta.email, senha: conta.senha, cliente: 'painel' })
    .expect(200);
  return resposta.body as { etapa: string; desafio: string };
}

function configurar(desafio: string) {
  return api.http.post('/v1/segundo-fator/configuracao').send({ desafio });
}

function confirmar(desafio: string, codigo: string) {
  return api.http.post('/v1/segundo-fator/confirmacao').send({ desafio, codigo });
}

function verificar(desafio: string, codigos: { codigo?: string; codigoRecuperacao?: string }) {
  return api.http.post('/v1/sessoes/segundo-fator').send({ desafio, ...codigos });
}

/** O código do app autenticador na hora do relógio da API. */
function codigoAgora(segredo: string): string {
  return totpDe(segredo, api.relogio.agora());
}

/** Um desafio gravado direto, sem invalidar os outros da conta (como o R8 pede). */
async function desafioAvulso(contaId: string, etapa: 'verificar' | 'configurar'): Promise<string> {
  const id = p.servicos.gerador.novoId();
  const segredo = p.servicos.gerador.tokenOpaco();
  const desafio = DesafioDeSegundoFator.emitir({
    id,
    contaId,
    etapa,
    tokenHmac: p.servicos.cifrador.hmac(`desafio_${etapa}`, [contaId, segredo]),
    agora: api.relogio.agora(),
  });
  await p.unidade.executar(() => p.repos.desafios.inserir(desafio));
  return `${id}.${segredo}`;
}

describe('configuração do segundo fator (CA-09, S1)', () => {
  it('login → configuração → confirmação: só os campos do contrato, no-store, e a sessão abre /v1/admin', async () => {
    const conta = await adminSemSegundoFator();
    const login = await entrarNoPainel(conta);
    expect(login.etapa).toBe('configurar');

    const configuracao = await configurar(login.desafio).expect(200);
    expect(configuracao.headers['cache-control']).toBe('no-store');
    expect(Object.keys(configuracao.body as object).sort()).toEqual([
      'otpauthUri',
      'segredoBase32',
    ]);
    const { otpauthUri, segredoBase32 } = configuracao.body as Record<string, string>;
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    // Rótulo com o e-mail mascarado, nunca inteiro (P10).
    expect(decodeURIComponent(otpauthUri ?? '')).not.toContain(conta.email);

    const confirmacao = await confirmar(login.desafio, codigoAgora(segredoBase32 ?? '')).expect(
      200,
    );
    expect(confirmacao.headers['cache-control']).toBe('no-store');
    const corpo = confirmacao.body as { codigosRecuperacao: string[]; sessao: unknown };
    expect(Object.keys(corpo).sort()).toEqual(['codigosRecuperacao', 'sessao']);
    expect(corpo.codigosRecuperacao).toHaveLength(10);
    expect(Object.keys(corpo.sessao as object).sort()).toEqual([
      'emailVerificado',
      'expiraEm',
      'tokenAcesso',
    ]);
    const cookie = cookieDeRenovacao(confirmacao.headers);
    expect(cookie?.atributos).toEqual(
      expect.arrayContaining([
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
        'Path=/v1/sessoes/renovacao',
      ]),
    );

    const sessao = sessaoDe(corpo.sessao);
    await api.http
      .get('/v1/admin/sonda-do-segundo-fator')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(200);
  });

  it('desafio de etapa verificar na configuração e na confirmação → 401', async () => {
    const admin = await adminComSegundoFator();
    const login = await entrarNoPainel(admin.conta);
    expect(login.etapa).toBe('verificar');

    await configurar(login.desafio).expect(401);
    await confirmar(login.desafio, codigoAgora(admin.segredo)).expect(401);
  });

  it('desafio `configurar` de conta com segundo fator já confirmado → 401 (reconfigurar só pela CLI)', async () => {
    const admin = await adminComSegundoFator();
    const desafio = await desafioAvulso(admin.conta.id, 'configurar');

    await configurar(desafio).expect(401);
    await confirmar(desafio, codigoAgora(admin.segredo)).expect(401);
  });
});

describe('Respostas do 2FA, na ordem do contrato (P3)', () => {
  it('quatro errados → 400 no campo; o quinto → 401; o sexto, mesmo certo → 401; depois, 429 com Retry-After', async () => {
    const admin = await adminComSegundoFator();
    api.relogio.avancar(UM_MINUTO);
    const login = await entrarNoPainel(admin.conta);

    for (let vez = 0; vez < 4; vez += 1) {
      const resposta = await verificar(login.desafio, { codigo: '000000' }).expect(400);
      expect(problemaDe(resposta.body).campos).toEqual([
        { campo: 'codigo', codigo: 'invalido', motivo: expect.any(String) as string },
      ]);
    }
    const quinta = await verificar(login.desafio, { codigo: '000000' }).expect(401);
    const sexta = await verificar(login.desafio, { codigo: codigoAgora(admin.segredo) }).expect(
      401,
    );
    expect(semId(sexta.body)).toEqual(semId(quinta.body));
    expect(problemaDe(quinta.body).codigo).toBe('nao_autenticado');

    // Cinco falhas no freio de segundo fator da conta: o próximo desafio já cai no 429.
    const outro = await entrarNoPainel(admin.conta);
    const freado = await verificar(outro.desafio, { codigo: codigoAgora(admin.segredo) }).expect(
      429,
    );
    expect(problemaDe(freado.body).codigo).toBe('limite_excedido');
    expect(freado.headers['retry-after']).toBe('60');
  });

  it('o mesmo 401 para desafio vencido, já usado e de outra etapa', async () => {
    const admin = await adminComSegundoFator();
    api.relogio.avancar(UM_MINUTO);

    const vencido = await entrarNoPainel(admin.conta);
    api.relogio.avancar(6 * UM_MINUTO);
    const respostaDoVencido = await verificar(vencido.desafio, {
      codigo: codigoAgora(admin.segredo),
    }).expect(401);

    const usado = await entrarNoPainel(admin.conta);
    await verificar(usado.desafio, { codigo: codigoAgora(admin.segredo) }).expect(200);
    api.relogio.avancar(UM_MINUTO);
    const respostaDoUsado = await verificar(usado.desafio, {
      codigo: codigoAgora(admin.segredo),
    }).expect(401);

    const deOutraEtapa = await desafioAvulso(admin.conta.id, 'configurar');
    const respostaDeOutraEtapa = await verificar(deOutraEtapa, {
      codigo: codigoAgora(admin.segredo),
    }).expect(401);

    expect(semId(respostaDoUsado.body)).toEqual(semId(respostaDoVencido.body));
    expect(semId(respostaDeOutraEtapa.body)).toEqual(semId(respostaDoVencido.body));
  });

  it('código de recuperação errado → 400 em `codigoRecuperacao`; o certo → 200 com a sessão no cookie', async () => {
    const admin = await adminComSegundoFator();
    const login = await entrarNoPainel(admin.conta);

    const errado = await verificar(login.desafio, { codigoRecuperacao: 'AAAAAAAAAA' }).expect(400);
    expect(problemaDe(errado.body).campos).toEqual([
      expect.objectContaining({ campo: 'codigoRecuperacao', codigo: 'invalido' }),
    ]);
    const certo = await verificar(login.desafio, {
      codigoRecuperacao: admin.recuperacao[0] ?? '',
    }).expect(200);
    expect(Object.keys(certo.body as object).sort()).toEqual([
      'emailVerificado',
      'expiraEm',
      'tokenAcesso',
    ]);
    expect(cookieDeRenovacao(certo.headers)?.valor).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe('2FA concorrente pela rota (R8)', () => {
  it('dois desafios com o mesmo código do autenticador ao mesmo tempo: um entra (200), o outro recebe 400', async () => {
    const admin = await adminComSegundoFator();
    api.relogio.avancar(UM_MINUTO);
    const codigo = codigoAgora(admin.segredo);
    const desafioA = await desafioAvulso(admin.conta.id, 'verificar');
    const desafioB = await desafioAvulso(admin.conta.id, 'verificar');

    const pausa = pausarAntes(api.app.get(RepositorioDeSegundoFator), 'salvar');
    const primeiro = verificar(desafioA, { codigo }).then((resposta) => resposta);
    await pausa.chegou;
    const segundo = verificar(desafioB, { codigo }).then((resposta) => resposta);
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect((await primeiro).status).toBe(200);
    const recusado = await segundo;
    expect(recusado.status).toBe(400);
    expect(problemaDe(recusado.body).campos).toEqual([
      expect.objectContaining({ campo: 'codigo', codigo: 'invalido' }),
    ]);
  });

  it('dois desafios com o mesmo código de recuperação ao mesmo tempo: um entra, o outro recebe 400, e o código fica gasto', async () => {
    const admin = await adminComSegundoFator();
    const codigoRecuperacao = admin.recuperacao[0] ?? '';
    const desafioA = await desafioAvulso(admin.conta.id, 'verificar');
    const desafioB = await desafioAvulso(admin.conta.id, 'verificar');

    const pausa = pausarAntes(
      api.app.get(RepositorioDeSegundoFator),
      'marcarCodigoDeRecuperacaoUsado',
    );
    const primeiro = verificar(desafioA, { codigoRecuperacao }).then((resposta) => resposta);
    await pausa.chegou;
    const segundo = verificar(desafioB, { codigoRecuperacao }).then((resposta) => resposta);
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect((await primeiro).status).toBe(200);
    const recusado = await segundo;
    expect(recusado.status).toBe(400);
    expect(problemaDe(recusado.body).campos).toEqual([
      expect.objectContaining({ campo: 'codigoRecuperacao', codigo: 'invalido' }),
    ]);
    const { rows } = await dono.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM identidade.codigos_recuperacao WHERE conta_id = $1::uuid AND usado_em IS NOT NULL',
      [admin.conta.id],
    );
    expect(rows[0]?.n).toBe(1);
  });
});
