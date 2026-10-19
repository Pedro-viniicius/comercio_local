import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { IndicadorDePassos } from './IndicadorDePassos.tsx';

afterEach(cleanup);

describe('IndicadorDePassos', () => {
  it('mostra "Passo 1 de 3" e o título do passo, em texto', () => {
    render(<IndicadorDePassos passo={1} total={3} titulo="Instale um app autenticador" />);

    expect(screen.getByText('Passo 1 de 3')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Instale um app autenticador',
    );
  });

  it('acompanha o passo atual', () => {
    const { rerender } = render(<IndicadorDePassos passo={2} total={3} titulo="Escaneie" />);
    expect(screen.getByText('Passo 2 de 3')).toBeTruthy();

    rerender(<IndicadorDePassos passo={3} total={3} titulo="Guarde seus códigos" />);
    expect(screen.getByText('Passo 3 de 3')).toBeTruthy();
    expect(screen.queryByText('Passo 2 de 3')).toBeNull();
  });

  it.each([
    { passo: 0, total: 3, texto: 'Passo 1 de 3' },
    { passo: 7, total: 3, texto: 'Passo 3 de 3' },
    { passo: -2, total: 3, texto: 'Passo 1 de 3' },
    { passo: Number.NaN, total: 3, texto: 'Passo 1 de 3' },
    { passo: 2, total: 0, texto: 'Passo 1 de 1' },
    { passo: 2.9, total: 4, texto: 'Passo 2 de 4' },
  ])('nunca mostra passo fora do intervalo: $passo de $total', ({ passo, total, texto }) => {
    render(<IndicadorDePassos passo={passo} total={total} titulo="Título" />);
    expect(screen.getByText(texto)).toBeTruthy();
  });

  it('o título pode receber o foco por código ao trocar de passo', () => {
    const referencia = createRef<HTMLHeadingElement>();
    render(<IndicadorDePassos passo={2} total={3} titulo="Escaneie" refDoTitulo={referencia} />);

    referencia.current?.focus();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2 }));
    // Fora da ordem de Tab: só código leva o foco até ele.
    expect(screen.getByRole('heading', { level: 2 }).getAttribute('tabindex')).toBe('-1');
  });
});
