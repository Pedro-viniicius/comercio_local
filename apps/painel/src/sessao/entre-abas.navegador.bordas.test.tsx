// QA do grupo C, rodada 2 (R2, S89): os sinais entre abas com o `BroadcastChannel` de verdade (o
// Node o traz, e o jsdom o deixa passar). Duas "abas" do mesmo processo conversam pelo canal
// `bairrin.painel.atividade`: o que se prova é a entrega real, não a de um barramento falso.
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTA, SESSAO, criarApiFalsa, type ApiFalsa } from '../autenticacao/teste/api-falsa.ts';
import {
  CONTA_DO_ADMIN,
  RENOVAR,
  SAIR,
  montarApp,
  t,
} from '../autenticacao/fixtures/fluxo-comum.tsx';
import { criarAutenticacaoDoPainel } from './autenticacao-do-painel.ts';
import {
  NOME_DO_CANAL_DAS_ABAS,
  sinaisEntreAbasNoNavegador,
  type SinalEntreAbas,
} from './entre-abas.ts';
import { BASE_URL } from '../autenticacao/teste/api-falsa.ts';

const CHAVE = 'bairrin.painel.logoutPendente';
const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

let api: ApiFalsa;

beforeEach(() => {
  localStorage.clear();
  api = criarApiFalsa();
  api.responder(RENOVAR, { status: 200, corpo: SESSAO });
  api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
  api.responder(SAIR, { status: 204 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  localStorage.clear();
});

describe('sinaisEntreAbasNoNavegador com o BroadcastChannel real', () => {
  it('o sinal chega à outra aba, nunca à própria, mesmo quando quem manda não ouve nada', async () => {
    const aba1 = sinaisEntreAbasNoNavegador({ chaveDaMarca: CHAVE });
    const aba2 = sinaisEntreAbasNoNavegador({ chaveDaMarca: CHAVE });
    const recebidos1: SinalEntreAbas[] = [];
    const recebidos2: SinalEntreAbas[] = [];
    const parar1 = aba1.ouvir((sinal) => recebidos1.push(sinal));
    const parar2 = aba2.ouvir((sinal) => recebidos2.push(sinal));

    aba1.enviar('atividade');
    aba2.enviar('saiu');
    await waitFor(() => expect(recebidos1).toEqual(['saiu']));
    await waitFor(() => expect(recebidos2).toEqual(['atividade']));
    parar1();
    parar2();

    // Sem ouvinte na aba que manda (abre, posta e fecha): a outra aba ainda recebe.
    const quemManda = sinaisEntreAbasNoNavegador({ chaveDaMarca: CHAVE });
    const quemOuve = sinaisEntreAbasNoNavegador({ chaveDaMarca: CHAVE });
    const recebidos: SinalEntreAbas[] = [];
    const parar = quemOuve.ouvir((sinal) => recebidos.push(sinal));
    quemManda.enviar('saiu');
    await waitFor(() => expect(recebidos).toEqual(['saiu']));
    parar();
  });

  it('depois que o último ouvinte sai, nada mais é entregue', async () => {
    const aba1 = sinaisEntreAbasNoNavegador({ chaveDaMarca: CHAVE });
    const aba2 = sinaisEntreAbasNoNavegador({ chaveDaMarca: CHAVE });
    const recebidos: SinalEntreAbas[] = [];
    const parar = aba2.ouvir((sinal) => recebidos.push(sinal));
    aba1.enviar('atividade');
    await waitFor(() => expect(recebidos).toEqual(['atividade']));

    parar();
    aba1.enviar('saiu');
    await esperar(50);
    expect(recebidos).toEqual(['atividade']);
  });

  it('só as palavras da lista passam, mesmo vindas pelo canal de verdade', async () => {
    const aba = sinaisEntreAbasNoNavegador({ chaveDaMarca: CHAVE });
    const recebidos: SinalEntreAbas[] = [];
    const parar = aba.ouvir((sinal) => recebidos.push(sinal));
    const intruso = new BroadcastChannel(NOME_DO_CANAL_DAS_ABAS);
    intruso.postMessage({ sinal: 'saiu' });
    intruso.postMessage('token-de-acesso-falso.abc');
    intruso.postMessage('atividade');
    await waitFor(() => expect(recebidos).toEqual(['atividade']));
    intruso.close();
    parar();
  });
});

describe('duas abas do painel dividem a sessão pelo canal de verdade', () => {
  function outraAba(apiDela: ApiFalsa) {
    return criarAutenticacaoDoPainel({ baseUrl: BASE_URL, fetch: apiDela.fetch });
  }

  it('"Sair" na outra aba leva esta a P1 com "Sua sessão terminou", sem logout daqui', async () => {
    montarApp(api);
    await screen.findByText(t.inicio.conta(CONTA.emailMascarado));

    const apiDaOutra = criarApiFalsa();
    apiDaOutra.responder(SAIR, { status: 204 });
    const resposta = await outraAba(apiDaOutra).encerrarSessao();
    expect(resposta).toEqual({ revogadaNoServidor: true });

    await screen.findByText(t.aviso.sessaoTerminou);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
  });

  it('o `saiu` da outra aba, quando esta está em P1, não muda a tela', async () => {
    api.responder(RENOVAR, { status: 401 });
    montarApp(api);
    await screen.findByRole('heading', { level: 1, name: t.entrar.titulo });

    const apiDaOutra = criarApiFalsa();
    apiDaOutra.responder(SAIR, { status: 204 });
    await outraAba(apiDaOutra).encerrarSessao();
    await esperar(50);

    expect(screen.queryByText(t.aviso.sessaoTerminou)).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: t.entrar.titulo })).toBeTruthy();
  });
});

describe('sem BroadcastChannel (navegador antigo): a reserva pelo evento `storage`', () => {
  const marcaDeOutraAba = (valor: string | null) =>
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: CHAVE, newValue: valor }));
    });

  it('a marca de logout gravada por outra aba leva esta a P1 sem pedir logout', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    montarApp(api);
    await screen.findByText(t.inicio.conta(CONTA.emailMascarado));

    marcaDeOutraAba('{}');

    await screen.findByText(t.aviso.sessaoTerminou);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
  });

  it('apagar a marca (logout confirmado ou novo login) não derruba esta aba', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    montarApp(api);
    await screen.findByText(t.inicio.conta(CONTA.emailMascarado));

    marcaDeOutraAba(null);
    await esperar(50);

    expect(screen.queryByText(t.aviso.sessaoTerminou)).toBeNull();
    expect(screen.getByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
  });
});
