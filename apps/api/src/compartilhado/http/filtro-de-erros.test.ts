import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  MethodNotAllowedException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { camposDoErroZod, entrarSchema, problemaSchema } from '@bairrin/contratos';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import {
  classificarExcecao,
  ErroComCodigo,
  FiltroDeErros,
  MAXIMO_DE_CAMPOS_NO_PROBLEMA,
} from './filtro-de-erros.ts';
import { ErroDeValidacao } from './validacao-zod.pipe.ts';

/** Erro como o do leitor de corpo do Express (`http-errors`). */
function erroDoLeitorDeCorpo(status: number, type: string): Error {
  return Object.assign(new Error('request entity too large'), { status, type, expose: true });
}

describe('classificarExcecao', () => {
  it.each([
    [new BadRequestException('Unexpected token } in JSON at position 9'), 'validacao'],
    [new UnauthorizedException(), 'nao_autenticado'],
    [new ForbiddenException(), 'sem_permissao'],
    [new NotFoundException('Cannot GET /v1/x'), 'nao_encontrado'],
    [new HttpException('x', 409), 'conflito'],
    [new PayloadTooLargeException(), 'corpo_grande_demais'],
    [new ThrottlerException(), 'limite_excedido'],
    [new MethodNotAllowedException(), 'validacao'],
    [new ServiceUnavailableException(), 'indisponivel'],
    [erroDoLeitorDeCorpo(413, 'entity.too.large'), 'corpo_grande_demais'],
    [erroDoLeitorDeCorpo(415, 'encoding.unsupported'), 'validacao'],
  ])('%s → %s, esperado', (excecao, codigo) => {
    expect(classificarExcecao(excecao)).toEqual({ codigo, inesperado: false });
  });

  it('ErroDeValidacao leva os campos', () => {
    const campos = [
      { campo: 'nome', codigo: 'obrigatorio' as const, motivo: 'Campo obrigatório.' },
    ];
    expect(classificarExcecao(new ErroDeValidacao(campos))).toEqual({
      codigo: 'validacao',
      campos,
      inesperado: false,
    });
  });

  it('ErroComCodigo escolhe o código e leva a espera do freio (01b, etapa 16)', () => {
    expect(classificarExcecao(new ErroComCodigo('sem_acesso_painel'))).toEqual({
      codigo: 'sem_acesso_painel',
      inesperado: false,
    });
    expect(
      classificarExcecao(new ErroComCodigo('limite_excedido', { esperaEmSegundos: 59.2 })),
    ).toEqual({ codigo: 'limite_excedido', inesperado: false, esperaEmSegundos: 60 });
    // `Retry-After: 0` faria o cliente repetir na hora: no mínimo 1 s.
    expect(new ErroComCodigo('limite_excedido', { esperaEmSegundos: 0 }).esperaEmSegundos).toBe(1);
    expect(new ErroComCodigo('sem_acesso_painel').getStatus()).toBe(403);
  });

  it.each([
    ['Error', new Error('falha com fulano@exemplo.com')],
    ['TypeError', new TypeError('x is undefined')],
    ['HttpException 500', new InternalServerErrorException('detalhe interno')],
    ['valor que não é Error', 'texto lançado'],
    ['erro com status 4xx sem `type`', Object.assign(new Error('x'), { status: 400 })],
  ])('%s → erro_interno inesperado', (_nome, excecao) => {
    expect(classificarExcecao(excecao)).toEqual({ codigo: 'erro_interno', inesperado: true });
  });
});

interface RespostaFalsa {
  statusCode: number;
  headersSent: boolean;
  err?: Error;
  cabecalhos: Record<string, string>;
  corpo?: string;
  destruida: boolean;
}

function montar(opcoes: { comLogDaRequisicao?: boolean; headersSent?: boolean } = {}) {
  const req = { id: 'id-fixo-123', ...(opcoes.comLogDaRequisicao ? { log: {} } : {}) };
  const resposta: RespostaFalsa = {
    statusCode: 200,
    headersSent: opcoes.headersSent ?? false,
    cabecalhos: {},
    destruida: false,
  };
  const res = Object.assign(resposta, {
    setHeader(nome: string, valor: string) {
      resposta.cabecalhos[nome.toLowerCase()] = valor;
    },
    end(corpo: string) {
      resposta.corpo = corpo;
    },
    destroy() {
      resposta.destruida = true;
    },
  });
  const host = {
    switchToHttp: () => ({
      getRequest: () => req as unknown as IncomingMessage,
      getResponse: () => res as unknown as ServerResponse,
    }),
  } as unknown as ArgumentsHost;
  const logger = { setContext: vi.fn(), error: vi.fn(), warn: vi.fn() };
  const filtro = new FiltroDeErros(logger as unknown as PinoLogger);
  return { filtro, host, resposta, logger };
}

describe('FiltroDeErros', () => {
  it('erro inesperado vira 500 genérico, sem mensagem nem pilha, com idRequisicao', () => {
    const { filtro, host, resposta } = montar({ comLogDaRequisicao: true });
    const erro = new Error('falha no banco com fulano@exemplo.com');

    filtro.catch(erro, host);

    expect(resposta.statusCode).toBe(500);
    expect(resposta.cabecalhos['content-type']).toBe('application/problem+json; charset=utf-8');
    const corpo: unknown = JSON.parse(resposta.corpo ?? '');
    expect(problemaSchema.parse(corpo)).toEqual({
      type: 'urn:bairrin:erro:erro_interno',
      title: 'Erro interno',
      status: 500,
      codigo: 'erro_interno',
      idRequisicao: 'id-fixo-123',
    });
    expect(resposta.corpo).not.toContain('fulano@exemplo.com');
    expect(resposta.corpo).not.toContain('falha no banco');
    expect(resposta.corpo).not.toMatch(/\bat\s|stack|pilha/);
  });

  it('com o log da requisição ativo, entrega o erro ao pino-http por `res.err`', () => {
    const { filtro, host, resposta, logger } = montar({ comLogDaRequisicao: true });
    const erro = new Error('x');
    filtro.catch(erro, host);
    expect(resposta.err).toBe(erro);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('sem o log da requisição (falha antes do pino-http), registra o erro direto com o id', () => {
    const { filtro, host, logger, resposta } = montar();
    const erro = new Error('x');
    filtro.catch(erro, host);
    expect(resposta.err).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: erro, idRequisicao: 'id-fixo-123' }),
      expect.any(String),
    );
  });

  it('sem o log da requisição, registra a recusa esperada como aviso, sem erro', () => {
    const { filtro, host, logger } = montar();
    filtro.catch(new PayloadTooLargeException(), host);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [registro] = logger.warn.mock.calls[0] as [Record<string, unknown>];
    expect(registro['idRequisicao']).toBe('id-fixo-123');
    expect(registro).not.toHaveProperty('err');
  });

  it('erro esperado (404) não é registrado como inesperado', () => {
    const { filtro, host, resposta, logger } = montar({ comLogDaRequisicao: true });
    filtro.catch(new NotFoundException('Cannot GET /v1/segredo?token=abc'), host);
    expect(resposta.statusCode).toBe(404);
    expect(resposta.err).toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(resposta.corpo).not.toContain('token=abc');
  });

  it('ErroDeValidacao devolve 400 com os campos', () => {
    const { filtro, host, resposta } = montar();
    const campos = [
      { campo: 'nome', codigo: 'obrigatorio' as const, motivo: 'Campo obrigatório.' },
    ];
    filtro.catch(new ErroDeValidacao(campos), host);
    expect(resposta.statusCode).toBe(400);
    expect(JSON.parse(resposta.corpo ?? '')).toMatchObject({ codigo: 'validacao', campos });
  });

  it('corpo de ~100 KB com milhares de chaves desconhecidas: o 400 leva só os primeiros 20 campos (Q30)', () => {
    // Chaves curtas até o limite do corpo (100 KB): uma por item de `campos` sem o corte.
    const chaves: string[] = [];
    let tamanho = 0;
    while (tamanho < 100 * 1024 - 100) {
      const chave = `k${chaves.length}`;
      chaves.push(`"${chave}":1`);
      tamanho += chave.length + 5;
    }
    const bruto = `{"email":"nao-e-email",${chaves.join(',')}}`;
    const resultado = entrarSchema.safeParse(JSON.parse(bruto));
    if (resultado.success) throw new Error('o corpo deveria ser recusado');
    expect(camposDoErroZod(resultado.error).length).toBeGreaterThan(10_000);

    const { filtro, host, resposta } = montar();
    filtro.catch(new ErroDeValidacao(camposDoErroZod(resultado.error)), host);

    expect(resposta.statusCode).toBe(400);
    const problema = problemaSchema.parse(JSON.parse(resposta.corpo ?? ''));
    expect(problema.campos).toHaveLength(MAXIMO_DE_CAMPOS_NO_PROBLEMA);
    // Os campos declarados vêm primeiro, com o motivo em português (CA-13).
    expect(problema.campos?.slice(0, 3)).toEqual([
      { campo: 'email', codigo: 'invalido', motivo: 'Confira o e-mail: falta o @ ou o domínio' },
      { campo: 'senha', codigo: 'obrigatorio', motivo: 'Campo obrigatório.' },
      expect.objectContaining({ campo: 'cliente', codigo: 'invalido' }),
    ]);
    expect(problema.campos?.[3]).toEqual({
      campo: 'k0',
      codigo: 'desconhecido',
      motivo: 'Campo desconhecido.',
    });
    expect(bruto.length).toBeGreaterThan(100 * 1024 - 200);
    expect(resposta.corpo?.length).toBeLessThan(4 * 1024);
  });

  it('ErroDeValidacao com até 20 campos passa inteiro', () => {
    const campos = Array.from({ length: MAXIMO_DE_CAMPOS_NO_PROBLEMA }, (_, indice) => ({
      campo: `c${indice}`,
      codigo: 'desconhecido' as const,
      motivo: 'Campo desconhecido.',
    }));
    expect(classificarExcecao(new ErroDeValidacao(campos)).campos).toEqual(campos);
    expect(
      classificarExcecao(new ErroDeValidacao([...campos, { ...campos[0]!, campo: 'extra' }]))
        .campos,
    ).toEqual(campos);
  });

  it('ErroComCodigo responde com o código e, no freio, com Retry-After', () => {
    const painel = montar();
    painel.filtro.catch(new ErroComCodigo('sem_acesso_painel'), painel.host);
    expect(painel.resposta.statusCode).toBe(403);
    expect(JSON.parse(painel.resposta.corpo ?? '')).toMatchObject({ codigo: 'sem_acesso_painel' });
    expect(painel.resposta.cabecalhos['retry-after']).toBeUndefined();

    const freio = montar();
    freio.filtro.catch(new ErroComCodigo('limite_excedido', { esperaEmSegundos: 300 }), freio.host);
    expect(freio.resposta.statusCode).toBe(429);
    expect(freio.resposta.cabecalhos['retry-after']).toBe('300');
    expect(JSON.parse(freio.resposta.corpo ?? '')).toMatchObject({ codigo: 'limite_excedido' });
  });

  it('com a resposta já iniciada, só encerra a conexão', () => {
    const { filtro, host, resposta } = montar({ headersSent: true });
    filtro.catch(new Error('x'), host);
    expect(resposta.destruida).toBe(true);
    expect(resposta.corpo).toBeUndefined();
  });
});
