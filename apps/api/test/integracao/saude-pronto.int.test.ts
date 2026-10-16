// Integração de `GET /v1/saude/pronto` (CA-F3): a aplicação montada como no
// `main.ts`, com o papel `bairrin_app` no Postgres de teste (migrado pelo
// `globalSetup`) ou com um banco inacessível.
import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { problemaSchema, prontidaoSchema, TIPO_DE_CONTEUDO_PROBLEMA } from '@bairrin/contratos';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.ts';
import { carregarAmbiente } from '../../src/compartilhado/config/ambiente.ts';
import {
  configurarAplicacao,
  OPCOES_DA_APLICACAO,
} from '../../src/compartilhado/http/configurar-aplicacao.ts';
import { URL_APP_TESTE } from './preparar-banco.ts';

/** Senha errada de propósito: a mensagem do driver não pode vazar. */
const SENHA_ERRADA = 'senha-errada-que-nao-pode-vazar';

function comSenha(url: string, senha: string): string {
  const endereco = new URL(url);
  endereco.password = senha;
  return endereco.toString();
}

function ambiente(databaseUrl: string) {
  const chave = () => randomBytes(32).toString('base64');
  return carregarAmbiente({
    NODE_ENV: 'test',
    PORTA: '3000',
    DATABASE_URL: databaseUrl,
    CORS_ORIGENS: 'https://painel.bairrin.com.br',
    JWT_SEGREDO: chave(),
    CHAVE_CIFRAGEM_DADOS: chave(),
    CHAVE_HMAC: chave(),
    SMTP_URL: 'smtp://127.0.0.1:1025',
    EMAIL_REMETENTE: 'nao-responda@bairrin.com.br',
    LOG_NIVEL: 'info',
  });
}

/**
 * Destino único do log para o arquivo (o nestjs-pino cria o pino-http uma vez
 * por processo); cada `subir()` limpa as linhas.
 */
const linhas: string[] = [];
const destinoDoLog = { write: (linha: string) => void linhas.push(linha) };

let aberta: NestExpressApplication | undefined;

afterEach(async () => {
  await aberta?.close();
  aberta = undefined;
});

async function subir(databaseUrl: string) {
  linhas.length = 0;
  const amb = ambiente(databaseUrl);
  const modulo = await Test.createTestingModule({
    imports: [AppModule.registrar({ ambiente: amb, destinoDoLog })],
  }).compile();
  const app = modulo.createNestApplication<NestExpressApplication>(OPCOES_DA_APLICACAO);
  configurarAplicacao(app, amb);
  await app.init();
  aberta = app;
  return { http: request(app.getHttpServer()), textoDoLog: () => linhas.join('\n') };
}

describe('GET /v1/saude/pronto', () => {
  it('responde 200 quando o banco responde', async () => {
    const { http } = await subir(URL_APP_TESTE);
    const resposta = await http.get('/v1/saude/pronto').expect(200);
    expect(prontidaoSchema.parse(resposta.body)).toEqual({ status: 'ok' });
    expect(resposta.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['com senha errada', comSenha(URL_APP_TESTE, SENHA_ERRADA)],
    // Porta 1: nada escuta ali, a conexão é recusada na hora.
    ['fora do ar', 'postgresql://bairrin_app:ficticia@127.0.0.1:1/bairrin_teste'],
  ])(
    'responde 503 em Problem Details, sem detalhe interno, quando o banco está %s',
    async (_caso, databaseUrl) => {
      const { http, textoDoLog } = await subir(databaseUrl);
      const resposta = await http.get('/v1/saude/pronto').expect(503);

      expect(resposta.headers['content-type']).toContain(TIPO_DE_CONTEUDO_PROBLEMA);
      const problema = problemaSchema.parse(resposta.body);
      expect(problema).toMatchObject({ status: 503, codigo: 'indisponivel' });
      expect(Object.keys(resposta.body as object).sort()).toEqual(
        ['codigo', 'idRequisicao', 'status', 'title', 'type'].sort(),
      );
      const corpo = JSON.stringify(resposta.body);
      for (const vazamento of ['bairrin_app', '127.0.0.1', 'ECONNREFUSED', SENHA_ERRADA]) {
        expect(corpo).not.toContain(vazamento);
      }

      // A causa vai para o log só com tipo, código e pilha: nunca a mensagem
      // do driver (traz papel, host e pode trazer parâmetros) nem a URL.
      const log = textoDoLog();
      expect(log).toContain('banco indisponível na verificação de prontidão');
      for (const vazamento of [
        'bairrin_app',
        SENHA_ERRADA,
        'password authentication failed',
        'Authentication failed',
        'connect ECONNREFUSED',
        '"msg":"connect',
      ]) {
        expect(log).not.toContain(vazamento);
      }
    },
  );
});
