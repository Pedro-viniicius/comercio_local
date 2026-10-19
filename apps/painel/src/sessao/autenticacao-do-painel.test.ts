// Montagem da sessão do painel: cookie em toda chamada, marca `{}` no `localStorage` (P14) com
// try/catch, token só em memória e falha em segundo plano só com a origem.
import type { FalhaEmSegundoPlano } from '@bairrin/cliente-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  armazenamentoDeRevogacaoNoNavegador,
  armazenamentoEmMemoria,
  avisoSoComOrigem,
  CHAVE_DO_LOGOUT_PENDENTE,
  criarAutenticacaoDoPainel,
  criarFetchComCookie,
  type FetchDoNavegador,
} from './autenticacao-do-painel.ts';
import { BASE_URL, criarApiFalsa, problema, SESSAO } from '../autenticacao/teste/api-falsa.ts';

afterEach(() => {
  localStorage.clear();
});

/** Armazenamento que recusa tudo, como o navegador com o site bloqueado. */
function armazenamentoQueRecusa(): Storage {
  const recusar = () => {
    throw new DOMException('acesso negado a pedro@exemplo.com.br', 'SecurityError');
  };
  return {
    length: 0,
    clear: recusar,
    getItem: recusar,
    key: recusar,
    removeItem: recusar,
    setItem: recusar,
  };
}

describe('criarFetchComCookie', () => {
  it('manda `credentials: include` e preserva método, cabeçalhos, corpo e sinal', async () => {
    const buscar = vi.fn<FetchDoNavegador>(() =>
      Promise.resolve({ status: 204, ok: true, text: () => Promise.resolve('') }),
    );
    const sinal = new AbortController().signal;
    await criarFetchComCookie(buscar)('https://api/x', {
      method: 'POST',
      headers: { 'X-Cliente': 'painel' },
      body: '{}',
      signal: sinal,
    });

    expect(buscar).toHaveBeenCalledWith('https://api/x', {
      method: 'POST',
      headers: { 'X-Cliente': 'painel' },
      body: '{}',
      signal: sinal,
      credentials: 'include',
    });
  });
});

describe('armazenamentoDeRevogacaoNoNavegador (P14)', () => {
  it('grava sempre `{}`, mesmo se receber outro valor, e lê a marca como `{}`', async () => {
    const marca = armazenamentoDeRevogacaoNoNavegador();
    expect(await marca.ler()).toBeNull();

    await marca.gravar({ tokenAcesso: 'nao-pode-ir', tokenRenovacao: 'nem-este' });
    expect(localStorage.getItem(CHAVE_DO_LOGOUT_PENDENTE)).toBe('{}');
    expect(await marca.ler()).toEqual({});

    await marca.limpar();
    expect(localStorage.getItem(CHAVE_DO_LOGOUT_PENDENTE)).toBeNull();
  });

  it('qualquer valor guardado conta como marca', async () => {
    localStorage.setItem(CHAVE_DO_LOGOUT_PENDENTE, 'lixo');
    expect(await armazenamentoDeRevogacaoNoNavegador().ler()).toEqual({});
  });

  it('com o armazenamento recusado: leitura vira marca e escrita rejeita sem detalhe', async () => {
    const marca = armazenamentoDeRevogacaoNoNavegador(armazenamentoQueRecusa);
    expect(await marca.ler()).toEqual({});

    const erros = await Promise.all([
      marca.gravar({}).catch((erro: unknown) => erro),
      marca.limpar().catch((erro: unknown) => erro),
    ]);
    for (const erro of erros) {
      expect(erro).toBeInstanceOf(Error);
      expect((erro as Error).message).not.toContain('@');
      expect((erro as Error).cause).toBeUndefined();
    }
  });

  it('o acesso ao `localStorage` que lança (site bloqueado) não quebra a criação', async () => {
    const marca = armazenamentoDeRevogacaoNoNavegador(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    expect(await marca.ler()).toEqual({});
    await expect(marca.gravar({})).rejects.toBeInstanceOf(Error);
  });
});

describe('armazenamentoEmMemoria (S9)', () => {
  it('guarda e limpa sem tocar no armazenamento do navegador', async () => {
    const memoria = armazenamentoEmMemoria();
    expect(await memoria.ler()).toBeNull();
    await memoria.gravar(SESSAO);
    expect(await memoria.ler()).toEqual(SESSAO);
    expect(JSON.stringify({ ...localStorage })).not.toContain(SESSAO.tokenAcesso);
    await memoria.limpar();
    expect(await memoria.ler()).toBeNull();
  });
});

describe('avisoSoComOrigem (Q18)', () => {
  it('repassa só a origem: nem o erro, nem token', () => {
    const registrar = vi.fn();
    const falha: FalhaEmSegundoPlano = {
      origem: 'revogacao_pendente',
      erro: new Error(`token ${SESSAO.tokenAcesso}`),
    };
    avisoSoComOrigem(registrar)(falha);
    expect(registrar).toHaveBeenCalledWith({ origem: 'revogacao_pendente' });
    expect(JSON.stringify(registrar.mock.calls)).not.toContain(SESSAO.tokenAcesso);
  });

  it('sem registrador (painel ainda sem Sentry) não faz nada', () => {
    expect(() =>
      avisoSoComOrigem(undefined)({ origem: 'gravar_sessao', erro: null }),
    ).not.toThrow();
  });

  it('a falha de gravar a marca chega ao registrador só com a origem', async () => {
    const api = criarApiFalsa();
    api.responder('DELETE /v1/sessoes/renovacao', 'rede');
    const registrarFalha = vi.fn();
    const autenticacao = criarAutenticacaoDoPainel({
      baseUrl: BASE_URL,
      fetch: api.fetch,
      revogacaoPendente: armazenamentoDeRevogacaoNoNavegador(armazenamentoQueRecusa),
      registrarFalha,
    });

    expect(await autenticacao.encerrarSessao()).toEqual({ revogadaNoServidor: false });
    expect(registrarFalha).toHaveBeenCalledWith({ origem: 'revogacao_pendente' });
    for (const [evento] of registrarFalha.mock.calls)
      expect(Object.keys(evento as object)).toEqual(['origem']);
  });
});

describe('criarAutenticacaoDoPainel', () => {
  it('entrar com sessão direta já a guarda; a rota protegida vai com o Bearer', async () => {
    const api = criarApiFalsa();
    api.responder('POST /v1/sessoes', { status: 200, corpo: SESSAO });
    api.responder('GET /v1/admin/conta', {
      status: 200,
      corpo: { nome: 'P', emailMascarado: 'p***@x.com', perfis: ['admin'] },
    });
    const autenticacao = criarAutenticacaoDoPainel({ baseUrl: BASE_URL, fetch: api.fetch });

    await autenticacao.entrar({ email: 'a@b.com', senha: 'x', cliente: 'painel' });
    await autenticacao.consultarConta();
    expect(api.pedidosDa('GET /v1/admin/conta')[0]?.cabecalhos['Authorization']).toBe(
      `Bearer ${SESSAO.tokenAcesso}`,
    );
  });

  it('o desafio não abre sessão: a rota protegida vai sem Bearer', async () => {
    const api = criarApiFalsa();
    api.responder('POST /v1/sessoes', {
      status: 200,
      corpo: { etapa: 'verificar', desafio: 'd.s' },
    });
    api.responder('GET /v1/admin/conta', problema(401, 'nao_autenticado'));
    const autenticacao = criarAutenticacaoDoPainel({ baseUrl: BASE_URL, fetch: api.fetch });

    await autenticacao.entrar({ email: 'a@b.com', senha: 'x', cliente: 'painel' });
    await expect(autenticacao.consultarConta()).rejects.toMatchObject({ status: 401 });
    expect(api.pedidosDa('GET /v1/admin/conta')[0]?.cabecalhos['Authorization']).toBeUndefined();
  });

  it('avisa os ouvintes quando a renovação é recusada e para de avisar depois de cancelar', async () => {
    const api = criarApiFalsa();
    api.responder('POST /v1/sessoes', { status: 200, corpo: SESSAO });
    api.responder('GET /v1/admin/conta', problema(401, 'nao_autenticado'));
    api.responder('POST /v1/sessoes/renovacao', problema(401, 'nao_autenticado'));
    const autenticacao = criarAutenticacaoDoPainel({ baseUrl: BASE_URL, fetch: api.fetch });
    const ouvinte = vi.fn();
    const outro = vi.fn();
    autenticacao.aoEncerrar(ouvinte);
    autenticacao.aoEncerrar(outro)();

    await autenticacao.entrar({ email: 'a@b.com', senha: 'x', cliente: 'painel' });
    await expect(autenticacao.consultarConta()).rejects.toMatchObject({ status: 401 });
    expect(ouvinte).toHaveBeenCalledWith('renovacao_recusada');
    expect(outro).not.toHaveBeenCalled();
  });
});
