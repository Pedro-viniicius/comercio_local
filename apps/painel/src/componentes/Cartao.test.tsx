import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Cartao } from './Cartao.tsx';

afterEach(cleanup);

describe('Cartao', () => {
  it('é uma seção nomeada pelo próprio título (h1 por padrão)', () => {
    render(
      <Cartao titulo="Entrar">
        <p>Conteúdo</p>
      </Cartao>,
    );

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Entrar');
    const secao = screen.getByRole('region', { name: 'Entrar' });
    expect(secao.textContent).toContain('Conteúdo');
  });

  it('aceita título de nível 2', () => {
    render(<Cartao titulo="Entrar" nivelDoTitulo={2} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Entrar');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('dois cartões não confundem os nomes', () => {
    render(
      <>
        <Cartao titulo="Entrar" />
        <Cartao titulo="Recuperar senha" />
      </>,
    );
    expect(screen.getByRole('region', { name: 'Entrar' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Recuperar senha' })).toBeTruthy();
  });

  it('sem `centralizado`, não cria o fundo; com ele, envolve o cartão', () => {
    const { container, rerender } = render(<Cartao titulo="Entrar" />);
    expect(container.querySelector('.ui-cartao-fundo')).toBeNull();

    rerender(<Cartao titulo="Entrar" centralizado />);
    expect(container.querySelector('.ui-cartao-fundo > .ui-cartao')).not.toBeNull();
  });
});
