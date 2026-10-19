// R2 e S89 no painel inteiro: duas abas dividem o mesmo cookie, então a sessão é uma só. Esta aba
// roda o App com o relógio falso; a outra aba é simulada pelas mensagens que ela mandaria pelo
// barramento falso (no lugar do `BroadcastChannel`), cada uma na hora do relógio dela.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTA, SESSAO, criarApiFalsa, type ApiFalsa } from '../autenticacao/teste/api-falsa.ts';
import {
  CONTA_DO_ADMIN,
  RENOVAR,
  SAIR,
  montarApp,
  t,
} from '../autenticacao/fixtures/fluxo-comum.tsx';
import { INTERVALO_DO_SINAL_DE_ATIVIDADE_MS } from './autenticacao-do-painel.ts';
import { criarAbasFalsas, type AbaFalsa } from './teste/abas-falsas.ts';

const MINUTO = 60_000;
const avancar = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

let api: ApiFalsa;
let estaAba: AbaFalsa;
let outraAba: AbaFalsa;
let recebidosNaOutra: string[];

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  api = criarApiFalsa();
  api.responder(RENOVAR, { status: 200, corpo: SESSAO });
  api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
  api.responder(SAIR, { status: 204 });
  const abas = criarAbasFalsas();
  estaAba = abas.abrirAba();
  outraAba = abas.abrirAba();
  recebidosNaOutra = [];
  outraAba.ouvir((sinal) => recebidosNaOutra.push(sinal));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

async function abrirPainel() {
  montarApp(api, { entreAbas: estaAba });
  await avancar(0);
  expect(screen.getByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
}

describe('a aba ociosa não encerra a sessão da aba em uso (R2)', () => {
  it('com a outra aba ativa por 1 h, esta não avisa nem pede logout; parada a outra, encerra 30 min depois', async () => {
    await abrirPainel();

    // A outra aba manda `atividade` a cada 5 min (a pessoa está nela).
    for (let vez = 0; vez < 12; vez += 1) {
      await avancar(5 * MINUTO);
      outraAba.enviar('atividade');
    }
    await avancar(0);
    expect(screen.queryByText(t.inicio.expirando)).toBeNull();
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    // Esta aba não renova pela atividade alheia: quem renova é a aba em uso.
    expect(api.pedidosDa(RENOVAR)).toHaveLength(1);

    await avancar(28 * MINUTO);
    expect(screen.getByText(t.inicio.expirando)).toBeTruthy();
    await avancar(2 * MINUTO);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
    expect(screen.getByText(t.aviso.sessaoTerminou)).toBeTruthy();
    await avancar(0);
    expect(recebidosNaOutra).toEqual(['saiu']);
  });

  it('a atividade da outra aba fecha o aviso desta, que volta a contar 30 min', async () => {
    await abrirPainel();
    await avancar(29 * MINUTO);
    expect(screen.getByText(t.inicio.expirando)).toBeTruthy();

    outraAba.enviar('atividade');
    await avancar(0);
    expect(screen.queryByText(t.inicio.expirando)).toBeNull();
    await avancar(29 * MINUTO);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    await avancar(1 * MINUTO);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
  });

  it('a interação aqui manda `atividade` à outra aba, no máximo um a cada 10 s, sem dado', async () => {
    await abrirPainel();
    fireEvent.keyDown(document.body, { key: 'a' });
    fireEvent.pointerDown(document.body);
    await avancar(INTERVALO_DO_SINAL_DE_ATIVIDADE_MS - 1);
    fireEvent.keyDown(document.body, { key: 'b' });
    await avancar(1);
    fireEvent.keyDown(document.body, { key: 'c' });
    await avancar(0);

    expect(recebidosNaOutra).toEqual(['atividade', 'atividade']);
    expect(estaAba.enviados.every((sinal) => sinal === 'atividade')).toBe(true);
  });
});

describe('"Sair" numa aba leva as outras a P1 (R2, S89)', () => {
  it('o `saiu` da outra aba leva esta a P1 na hora, sem logout daqui e sem esperar um 401', async () => {
    const { autenticacao } = montarApp(api, { entreAbas: estaAba });
    await avancar(0);
    expect(api.pedidosDa(CONTA_DO_ADMIN)[0]?.cabecalhos['Authorization']).toBe(
      `Bearer ${SESSAO.tokenAcesso}`,
    );
    outraAba.enviar('saiu');
    await avancar(0);

    expect(screen.getByText(t.aviso.sessaoTerminou)).toBeTruthy();
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(1);
    expect(api.pedidosDa(CONTA_DO_ADMIN)).toHaveLength(1);
    // Em P1 o relógio da inatividade não roda mais.
    await avancar(60 * MINUTO);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);

    // O token de acesso antigo saiu da memória: a próxima requisição vai sem ele, e nada renova.
    await act(() => autenticacao.consultarConta().catch(() => undefined));
    const ultima = api.pedidosDa(CONTA_DO_ADMIN).at(-1);
    expect(api.pedidosDa(CONTA_DO_ADMIN)).toHaveLength(2);
    expect(ultima?.cabecalhos['Authorization']).toBeUndefined();
    expect(api.pedidosDa(RENOVAR)).toHaveLength(1);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
  });

  it('"Sair" aqui manda `saiu` só depois que o logout termina, também sem confirmação (S80)', async () => {
    const liberar = api.segurar(SAIR);
    await abrirPainel();

    fireEvent.click(screen.getByRole('button', { name: t.sair }));
    await avancar(0);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
    expect(recebidosNaOutra).toEqual([]);

    liberar('rede');
    await avancar(0);
    expect(screen.getByText(t.aviso.naoSaiu)).toBeTruthy();
    expect(recebidosNaOutra).toEqual(['saiu']);
  });

  it('o `saiu` que chega em P1 não muda nada', async () => {
    api.responder(RENOVAR, { status: 401, corpo: undefined });
    montarApp(api, { entreAbas: estaAba });
    await avancar(0);
    const formulario = document.querySelector('form');

    outraAba.enviar('saiu');
    await avancar(0);
    expect(document.querySelector('form')).toBe(formulario);
    expect(screen.queryByText(t.aviso.sessaoTerminou)).toBeNull();
  });
});
