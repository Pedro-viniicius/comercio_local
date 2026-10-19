import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { textos } from '../textos/pt-BR.ts';
import { Campo } from './Campo.tsx';

afterEach(cleanup);

const descricaoDe = (elemento: HTMLElement): string[] =>
  (elemento.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '');

describe('Campo', () => {
  it('liga o rótulo ao campo (clicar no rótulo foca o campo)', () => {
    render(<Campo rotulo="E-mail" />);

    const campo = screen.getByLabelText('E-mail');
    expect(campo.tagName).toBe('INPUT');
    expect(screen.getByText('E-mail').tagName).toBe('LABEL');
  });

  it('dois campos têm ids diferentes e cada rótulo aponta para o seu', () => {
    render(
      <>
        <Campo rotulo="Nome" />
        <Campo rotulo="Sobrenome" />
      </>,
    );
    const nome = screen.getByLabelText('Nome');
    const sobrenome = screen.getByLabelText('Sobrenome');
    expect(nome.id).not.toBe('');
    expect(nome.id).not.toBe(sobrenome.id);
  });

  it('aceita um `id` da tela', () => {
    render(<Campo rotulo="E-mail" id="email-do-admin" />);
    expect(screen.getByLabelText('E-mail').id).toBe('email-do-admin');
  });

  it('sem erro nem ajuda, não declara inválido nem descrição', () => {
    render(<Campo rotulo="E-mail" />);
    const campo = screen.getByLabelText('E-mail');
    expect(campo.hasAttribute('aria-invalid')).toBe(false);
    expect(campo.hasAttribute('aria-describedby')).toBe(false);
  });

  it('liga o erro ao campo por `aria-describedby` e marca `aria-invalid`', () => {
    render(<Campo rotulo="E-mail" erro="Informe seu e-mail" />);

    const campo = screen.getByLabelText('E-mail');
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(descricaoDe(campo).join(' ')).toContain('Informe seu e-mail');
  });

  it('o erro aparece numa região educada que já existia (anunciada ao surgir)', () => {
    const { rerender, container } = render(<Campo rotulo="E-mail" />);
    const regiao = container.querySelector('[aria-live="polite"]');
    expect(regiao?.textContent).toBe('');

    rerender(<Campo rotulo="E-mail" erro="Informe seu e-mail" />);
    expect(container.querySelector('[aria-live="polite"]')).toBe(regiao);
    expect(regiao?.textContent).toContain('Informe seu e-mail');
  });

  it('a ajuda também descreve o campo, antes do erro', () => {
    render(<Campo rotulo="Código" ajuda="Seis dígitos do app" erro="Informe o código" />);

    const [primeira, segunda] = descricaoDe(screen.getByLabelText('Código'));
    expect(primeira).toBe('Seis dígitos do app');
    expect(segunda).toContain('Informe o código');
  });

  it('junta o `aria-describedby` da tela sem duplicar', () => {
    render(
      <>
        <p id="dica-externa">Dica de fora</p>
        <Campo rotulo="E-mail" erro="Erro" aria-describedby="dica-externa" />
      </>,
    );
    const campo = screen.getByLabelText('E-mail');
    expect(descricaoDe(campo)).toHaveLength(2);
    expect(descricaoDe(campo)).toContain('Dica de fora');
  });

  it('repassa atributos nativos (autoComplete, maxLength, inputMode, placeholder)', () => {
    render(
      <Campo
        rotulo="Código de 6 dígitos"
        autoComplete="one-time-code"
        inputMode="numeric"
        maxLength={6}
      />,
    );
    const campo = screen.getByLabelText<HTMLInputElement>('Código de 6 dígitos');
    expect(campo.autocomplete).toBe('one-time-code');
    expect(campo.inputMode).toBe('numeric');
    expect(campo.maxLength).toBe(6);
  });

  it('funciona como campo controlado', () => {
    function Controlado() {
      const [valor, setValor] = useState('');
      return <Campo rotulo="Nome" value={valor} onChange={(e) => setValor(e.target.value)} />;
    }
    render(<Controlado />);

    const campo = screen.getByLabelText<HTMLInputElement>('Nome');
    fireEvent.change(campo, { target: { value: 'Ana' } });
    expect(campo.value).toBe('Ana');
  });

  it('o tipo e-mail usa teclado de e-mail e não capitaliza nem corrige', () => {
    render(<Campo rotulo="E-mail" tipo="email" />);
    const campo = screen.getByLabelText<HTMLInputElement>('E-mail');
    expect(campo.type).toBe('email');
    expect(campo.inputMode).toBe('email');
    expect(campo.getAttribute('autocapitalize')).toBe('none');
    expect(campo.getAttribute('spellcheck')).toBe('false');
  });

  it('o tipo texto é `text` e não tem botão de mostrar senha', () => {
    render(<Campo rotulo="Nome" />);
    expect(screen.getByLabelText<HTMLInputElement>('Nome').type).toBe('text');
    expect(screen.queryByRole('button')).toBeNull();
  });

  describe('senha', () => {
    it('começa oculta, com "Mostrar senha" e sem anúncio', () => {
      render(<Campo rotulo="Senha" tipo="senha" />);

      expect(screen.getByLabelText<HTMLInputElement>('Senha').type).toBe('password');
      expect(screen.getByRole('button', { name: textos.componentes.mostrarSenha })).toBeTruthy();
      expect(screen.getByRole('status').textContent).toBe('');
    });

    it('alterna entre visível e oculta, troca o nome do botão e anuncia o estado', () => {
      render(<Campo rotulo="Senha" tipo="senha" />);
      const campo = screen.getByLabelText<HTMLInputElement>('Senha');

      fireEvent.click(screen.getByRole('button', { name: textos.componentes.mostrarSenha }));
      expect(campo.type).toBe('text');
      expect(screen.getByRole('status').textContent).toBe(textos.componentes.senhaVisivel);

      fireEvent.click(screen.getByRole('button', { name: textos.componentes.ocultarSenha }));
      expect(campo.type).toBe('password');
      expect(screen.getByRole('status').textContent).toBe(textos.componentes.senhaOculta);
      expect(screen.getByRole('button', { name: textos.componentes.mostrarSenha })).toBeTruthy();
    });

    it('mostrar a senha não envia o formulário nem apaga o que foi digitado', () => {
      const aoEnviar = vi.fn((evento: { preventDefault: () => void }) => evento.preventDefault());
      render(
        <form onSubmit={aoEnviar}>
          <Campo rotulo="Senha" tipo="senha" defaultValue="segredo-que-so-eu-sei" />
        </form>,
      );

      fireEvent.click(screen.getByRole('button', { name: textos.componentes.mostrarSenha }));
      expect(aoEnviar).not.toHaveBeenCalled();
      expect(screen.getByLabelText<HTMLInputElement>('Senha').value).toBe('segredo-que-so-eu-sei');
    });

    it('não deixa o gerenciador de texto corrigir nem capitalizar a senha', () => {
      render(<Campo rotulo="Senha" tipo="senha" autoComplete="current-password" />);
      const campo = screen.getByLabelText<HTMLInputElement>('Senha');
      expect(campo.autocomplete).toBe('current-password');
      expect(campo.getAttribute('autocapitalize')).toBe('none');
      expect(campo.getAttribute('spellcheck')).toBe('false');
    });
  });
});
