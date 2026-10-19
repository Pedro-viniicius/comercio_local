import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { textos } from '../textos/pt-BR.ts';
import { Banner } from './Banner.tsx';

afterEach(cleanup);

describe('Banner', () => {
  it('o erro é anunciado de forma assertiva (`alert`)', () => {
    render(<Banner tom="erro">Não foi possível entrar.</Banner>);
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível entrar.');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each(['informacao', 'sucesso', 'aviso'] as const)(
    'o tom %s é anunciado de forma educada (`status`)',
    (tom) => {
      render(<Banner tom={tom}>Texto</Banner>);
      expect(screen.getByRole('status').textContent).toContain('Texto');
      expect(screen.queryByRole('alert')).toBeNull();
    },
  );

  it('é informativo por padrão', () => {
    render(<Banner>Sua sessão terminou. Entre de novo para continuar.</Banner>);
    const banner = screen.getByRole('status');
    expect(banner.classList.contains('ui-banner--informacao')).toBe(true);
  });

  it.each(['informacao', 'sucesso', 'aviso', 'erro'] as const)(
    'o tom %s tem símbolo escondido do leitor de tela (não depende só de cor)',
    (tom) => {
      const { container } = render(<Banner tom={tom}>Texto</Banner>);
      const simbolo = container.querySelector('.ui-banner__simbolo');
      expect(simbolo?.textContent).not.toBe('');
      expect(simbolo?.getAttribute('aria-hidden')).toBe('true');
    },
  );

  it('mostra o título curto antes do texto', () => {
    render(
      <Banner tom="aviso" titulo="Guarde os códigos">
        Eles aparecem só agora.
      </Banner>,
    );
    const texto = screen.getByRole('status').textContent ?? '';
    expect(texto.indexOf('Guarde os códigos')).toBeLessThan(texto.indexOf('Eles aparecem'));
  });

  it('mostra a ação quando há', () => {
    const aoClicar = vi.fn();
    render(
      <Banner tom="erro" acao={<button onClick={aoClicar}>Tentar de novo</button>}>
        Não conseguimos falar com o Bairrin agora.
      </Banner>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });

  it('sem `aoFechar`, não tem botão "Fechar"', () => {
    render(<Banner>Texto</Banner>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('com `aoFechar`, mostra "Fechar" e o chama ao clicar', () => {
    const aoFechar = vi.fn();
    render(<Banner aoFechar={aoFechar}>Texto</Banner>);

    fireEvent.click(screen.getByRole('button', { name: textos.componentes.fecharAviso }));
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it('o nome acessível do "Fechar" começa pelo texto visível e leva o título quando há', () => {
    render(
      <Banner titulo="Sem conexão" aoFechar={() => undefined}>
        Texto
      </Banner>,
    );
    const botao = screen.getByRole('button', { name: 'Fechar aviso: Sem conexão' });
    expect(botao.textContent).toBe(textos.componentes.fechar);
  });

  it('o botão "Fechar" não envia um formulário em volta', () => {
    const aoEnviar = vi.fn((evento: { preventDefault: () => void }) => evento.preventDefault());
    render(
      <form onSubmit={aoEnviar}>
        <Banner aoFechar={() => undefined}>Texto</Banner>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: textos.componentes.fecharAviso }));
    expect(aoEnviar).not.toHaveBeenCalled();
  });
});
