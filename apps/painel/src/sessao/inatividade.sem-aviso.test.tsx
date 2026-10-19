// R8: `comAviso: false` (passo 3 da P1b, que não mostra aviso). O relógio vai direto aos 30 min,
// `aoAvisar` nunca é chamado e toda interação conta até o fim; o padrão continua com aviso (D2).
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIMITE_DE_INATIVIDADE_MS,
  useInatividade,
  type OpcoesDaInatividade,
} from './inatividade.ts';

const MINUTO = 60_000;
const avancar = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

function Harness(opcoes: OpcoesDaInatividade) {
  useInatividade(opcoes);
  return null;
}

function montar(comAviso?: boolean) {
  const chamadas = {
    aoAvisar: vi.fn(),
    aoRetomar: vi.fn(),
    aoExpirar: vi.fn(),
    aoInteragir: vi.fn(),
  };
  render(<Harness ativo {...(comAviso === undefined ? {} : { comAviso })} {...chamadas} />);
  return chamadas;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useInatividade sem aviso', () => {
  it('não avisa e encerra exatamente aos 30 min, com um timer só', async () => {
    const { aoAvisar, aoExpirar } = montar(false);
    expect(vi.getTimerCount()).toBe(1);
    await avancar(LIMITE_DE_INATIVIDADE_MS - 1);
    expect(aoAvisar).not.toHaveBeenCalled();
    expect(aoExpirar).not.toHaveBeenCalled();
    await avancar(1);
    expect(aoExpirar).toHaveBeenCalledTimes(1);
    expect(aoAvisar).not.toHaveBeenCalled();
  });

  it.each([
    ['29 min', 29 * MINUTO],
    ['29:59.999', LIMITE_DE_INATIVIDADE_MS - 1],
  ])('interação aos %s conta e recomeça os 30 min', async (_n, quando) => {
    const { aoExpirar, aoInteragir } = montar(false);
    await avancar(quando);
    fireEvent.pointerDown(document.body);
    expect(aoInteragir).toHaveBeenCalledTimes(1);
    await avancar(LIMITE_DE_INATIVIDADE_MS - 1);
    expect(aoExpirar).not.toHaveBeenCalled();
    await avancar(1);
    expect(aoExpirar).toHaveBeenCalledTimes(1);
  });

  it('o padrão continua com aviso: depois dele, a interação não conta (D2)', async () => {
    const { aoAvisar, aoExpirar, aoInteragir } = montar();
    await avancar(29 * MINUTO);
    expect(aoAvisar).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(aoInteragir).not.toHaveBeenCalled();
    await avancar(1 * MINUTO);
    expect(aoExpirar).toHaveBeenCalledTimes(1);
  });
});
