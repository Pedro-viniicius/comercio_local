// QA do grupo C, rodada 2 (D2, R1): o aviso de 2 min e a renovação pela interação, no painel inteiro
// com relógio falso. Com o aviso aberto só "Continuar conectado" retoma; fora dele, a interação
// renova no servidor quando a última sessão passou de 10 min, uma vez por janela.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONTA,
  SESSAO,
  criarApiFalsa,
  problema,
  type ApiFalsa,
} from '../autenticacao/teste/api-falsa.ts';
import {
  CONTA_DO_ADMIN,
  RENOVAR,
  SAIR,
  montarApp,
  t,
} from '../autenticacao/fixtures/fluxo-comum.tsx';
import { RENOVAR_NA_INTERACAO_APOS_MS } from './autenticacao-do-painel.ts';
import type { SinaisEntreAbas } from './entre-abas.ts';

const MINUTO = 60_000;
const avancar = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const sinaisMudos: SinaisEntreAbas = { enviar: () => undefined, ouvir: () => () => undefined };
const continuar = () => screen.getByRole<HTMLButtonElement>('button', { name: t.inicio.continuar });

let api: ApiFalsa;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  api = criarApiFalsa();
  api.responder(RENOVAR, { status: 200, corpo: SESSAO });
  api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
  api.responder(SAIR, { status: 204 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

async function abrirPainel() {
  montarApp(api, { entreAbas: sinaisMudos });
  await avancar(0);
  expect(screen.getByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
}

describe('D2: com o aviso aberto, a interação na página é ignorada', () => {
  it.each([
    ['tecla', () => fireEvent.keyDown(document.body, { key: 'Tab' })],
    ['clique', () => fireEvent.pointerDown(document.body)],
    ['rolagem', () => fireEvent.wheel(document.body)],
    ['toque', () => fireEvent.touchStart(document.body)],
  ])('%s não fecha o aviso, não renova e não adia o fim dos 30 min', async (_nome, interagir) => {
    await abrirPainel();
    await avancar(28 * MINUTO);
    expect(screen.getByText(t.inicio.expirando)).toBeTruthy();

    await avancar(1 * MINUTO);
    interagir();
    await avancar(0);
    expect(screen.getByText(t.inicio.expirando)).toBeTruthy();
    expect(api.pedidosDa(RENOVAR)).toHaveLength(1);

    await avancar(1 * MINUTO);
    expect(screen.getByText(t.aviso.sessaoTerminou)).toBeTruthy();
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
  });

  it('a falha de "Continuar conectado" mostra o erro (`alert`), mantém o aviso e deixa tentar de novo', async () => {
    await abrirPainel();
    api.responder(RENOVAR, 'rede', { status: 200, corpo: SESSAO });
    await avancar(28 * MINUTO);

    fireEvent.click(continuar());
    await avancar(0);
    expect(screen.getByRole('alert').textContent).toContain(t.inicio.naoContinuou);
    expect(screen.getByText(t.inicio.expirando)).toBeTruthy();
    expect(continuar().textContent).toContain(t.inicio.continuar);

    fireEvent.click(continuar());
    await avancar(0);
    expect(screen.queryByText(t.inicio.expirando)).toBeNull();
    expect(screen.queryByText(t.inicio.naoContinuou)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.pedidosDa(RENOVAR)).toHaveLength(3);
    await avancar(29 * MINUTO);
    expect(screen.queryByText(t.aviso.sessaoTerminou)).toBeNull();
  });

  it('erro 503 na renovação também mostra o erro e mantém o aviso, sem encerrar a sessão', async () => {
    await abrirPainel();
    api.responder(RENOVAR, problema(503, 'indisponivel'));
    await avancar(28 * MINUTO);

    fireEvent.click(continuar());
    await avancar(0);

    expect(screen.getByRole('alert').textContent).toContain(t.inicio.naoContinuou);
    expect(screen.getByText(t.inicio.expirando)).toBeTruthy();
    expect(screen.queryByText(t.aviso.sessaoTerminou)).toBeNull();
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
  });

  it('depois do erro, sem novo clique, os 30 min seguem e a sessão termina na hora', async () => {
    await abrirPainel();
    api.responder(RENOVAR, 'rede');
    await avancar(28 * MINUTO);
    fireEvent.click(continuar());
    await avancar(0);
    expect(screen.getByRole('alert')).toBeTruthy();

    await avancar(2 * MINUTO);
    expect(screen.getByText(t.aviso.sessaoTerminou)).toBeTruthy();
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
  });

  it('duplo clique em "Continuar conectado" pede uma renovação só e mostra "Enviando…" enquanto espera', async () => {
    await abrirPainel();
    await avancar(28 * MINUTO);
    const liberar = api.segurar(RENOVAR);

    fireEvent.click(continuar());
    await avancar(0);
    const enviando = screen.getByRole('button', { name: 'Enviando…' });
    fireEvent.click(enviando);
    fireEvent.click(enviando);
    await avancar(0);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);

    liberar({ status: 200, corpo: SESSAO });
    await avancar(0);
    expect(screen.queryByText(t.inicio.expirando)).toBeNull();
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);
  });
});

describe('R1: a interação renova no servidor, uma vez por janela de 10 min', () => {
  it('N é 10 min; exatos 10 min não renovam, 1 ms depois renova', async () => {
    expect(RENOVAR_NA_INTERACAO_APOS_MS).toBe(10 * MINUTO);
    await abrirPainel();

    await avancar(10 * MINUTO);
    fireEvent.keyDown(document.body, { key: 'a' });
    await avancar(0);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(1);

    await avancar(1);
    fireEvent.keyDown(document.body, { key: 'b' });
    await avancar(0);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);
  });

  it('muitas interações enquanto a renovação ainda está no ar viram um pedido só', async () => {
    await abrirPainel();
    await avancar(11 * MINUTO);
    const liberar = api.segurar(RENOVAR);

    for (const evento of [
      () => fireEvent.keyDown(document.body, { key: 'a' }),
      () => fireEvent.pointerDown(document.body),
      () => fireEvent.wheel(document.body),
      () => fireEvent.touchStart(document.body),
    ]) {
      evento();
      await avancar(1_000);
    }
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);

    liberar({ status: 200, corpo: SESSAO });
    await avancar(0);
    fireEvent.keyDown(document.body, { key: 'c' });
    await avancar(0);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);
  });

  it('renovação recusada pela interação leva a P1 com "Sua sessão terminou"', async () => {
    await abrirPainel();
    api.responder(RENOVAR, problema(401, 'nao_autenticado'));
    await avancar(11 * MINUTO);

    fireEvent.keyDown(document.body, { key: 'a' });
    await avancar(0);
    await avancar(0);

    expect(screen.getByText(t.aviso.sessaoTerminou)).toBeTruthy();
    expect(document.querySelectorAll('form')).toHaveLength(1);
  });

  it('renovação que falha por rede não derruba nem mostra nada; a próxima tentativa é depois de 10 min', async () => {
    await abrirPainel();
    api.responder(RENOVAR, 'rede');
    await avancar(11 * MINUTO);

    fireEvent.keyDown(document.body, { key: 'a' });
    await avancar(0);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();

    await avancar(5 * MINUTO);
    fireEvent.keyDown(document.body, { key: 'b' });
    await avancar(0);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);
  });

  it('a interação sem sessão (P1) não renova nada', async () => {
    api.responder(RENOVAR, problema(401, 'nao_autenticado'));
    montarApp(api, { entreAbas: sinaisMudos });
    await avancar(0);
    await avancar(20 * MINUTO);
    fireEvent.keyDown(document.body, { key: 'a' });
    fireEvent.pointerDown(document.body);
    await avancar(0);

    expect(api.pedidosDa(RENOVAR)).toHaveLength(1);
  });
});
