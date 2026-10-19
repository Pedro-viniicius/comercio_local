import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Campo } from './Campo.tsx';

afterEach(cleanup);

describe('Campo: aria-describedby da tela com ids repetidos', () => {
  it('a tela que já aponta para o erro e para a ajuda do campo não duplica os ids', () => {
    render(
      <Campo
        id="email"
        rotulo="E-mail"
        ajuda="Usamos para entrar"
        erro="Informe seu e-mail"
        aria-describedby="email-erro email-ajuda  email-erro"
      />,
    );

    const ids = (screen.getByLabelText('E-mail').getAttribute('aria-describedby') ?? '').split(' ');

    expect(ids).toHaveLength(2);
    expect(new Set(ids)).toEqual(new Set(['email-ajuda', 'email-erro']));
  });

  it('o erro some quando a tela o tira: sem texto de erro, nada fica descrito nem inválido', () => {
    const { rerender } = render(<Campo id="senha" rotulo="Senha" erro="Informe sua senha" />);
    expect(screen.getByLabelText('Senha').getAttribute('aria-invalid')).toBe('true');

    rerender(<Campo id="senha" rotulo="Senha" />);

    const campo = screen.getByLabelText('Senha');
    expect(campo.getAttribute('aria-invalid')).toBeNull();
    expect(campo.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByText('Informe sua senha')).toBeNull();
  });
});
