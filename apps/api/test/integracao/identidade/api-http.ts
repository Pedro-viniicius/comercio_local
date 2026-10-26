// Ajudas dos testes de integração das rotas da Identidade (plano 01b, etapa 16): a API
// inteira (`AppModule` com `configurarAplicacao`, como no `main.ts`) contra o Postgres de
// teste, com o relógio parado em `T0` e as mesmas chaves da `montarPilha()`, para o teste
// gravar códigos e ler freios pela pilha. Não é um teste: fica fora do filtro
// `*.int.test.ts`.
//
// `trust proxy` ligado só aqui: cada teste escolhe o IP do cliente por `X-Forwarded-For`
// (`ipNovo()`), sem esbarrar nos limites por IP de outro teste. Em produção vale o
// `SALTOS_DE_PROXY_NO_FLY` (`http-base.int.test.ts` prova).
import { randomInt } from 'node:crypto';
import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { problemaSchema, type Problema, sessaoSchema, type Sessao } from '@bairrin/contratos';
import request from 'supertest';
import { AppModule } from '../../../src/app.module.ts';
import { carregarAmbiente } from '../../../src/compartilhado/config/ambiente.ts';
import {
  configurarAplicacao,
  OPCOES_DA_APLICACAO,
} from '../../../src/compartilhado/http/configurar-aplicacao.ts';
import { Relogio, RelogioFixo } from '../../../src/compartilhado/tempo/relogio.ts';
import { chaveDoFreioPorOrigem } from '../../../src/modulos/identidade/aplicacao/sessao/comum.ts';
import { COOKIE_DE_RENOVACAO } from '../../../src/modulos/identidade/http/sessao-no-http.ts';
import { criarCapturaDeLog } from '../../helpers/captura-de-log.ts';
import { URL_APP_TESTE } from '../preparar-banco.ts';
import { CHAVES, type Pilha, T0 } from './pilha-de-casos-de-uso.ts';

export const ORIGEM_DO_PAINEL = 'https://painel.bairrin.com.br';

/**
 * Destino único do log no arquivo (o nestjs-pino cria o pino-http uma vez por processo):
 * cada `subirApi()` limpa as linhas.
 */
const captura = criarCapturaDeLog();

export interface ApiDeTeste {
  readonly app: NestExpressApplication;
  readonly http: ReturnType<typeof request>;
  readonly relogio: RelogioFixo;
  /** As linhas do log desde a subida, juntas. */
  textoDoLog(): string;
  /** As linhas do log desde a subida, como objetos. */
  registrosDoLog(): Record<string, unknown>[];
  fechar(): Promise<void>;
}

/**
 * Sobe a API com o relógio em `T0` (ou o dado). `controllers`: rotas extras só do teste;
 * `antesDeIniciar`: o que o `main.ts` faria antes do `init` (ex.: o interceptador do Sentry).
 */
export async function subirApi(
  opcoes: {
    relogio?: RelogioFixo;
    controllers?: Type[];
    antesDeIniciar?: (app: NestExpressApplication) => void;
  } = {},
): Promise<ApiDeTeste> {
  captura.limpar();
  const relogio = opcoes.relogio ?? new RelogioFixo(T0);
  const ambiente = carregarAmbiente({
    NODE_ENV: 'test',
    PORTA: '3000',
    DATABASE_URL: URL_APP_TESTE,
    CORS_ORIGENS: ORIGEM_DO_PAINEL,
    ...CHAVES,
    SMTP_URL: 'smtp://127.0.0.1:1025',
    EMAIL_REMETENTE: 'nao-responda@bairrin.com.br',
    LOG_NIVEL: 'info',
  });
  const modulo = await Test.createTestingModule({
    imports: [AppModule.registrar({ ambiente, destinoDoLog: captura.destino })],
    controllers: opcoes.controllers ?? [],
  })
    .overrideProvider(Relogio)
    .useValue(relogio)
    .compile();
  const app = modulo.createNestApplication<NestExpressApplication>(OPCOES_DA_APLICACAO);
  configurarAplicacao(app, ambiente);
  app.set('trust proxy', true);
  opcoes.antesDeIniciar?.(app);
  await app.init();
  return {
    app,
    http: request(app.getHttpServer()),
    relogio,
    textoDoLog: () => captura.texto(),
    registrosDoLog: () => captura.registros(),
    fechar: () => app.close(),
  };
}

/**
 * Um IPv4 de rede privada sorteado, com a chave do freio por origem anotada em `freios`
 * para a limpeza.
 */
export function ipNovo(pilha: Pilha, freios: string[]): string {
  const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  freios.push(chaveDoFreioPorOrigem(pilha.servicos.cifrador, ip));
  return ip;
}

/** O Problem Details da resposta (lança se o corpo não é um). */
export function problemaDe(corpo: unknown): Problema {
  return problemaSchema.parse(corpo);
}

/** O Problema sem o `idRequisicao`, para comparar respostas entre si. */
export function semId(corpo: unknown): Omit<Problema, 'idRequisicao'> {
  const { idRequisicao: _id, ...resto } = problemaDe(corpo);
  return resto;
}

/** A sessão da resposta, conferida pelo contrato. */
export function sessaoDe(corpo: unknown): Sessao {
  return sessaoSchema.parse(corpo);
}

/** O cabeçalho `Set-Cookie` como lista (o supertest o devolve como texto ou lista). */
export function setCookies(cabecalhos: Record<string, unknown>): string[] {
  const valor = cabecalhos['set-cookie'];
  if (Array.isArray(valor)) return valor.map(String);
  return typeof valor === 'string' ? [valor] : [];
}

/** O cookie de renovação gravado pela resposta, com o valor e os atributos. */
export function cookieDeRenovacao(
  cabecalhos: Record<string, unknown>,
): { valor: string; atributos: string[] } | null {
  const linha = setCookies(cabecalhos).find((cookie) =>
    cookie.startsWith(`${COOKIE_DE_RENOVACAO}=`),
  );
  if (linha === undefined) return null;
  const [par = '', ...atributos] = linha.split(';').map((parte) => parte.trim());
  return { valor: decodeURIComponent(par.slice(COOKIE_DE_RENOVACAO.length + 1)), atributos };
}

/** `Cookie:` com o token de renovação do painel. */
export function comCookie(token: string): string {
  return `${COOKIE_DE_RENOVACAO}=${encodeURIComponent(token)}`;
}
