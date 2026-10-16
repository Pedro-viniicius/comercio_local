// Integração da base HTTP (CA-F3): a aplicação montada como no `main.ts`,
// mais rotas de teste para validação, erro inesperado, log e IP do cliente.
// Não usa banco nem `.env`: o ambiente é fictício e o log vai para a memória.
import { randomBytes } from 'node:crypto';
import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { objetoEstrito, problemaSchema, z } from '@bairrin/contratos';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppModule, type LimiteDeRequisicoes } from '../../src/app.module.ts';
import { carregarAmbiente } from '../../src/compartilhado/config/ambiente.ts';
import {
  configurarAplicacao,
  OPCOES_DA_APLICACAO,
} from '../../src/compartilhado/http/configurar-aplicacao.ts';
import { ValidacaoZodPipe } from '../../src/compartilhado/http/validacao-zod.pipe.ts';

const ORIGEM_DO_PAINEL = 'https://painel.bairrin.com.br';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const cadastroSchema = objetoEstrito({
  nome: z.string().min(1),
  idade: z.number().int().min(18),
});

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

async function subir(opcoes: { producao?: boolean; limite?: LimiteDeRequisicoes } = {}) {
  linhas.length = 0;
  const amb = ambiente(opcoes.producao);
  const modulo = await Test.createTestingModule({
    imports: [
      AppModule.registrar({
        ambiente: amb,
        destinoDoLog,
        ...(opcoes.limite ? { limiteDeRequisicoes: opcoes.limite } : {}),
      }),
    ],
    controllers: [RotasDeTeste],
  }).compile();
  const app = modulo.createNestApplication<NestExpressApplication>(OPCOES_DA_APLICACAO);
  configurarAplicacao(app, amb);
  await app.init();
  aberta = app;
  const registros = () => linhas.map((linha) => JSON.parse(linha) as Record<string, unknown>);
  return { http: request(app.getHttpServer()), textoDoLog: () => linhas.join('\n'), registros };
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
