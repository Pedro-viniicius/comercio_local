// Bordas das rotas HTTP da Identidade, pela API inteira (plano 01b, etapa 16; revisão do `qa`).
// Estende, sem repetir, os testes do `dev` (`cadastro`, `sessao`, `recuperacao`,
// `segundo-fator`, `http-base`):
//
// - CA-13: corpo inválido em TODA rota com corpo (campo desconhecido, tipo errado, vazio,
//   array, sem `Content-Type`, JSON aninhado demais) → 400 `validacao` com campos e motivos;
// - CA-12: nenhum dado pessoal, senha, token ou código na resposta de erro nem no log, nas
//   rotas que mais recebem dado sensível;
// - CA-07: nenhum endpoint público concede `admin` (login nos apps, renovação, verificação de
//   e-mail, redefinição, cadastro com `perfis`);
// - guarda global (S7): inventário das rotas (só as marcadas `@Publico()` abrem sem token) e
//   token adulterado, vencido, de conta desativada ou em lugar errado;
// - concorrência: cadastro repetido simultâneo, rajada contra o limite por IP, renovação do
//   mesmo token e falhas de login simultâneas.
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { Controller, Get } from '@nestjs/common';
import { ModulesContainer, Reflector } from '@nestjs/core';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ContaAutenticada } from '../../../src/compartilhado/autenticacao/verificador-de-acesso.ts';
import { ContaAtual } from '../../../src/compartilhado/http/autenticacao/conta-atual.decorator.ts';
import { ROTA_PUBLICA } from '../../../src/compartilhado/http/autenticacao/publico.decorator.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import {
  type ApiDeTeste,
  comCookie,
  cookieDeRenovacao,
  ipNovo,
  ORIGEM_DO_PAINEL,
  problemaDe,
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
  eventosDaConta,
  inserirCodigo,
  montarPilha,
  NOME_PADRAO,
  OUTRA_SENHA,
  type Pilha,
  prepararAdmin,
  SENHA,
  semearDocumentos,
  sessoesDaConta,
  sessoesVivas,
  T0,
  totpDe,
  UM_MINUTO,
} from './pilha-de-casos-de-uso.ts';

/** Rota de admin só do teste, com os decoradores. */
@Controller('v1/admin/qa-sonda')
class SondaDeAdmin {
  @Get()
  ver(@ContaAtual() conta: ContaAutenticada) {
    return { contaId: conta.contaId, perfis: conta.perfis, mfa: conta.mfa };
  }
}

/** Rota de admin só do teste, SEM decorador de perfil nem de segundo fator. */
@Controller('v1/admin/qa-sem-decoradores')
class SondaDeAdminSemDecoradores {
  @Get()
  ver() {
    return { aberta: true };
  }
}

/** Rota autenticada comum, só do teste. */
@Controller('v1/qa-autenticada')
class SondaAutenticada {
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
  api = await subirApi({
    controllers: [SondaDeAdmin, SondaDeAdminSemDecoradores, SondaAutenticada],
  });
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

async function adminComSegundoFator() {
  const admin = await prepararAdmin(p, docs, ip());
  anotar(admin.conta);
  return admin;
}

function entrar(corpo: object, origem = ip()) {
  return api.http.post('/v1/sessoes').set('X-Forwarded-For', origem).send(corpo);
}

async function entrarNoApp(conta: ContaDeTeste, cliente = 'app_consumidor') {
  const resposta = await entrar({ email: conta.email, senha: conta.senha, cliente }).expect(200);
  return sessaoDe(resposta.body);
}

/** As claims (sem conferir a assinatura) do token de acesso. */
function claimsDe(token: string): Record<string, unknown> {
  const meio = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(meio, 'base64url').toString('utf8')) as Record<string, unknown>;
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

async function contaDoEmail(email: string) {
  const conta = await p.repos.contas.buscarPorEmail(Email.criar(email));
  if (conta !== null && !contasDoTeste.includes(conta.id)) {
    anotar({ id: conta.id, email });
  }
  return conta;
}

// ---------------------------------------------------------------------------
// CA-13: corpo inválido em toda rota com corpo

interface RotaComCorpo {
  readonly nome: string;
  readonly metodo: 'post';
  readonly caminho: string;
  /** Corpo válido na forma (campos certos), para a rota ao qual o campo extra se junta. */
  readonly corpo: () => Record<string, unknown>;
  /** Cabeçalhos para a rota chegar ao pipe. */
  readonly cabecalhos?: Record<string, string>;
}

const ROTAS_PUBLICAS_COM_CORPO: readonly RotaComCorpo[] = [
  {
    nome: 'POST /v1/contas',
    metodo: 'post',
    caminho: '/v1/contas',
    corpo: () => corpoDoCadastro(emailUnico('borda')),
  },
  {
    nome: 'POST /v1/sessoes',
    metodo: 'post',
    caminho: '/v1/sessoes',
    corpo: () => ({ email: emailUnico('borda'), senha: SENHA, cliente: 'app_consumidor' }),
  },
  {
    nome: 'POST /v1/sessoes/renovacao (apps)',
    metodo: 'post',
    caminho: '/v1/sessoes/renovacao',
    corpo: () => ({ tokenRenovacao: 'token-qualquer', cliente: 'app_consumidor' }),
  },
  {
    nome: 'POST /v1/senha/recuperacao',
    metodo: 'post',
    caminho: '/v1/senha/recuperacao',
    corpo: () => ({ email: emailUnico('borda') }),
  },
  {
    nome: 'POST /v1/senha/redefinicao',
    metodo: 'post',
    caminho: '/v1/senha/redefinicao',
    corpo: () => ({ email: emailUnico('borda'), codigo: '123456', novaSenha: OUTRA_SENHA }),
  },
  {
    nome: 'POST /v1/segundo-fator/configuracao',
    metodo: 'post',
    caminho: '/v1/segundo-fator/configuracao',
    corpo: () => ({ desafio: 'a.b' }),
  },
  {
    nome: 'POST /v1/segundo-fator/confirmacao',
    metodo: 'post',
    caminho: '/v1/segundo-fator/confirmacao',
    corpo: () => ({ desafio: 'a.b', codigo: '123456' }),
  },
  {
    nome: 'POST /v1/sessoes/segundo-fator',
    metodo: 'post',
    caminho: '/v1/sessoes/segundo-fator',
    corpo: () => ({ desafio: 'a.b', codigo: '123456' }),
  },
];

function pedir(rota: RotaComCorpo) {
  const pedido = api.http.post(rota.caminho).set('X-Forwarded-For', ip());
  for (const [nome, valor] of Object.entries(rota.cabecalhos ?? {})) pedido.set(nome, valor);
  return pedido;
}

describe.each(ROTAS_PUBLICAS_COM_CORPO)('CA-13: corpo inválido em $nome', (rota) => {
  it('campo desconhecido (inclusive `perfis`) → 400 `desconhecido`, com motivo em português', async () => {
    const resposta = await pedir(rota)
      .send({ ...rota.corpo(), perfis: ['admin'] })
      .expect(400);
    const problema = problemaDe(resposta.body);
    expect(problema.codigo).toBe('validacao');
    expect(problema.campos).toEqual([
      expect.objectContaining({ campo: 'perfis', codigo: 'desconhecido' }),
    ]);
    for (const campo of problema.campos ?? []) expect(campo.motivo.length).toBeGreaterThan(3);
  });

  it('corpo vazio `{}` → 400 `validacao`, com campo e motivo em cada erro', async () => {
    const resposta = await pedir(rota).send({}).expect(400);
    const problema = problemaDe(resposta.body);
    expect(problema.codigo).toBe('validacao');
    expect((problema.campos ?? []).length).toBeGreaterThan(0);
    for (const campo of problema.campos ?? []) {
      expect(['obrigatorio', 'invalido']).toContain(campo.codigo);
      expect(campo.campo.length).toBeGreaterThan(0);
      expect(campo.motivo.length).toBeGreaterThan(3);
    }
  });

  it.each([
    ['array', '[]'],
    ['null', 'null'],
    ['texto', '"texto"'],
    ['número', '42'],
  ])('corpo JSON %s → 400 `validacao`, nunca 5xx', async (_nome, texto) => {
    const resposta = await pedir(rota).set('Content-Type', 'application/json').send(texto);
    expect(resposta.status).toBe(400);
    expect(problemaDe(resposta.body).codigo).toBe('validacao');
  });

  it('sem `Content-Type` JSON (texto puro) → 400, nunca 5xx', async () => {
    const resposta = await pedir(rota).set('Content-Type', 'text/plain').send('email=a&senha=b');
    expect(resposta.status).toBe(400);
    expect(problemaDe(resposta.body).codigo).toBe('validacao');
  });

  it('valores com tipo errado em todos os campos → 400, sem ecoar o valor enviado', async () => {
    const marca = `marca-${emailUnico('tipo')}`;
    const errado = Object.fromEntries(
      Object.keys(rota.corpo()).map((chave) => [chave, { dentro: marca }]),
    );
    const resposta = await pedir(rota).send(errado);
    expect(resposta.status).toBe(400);
    expect(JSON.stringify(resposta.body)).not.toContain(marca);
    expect(api.textoDoLog()).not.toContain(marca);
  });
});

describe('CA-13: rotas com sessão', () => {
  it.each([
    [
      'POST /v1/conta/verificacao-email',
      'post',
      '/v1/conta/verificacao-email',
      { codigo: '123456' },
    ],
    ['POST /v1/conta/verificacao-email/reenvio', 'post', '/v1/conta/verificacao-email/reenvio', {}],
    ['DELETE /v1/sessoes/atual', 'delete', '/v1/sessoes/atual', {}],
  ] as const)(
    '%s: campo desconhecido → 400; sem token, o 401 vem antes da validação',
    async (_n, metodo, caminho, valido) => {
      const conta = await novaConta();
      const sessao = await entrarNoApp(conta);
      const invalido = { ...valido, perfis: ['admin'] };

      const semToken = await api.http[metodo](caminho).send(invalido);
      expect(semToken.status).toBe(401);

      const comToken = await api.http[metodo](caminho)
        .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
        .set('X-Forwarded-For', ip())
        .send(invalido);
      expect(comToken.status).toBe(400);
      expect(problemaDe(comToken.body).campos).toEqual([
        expect.objectContaining({ campo: 'perfis', codigo: 'desconhecido' }),
      ]);
    },
  );

  it('o campo desconhecido não derruba a sessão: o logout inválido (400) não revogou nada', async () => {
    const conta = await novaConta();
    const sessao = await entrarNoApp(conta);
    await api.http
      .delete('/v1/sessoes/atual')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({ intruso: 1 })
      .expect(400);
    expect(await sessoesVivas(dono, conta.id)).toBe(1);
  });
});

const TEXTOS_HOSTIS: readonly [string, string][] = [
  ['NUL', 'abc\u0000def'],
  ['surrogate solto', 'ab\ud800cd'],
  ['direção do texto invertida', 'ana\u202ebr.moc@'],
  ['espaço de largura zero', 'a\u200bb@exemplo.com'],
  ['emoji', '😀😀😀@exemplo.com'],
  ['SQL', "x'; DROP TABLE identidade.contas; --"],
  ['aspas e barras', '"\\/\\\\'],
  ['quebra de linha (injeção de log e de cabeçalho)', 'a@b.com\r\nX-Injetado: 1'],
  ['muito longo', 'a'.repeat(60_000)],
  ['só espaços', '     '],
  ['normalização (NFD)', 'Jose\u0301@exemplo.com'],
];

describe.each(ROTAS_PUBLICAS_COM_CORPO)('CA-13: textos hostis em $nome', (rota) => {
  it.each(TEXTOS_HOSTIS)(
    '%s em todos os campos de texto → nunca 5xx, sempre Problem Details',
    async (_nome, texto) => {
      const hostil = Object.fromEntries(
        Object.entries(rota.corpo()).map(([chave, valor]) => [
          chave,
          typeof valor === 'string' ? texto : valor,
        ]),
      );
      const resposta = await pedir(rota).send(hostil);
      expect(resposta.status, JSON.stringify(resposta.body).slice(0, 200)).toBeLessThan(500);
      expect(problemaDe(resposta.body).idRequisicao).toBeTruthy();
      expect(resposta.headers['x-injetado']).toBeUndefined();
    },
  );

  it('chaves `__proto__` e `constructor` no corpo → 400 `desconhecido`, nunca 5xx', async () => {
    const base = JSON.stringify(rota.corpo()).slice(0, -1);
    for (const intruso of [
      '"__proto__":{"admin":true}',
      '"constructor":{"prototype":{"admin":true}}',
    ]) {
      const resposta = await pedir(rota)
        .set('Content-Type', 'application/json')
        .send(`${base},${intruso}}`);
      expect(resposta.status).toBe(400);
      expect(problemaDe(resposta.body).campos?.some((c) => c.codigo === 'desconhecido')).toBe(true);
    }
  });
});

describe('CA-13: corpos hostis', () => {
  it('JSON aninhado até o limite de 100 KB → 400 ou 413, nunca 5xx', async () => {
    const profundo = '['.repeat(90_000);
    const resposta = await api.http
      .post('/v1/senha/recuperacao')
      .set('X-Forwarded-For', ip())
      .set('Content-Type', 'application/json')
      .send(profundo);
    expect([400, 413]).toContain(resposta.status);
    expect(problemaDe(resposta.body).codigo).not.toBe('erro_interno');
  });

  it('a mensagem de campo desconhecido não repete o valor, só o nome do campo', async () => {
    const valor = `valor-secreto-${emailUnico('v')}`;
    const resposta = await api.http
      .post('/v1/senha/recuperacao')
      .set('X-Forwarded-For', ip())
      .send({ email: emailUnico('v'), intruso: valor })
      .expect(400);
    expect(JSON.stringify(resposta.body)).not.toContain(valor);
    expect(api.textoDoLog()).not.toContain(valor);
  });
});

// ---------------------------------------------------------------------------
// CA-12: sem dado pessoal, senha, token ou código em resposta de erro e em log

describe('CA-12: erros e log das rotas sem dado pessoal, senha, token ou código', () => {
  it('percorre as recusas e nada do que foi enviado aparece na resposta nem no log', async () => {
    const conta = await novaConta();
    const sessao = await entrarNoApp(conta);
    const inedito = emailUnico('inedito');
    const telefoneRuim = '(35) 3333-4444';
    const nomeEnviado = 'Zelda Qa Hostil';
    const senhaErrada = 'senha-errada-qa-9911';
    const tokenFalso = 'tokenFalsoQa.parte2-Zx9';
    const codigoErrado = '987123';
    const alvo = emailUnico('alvo');
    freiosDoTeste.push(p.servicos.cifrador.hmac('bloqueio_email', [alvo]));
    freiosDoTeste.push(p.servicos.cifrador.hmac('bloqueio_email', [inedito]));

    const respostas = [
      // cadastro recusado: celular fixo, senha comum e versão errada
      await api.http
        .post('/v1/contas')
        .set('X-Forwarded-For', ip())
        .send({
          ...corpoDoCadastro(inedito),
          nome: nomeEnviado,
          telefone: telefoneRuim,
          senha: 'sorvete123',
          aceites: { termos: '99.9', privacidade: docs.privacidade.versao },
        }),
      // login com senha errada, e-mail sem conta e painel sem permissão
      await entrar({ email: conta.email, senha: senhaErrada, cliente: 'app_consumidor' }),
      await entrar({ email: alvo, senha: senhaErrada, cliente: 'app_consumidor' }),
      await entrar({ email: conta.email, senha: conta.senha, cliente: 'painel' }),
      // renovação com token falso (corpo e cookie)
      await api.http
        .post('/v1/sessoes/renovacao')
        .send({ tokenRenovacao: tokenFalso, cliente: 'app_consumidor' }),
      await api.http
        .post('/v1/sessoes/renovacao')
        .set('X-Cliente', 'painel')
        .set('Origin', ORIGEM_DO_PAINEL)
        .set('Cookie', comCookie(tokenFalso)),
      // guarda: Bearer falso
      await api.http
        .post('/v1/conta/verificacao-email/reenvio')
        .set('Authorization', `Bearer ${tokenFalso}`),
      // verificação com código errado, com sessão
      await api.http
        .post('/v1/conta/verificacao-email')
        .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
        .send({ codigo: codigoErrado }),
      // redefinição com código errado
      await api.http
        .post('/v1/senha/redefinicao')
        .set('X-Forwarded-For', ip())
        .send({ email: conta.email, codigo: codigoErrado, novaSenha: OUTRA_SENHA }),
      // 2FA com desafio falso
      await api.http
        .post('/v1/sessoes/segundo-fator')
        .send({ desafio: tokenFalso, codigo: codigoErrado }),
      await api.http.post('/v1/segundo-fator/configuracao').send({ desafio: tokenFalso }),
    ];
    for (const resposta of respostas) {
      expect(resposta.status).toBeGreaterThanOrEqual(400);
      expect(resposta.status).toBeLessThan(500);
    }

    const proibidos = [
      conta.email,
      alvo,
      inedito,
      telefoneRuim,
      '33334444',
      nomeEnviado,
      conta.nome,
      conta.senha,
      senhaErrada,
      'sorvete123',
      OUTRA_SENHA,
      tokenFalso,
      sessao.tokenAcesso,
      sessao.tokenRenovacao ?? 'x',
      codigoErrado,
    ];
    const respostasEmTexto = respostas.map((r) => JSON.stringify(r.body)).join('\n');
    const log = api.textoDoLog();
    for (const proibido of proibidos) {
      expect(respostasEmTexto, `resposta contém ${proibido.slice(0, 6)}…`).not.toContain(proibido);
      expect(log, `log contém ${proibido.slice(0, 6)}…`).not.toContain(proibido);
    }
    // Nem a parte do token que o cliente não digitou: o log não registra cabeçalhos de sessão.
    expect(log).not.toContain(sessao.tokenAcesso.split('.')[1] ?? 'x');
  });

  it('respostas de erro de segurança têm só os campos do Problem Details', async () => {
    const conta = await novaConta();
    const resposta = await entrar({ email: conta.email, senha: OUTRA_SENHA, cliente: 'painel' });
    expect(resposta.status).toBe(401);
    expect(Object.keys(resposta.body as object).sort()).toEqual(
      ['codigo', 'idRequisicao', 'status', 'title', 'type'].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// CA-02: igualdade da resposta de cadastro (corpo e cabeçalhos)

describe('CA-02: cadastro com e-mail novo e em uso é indistinguível na resposta', () => {
  it('mesmo status, corpo e cabeçalhos (menos data, id e tamanho)', async () => {
    const existente = await novaConta();
    const novo = emailUnico('novo');
    const a = await api.http
      .post('/v1/contas')
      .set('X-Forwarded-For', ip())
      .send(corpoDoCadastro(novo));
    await contaDoEmail(novo);
    const b = await api.http
      .post('/v1/contas')
      .set('X-Forwarded-For', ip())
      .send(corpoDoCadastro(existente.email));

    const limpar = (cabecalhos: Record<string, unknown>) => {
      const copia = { ...cabecalhos };
      for (const chave of ['date', 'x-request-id', 'etag', 'set-cookie']) delete copia[chave];
      return copia;
    };
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(a.body).toEqual(b.body);
    // Qualquer cabeçalho que o id da requisição não explique deve ser igual.
    const ca = limpar(a.headers);
    const cb = limpar(b.headers);
    const semOId = (c: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(c).filter(([chave]) => !chave.toLowerCase().includes('request')),
      );
    expect(semOId(ca)).toEqual(semOId(cb));
    expect(setCookies(a.headers)).toEqual([]);
    expect(setCookies(b.headers)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CA-07: nenhum endpoint público concede admin

describe('CA-07: nenhum endpoint público concede admin', () => {
  it('admin com 2FA que entra por um app recebe token sem `admin` nem `mfa`, e a renovação herda isso', async () => {
    const admin = await adminComSegundoFator();
    for (const cliente of ['app_consumidor', 'app_lojista']) {
      const sessao = await entrarNoApp(admin.conta, cliente);
      const claims = claimsDe(sessao.tokenAcesso);
      expect(claims['perfis']).not.toContain('admin');
      expect(claims['mfa']).toBe(false);

      const renovada = sessaoDe(
        (
          await api.http
            .post('/v1/sessoes/renovacao')
            .send({ tokenRenovacao: sessao.tokenRenovacao, cliente })
            .expect(200)
        ).body,
      );
      const claimsNovas = claimsDe(renovada.tokenAcesso);
      expect(claimsNovas['perfis']).not.toContain('admin');
      expect(claimsNovas['mfa']).toBe(false);
      await api.http
        .get('/v1/admin/qa-sonda')
        .set('Authorization', `Bearer ${renovada.tokenAcesso}`)
        .expect(403);
    }
  });

  it('a verificação de e-mail de uma sessão de app de conta admin não emite `admin` nem `mfa`', async () => {
    const admin = await adminComSegundoFator();
    const sessao = await entrarNoApp(admin.conta);
    await inserirCodigo(p, admin.conta.id, 'verificacao_email', '246810');
    const resposta = await api.http
      .post('/v1/conta/verificacao-email')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({ codigo: '246810' });
    expect(resposta.status).toBe(200);
    const claims = claimsDe(sessaoDe(resposta.body).tokenAcesso);
    expect(claims['perfis']).not.toContain('admin');
    expect(claims['mfa']).toBe(false);
  });

  it('a verificação de e-mail com a sessão do painel (admin, mfa) renova o cookie, mas a sessão nova não leva `admin` nem `mfa`', async () => {
    const admin = await adminComSegundoFator();
    const aberta = claimsDe(admin.sessao.tokenAcesso);
    expect(aberta['perfis']).toContain('admin');
    await inserirCodigo(p, admin.conta.id, 'verificacao_email', '135790');
    const resposta = await api.http
      .post('/v1/conta/verificacao-email')
      .set('Authorization', `Bearer ${admin.sessao.tokenAcesso}`)
      .send({ codigo: '135790' });
    expect(resposta.status).toBe(200);
    // No painel o token de renovação nunca vai no corpo.
    expect(sessaoDe(resposta.body).tokenRenovacao).toBeUndefined();
    expect(cookieDeRenovacao(resposta.headers)?.valor).toMatch(/^[A-Za-z0-9._-]+$/);
    // A sessão nova nunca leva `admin` nem `mfa` (S1): quem verifica o e-mail no painel não
    // ganha poder de admin por esse caminho.
    const claims = claimsDe(sessaoDe(resposta.body).tokenAcesso);
    expect(claims['perfis']).not.toContain('admin');
    expect(claims['mfa']).toBe(false);
    await api.http
      .get('/v1/admin/qa-sonda')
      .set('Authorization', `Bearer ${sessaoDe(resposta.body).tokenAcesso}`)
      .expect(403);
  });

  it('redefinir a senha do admin não abre sessão: depois dela, o painel ainda pede o segundo fator', async () => {
    const admin = await adminComSegundoFator();
    await inserirCodigo(p, admin.conta.id, 'recuperacao_senha', '112233');
    const redefinicao = await api.http
      .post('/v1/senha/redefinicao')
      .set('X-Forwarded-For', ip())
      .send({ email: admin.conta.email, codigo: '112233', novaSenha: OUTRA_SENHA });
    expect(redefinicao.status).toBe(204);
    expect(redefinicao.text).toBe('');
    expect(setCookies(redefinicao.headers)).toEqual([]);

    const login = await entrar({
      email: admin.conta.email,
      senha: OUTRA_SENHA,
      cliente: 'painel',
    }).expect(200);
    expect(Object.keys(login.body as object).sort()).toEqual(['desafio', 'etapa']);
    expect((login.body as { etapa: string }).etapa).toBe('verificar');
    expect(setCookies(login.headers)).toEqual([]);
    // As sessões abertas antes da redefinição foram revogadas, a do painel inclusive.
    expect(await sessoesVivas(dono, admin.conta.id)).toBe(0);
    await api.http
      .get('/v1/admin/qa-sonda')
      .set('Authorization', `Bearer ${admin.sessao.tokenAcesso}`)
      .expect(401);
  });

  it('o cadastro com `perfis`, `perfil` ou `admin` no corpo é recusado e não grava a conta', async () => {
    for (const extra of [{ perfis: ['admin'] }, { perfil: 'admin' }, { admin: true }]) {
      const email = emailUnico('escalada');
      const resposta = await api.http
        .post('/v1/contas')
        .set('X-Forwarded-For', ip())
        .send(corpoDoCadastro(email, extra));
      expect(resposta.status).toBe(400);
      expect(await contaDoEmail(email)).toBeNull();
    }
  });

  it('uma conta que acabou de se cadastrar só tem o perfil consumidor', async () => {
    const email = emailUnico('so-consumidor');
    await api.http
      .post('/v1/contas')
      .set('X-Forwarded-For', ip())
      .send(corpoDoCadastro(email))
      .expect(202);
    const conta = await contaDoEmail(email);
    const { rows } = await dono.query<{ perfil: string }>(
      'SELECT perfil::text FROM identidade.perfis_conta WHERE conta_id = $1::uuid',
      [conta?.id],
    );
    expect(rows.map((linha) => linha.perfil)).toEqual(['consumidor']);
  });

  it('a sessão do painel renova com `admin` e `mfa` (pelo cookie), e o token renovado abre /v1/admin', async () => {
    const admin = await adminComSegundoFator();
    const resposta = await api.http
      .post('/v1/sessoes/renovacao')
      .set('X-Cliente', 'painel')
      .set('Origin', ORIGEM_DO_PAINEL)
      .set('Cookie', comCookie(admin.sessao.tokenRenovacao))
      .expect(200);
    const claims = claimsDe(sessaoDe(resposta.body).tokenAcesso);
    expect(claims['perfis']).toContain('admin');
    expect(claims['mfa']).toBe(true);
    await api.http
      .get('/v1/admin/qa-sonda')
      .set('Authorization', `Bearer ${sessaoDe(resposta.body).tokenAcesso}`)
      .expect(200);
  });
});

// ---------------------------------------------------------------------------
// CA-09: segundo fator, repetição

describe('CA-09: o código do segundo fator não se repete', () => {
  async function desafioDeVerificar(conta: ContaDeTeste): Promise<string> {
    const login = await entrar({
      email: conta.email,
      senha: conta.senha,
      cliente: 'painel',
    }).expect(200);
    expect((login.body as { etapa: string }).etapa).toBe('verificar');
    return (login.body as { desafio: string }).desafio;
  }

  it('o mesmo código do autenticador, e o do passo anterior, não entram de novo depois de usados', async () => {
    const admin = await adminComSegundoFator();
    api.relogio.avancar(31_000);
    const passoAnterior = totpDe(admin.segredo, new Date(api.relogio.agora().getTime() - 30_000));
    const codigo = totpDe(admin.segredo, api.relogio.agora());

    const desafioDoPrimeiro = await desafioDeVerificar(admin.conta);
    const primeiro = await api.http
      .post('/v1/sessoes/segundo-fator')
      .send({ desafio: desafioDoPrimeiro, codigo });
    expect(primeiro.status).toBe(200);
    const mfa = claimsDe(sessaoDe(primeiro.body).tokenAcesso);
    expect(mfa['mfa']).toBe(true);
    expect(mfa['perfis']).toContain('admin');

    for (const repetido of [codigo, passoAnterior]) {
      const desafioDaOutra = await desafioDeVerificar(admin.conta);
      const outra = await api.http
        .post('/v1/sessoes/segundo-fator')
        .send({ desafio: desafioDaOutra, codigo: repetido });
      expect(outra.status).toBe(400);
      expect(problemaDe(outra.body).campos).toEqual([
        expect.objectContaining({ campo: 'codigo', codigo: 'invalido' }),
      ]);
      expect(setCookies(outra.headers)).toEqual([]);
    }
  });

  it('código de recuperação: cada um entra uma vez só, e os outros nove continuam valendo', async () => {
    const admin = await adminComSegundoFator();
    const [primeiro, segundo] = admin.recuperacao;
    const entrarCom = async (codigoRecuperacao: string | undefined) => {
      const desafio = await desafioDeVerificar(admin.conta);
      return api.http.post('/v1/sessoes/segundo-fator').send({ desafio, codigoRecuperacao });
    };

    expect((await entrarCom(primeiro)).status).toBe(200);
    const reuso = await entrarCom(primeiro);
    expect(reuso.status).toBe(400);
    expect(problemaDe(reuso.body).campos).toEqual([
      expect.objectContaining({ campo: 'codigoRecuperacao', codigo: 'invalido' }),
    ]);
    expect((await entrarCom(segundo)).status).toBe(200);
  });

  it('os dois campos de código juntos, ou nenhum, → 400 `validacao` (um código só)', async () => {
    const admin = await adminComSegundoFator();
    const desafio = await desafioDeVerificar(admin.conta);
    const ambos = await api.http
      .post('/v1/sessoes/segundo-fator')
      .send({ desafio, codigo: '123456', codigoRecuperacao: admin.recuperacao[0] });
    expect(ambos.status).toBe(400);
    const nenhum = await api.http.post('/v1/sessoes/segundo-fator').send({ desafio });
    expect(nenhum.status).toBe(400);
    // Nenhuma das duas recusas gastou tentativa do desafio nem o código de recuperação.
    const certo = await api.http
      .post('/v1/sessoes/segundo-fator')
      .send({ desafio, codigoRecuperacao: admin.recuperacao[0] });
    expect(certo.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Guarda global (S7): inventário de rotas

/** Rotas que abrem sem token, escritas à mão: acrescentar uma rota pública exige mexer aqui. */
const ROTAS_PUBLICAS_ESPERADAS = [
  'DELETE /v1/sessoes/renovacao',
  'GET /v1/saude',
  'GET /v1/pronto',
  'POST /v1/contas',
  'POST /v1/segundo-fator/configuracao',
  'POST /v1/segundo-fator/confirmacao',
  'POST /v1/senha/recuperacao',
  'POST /v1/senha/redefinicao',
  'POST /v1/sessoes',
  'POST /v1/sessoes/renovacao',
  'POST /v1/sessoes/segundo-fator',
].sort();

interface RotaDescoberta {
  readonly metodo: string;
  readonly caminho: string;
  readonly publica: boolean;
}

function juntar(...partes: unknown[]): string {
  const textos = partes.flatMap((parte) => {
    if (typeof parte === 'string') return [parte];
    if (Array.isArray(parte))
      return parte.filter((item): item is string => typeof item === 'string');
    return [''];
  });
  return `/${textos
    .join('/')
    .split('/')
    .filter((trecho) => trecho.length > 0)
    .join('/')}`;
}

/** As rotas registradas na aplicação inteira (sem as sondas do teste). */
function descobrirRotas(): RotaDescoberta[] {
  const modulos = api.app.get(ModulesContainer, { strict: false });
  const reflector = new Reflector();
  const rotas: RotaDescoberta[] = [];
  for (const modulo of modulos.values()) {
    for (const wrapper of modulo.controllers.values()) {
      const classe = wrapper.metatype;
      if (typeof classe !== 'function') continue;
      if ([SondaDeAdmin, SondaDeAdminSemDecoradores, SondaAutenticada].includes(classe as never)) {
        continue;
      }
      const base: unknown = Reflect.getMetadata(PATH_METADATA, classe);
      for (const nome of Object.getOwnPropertyNames(classe.prototype)) {
        const handler: unknown = (classe.prototype as Record<string, unknown>)[nome];
        if (typeof handler !== 'function') continue;
        const metodo: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
        if (typeof metodo !== 'number') continue;
        const caminho: unknown = Reflect.getMetadata(PATH_METADATA, handler);
        const publica =
          reflector.getAllAndOverride<boolean | undefined>(ROTA_PUBLICA, [handler, classe]) ===
          true;
        rotas.push({
          metodo: RequestMethod[metodo] ?? String(metodo),
          caminho: juntar(base, caminho),
          publica,
        });
      }
    }
  }
  return rotas;
}

describe('guarda global: inventário das rotas (S7, CA-08)', () => {
  it('só as rotas da lista escrita à mão abrem sem token', () => {
    const publicas = descobrirRotas()
      .filter((rota) => rota.publica)
      .map((rota) => `${rota.metodo} ${rota.caminho}`)
      .sort();
    // `/pronto` e `/saude` ficam sob o mesmo prefixo.
    expect(publicas.filter((rota) => !rota.includes('/pronto'))).toEqual(
      ROTAS_PUBLICAS_ESPERADAS.filter((rota) => !rota.includes('/pronto')),
    );
  });

  it('toda rota que não é pública responde 401 sem token, para qualquer corpo', async () => {
    const privadas = descobrirRotas().filter((rota) => !rota.publica);
    expect(privadas.length).toBeGreaterThanOrEqual(3);
    for (const rota of privadas) {
      const caminho = rota.caminho.replace(/:[A-Za-z]+/g, 'x');
      const pedido = api.http[
        rota.metodo.toLowerCase() as 'get' | 'post' | 'delete' | 'put' | 'patch'
      ](caminho).set('X-Forwarded-For', ip());
      const resposta = await pedido.send({ intruso: 1 });
      expect(resposta.status, `${rota.metodo} ${caminho}`).toBe(401);
      expect(problemaDe(resposta.body).codigo).toBe('nao_autenticado');
    }
  });
});

// ---------------------------------------------------------------------------
// Guarda global: tokens e caminhos

describe('guarda global: token fora do lugar, adulterado, vencido ou de conta desativada', () => {
  it('token na query, em cookie, com esquema Basic ou duplicado não autentica', async () => {
    const conta = await novaConta();
    const sessao = await entrarNoApp(conta);
    const token = sessao.tokenAcesso;
    const rota = '/v1/qa-autenticada';
    await api.http.get(`${rota}?access_token=${token}`).expect(401);
    await api.http.get(rota).set('Cookie', `token=${token}; bairrin_acesso=${token}`).expect(401);
    await api.http.get(rota).set('Authorization', `Basic ${token}`).expect(401);
    await api.http.get(rota).set('Authorization', `Bearer  ${token}`).expect(401);
    await api.http.get(rota).set('Authorization', `Bearer ${token} x`).expect(401);
    await api.http.get(rota).set('Authorization', `Bearer ${token}`).expect(200);
  });

  it('trocar o payload para incluir `admin` e `mfa` sem reassinar → 401 (não 403)', async () => {
    const conta = await novaConta();
    const sessao = await entrarNoApp(conta);
    const [cabecalho, , assinatura] = sessao.tokenAcesso.split('.');
    const claims = claimsDe(sessao.tokenAcesso);
    const forjado = Buffer.from(
      JSON.stringify({ ...claims, perfis: ['consumidor', 'admin'], mfa: true }),
    ).toString('base64url');
    const token = `${cabecalho}.${forjado}.${assinatura}`;
    await api.http.get('/v1/admin/qa-sonda').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('`alg: none` e HS512 com o corpo certo → 401', async () => {
    const conta = await novaConta();
    const sessao = await entrarNoApp(conta);
    const claims = claimsDe(sessao.tokenAcesso);
    const semAlgoritmo = [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ ...claims, perfis: ['admin'], mfa: true })).toString(
        'base64url',
      ),
      '',
    ].join('.');
    await api.http
      .get('/v1/qa-autenticada')
      .set('Authorization', `Bearer ${semAlgoritmo}`)
      .expect(401);
    await api.http
      .get('/v1/admin/qa-sonda')
      .set('Authorization', `Bearer ${semAlgoritmo}`)
      .expect(401);
  });

  it('token vencido (15 min) → 401, no limite exato ainda vale', async () => {
    const conta = await novaConta();
    const sessao = await entrarNoApp(conta);
    api.relogio.avancar(15 * UM_MINUTO - 1000);
    await api.http
      .get('/v1/qa-autenticada')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(200);
    api.relogio.avancar(2000);
    const resposta = await api.http
      .get('/v1/qa-autenticada')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(401);
    expect(problemaDe(resposta.body).codigo).toBe('nao_autenticado');
  });

  it('conta desativada perde o acesso na hora, mesmo com o token de acesso ainda dentro dos 15 min', async () => {
    const conta = await novaConta();
    const sessao = await entrarNoApp(conta);
    await api.http
      .get('/v1/qa-autenticada')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(200);
    await dono.query(
      "UPDATE identidade.contas SET status = 'desativada', desativada_em = now() WHERE id = $1::uuid",
      [conta.id],
    );
    await api.http
      .get('/v1/qa-autenticada')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(401);
    await api.http
      .post('/v1/conta/verificacao-email/reenvio')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(401);
  });

  it('a mesma conta desativada não entra pelo login e não renova a sessão', async () => {
    const conta = await novaConta();
    const sessao = await entrarNoApp(conta);
    await dono.query(
      "UPDATE identidade.contas SET status = 'desativada', desativada_em = now() WHERE id = $1::uuid",
      [conta.id],
    );
    const login = await entrar({
      email: conta.email,
      senha: conta.senha,
      cliente: 'app_consumidor',
    });
    expect(login.status).toBe(401);
    const renovacao = await api.http
      .post('/v1/sessoes/renovacao')
      .send({ tokenRenovacao: sessao.tokenRenovacao, cliente: 'app_consumidor' });
    expect(renovacao.status).toBe(401);
  });

  it.each([
    '/v1/admin/qa-sonda/',
    '/V1/Admin/QA-Sonda',
    '/v1/admin//qa-sonda',
    '/v1//admin/qa-sonda',
    '/v1/admin/./qa-sonda',
    '/v1/admin/qa-sonda?x=1',
    '/v1/admin/qa-sonda;a=b',
  ])(
    'rota de admin pedida como %s: o app nunca passa (403 ou 404, jamais 200)',
    async (caminho) => {
      const conta = await novaConta();
      const sessao = await entrarNoApp(conta);
      const resposta = await api.http
        .get(caminho)
        .set('Authorization', `Bearer ${sessao.tokenAcesso}`);
      expect([403, 404]).toContain(resposta.status);
      const semToken = await api.http.get(caminho);
      expect([401, 404]).toContain(semToken.status);
    },
  );

  it('rota de admin sem decoradores: o app (sem admin) leva 403 e o admin com 2FA passa', async () => {
    const conta = await novaConta();
    const sessao = await entrarNoApp(conta);
    await api.http
      .get('/v1/admin/qa-sem-decoradores')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .expect(403);
    const admin = await adminComSegundoFator();
    await api.http
      .get('/v1/admin/qa-sem-decoradores')
      .set('Authorization', `Bearer ${admin.sessao.tokenAcesso}`)
      .expect(200);
  });

  it('sessão do painel por inatividade (30 min sem renovar): o token de acesso ainda não venceu, mas /v1/admin responde 401', async () => {
    const admin = await adminComSegundoFator();
    await api.http
      .get('/v1/admin/qa-sonda')
      .set('Authorization', `Bearer ${admin.sessao.tokenAcesso}`)
      .expect(200);
    // O token vale 15 min; a sessão do painel, 30 min de inatividade. A sessão aberta em T0
    // continua ativa aos 14 min; o teste de 30 min exige token novo, então renova a cada 14 min.
    let atual = admin.sessao.tokenRenovacao;
    let acesso = admin.sessao.tokenAcesso;
    for (let i = 0; i < 2; i += 1) {
      api.relogio.avancar(14 * UM_MINUTO);
      const r = await api.http
        .post('/v1/sessoes/renovacao')
        .set('X-Cliente', 'painel')
        .set('Origin', ORIGEM_DO_PAINEL)
        .set('Cookie', comCookie(atual))
        .expect(200);
      atual = cookieDeRenovacao(r.headers)?.valor ?? '';
      acesso = sessaoDe(r.body).tokenAcesso;
    }
    // 28 min desde a última renovação: ainda ativa.
    await api.http.get('/v1/admin/qa-sonda').set('Authorization', `Bearer ${acesso}`).expect(200);
    // O token de 15 min venceu e a renovação seguinte, a 31 min de inatividade, é recusada.
    api.relogio.avancar(31 * UM_MINUTO);
    await api.http
      .post('/v1/sessoes/renovacao')
      .set('X-Cliente', 'painel')
      .set('Origin', ORIGEM_DO_PAINEL)
      .set('Cookie', comCookie(atual))
      .expect(401);
    await api.http.get('/v1/admin/qa-sonda').set('Authorization', `Bearer ${acesso}`).expect(401);
  });
});

// ---------------------------------------------------------------------------
// Concorrência

describe('concorrência pelas rotas', () => {
  it('seis cadastros simultâneos do mesmo e-mail novo: todos 202 iguais, uma conta só, sem 5xx', async () => {
    const email = emailUnico('simultaneo');
    freiosDoTeste.push(p.servicos.cifrador.hmac('bloqueio_email', [email]));
    const origem = ip();
    const respostas = await Promise.all(
      Array.from({ length: 6 }, () =>
        api.http.post('/v1/contas').set('X-Forwarded-For', origem).send(corpoDoCadastro(email)),
      ),
    );
    expect(respostas.map((r) => r.status)).toEqual([202, 202, 202, 202, 202, 202]);
    expect(new Set(respostas.map((r) => JSON.stringify(r.body))).size).toBe(1);
    const conta = await contaDoEmail(email);
    expect(conta).not.toBeNull();
    const { rows } = await dono.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM identidade.contas WHERE email_normalizado = $1',
      [email.toLowerCase()],
    );
    expect(rows[0]?.n).toBe(1);
    const eventos = await eventosDaConta(dono, conta?.id ?? '');
    expect(eventos.filter((e) => e.tipo === 'identidade.ContaCriada')).toHaveLength(1);
  });

  it('14 cadastros simultâneos do mesmo IP: exatamente 10 passam e 4 recebem 429 (limite atômico)', async () => {
    const origem = ip();
    const emails = Array.from({ length: 14 }, () => emailUnico('rajada'));
    const respostas = await Promise.all(
      emails.map((email) =>
        api.http.post('/v1/contas').set('X-Forwarded-For', origem).send(corpoDoCadastro(email)),
      ),
    );
    // As contas que passaram entram na limpeza (outros arquivos leem tabelas inteiras).
    for (const email of emails) {
      if ((await p.repos.contas.buscarPorEmail(Email.criar(email))) !== null) {
        await contaDoEmail(email);
      }
    }
    for (const r of respostas) {
      if (r.status === 202) {
        const e = JSON.stringify(r.body);
        expect(e).toContain('Verifique');
      }
    }
    const contagem = respostas.reduce<Record<number, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    expect(contagem).toEqual({ 202: 10, 429: 4 });
    for (const r of respostas.filter((x) => x.status === 429)) {
      expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    }
  });

  it('oito renovações simultâneas do mesmo token: nenhuma 5xx; só sessão válida ou 401', async () => {
    const conta = await novaConta();
    const sessao = await entrarNoApp(conta);
    const respostas = await Promise.all(
      Array.from({ length: 8 }, () =>
        api.http
          .post('/v1/sessoes/renovacao')
          .send({ tokenRenovacao: sessao.tokenRenovacao, cliente: 'app_consumidor' }),
      ),
    );
    for (const r of respostas) {
      expect([200, 401], `status ${r.status}`).toContain(r.status);
      if (r.status === 200) sessaoDe(r.body);
      else expect(problemaDe(r.body).codigo).toBe('nao_autenticado');
    }
  });

  it('quinze logins simultâneos com senha errada: no máximo 5 contam como 401, o resto recebe 429', async () => {
    const conta = await novaConta();
    const respostas = await Promise.all(
      Array.from({ length: 15 }, () =>
        entrar({ email: conta.email, senha: OUTRA_SENHA, cliente: 'app_consumidor' }),
      ),
    );
    const estados = respostas.map((r) => r.status);
    expect(estados.filter((s) => s !== 401 && s !== 429)).toEqual([]);
    expect(estados.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
    // Com o freio ativo, a senha certa também espera.
    await entrar({ email: conta.email, senha: conta.senha, cliente: 'app_consumidor' }).expect(429);
  });

  it('dez códigos de redefinição errados simultâneos: no máximo 5 recebem 400; a senha certa depois espera', async () => {
    const conta = await novaConta();
    await inserirCodigo(p, conta.id, 'recuperacao_senha', '445566');
    const respostas = await Promise.all(
      Array.from({ length: 10 }, () =>
        api.http
          .post('/v1/senha/redefinicao')
          .set('X-Forwarded-For', ip())
          .send({ email: conta.email, codigo: '000111', novaSenha: OUTRA_SENHA }),
      ),
    );
    const estados = respostas.map((r) => r.status);
    expect(estados.filter((s) => s !== 400 && s !== 429)).toEqual([]);
    expect(estados.filter((s) => s === 400).length).toBeLessThanOrEqual(5);
    const certo = await api.http
      .post('/v1/senha/redefinicao')
      .set('X-Forwarded-For', ip())
      .send({ email: conta.email, codigo: '445566', novaSenha: OUTRA_SENHA });
    expect(certo.status).toBe(429);
  });

  it('o código de recuperação é de uso único: duas redefinições simultâneas com o código certo, só uma vale', async () => {
    const conta = await novaConta();
    await inserirCodigo(p, conta.id, 'recuperacao_senha', '778899');
    const respostas = await Promise.all(
      [OUTRA_SENHA, 'terceira-senha-azul-31'].map((novaSenha) =>
        api.http
          .post('/v1/senha/redefinicao')
          .set('X-Forwarded-For', ip())
          .send({ email: conta.email, codigo: '778899', novaSenha }),
      ),
    );
    expect(respostas.map((r) => r.status).sort()).toEqual([204, 400]);
  });
});

// ---------------------------------------------------------------------------
// Idempotência e repetição

describe('conta desativada nas rotas públicas', () => {
  it('a redefinição de senha não devolve acesso a conta desativada (login segue 401, status segue desativada)', async () => {
    const conta = await novaConta();
    await dono.query(
      "UPDATE identidade.contas SET status = 'desativada', desativada_em = now() WHERE id = $1::uuid",
      [conta.id],
    );
    await inserirCodigo(p, conta.id, 'recuperacao_senha', '565656');
    const redefinicao = await api.http
      .post('/v1/senha/redefinicao')
      .set('X-Forwarded-For', ip())
      .send({ email: conta.email, codigo: '565656', novaSenha: OUTRA_SENHA });
    // Qualquer resposta que não seja 5xx serve; o que importa é o acesso.
    expect(redefinicao.status).toBeLessThan(500);
    for (const senha of [conta.senha, OUTRA_SENHA]) {
      const login = await entrar({ email: conta.email, senha, cliente: 'app_consumidor' });
      expect(login.status).toBe(401);
    }
    const { rows } = await dono.query<{ status: string }>(
      'SELECT status::text FROM identidade.contas WHERE id = $1::uuid',
      [conta.id],
    );
    expect(rows[0]?.status).toBe('desativada');
  });
});

describe('repetição', () => {
  it('logout do app repetido com o mesmo token de acesso: 204 as duas vezes (CA-05) e a sessão continua revogada', async () => {
    const conta = await novaConta();
    const sessao = await entrarNoApp(conta);
    for (let i = 0; i < 2; i += 1) {
      await api.http
        .delete('/v1/sessoes/atual')
        .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
        .expect(204);
    }
    const [linha] = await sessoesDaConta(dono, conta.id);
    expect(linha?.revogada_em).not.toBeNull();
    expect(linha?.motivo_revogacao).toBe('logout');
  });

  it('o código de recuperação já usado não serve de novo, nem para outra senha', async () => {
    const conta = await novaConta();
    await inserirCodigo(p, conta.id, 'recuperacao_senha', '334455');
    await api.http
      .post('/v1/senha/redefinicao')
      .set('X-Forwarded-For', ip())
      .send({ email: conta.email, codigo: '334455', novaSenha: OUTRA_SENHA })
      .expect(204);
    const segunda = await api.http
      .post('/v1/senha/redefinicao')
      .set('X-Forwarded-For', ip())
      .send({ email: conta.email, codigo: '334455', novaSenha: 'quarta-senha-roxa-77' });
    expect(segunda.status).toBe(400);
    // A senha que vale é a da primeira redefinição.
    await entrar({ email: conta.email, senha: OUTRA_SENHA, cliente: 'app_consumidor' }).expect(200);
    await entrar({
      email: conta.email,
      senha: 'quarta-senha-roxa-77',
      cliente: 'app_consumidor',
    }).expect(401);
  });
});
