import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { textos } from '../textos/pt-BR.ts';
import { Botao } from './Botao.tsx';

afterEach(cleanup);

describe('Botao', () => {
  it('é `type="button"` por padrão: dentro de formulário não envia sozinho', () => {
    const aoEnviar = vi.fn((evento: { preventDefault: () => void }) => evento.preventDefault());
    render(
      <form onSubmit={aoEnviar}>
        <Botao>Cancelar</Botao>
      </form>,
    );

    const botao = screen.getByRole('button', { name: 'Cancelar' });
    expect(botao.getAttribute('type')).toBe('button');
    fireEvent.click(botao);
    expect(aoEnviar).not.toHaveBeenCalled();
  });

  it('envia o formulário com `type="submit"`', () => {
    const aoEnviar = vi.fn((evento: { preventDefault: () => void }) => evento.preventDefault());
    render(
      <form onSubmit={aoEnviar}>
        <Botao type="submit">Entrar</Botao>
      </form>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(aoEnviar).toHaveBeenCalledTimes(1);
  });

  it.each(['primario', 'secundario', 'terciario', 'destrutivo'] as const)(
    'aplica a variante %s',
    (variante) => {
      render(<Botao variante={variante}>Ação</Botao>);
      expect(screen.getByRole('button').classList.contains(`ui-botao--${variante}`)).toBe(true);
    },
  );

  it('é primário por padrão e aceita largura total e classe extra', () => {
    render(
      <Botao larguraTotal className="minha-classe">
        Ação
      </Botao>,
    );
    const botao = screen.getByRole('button');
    expect(botao.classList.contains('ui-botao--primario')).toBe(true);
    expect(botao.classList.contains('ui-botao--total')).toBe(true);
    expect(botao.classList.contains('minha-classe')).toBe(true);
  });

  it('chama `onClick` e repassa atributos nativos', () => {
    const aoClicar = vi.fn();
    render(
      <Botao onClick={aoClicar} aria-label="Salvar alterações">
        Salvar
      </Botao>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });

  it('desabilitado não chama `onClick` e fica exposto como desabilitado', () => {
    const aoClicar = vi.fn();
    render(
      <Botao disabled onClick={aoClicar}>
        Salvar
      </Botao>,
    );

    const botao = screen.getByRole<HTMLButtonElement>('button');
    expect(botao.disabled).toBe(true);
    fireEvent.click(botao);
    expect(aoClicar).not.toHaveBeenCalled();
  });

  describe('carregando', () => {
    it('diz "Enviando…" ao leitor de tela no lugar do rótulo e marca `aria-busy`', () => {
      render(<Botao carregando>Entrar</Botao>);

      const botao = screen.getByRole('button', { name: textos.componentes.enviando });
      expect(botao.getAttribute('aria-busy')).toBe('true');
      expect(botao.getAttribute('aria-disabled')).toBe('true');
      // O rótulo continua no DOM (mantém a largura), mas fora do leitor de tela.
      const rotulo = botao.querySelector('.ui-botao__rotulo');
      expect(rotulo?.textContent).toBe('Entrar');
      expect(rotulo?.getAttribute('aria-hidden')).toBe('true');
    });

    it('aceita outro texto para o leitor de tela', () => {
      render(
        <Botao carregando textoCarregando="Confirmando…">
          Confirmar
        </Botao>,
      );
      expect(screen.getByRole('button', { name: 'Confirmando…' })).toBeTruthy();
    });

    it('continua no DOM, focável e sem `disabled`, mas ignora o clique', () => {
      const aoClicar = vi.fn();
      render(
        <Botao carregando onClick={aoClicar}>
          Entrar
        </Botao>,
      );

      const botao = screen.getByRole<HTMLButtonElement>('button');
      botao.focus();
      expect(document.activeElement).toBe(botao);
      expect(botao.disabled).toBe(false);
      fireEvent.click(botao);
      expect(aoClicar).not.toHaveBeenCalled();
    });

    it('não envia o formulário (clique nem Enter)', () => {
      const aoEnviar = vi.fn((evento: { preventDefault: () => void }) => evento.preventDefault());
      render(
        <form onSubmit={aoEnviar}>
          <Botao type="submit" carregando>
            Entrar
          </Botao>
        </form>,
      );

      fireEvent.click(screen.getByRole('button'));
      expect(aoEnviar).not.toHaveBeenCalled();
    });

    it('sem carregando, não tem `aria-busy` nem `aria-disabled`', () => {
      render(<Botao>Entrar</Botao>);
      const botao = screen.getByRole('button');
      expect(botao.hasAttribute('aria-busy')).toBe(false);
      expect(botao.hasAttribute('aria-disabled')).toBe(false);
    });
  });
});
