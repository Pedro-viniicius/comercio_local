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

  it('o cabeçalho (D4) fica dentro da seção, antes do título, com o logo e o "Sair"', () => {
    const { container } = render(
      <Cartao
        titulo="Configurar"
        cabecalho={
          <>
            <img src="logo.svg" alt="Bairrin" />
            <button type="button">Sair</button>
          </>
        }
      >
        <p>Conteúdo</p>
      </Cartao>,
    );

    const secao = screen.getByRole('region', { name: 'Configurar' });
    const cabecalho = secao.querySelector('.ui-cartao__cabecalho');
    expect(cabecalho).not.toBeNull();
    expect(cabecalho?.querySelector('img')?.getAttribute('alt')).toBe('Bairrin');
    expect(screen.getByRole('button', { name: 'Sair' }).closest('.ui-cartao__cabecalho')).toBe(
      cabecalho,
    );
    // Ordem no DOM (e de foco): cabeçalho, título, conteúdo.
    const filhos = [...(secao.children as HTMLCollectionOf<HTMLElement>)];
    expect(filhos[0]).toBe(cabecalho);
    expect(filhos[1]?.tagName).toBe('H1');
    expect(container.querySelectorAll('.ui-cartao__cabecalho')).toHaveLength(1);
  });

  it('sem cabeçalho, não cria a faixa vazia', () => {
    const { container, rerender } = render(<Cartao titulo="Entrar" />);
    expect(container.querySelector('.ui-cartao__cabecalho')).toBeNull();
    rerender(<Cartao titulo="Entrar" cabecalho={null} />);
    expect(container.querySelector('.ui-cartao__cabecalho')).toBeNull();
  });

  it('sem `centralizado`, não cria o fundo; com ele, envolve o cartão', () => {
    const { container, rerender } = render(<Cartao titulo="Entrar" />);
    expect(container.querySelector('.ui-cartao-fundo')).toBeNull();

    rerender(<Cartao titulo="Entrar" centralizado />);
    expect(container.querySelector('.ui-cartao-fundo > .ui-cartao')).not.toBeNull();
  });
});
