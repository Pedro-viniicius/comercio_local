// Integração da base HTTP (CA-F3): a aplicação montada como no `main.ts`,
// mais rotas de teste para validação, erro inesperado, log e IP do cliente.
// Não usa banco nem `.env`: o ambiente é fictício e o log vai para a memória.
// Desde o 01b (etapa 16), também as guardas globais (`Autenticado`, limites
// por rota) e as guardas de perfil e de segundo fator, com o
// `VerificadorDeAcesso` trocado por um falso (sem banco).
import { randomBytes } from 'node:crypto';
import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { CABECALHO_DO_CLIENTE, objetoEstrito, problemaSchema, z } from '@bairrin/contratos';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppModule, type LimiteDeRequisicoes } from '../../src/app.module.ts';
import {
  type ContaAutenticada,
  type OpcoesDaVerificacao,
  VerificadorDeAcesso,
} from '../../src/compartilhado/autenticacao/verificador-de-acesso.ts';
import { carregarAmbiente } from '../../src/compartilhado/config/ambiente.ts';
import { TAMANHO_MAXIMO_DO_TOKEN_DE_ACESSO } from '../../src/compartilhado/http/autenticacao/autenticado.guard.ts';
import { ConfereSessao } from '../../src/compartilhado/http/autenticacao/confere-sessao.decorator.ts';
import { ContaAtual } from '../../src/compartilhado/http/autenticacao/conta-atual.decorator.ts';
import { ExigeMfa } from '../../src/compartilhado/http/autenticacao/exige-mfa.guard.ts';
import { Perfis } from '../../src/compartilhado/http/autenticacao/perfis.guard.ts';
import { Publico } from '../../src/compartilhado/http/autenticacao/publico.decorator.ts';
import {
  configurarAplicacao,
  OPCOES_DA_APLICACAO,
} from '../../src/compartilhado/http/configurar-aplicacao.ts';
import { LimitarRota } from '../../src/compartilhado/http/limite-por-rota.guard.ts';
import { ValidacaoZodPipe } from '../../src/compartilhado/http/validacao-zod.pipe.ts';

const ORIGEM_DO_PAINEL = 'https://painel.bairrin.com.br';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const cadastroSchema = objetoEstrito({
  nome: z.string().min(1),
  idade: z.number().int().min(18),
});

@Publico()
@Controller('teste')
class RotasDeTeste {
  constructor(private readonly logger: PinoLogger) {}

  @Post('cadastro')
  cadastrar(@Body(new ValidacaoZodPipe(cadastroSchema)) corpo: z.infer<typeof cadastroSchema>) {
    return corpo;
  }

  @Get('falha')
  falhar(): never {
    throw new Error('falha interna: conexão recusada para fulano@exemplo.com');
  }

  @Post('registrar')
  registrar(@Body() corpo: unknown) {
    // Simula um descuido: registrar um objeto com dado pessoal.
    this.logger.info(
      { usuario: corpo, authorization: 'Bearer token-do-log', tokenAcesso: 'abc-do-log' },
      'registro de teste',
    );
    return { ok: true };
  }

  @Get('vinculo')
  vincular() {
    // `assign` do nestjs-pino: vira vínculo de logger filho da requisição.
    this.logger.assign({ usuarioId: 'u-vinculo', email: 'vinculo@exemplo.com', nome: 'Vinculado' });
    this.logger.info('registro com vínculo');
    return { ok: true };
  }

  @Get('ip')
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }
}

/** Rota autenticada (sem `@Publico()`): devolve a conta que a guarda pôs na requisição. */
@Controller('teste/protegida')
class RotasProtegidas {
  @Get()
  quem(@ContaAtual() conta: ContaAutenticada) {
    return { contaId: conta.contaId, sid: conta.sid };
  }

  /** Rota sensível fora de /v1/admin: a sessão do `sid` também é conferida (etapa 19). */
  @Get('com-sessao')
  @ConfereSessao()
  comSessao(@ContaAtual() conta: ContaAutenticada) {
    return { contaId: conta.contaId };
  }
}

/** `@ConfereSessao()` no controller vale para todas as rotas dele. */
@ConfereSessao()
@Controller('teste/protegida-no-controller')
class RotasQueConferemSessao {
  @Get()
  quem(@ContaAtual() conta: ContaAutenticada) {
    return { contaId: conta.contaId };
  }
}

/** Rotas de admin como as do painel (S7): perfil `admin` e segundo fator. */
@Perfis('admin')
@ExigeMfa()
@Controller('v1/admin/teste')
class RotasDeAdminDeTeste {
  @Get()
  ver(@ContaAtual() conta: ContaAutenticada) {
    return { contaId: conta.contaId };
  }
}

/** Rota de admin que esqueceu `@Perfis` e `@ExigeMfa`: a guarda global segura pelo prefixo. */
@Controller('v1')
class RotaDeAdminEsquecida {
  @Get('admin/esquecida')
  ver() {
    return { ok: true };
  }
}

/** Rota de admin marcada `@Publico()` por engano: o prefixo vence (S110). */
@Publico()
@Controller('v1/admin/publica-por-engano')
class RotaDeAdminPublicaPorEngano {
  @Get()
  ver() {
    return { ok: true };
  }
}

/**
 * Declarada sem o `v1`: só fica sob `/v1/admin` com `setGlobalPrefix('v1')`,
 * que os metadados do controller não mostram (S110).
 */
@Controller('admin/pelo-prefixo-global')
class RotaDeAdminPeloPrefixoGlobal {
  @Get()
  ver() {
    return { ok: true };
  }
}

/** Limites por rota (etapa 16): por IP, por e-mail do corpo e por conta. */
@Controller('teste/limitada')
class RotasLimitadas {
  // O e-mail vem antes no decorador de propósito: a guarda confere o IP
  // primeiro mesmo assim (S109).
  @Publico()
  @Post('por-ip-e-email')
  @LimitarRota(
    { nome: 'email', por: 'email', limite: 2, janelaEmMs: 60_000 },
    { nome: 'ip', por: 'ip', limite: 3, janelaEmMs: 60_000 },
  )
  porIpEEmail(@Body() _corpo: unknown) {
    return { ok: true };
  }

  @Post('por-conta')
  @LimitarRota({ nome: 'conta', por: 'conta', limite: 1, janelaEmMs: 60_000 })
  porConta() {
    return { ok: true };
  }

  // O IP vem antes no decorador de propósito: a guarda confere a conta primeiro
  // mesmo assim (etapa 19, CGNAT).
  @Post('por-conta-e-ip')
  @LimitarRota(
    { nome: 'ip', por: 'ip', limite: 3, janelaEmMs: 60_000 },
    { nome: 'conta', por: 'conta', limite: 1, janelaEmMs: 60_000 },
  )
  porContaEIp() {
    return { ok: true };
  }
}

/** Tokens que o verificador falso aceita, com a conta de cada um. */
const CONTA_COMUM: ContaAutenticada = {
  contaId: '11111111-1111-4111-8111-111111111111',
  sid: '21111111-1111-4111-8111-111111111111',
  perfis: ['consumidor'],
  mfa: false,
  emailVerificado: true,
};
const CONTA_ADMIN: ContaAutenticada = {
  contaId: '33333333-3333-4333-8333-333333333333',
  sid: '43333333-3333-4333-8333-333333333333',
  perfis: ['consumidor', 'admin'],
  mfa: true,
  emailVerificado: true,
};
const OUTRA_CONTA: ContaAutenticada = {
  ...CONTA_COMUM,
  contaId: '55555555-5555-4555-8555-555555555555',
  sid: '65555555-5555-4555-8555-555555555555',
};
const TOKENS: Readonly<Record<string, ContaAutenticada>> = {
  'token.comum': CONTA_COMUM,
  'token.outra': OUTRA_CONTA,
  'token.terceira': {
    ...CONTA_COMUM,
    contaId: '77777777-7777-4777-8777-777777777777',
    sid: '87777777-7777-4777-8777-777777777777',
  },
  'token.admin': CONTA_ADMIN,
  'token.admin-sem-mfa': { ...CONTA_ADMIN, mfa: false },
  'token.mfa-sem-admin': { ...CONTA_COMUM, mfa: true },
};

/** `VerificadorDeAcesso` sem banco: aceita só os `TOKENS` e anota cada chamada. */
class VerificadorDeAcessoFalso extends VerificadorDeAcesso {
  readonly chamadas: { token: string; opcoes: OpcoesDaVerificacao }[] = [];

  override verificar(token: string, opcoes: OpcoesDaVerificacao) {
    this.chamadas.push({ token, opcoes });
    return Promise.resolve(TOKENS[token] ?? null);
  }
}

/** Valores fictícios, nunca lidos de `.env`. */
function ambiente(producao = false) {
  const chave = () => randomBytes(32).toString('base64');
  return carregarAmbiente({
    NODE_ENV: producao ? 'production' : 'test',
    PORTA: '3000',
    DATABASE_URL: 'postgresql://ficticio:ficticio@127.0.0.1:5433/ficticio',
    CORS_ORIGENS: ORIGEM_DO_PAINEL,
    JWT_SEGREDO: chave(),
    CHAVE_CIFRAGEM_DADOS: chave(),
    CHAVE_HMAC: chave(),
    SMTP_URL: 'smtp://127.0.0.1:1025',
    EMAIL_REMETENTE: 'nao-responda@bairrin.com.br',
    LOG_NIVEL: 'info',
  });
}

let aberta: NestExpressApplication | undefined;

/**
 * Destino único do log para o arquivo todo. O nestjs-pino 5.3 cria o pino-http
 * uma vez por processo (`rootLogger.js`, sem forma pública de recriar): a
 * segunda aplicação do mesmo processo escreve no destino da primeira. Por isso
 * o destino é um só e cada `subir()` limpa as linhas.
 */
const linhas: string[] = [];
const destinoDoLog = { write: (linha: string) => void linhas.push(linha) };

afterEach(async () => {
  await aberta?.close();
  aberta = undefined;
});

async function subir(
  opcoes: { producao?: boolean; limite?: LimiteDeRequisicoes; prefixoGlobal?: string } = {},
) {
  linhas.length = 0;
  const amb = ambiente(opcoes.producao);
  const verificador = new VerificadorDeAcessoFalso();
  const modulo = await Test.createTestingModule({
    imports: [
      AppModule.registrar({
        ambiente: amb,
        destinoDoLog,
        ...(opcoes.limite ? { limiteDeRequisicoes: opcoes.limite } : {}),
      }),
    ],
    controllers: [
      RotasDeTeste,
      RotasProtegidas,
      RotasQueConferemSessao,
      RotasDeAdminDeTeste,
      RotaDeAdminEsquecida,
      RotaDeAdminPublicaPorEngano,
      RotaDeAdminPeloPrefixoGlobal,
      RotasLimitadas,
    ],
  })
    .overrideProvider(VerificadorDeAcesso)
    .useValue(verificador)
    .compile();
  const app = modulo.createNestApplication<NestExpressApplication>(OPCOES_DA_APLICACAO);
  configurarAplicacao(app, amb);
  if (opcoes.prefixoGlobal !== undefined) app.setGlobalPrefix(opcoes.prefixoGlobal);
  await app.init();
  aberta = app;
  const registros = () => linhas.map((linha) => JSON.parse(linha) as Record<string, unknown>);
  return {
    http: request(app.getHttpServer()),
    textoDoLog: () => linhas.join('\n'),
    registros,
    verificador,
  };
}

function problema(corpo: unknown) {
  return problemaSchema.parse(corpo);
}

describe('GET /v1/saude', () => {
  it('responde 200 com a versão fora de produção, no-store, id e cabeçalhos do helmet', async () => {
    const { http } = await subir();
    const resposta = await http.get('/v1/saude').expect(200);
    expect(resposta.body).toEqual({ status: 'ok', versao: '0.0.0' });
    expect(resposta.headers['cache-control']).toBe('no-store');
    expect(resposta.headers['x-request-id']).toMatch(UUID);
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
    expect(resposta.headers['x-powered-by']).toBeUndefined();
  });

  it('em produção não mostra a versão (S24)', async () => {
    const { http } = await subir({ producao: true });
    const resposta = await http.get('/v1/saude').expect(200);
    expect(resposta.body).toEqual({ status: 'ok' });
  });
});

describe('validação do corpo', () => {
  it('campo inválido → 400 em Problem Details com campos em português', async () => {
    const { http } = await subir();
    const resposta = await http
      .post('/teste/cadastro')
      .send({ nome: 'Ana', idade: 10 })
      .expect(400);
    expect(resposta.headers['content-type']).toBe('application/problem+json; charset=utf-8');
    const corpo = problema(resposta.body);
    expect(corpo).toMatchObject({ status: 400, codigo: 'validacao', title: 'Dados inválidos' });
    expect(corpo.idRequisicao).toBe(resposta.headers['x-request-id']);
    expect(corpo.campos).toHaveLength(1);
    expect(corpo.campos?.[0]).toMatchObject({ campo: 'idade', codigo: 'invalido' });
    expect(corpo.campos?.[0]?.motivo).toMatch(/Pequeno demais/);
  });

  it('campo desconhecido → 400 com código `desconhecido`', async () => {
    const { http } = await subir();
    const resposta = await http
      .post('/teste/cadastro')
      .send({ nome: 'Ana', idade: 30, admin: true })
      .expect(400);
    expect(problema(resposta.body).campos).toEqual([
      { campo: 'admin', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
    ]);
  });

  it('corpo válido passa', async () => {
    const { http } = await subir();
    await http.post('/teste/cadastro').send({ nome: 'Ana', idade: 30 }).expect(201, {
      nome: 'Ana',
      idade: 30,
    });
  });

  it('JSON malformado → 400 sem ecoar o trecho recebido, nem na resposta nem no log', async () => {
    const { http, textoDoLog } = await subir();
    const resposta = await http
      .post('/teste/cadastro')
      .set('Content-Type', 'application/json')
      .send('{"nome":"segredo-do-corpo",')
      .expect(400);
    expect(problema(resposta.body).codigo).toBe('validacao');
    expect(JSON.stringify(resposta.body)).not.toContain('segredo-do-corpo');
    expect(textoDoLog()).toContain(resposta.headers['x-request-id']);
    expect(textoDoLog()).not.toContain('segredo-do-corpo');
  });

  it('corpo acima de 100 KB → 413 em Problem Details com id (S19)', async () => {
    const { http, registros, textoDoLog } = await subir();
    const grande = { nome: 'x'.repeat(101 * 1024), idade: 30 };
    const resposta = await http.post('/teste/cadastro').send(grande).expect(413);
    const corpo = problema(resposta.body);
    expect(corpo.codigo).toBe('corpo_grande_demais');
    expect(corpo.idRequisicao).toMatch(UUID);
    expect(corpo.idRequisicao).toBe(resposta.headers['x-request-id']);
    expect(resposta.headers['cache-control']).toBe('no-store');

    // Recusada antes do pino-http: o filtro registra a recusa com o mesmo id.
    expect(registros().find((r) => r['idRequisicao'] === corpo.idRequisicao)).toMatchObject({
      level: 'warn',
      msg: 'requisição recusada antes do log',
      req: { metodo: 'POST', url: '/teste/cadastro' },
      res: { status: 413 },
    });
    expect(textoDoLog()).not.toContain('xxxxxxxx');
  });

  it('corpo logo abaixo de 100 KB é aceito', async () => {
    const { http } = await subir();
    await http
      .post('/teste/cadastro')
      .send({ nome: 'x'.repeat(99 * 1024), idade: 30 })
      .expect(201);
  });

  it('corpo de ~99 KB só de chaves desconhecidas → 400 com no máximo 20 campos (Q30)', async () => {
    const { http } = await subir();
    const corpo: Record<string, number> = { idade: 30 };
    // Cada chave `"kN":1,` soma o tamanho do nome mais 5 caracteres ao JSON.
    for (let indice = 0, tamanho = 10; tamanho < 99 * 1024; indice += 1) {
      corpo[`k${indice}`] = 1;
      tamanho += `k${indice}`.length + 5;
    }
    const resposta = await http.post('/teste/cadastro').send(corpo).expect(400);
    const { campos } = problema(resposta.body);
    expect(campos).toHaveLength(20);
    expect(campos?.[0]).toEqual({
      campo: 'nome',
      codigo: 'obrigatorio',
      motivo: 'Campo obrigatório.',
    });
    expect(campos?.slice(1).every(({ codigo }) => codigo === 'desconhecido')).toBe(true);
    expect(resposta.text.length).toBeLessThan(4 * 1024);
  });
});

describe('erros', () => {
  it('erro inesperado → 500 genérico com idRequisicao, sem pilha nem mensagem interna', async () => {
    const { http, registros } = await subir();
    const resposta = await http.get('/teste/falha').expect(500);
    const corpo = problema(resposta.body);
    expect(corpo).toEqual({
      type: 'urn:bairrin:erro:erro_interno',
      title: 'Erro interno',
      status: 500,
      codigo: 'erro_interno',
      idRequisicao: resposta.headers['x-request-id'],
    });
    expect(resposta.text).not.toMatch(/falha interna|fulano@exemplo\.com|stack|\bat\s/);

    // O log tem o erro (tipo e pilha) ligado ao mesmo id, mas nunca a mensagem.
    await vi.waitFor(() => {
      expect(registros().some((r) => r['msg'] === 'requisição com erro')).toBe(true);
    });
    const registro = registros().find((r) => r['msg'] === 'requisição com erro');
    expect(registro).toMatchObject({
      level: 'error',
      idRequisicao: corpo.idRequisicao,
      res: { status: 500 },
      err: { tipo: 'Error' },
    });
    expect((registro?.['err'] as { pilha?: string }).pilha).toMatch(/\bat\s/);
    expect(JSON.stringify(registros())).not.toMatch(/falha interna|fulano@exemplo\.com/);
  });

  it('rota inexistente → 404 em Problem Details', async () => {
    const { http } = await subir();
    const resposta = await http.get('/v1/nao-existe?token=abc').expect(404);
    expect(problema(resposta.body).codigo).toBe('nao_encontrado');
    expect(resposta.text).not.toContain('token=abc');
  });

  it('limite de requisições → 429 em Problem Details com Retry-After', async () => {
    const { http } = await subir({ limite: { limite: 2, janelaEmMs: 60_000 } });
    await http.get('/v1/saude').expect(200);
    await http.get('/v1/saude').expect(200);
    const resposta = await http.get('/v1/saude').expect(429);
    expect(problema(resposta.body).codigo).toBe('limite_excedido');
    expect(resposta.headers['retry-after']).toMatch(/^\d+$/);
  });
});

describe('logs', () => {
  it('em JSON, sem corpo, sem cabeçalhos sensíveis e com a URL sem query (S20)', async () => {
    const { http, textoDoLog, registros } = await subir();
    const resposta = await http
      .post('/teste/cadastro?email=query@exemplo.com&token=token-da-query')
      .set('Authorization', 'Bearer token-do-cabecalho')
      .set('Cookie', 'sid=cookie-secreto')
      .send({ nome: 'Nome Do Corpo', idade: 30 })
      .expect(201);

    await vi.waitFor(() => {
      expect(registros().some((r) => r['msg'] === 'requisição concluída')).toBe(true);
    });
    const registro = registros().find((r) => r['msg'] === 'requisição concluída');
    expect(registro).toMatchObject({
      level: 'info',
      idRequisicao: resposta.headers['x-request-id'],
      req: { metodo: 'POST', url: '/teste/cadastro' },
      res: { status: 201 },
    });
    const tudo = textoDoLog();
    for (const proibido of [
      'Nome Do Corpo',
      'query@exemplo.com',
      'token-da-query',
      'token-do-cabecalho',
      'cookie-secreto',
      '?',
    ]) {
      expect(tudo).not.toContain(proibido);
    }
  });

  it('redige campos sensíveis de objetos registrados pela aplicação', async () => {
    const { http, textoDoLog, registros } = await subir();
    await http
      .post('/teste/registrar')
      .send({
        nome: 'Comprador',
        email: 'fulano@exemplo.com',
        telefone: '35999990000',
        cpf: '12345678900',
        cnpj: '12345678000199',
        senha: 'senha-secreta',
      })
      .expect(201);

    const registro = registros().find((r) => r['msg'] === 'registro de teste');
    expect(registro).toMatchObject({
      usuario: {
        nome: '[REDIGIDO]',
        email: '[REDIGIDO]',
        telefone: '[REDIGIDO]',
        cpf: '[REDIGIDO]',
        cnpj: '[REDIGIDO]',
        senha: '[REDIGIDO]',
      },
      authorization: '[REDIGIDO]',
      tokenAcesso: '[REDIGIDO]',
    });
    expect(registro?.['idRequisicao']).toMatch(UUID);
    const tudo = textoDoLog();
    for (const proibido of [
      'Comprador',
      'fulano@exemplo.com',
      '35999990000',
      '12345678900',
      '12345678000199',
      'senha-secreta',
      'token-do-log',
      'abc-do-log',
    ]) {
      expect(tudo).not.toContain(proibido);
    }
  });

  it('redige os campos atribuídos com `assign` (vínculos do logger da requisição)', async () => {
    const { http, textoDoLog, registros } = await subir();
    await http.get('/teste/vinculo').expect(200);

    const registro = registros().find((r) => r['msg'] === 'registro com vínculo');
    expect(registro).toMatchObject({
      usuarioId: 'u-vinculo',
      email: '[REDIGIDO]',
      nome: '[REDIGIDO]',
    });
    expect(textoDoLog()).not.toContain('vinculo@exemplo.com');
    expect(textoDoLog()).not.toContain('Vinculado');
  });
});

describe('autenticação global (S7, S8)', () => {
  it('rota sem `@Publico()` exige token: ausente, mal formado ou desconhecido → 401 igual', async () => {
    const { http, verificador } = await subir();
    const semToken = await http.get('/teste/protegida').expect(401);
    const malFormado = await http
      .get('/teste/protegida')
      .set('Authorization', 'Bearer token com espaço')
      .expect(401);
    const outroEsquema = await http
      .get('/teste/protegida')
      .set('Authorization', 'Basic dXN1YXJpbzpzZW5oYQ==')
      .expect(401);
    const desconhecido = await http
      .get('/teste/protegida')
      .set('Authorization', 'Bearer token.desconhecido')
      .expect(401);
    for (const resposta of [semToken, malFormado, outroEsquema, desconhecido]) {
      const { idRequisicao: _id, ...corpo } = problema(resposta.body);
      expect(corpo).toEqual({
        type: 'urn:bairrin:erro:nao_autenticado',
        title: 'Autenticação necessária',
        status: 401,
        codigo: 'nao_autenticado',
      });
    }
    // Só o token bem formado chega ao verificador.
    expect(verificador.chamadas.map(({ token }) => token)).toEqual(['token.desconhecido']);
  });

  it('token acima do tamanho máximo é recusado antes de conferir a assinatura', async () => {
    const { http, verificador } = await subir();
    const grande = 'a'.repeat(TAMANHO_MAXIMO_DO_TOKEN_DE_ACESSO + 1);
    await http.get('/teste/protegida').set('Authorization', `Bearer ${grande}`).expect(401);
    expect(verificador.chamadas).toEqual([]);
  });

  it('token válido: a rota recebe a conta, e fora de /v1/admin a sessão não é conferida', async () => {
    const { http, verificador } = await subir();
    const resposta = await http
      .get('/teste/protegida')
      .set('Authorization', 'bearer token.comum')
      .expect(200);
    expect(resposta.body).toEqual({ contaId: CONTA_COMUM.contaId, sid: CONTA_COMUM.sid });
    expect(verificador.chamadas).toEqual([
      { token: 'token.comum', opcoes: { conferirSessao: false } },
    ]);
  });

  it('rota com `@ConfereSessao()` fora de /v1/admin: a sessão do `sid` é conferida, sem exigir admin (etapa 19)', async () => {
    const { http, verificador } = await subir();
    const resposta = await http
      .get('/teste/protegida/com-sessao')
      .set('Authorization', 'Bearer token.comum')
      .expect(200);
    expect(resposta.body).toEqual({ contaId: CONTA_COMUM.contaId });
    await http
      .get('/teste/protegida-no-controller')
      .set('Authorization', 'Bearer token.comum')
      .expect(200);
    // O verificador recusa (sessão revogada, por exemplo): 401 da guarda, como sem token.
    await http
      .get('/teste/protegida/com-sessao')
      .set('Authorization', 'Bearer token.x')
      .expect(401);
    expect(verificador.chamadas).toEqual([
      { token: 'token.comum', opcoes: { conferirSessao: true } },
      { token: 'token.comum', opcoes: { conferirSessao: true } },
      { token: 'token.x', opcoes: { conferirSessao: true } },
    ]);
  });

  it('/v1/saude continua pública', async () => {
    const { http, verificador } = await subir();
    await http.get('/v1/saude').expect(200);
    expect(verificador.chamadas).toEqual([]);
  });

  it('em /v1/admin: admin com segundo fator passa, e a sessão do `sid` é conferida (S8)', async () => {
    const { http, verificador } = await subir();
    const resposta = await http
      .get('/v1/admin/teste')
      .set('Authorization', 'Bearer token.admin')
      .expect(200);
    expect(resposta.body).toEqual({ contaId: CONTA_ADMIN.contaId });
    expect(verificador.chamadas).toEqual([
      { token: 'token.admin', opcoes: { conferirSessao: true } },
    ]);
  });

  it('em /v1/admin: sem admin ou sem segundo fator → 403 com log só do id (CA-08)', async () => {
    const { http, textoDoLog, registros } = await subir();
    for (const token of ['token.comum', 'token.admin-sem-mfa', 'token.mfa-sem-admin']) {
      const resposta = await http
        .get('/v1/admin/teste')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(problema(resposta.body).codigo).toBe('sem_permissao');
    }
    await vi.waitFor(() => {
      expect(registros().filter((r) => r['msg'] === 'acesso negado a rota de admin')).toHaveLength(
        3,
      );
    });
    const negados = registros().filter((r) => r['msg'] === 'acesso negado a rota de admin');
    expect(negados.map((r) => r['contaId'])).toEqual([
      CONTA_COMUM.contaId,
      CONTA_ADMIN.contaId,
      CONTA_COMUM.contaId,
    ]);
    expect(textoDoLog()).not.toMatch(/token\.(comum|admin)/);
  });

  it('rota de /v1/admin sem `@Perfis` nem `@ExigeMfa` continua só de admin com segundo fator', async () => {
    const { http, verificador } = await subir();
    await http.get('/v1/admin/esquecida').expect(401);
    await http.get('/v1/admin/esquecida').set('Authorization', 'Bearer token.comum').expect(403);
    await http
      .get('/v1/admin/esquecida')
      .set('Authorization', 'Bearer token.admin-sem-mfa')
      .expect(403);
    await http.get('/v1/admin/esquecida').set('Authorization', 'Bearer token.admin').expect(200);
    expect(verificador.chamadas.every(({ opcoes }) => opcoes.conferirSessao)).toBe(true);
  });

  it('o prefixo vale pelo caminho declarado, também com a URL em maiúsculas', async () => {
    const { http, verificador } = await subir();
    await http.get('/V1/ADMIN/teste').set('Authorization', 'Bearer token.comum').expect(403);
    await http.get('/v1/Admin/Esquecida').set('Authorization', 'Bearer token.comum').expect(403);
    expect(verificador.chamadas.map(({ opcoes }) => opcoes.conferirSessao)).toEqual([true, true]);
  });

  it('`@Publico()` numa rota de /v1/admin não a abre: sem token, 401 (S110)', async () => {
    const { http, verificador } = await subir();
    await http.get('/v1/admin/publica-por-engano').expect(401);
    await http.get('/V1/Admin/Publica-Por-Engano').expect(401);
    await http
      .get('/v1/admin/publica-por-engano')
      .set('Authorization', 'Bearer token.comum')
      .expect(403);
    await http
      .get('/v1/admin/publica-por-engano')
      .set('Authorization', 'Bearer token.admin')
      .expect(200);
    expect(verificador.chamadas.map(({ opcoes }) => opcoes.conferirSessao)).toEqual([true, true]);
  });

  it('o prefixo vale também pela rota casada, com o `setGlobalPrefix` (S110)', async () => {
    const { http, verificador } = await subir({ prefixoGlobal: 'v1' });
    await http.get('/v1/admin/pelo-prefixo-global').expect(401);
    await http
      .get('/v1/admin/pelo-prefixo-global')
      .set('Authorization', 'Bearer token.comum')
      .expect(403);
    await http
      .get('/V1/ADMIN/pelo-prefixo-global')
      .set('Authorization', 'Bearer token.admin-sem-mfa')
      .expect(403);
    await http
      .get('/v1/admin/pelo-prefixo-global')
      .set('Authorization', 'Bearer token.admin')
      .expect(200);
    // Fora do prefixo, a mesma guarda não confere a sessão.
    await http.get('/v1/teste/protegida').set('Authorization', 'Bearer token.comum').expect(200);
    expect(verificador.chamadas.map(({ opcoes }) => opcoes.conferirSessao)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

describe('limites por rota (S14, S82)', () => {
  it('por e-mail (normalizado) e por IP, com 429 e Retry-After', async () => {
    const { http } = await subir();
    const rota = '/teste/limitada/por-ip-e-email';
    await http.post(rota).send({ email: 'Fulano@Exemplo.com' }).expect(201);
    await http.post(rota).send({ email: ' fulano@exemplo.com ' }).expect(201);
    // Terceira do mesmo e-mail: 429 pelo limite por e-mail (a terceira do IP
    // ainda cabe no limite dele, 3).
    const porEmail = await http.post(rota).send({ email: 'FULANO@exemplo.com' }).expect(429);
    expect(problema(porEmail.body).codigo).toBe('limite_excedido');
    expect(porEmail.headers['retry-after']).toMatch(/^[1-9]\d*$/);
    // O IP é conferido antes (S109): a recusa por e-mail também contou nele, e
    // um e-mail novo já cai no limite por IP.
    const porIp = await http.post(rota).send({ email: 'outro@exemplo.com' }).expect(429);
    expect(porIp.headers['retry-after']).toMatch(/^[1-9]\d*$/);
  });

  it('IP bloqueado não gasta o contador do e-mail: o mesmo e-mail, de outro IP, ainda passa (S109)', async () => {
    const { http } = await subir({ producao: true });
    const rota = '/teste/limitada/por-ip-e-email';
    const de = (cliente: string) =>
      http.post(rota).set('X-Forwarded-For', `${cliente}, 198.51.100.1`);
    for (const n of [1, 2, 3]) {
      await de('203.0.113.1')
        .send({ email: `lote${n}@exemplo.com` })
        .expect(201);
    }
    // Com o IP bloqueado, as tentativas com o e-mail novo não chegam ao limite por e-mail (2).
    for (let vez = 0; vez < 3; vez += 1) {
      await de('203.0.113.1').send({ email: 'novo@exemplo.com' }).expect(429);
    }
    await de('203.0.113.2').send({ email: 'novo@exemplo.com' }).expect(201);
    await de('203.0.113.3').send({ email: 'novo@exemplo.com' }).expect(201);
    await de('203.0.113.4').send({ email: 'novo@exemplo.com' }).expect(429);
  });

  it('corpo sem e-mail válido não conta no limite por e-mail, mas conta no por IP', async () => {
    const { http } = await subir();
    const rota = '/teste/limitada/por-ip-e-email';
    await http.post(rota).send({ email: 'não é e-mail' }).expect(201);
    await http.post(rota).send({}).expect(201);
    await http.post(rota).send({ email: 'fulano@exemplo.com' }).expect(201);
    await http.post(rota).send({ email: 'fulano@exemplo.com' }).expect(429);
  });

  it('em produção, o IPv6 conta pelo /64 e o IPv4 pelo endereço', async () => {
    const { http } = await subir({ producao: true });
    const rota = '/teste/limitada/por-ip-e-email';
    const via = (cliente: string) => `${cliente}, 198.51.100.1`;
    for (const sufixo of ['1', '2', 'abcd:1234']) {
      await http
        .post(rota)
        .set('X-Forwarded-For', via(`2001:db8:1:2::${sufixo}`))
        .send({})
        .expect(201);
    }
    // Quarta do mesmo /64, com outro sufixo: recusada.
    await http.post(rota).set('X-Forwarded-For', via('2001:db8:1:2:ffff::9')).send({}).expect(429);
    // Outro /64 e outro IPv4 seguem livres.
    await http.post(rota).set('X-Forwarded-For', via('2001:db8:1:3::1')).send({}).expect(201);
    await http.post(rota).set('X-Forwarded-For', via('203.0.113.9')).send({}).expect(201);
  });

  it('por conta: conta a conta autenticada; outra conta tem o próprio limite', async () => {
    const { http } = await subir();
    const rota = '/teste/limitada/por-conta';
    await http.post(rota).set('Authorization', 'Bearer token.comum').expect(201);
    await http.post(rota).set('Authorization', 'Bearer token.comum').expect(429);
    await http.post(rota).set('Authorization', 'Bearer token.admin').expect(201);
  });

  it('a conta é conferida antes do IP: a recusa por conta não gasta o limite do IP (etapa 19, CGNAT)', async () => {
    const { http } = await subir();
    const rota = '/teste/limitada/por-conta-e-ip';
    const como = (token: string) => http.post(rota).set('Authorization', `Bearer ${token}`);
    await como('token.comum').expect(201);
    // Muitas recusas da mesma conta, do mesmo IP: todas pelo limite da conta.
    for (let vez = 0; vez < 5; vez += 1) {
      const recusa = await como('token.comum').expect(429);
      expect(recusa.headers['retry-after']).toMatch(/^[1-9]\d*$/);
    }
    // O IP só contou o pedido aceito: outras duas contas ainda cabem no limite dele (3).
    await como('token.outra').expect(201);
    await como('token.admin').expect(201);
    // Agora o IP estourou: a conta seguinte, ainda dentro do próprio limite, cai no do IP.
    await como('token.terceira').expect(429);
  });
});

describe('CORS', () => {
  it('aceita a origem do painel, com credenciais', async () => {
    const { http } = await subir();
    const resposta = await http.get('/v1/saude').set('Origin', ORIGEM_DO_PAINEL).expect(200);
    expect(resposta.headers['access-control-allow-origin']).toBe(ORIGEM_DO_PAINEL);
    expect(resposta.headers['access-control-allow-credentials']).toBe('true');
  });

  it('recusa origem fora da lista, também na pré-verificação', async () => {
    const { http } = await subir();
    const simples = await http.get('/v1/saude').set('Origin', 'https://malicioso.example');
    expect(simples.headers['access-control-allow-origin']).toBeUndefined();
    expect(simples.headers['access-control-allow-credentials']).toBeUndefined();

    const previa = await http
      .options('/teste/cadastro')
      .set('Origin', 'https://malicioso.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(previa.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('pré-verificação da renovação do painel aceita X-Cliente, POST e DELETE com credenciais (01b)', async () => {
    const { http } = await subir();
    for (const metodo of ['POST', 'DELETE']) {
      const previa = await http
        .options('/v1/sessoes/renovacao')
        .set('Origin', ORIGEM_DO_PAINEL)
        .set('Access-Control-Request-Method', metodo)
        .set('Access-Control-Request-Headers', 'content-type, x-cliente')
        .expect(204);
      expect(previa.headers['access-control-allow-origin']).toBe(ORIGEM_DO_PAINEL);
      expect(previa.headers['access-control-allow-credentials']).toBe('true');
      const permitidos = String(previa.headers['access-control-allow-headers']).toLowerCase();
      expect(permitidos.split(',').map((item) => item.trim())).toContain(
        CABECALHO_DO_CLIENTE.toLowerCase(),
      );
      expect(String(previa.headers['access-control-allow-methods'])).toContain(metodo);
    }
  });

  it('pré-verificação da renovação vinda de fora não recebe nenhum cabeçalho de CORS', async () => {
    const { http } = await subir();
    const previa = await http
      .options('/v1/sessoes/renovacao')
      .set('Origin', 'https://malicioso.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type, x-cliente');
    const deCors = Object.keys(previa.headers).filter((nome) => nome.startsWith('access-control-'));
    expect(deCors).toEqual([]);
  });

  it('nunca responde com `*`', async () => {
    const { http } = await subir();
    const resposta = await http.get('/v1/saude').set('Origin', 'null');
    expect(resposta.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('trust proxy', () => {
  it('fora de produção ignora X-Forwarded-For', async () => {
    const { http } = await subir();
    const resposta = await http.get('/teste/ip').set('X-Forwarded-For', '203.0.113.7').expect(200);
    expect((resposta.body as { ip: string }).ip).toMatch(/127\.0\.0\.1|::1/);
  });

  it('em produção usa o cliente posto pelo Fly e ignora o que o cliente forjou à esquerda', async () => {
    const { http } = await subir({ producao: true });
    // Fly: "<forjado pelo cliente>, <cliente real>, <IP do app>".
    const resposta = await http
      .get('/teste/ip')
      .set('X-Forwarded-For', '6.6.6.6, 203.0.113.7, 198.51.100.1')
      .expect(200);
    expect((resposta.body as { ip: string }).ip).toBe('203.0.113.7');
  });

  it('o limite de requisições não é contornado trocando o X-Forwarded-For fora de produção', async () => {
    const { http } = await subir({ limite: { limite: 1, janelaEmMs: 60_000 } });
    await http.get('/v1/saude').set('X-Forwarded-For', '203.0.113.1').expect(200);
    await http.get('/v1/saude').set('X-Forwarded-For', '203.0.113.2').expect(429);
  });
});
