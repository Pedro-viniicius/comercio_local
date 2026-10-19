// QA do grupo C (etapa 15, S9): bordas da inatividade de 30 min com relógio falso. O hook conta
// por datas (não por disparos), só interação da pessoa estende, e o fluxo completo termina a
// sessão pelo cookie quando o tempo acaba.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AVISO_ANTES_DO_FIM_MS,
  LIMITE_DE_INATIVIDADE_MS,
  useInatividade,
  type OpcoesDaInatividade,
} from './inatividade.ts';
import {
  CONTA_DO_ADMIN,
  RENOVAR,
  SAIR,
  montarApp,
  t,
} from '../autenticacao/fixtures/fluxo-comum.tsx';
import { CONTA, SESSAO, criarApiFalsa, problema } from '../autenticacao/teste/api-falsa.ts';

const MINUTO = 60_000;
const avancar = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

function Harness(opcoes: OpcoesDaInatividade) {
  const { retomar } = useInatividade(opcoes);
  return (
    <>
      <button type="button">alvo</button>
      {/* Como "Continuar conectado" depois de renovar (D2): só ele retoma com o aviso aberto. */}
      <button type="button" onClick={retomar}>
        retomar
      </button>
    </>
  );
}

function montarHook(extras: Partial<OpcoesDaInatividade> = {}) {
  const chamadas = { aoAvisar: vi.fn(), aoRetomar: vi.fn(), aoExpirar: vi.fn() };
  const props: OpcoesDaInatividade = { ativo: true, ...chamadas, ...extras };
  const resultado = render(<Harness {...props} />);
  return { ...chamadas, ...resultado, props };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useInatividade: relógio', () => {
  it('computador que dormiu: o timer atrasado encerra de uma vez, sem aviso fora de hora e uma vez só', async () => {
    const { aoAvisar, aoExpirar } = montarHook();

    // A hora do sistema pula 45 min sem os timers rodarem (aba suspensa); depois o timer dispara.
    vi.setSystemTime(Date.now() + 45 * MINUTO);
    await avancar(LIMITE_DE_INATIVIDADE_MS - AVISO_ANTES_DO_FIM_MS);

    expect(aoExpirar).toHaveBeenCalledTimes(1);
    expect(aoAvisar).not.toHaveBeenCalled();
    await avancar(60 * MINUTO);
    expect(aoExpirar).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('timer atrasado depois de uma interação recente reagenda pela data, não encerra', async () => {
    const { aoExpirar, aoAvisar } = montarHook();
    await avancar(27 * MINUTO);
    fireEvent.keyDown(document.body, { key: 'a' });
    // O timer dos 28 min dispara com só 1 min desde a interação: nada acontece.
    await avancar(1 * MINUTO);

    expect(aoAvisar).not.toHaveBeenCalled();
    expect(aoExpirar).not.toHaveBeenCalled();
    await avancar(27 * MINUTO);
    expect(aoAvisar).toHaveBeenCalledTimes(1);
    await avancar(2 * MINUTO);
    expect(aoExpirar).toHaveBeenCalledTimes(1);
  });

  it('o aviso e a retomada se repetem a cada ciclo; só o fim avisa uma vez', async () => {
    const { aoAvisar, aoRetomar, aoExpirar, getByRole } = montarHook();
    for (let ciclo = 1; ciclo <= 3; ciclo += 1) {
      await avancar(28 * MINUTO);
      expect(aoAvisar).toHaveBeenCalledTimes(ciclo);
      // D2: com o aviso aberto, só a retomada explícita fecha o aviso.
      fireEvent.click(getByRole('button', { name: 'retomar' }));
      expect(aoRetomar).toHaveBeenCalledTimes(ciclo);
    }
    expect(aoExpirar).not.toHaveBeenCalled();
    await avancar(30 * MINUTO);
    expect(aoExpirar).toHaveBeenCalledTimes(1);
  });

  it('depois de expirar, interação não ressuscita o relógio nem chama a retomada', async () => {
    const { aoRetomar, aoExpirar, aoAvisar } = montarHook();
    await avancar(30 * MINUTO);
    expect(aoExpirar).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.body, { key: 'a' });
    fireEvent.pointerDown(document.body);
    await avancar(60 * MINUTO);

    expect(aoRetomar).not.toHaveBeenCalled();
    expect(aoExpirar).toHaveBeenCalledTimes(1);
    expect(aoAvisar).toHaveBeenCalledTimes(1);
  });

  it('o limite é exato: 29:59.999 ainda vale, 30:00 encerra', async () => {
    const { aoExpirar } = montarHook();
    await avancar(LIMITE_DE_INATIVIDADE_MS - 1);
    expect(aoExpirar).not.toHaveBeenCalled();
    await avancar(1);
    expect(aoExpirar).toHaveBeenCalledTimes(1);
  });
});

describe('useInatividade: o que conta como interação', () => {
  it.each([
    ['pointerdown', () => fireEvent.pointerDown(document.body)],
    ['keydown', () => fireEvent.keyDown(document.body, { key: 'Tab' })],
    ['wheel', () => fireEvent.wheel(document.body)],
    ['touchstart', () => fireEvent.touchStart(document.body)],
  ])('%s recomeça a contagem', async (_nome, interagir) => {
    const { aoExpirar } = montarHook();
    // Antes do aviso dos 28 min: com ele aberto, interação não conta (D2).
    await avancar(27 * MINUTO);
    interagir();
    await avancar(29 * MINUTO);
    expect(aoExpirar).not.toHaveBeenCalled();
    await avancar(1 * MINUTO);
    expect(aoExpirar).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['mousemove', () => fireEvent.mouseMove(document.body)],
    ['focus', () => fireEvent.focus(document.body)],
    ['visibilitychange', () => document.dispatchEvent(new Event('visibilitychange'))],
    ['scroll', () => fireEvent.scroll(window)],
    ['resize', () => fireEvent.resize(window)],
  ])(
    '%s não conta como interação da pessoa (como a spec manda: tecla, clique, toque, rolagem)',
    async (_n, evento) => {
      const { aoExpirar } = montarHook();
      await avancar(29 * MINUTO);
      evento();
      await avancar(1 * MINUTO);
      expect(aoExpirar).toHaveBeenCalledTimes(1);
    },
  );

  it('um elemento que para a propagação ainda conta (a escuta é na captura)', async () => {
    const { aoExpirar, getByRole } = montarHook();
    const alvo = getByRole('button', { name: 'alvo' });
    alvo.addEventListener('keydown', (evento) => evento.stopPropagation());
    await avancar(27 * MINUTO);

    fireEvent.keyDown(alvo, { key: 'Enter' });
    await avancar(29 * MINUTO);
    expect(aoExpirar).not.toHaveBeenCalled();
  });
});

describe('useInatividade: ligar, desligar e trocar os avisos', () => {
  it('desligado, não agenda nem escuta nada; ligar começa a contar da hora em que ligou', async () => {
    const adicionar = vi.spyOn(document, 'addEventListener');
    const { rerender, props, aoExpirar } = montarHook({ ativo: false });
    expect(vi.getTimerCount()).toBe(0);
    expect(adicionar).not.toHaveBeenCalledWith('keydown', expect.anything(), expect.anything());

    await avancar(50 * MINUTO);
    rerender(<Harness {...props} ativo />);
    await avancar(29 * MINUTO);
    expect(aoExpirar).not.toHaveBeenCalled();
    await avancar(1 * MINUTO);
    expect(aoExpirar).toHaveBeenCalledTimes(1);
  });

  it('desligar no meio limpa o timer e as escutas', async () => {
    const remover = vi.spyOn(document, 'removeEventListener');
    const { rerender, props, aoExpirar } = montarHook();
    await avancar(10 * MINUTO);
    rerender(<Harness {...props} ativo={false} />);

    expect(vi.getTimerCount()).toBe(0);
    expect(remover.mock.calls.map(([evento]) => evento).sort()).toEqual(
      ['keydown', 'pointerdown', 'touchstart', 'wheel'].sort(),
    );
    await avancar(60 * MINUTO);
    expect(aoExpirar).not.toHaveBeenCalled();
  });

  it('chama sempre a versão mais nova dos avisos, sem reiniciar o relógio', async () => {
    const { rerender, props, aoExpirar } = montarHook();
    await avancar(20 * MINUTO);
    const novo = vi.fn();
    rerender(<Harness {...props} aoExpirar={novo} />);

    await avancar(10 * MINUTO);
    expect(aoExpirar).not.toHaveBeenCalled();
    expect(novo).toHaveBeenCalledTimes(1);
  });

  it('um timer só enquanto ativo (sem polling escondido)', async () => {
    montarHook();
    expect(vi.getTimerCount()).toBe(1);
    await avancar(28 * MINUTO);
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('inatividade no painel inteiro', () => {
  const api = () => {
    const falsa = criarApiFalsa();
    falsa.responder(RENOVAR, { status: 200, corpo: SESSAO });
    falsa.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
    return falsa;
  };

  it('30 min parado: pede o logout pelo cookie, mostra "Sua sessão terminou" e não "Você saiu"', async () => {
    const falsa = api();
    falsa.responder(SAIR, { status: 204 });
    montarApp(falsa);
    await avancar(0);
    expect(screen.getByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();

    await avancar(28 * MINUTO);
    expect(screen.getByText(t.inicio.expirando)).toBeTruthy();
    await avancar(2 * MINUTO);

    expect(screen.getByText(t.aviso.sessaoTerminou)).toBeTruthy();
    expect(screen.queryByText(t.aviso.saiu)).toBeNull();
    expect(falsa.pedidosDa(SAIR)).toHaveLength(1);
    expect(falsa.pedidosDa(CONTA_DO_ADMIN)).toHaveLength(1);
  });

  // R1: a interação renova quando a última renovação tem mais de 10 min (uma por janela). Nos 25 min,
  // só a interação dos 15 min passa disso; sem interação, nada renova (sem polling).
  it('sem polling: 25 min com interações de tempos em tempos renovam só pela regra do R1 e não consultam de novo', async () => {
    const falsa = api();
    montarApp(falsa);
    await avancar(0);

    for (let i = 0; i < 5; i += 1) {
      await avancar(5 * MINUTO);
      fireEvent.keyDown(document.body, { key: 'a' });
    }

    expect(falsa.pedidosDa(RENOVAR)).toHaveLength(2);
    expect(falsa.pedidosDa(CONTA_DO_ADMIN)).toHaveLength(1);
    expect(falsa.pedidos.filter((p) => p.caminho === '/v1/saude').length).toBeLessThanOrEqual(1);

    await avancar(4 * MINUTO);
    expect(falsa.pedidosDa(RENOVAR)).toHaveLength(2);
  });

  // Q22: o `pointerdown` é interação, então o aviso some (aoRetomar) antes do `click`. No navegador a
  // atualização do React sai em microtarefa, o botão é desmontado entre o apertar e o soltar, e o
  // clique não chega a ele: a renovação no servidor nunca é pedida e a pessoa acha que renovou.
  it('Q22: clicar em "Continuar conectado" (pointerdown e depois click) renova pelo cookie e recomeça o relógio', async () => {
    const falsa = api();
    falsa.responder(RENOVAR, { status: 200, corpo: SESSAO });
    montarApp(falsa);
    await avancar(0);
    await avancar(28 * MINUTO);

    const continuar = screen.getByRole('button', { name: t.inicio.continuar });
    fireEvent.pointerDown(continuar);
    // Como o navegador: o que estiver desmontado depois do pointerdown não recebe o clique.
    if (continuar.isConnected) fireEvent.click(continuar);
    await avancar(0);
    await avancar(0);

    expect(falsa.pedidosDa(RENOVAR)).toHaveLength(2);
    expect(screen.queryByText(t.inicio.expirando)).toBeNull();
    await avancar(29 * MINUTO);
    expect(screen.queryByText(t.aviso.sessaoTerminou)).toBeNull();
  });

  it('"Continuar conectado" só com o clique (sem pointerdown, como por tecla ou leitor de tela): renova pelo cookie', async () => {
    const falsa = api();
    falsa.responder(RENOVAR, { status: 200, corpo: SESSAO });
    montarApp(falsa);
    await avancar(0);
    await avancar(28 * MINUTO);

    fireEvent.click(screen.getByRole('button', { name: t.inicio.continuar }));
    await avancar(0);
    await avancar(0);

    expect(falsa.pedidosDa(RENOVAR)).toHaveLength(2);
    expect(screen.queryByText(t.inicio.expirando)).toBeNull();
  });

  // D2: a renovação que falhou não fecha o aviso; o Banner de erro conta o que houve.
  it('"Continuar conectado" sem rede: o aviso fica com o erro, nada quebra e o painel segue aberto', async () => {
    const falsa = api();
    falsa.responder(RENOVAR, { status: 200, corpo: SESSAO }, 'rede');
    montarApp(falsa);
    await avancar(0);
    await avancar(28 * MINUTO);

    fireEvent.click(screen.getByRole('button', { name: t.inicio.continuar }));
    await avancar(0);

    expect(screen.getByText(t.inicio.expirando)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(t.inicio.naoContinuou);
    expect(screen.getByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
    expect(screen.queryByText(t.aviso.sessaoTerminou)).toBeNull();
  });

  it('"Continuar conectado" com a renovação recusada: P1 com "Sua sessão terminou", um logout só', async () => {
    const falsa = api();
    falsa.responder(RENOVAR, { status: 200, corpo: SESSAO }, problema(401, 'nao_autenticado'));
    falsa.responder(SAIR, { status: 204 });
    montarApp(falsa);
    await avancar(0);
    await avancar(28 * MINUTO);

    fireEvent.click(screen.getByRole('button', { name: t.inicio.continuar }));
    await avancar(0);

    expect(screen.getByText(t.aviso.sessaoTerminou)).toBeTruthy();
    // O cookie já foi recusado: não há o que revogar, e a tela não passa por "Saindo…".
    expect(falsa.pedidosDa(SAIR)).toHaveLength(0);
    expect(document.querySelectorAll('form')).toHaveLength(1);
  });
});
