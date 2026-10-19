// R1 (S9): o servidor encerra a sessão 30 min depois da última renovação, não da última interação.
// Uma API falsa que conta essa janela mostra que a interação da pessoa chega ao servidor: quem
// interage aos 20 min e pede algo aos 31 min continua conectado, sem renovação recusada.
import type { RespostaMinima } from '@bairrin/cliente-api';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTA, criarApiFalsa } from '../autenticacao/teste/api-falsa.ts';
import { montarApp, t } from '../autenticacao/fixtures/fluxo-comum.tsx';
import type { FetchDoNavegador } from './autenticacao-do-painel.ts';
import type { SinaisEntreAbas } from './entre-abas.ts';

const MINUTO = 60_000;
const JANELA_DO_SERVIDOR_MS = 30 * MINUTO;
const VALIDADE_DO_TOKEN_MS = 15 * MINUTO;

/**
 * Servidor com a regra do painel: a renovação vale até 30 min depois da anterior (depois disso,
 * 401) e o token de acesso vale 15 min. A sessão existe desde a hora em que o teste começa.
 */
function servidorComJanela() {
  const api = criarApiFalsa();
  let renovadaEm = Date.now();
  let emitidos = 0;
  const validade = new Map<string, number>();
  const renovacoes: number[] = [];

  const responder = (status: number, corpo?: unknown): RespostaMinima => ({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(corpo === undefined ? '' : JSON.stringify(corpo)),
  });
  const naoAutenticado = () =>
    responder(401, {
      type: 'urn:bairrin:erro:nao_autenticado',
      title: 'Erro',
      status: 401,
      codigo: 'nao_autenticado',
      idRequisicao: 'req-teste',
    });

  const fetch: FetchDoNavegador = async (url, init) => {
    await Promise.resolve();
    const agora = Date.now();
    const caminho = new URL(url).pathname;
    const metodo = init.method ?? 'GET';
    if (metodo === 'POST' && caminho === '/v1/sessoes/renovacao') {
      renovacoes.push(agora - renovadaEm <= JANELA_DO_SERVIDOR_MS ? 200 : 401);
      if (renovacoes.at(-1) === 401) return naoAutenticado();
      renovadaEm = agora;
      emitidos += 1;
      const token = `token-${emitidos}`;
      validade.set(token, agora + VALIDADE_DO_TOKEN_MS);
      return responder(200, {
        tokenAcesso: token,
        expiraEm: new Date(agora + VALIDADE_DO_TOKEN_MS).toISOString(),
        emailVerificado: true,
      });
    }
    if (metodo === 'GET' && caminho === '/v1/admin/conta') {
      const cabecalhos = (init.headers ?? {}) as Record<string, string>;
      const token = (cabecalhos['Authorization'] ?? '').replace('Bearer ', '');
      const valeAte = validade.get(token) ?? 0;
      const sessaoViva = agora - renovadaEm <= JANELA_DO_SERVIDOR_MS;
      return agora < valeAte && sessaoViva ? responder(200, CONTA) : naoAutenticado();
    }
    if (metodo === 'GET' && caminho === '/v1/saude') return responder(200, { status: 'ok' });
    if (metodo === 'DELETE' && caminho === '/v1/sessoes/renovacao') return responder(204);
    return responder(404);
  };
  // `montarApp` usa o `responder` da API falsa só para a saúde; o `fetch` é este.
  return { api: { ...api, fetch }, renovacoes };
}

const sinaisMudos: SinaisEntreAbas = { enviar: () => undefined, ouvir: () => () => undefined };
const avancar = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe('R1: a interação chega ao servidor', () => {
  it('interação aos 20 min e requisição aos 31 min: continua conectado, nenhuma renovação recusada', async () => {
    const servidor = servidorComJanela();
    const { autenticacao } = montarApp(servidor.api, { entreAbas: sinaisMudos });
    await avancar(0);
    expect(screen.getByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();

    await avancar(20 * MINUTO);
    fireEvent.keyDown(document.body, { key: 'a' });
    await avancar(11 * MINUTO);
    const conta = await act(() => autenticacao.consultarConta());

    expect(conta).toEqual(CONTA);
    expect(servidor.renovacoes).toEqual([200, 200]);
    expect(screen.queryByText(t.aviso.sessaoTerminou)).toBeNull();
    expect(screen.getByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
  });

  it('uso contínuo por 1 h (uma tecla por minuto): uma renovação a cada janela de 10 min, nenhuma recusada', async () => {
    const servidor = servidorComJanela();
    const { autenticacao } = montarApp(servidor.api, { entreAbas: sinaisMudos });
    await avancar(0);

    for (let minuto = 1; minuto <= 60; minuto += 1) {
      await avancar(MINUTO);
      fireEvent.keyDown(document.body, { key: 'a' });
    }
    await act(() => autenticacao.consultarConta());

    // A abertura e as interações dos 11, 22, 33, 44 e 55 min.
    expect(servidor.renovacoes).toEqual([200, 200, 200, 200, 200, 200]);
    expect(screen.queryByText(t.inicio.expirando)).toBeNull();
    expect(screen.queryByText(t.aviso.sessaoTerminou)).toBeNull();
  });

  it('a API falsa recusa mesmo: sem a interação que renova, o pedido aos 31 min leva a P1', async () => {
    const servidor = servidorComJanela();
    const { autenticacao } = montarApp(servidor.api, { entreAbas: sinaisMudos });
    await avancar(0);

    // Interação aos 5 min: ainda dentro dos 10 min da abertura, não renova (limite do N).
    await avancar(5 * MINUTO);
    fireEvent.keyDown(document.body, { key: 'a' });
    await avancar(26 * MINUTO);
    await act(() => autenticacao.consultarConta().catch(() => undefined));
    await avancar(0);

    expect(servidor.renovacoes).toEqual([200, 401]);
    expect(screen.getByText(t.aviso.sessaoTerminou)).toBeTruthy();
  });
});
