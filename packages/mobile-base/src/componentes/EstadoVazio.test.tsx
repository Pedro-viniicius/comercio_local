import { temaClaro } from '@bairrin/tokens';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { EstadoVazio } from './EstadoVazio.tsx';

describe('EstadoVazio', () => {
  it('mostra título (cabeçalho) e o porquê, centralizados', async () => {
    await render(
      <EstadoVazio
        titulo="Entre para ver seus pedidos e dados"
        texto="Você precisa de uma conta."
      />,
    );

    expect(screen.getByRole('heading')).toHaveTextContent('Entre para ver seus pedidos e dados');
    expect(screen.getByRole('heading')).toHaveStyle({
      textAlign: 'center',
      color: temaClaro.text.primary,
    });
    expect(screen.getByText('Você precisa de uma conta.')).toHaveStyle({
      color: temaClaro.text.secondary,
    });
  });

  it('só com o título, não sobra espaço de texto, ícone nem botão', async () => {
    await render(<EstadoVazio titulo="Nenhum pedido novo" />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByText(/./)).toHaveLength(1);
  });

  it('o ícone é decorativo (escondido do leitor de tela) e tem 48 px', async () => {
    await render(<EstadoVazio titulo="Sua conta está pronta" icone={<Text>🏪</Text>} />);

    expect(screen.queryByText('🏪')).toBeNull();
    const icone = screen.getByText('🏪', { includeHiddenElements: true }).parent;
    expect(icone).toHaveStyle({ width: 48, height: 48 });
  });

  it('a ação principal é um botão primário; a secundária, terciário por padrão', async () => {
    const aoEntrar = jest.fn();
    const aoCriar = jest.fn();
    await render(
      <EstadoVazio
        titulo="Entre para ver seus pedidos"
        acao={{ rotulo: 'Entrar', aoPressionar: aoEntrar }}
        acaoSecundaria={{ rotulo: 'Criar conta', aoPressionar: aoCriar }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Entrar' })).toHaveStyle({
      backgroundColor: temaClaro.action.primary,
    });
    expect(screen.getByRole('button', { name: 'Criar conta' })).toHaveStyle({
      backgroundColor: 'transparent',
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Entrar' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Criar conta' }));
    expect(aoEntrar).toHaveBeenCalledTimes(1);
    expect(aoCriar).toHaveBeenCalledTimes(1);
  });

  it('a variante da ação pode ser trocada, e a ação pode estar desabilitada ou carregando', async () => {
    await render(
      <EstadoVazio
        titulo="Não conseguimos carregar"
        acao={{
          rotulo: 'Tentar de novo',
          aoPressionar: jest.fn(),
          variante: 'secundario',
          carregando: true,
        }}
        acaoSecundaria={{ rotulo: 'Sair', aoPressionar: jest.fn(), desabilitada: true }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Enviando…' })).toBeBusy();
    expect(screen.getByRole('button', { name: 'Sair' })).toBeDisabled();
  });

  it('só a ação secundária também aparece', async () => {
    await render(
      <EstadoVazio
        titulo="Vazio"
        acaoSecundaria={{ rotulo: 'Criar conta', aoPressionar: jest.fn() }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Criar conta' })).toBeOnTheScreen();
  });

  it('título e texto longos quebram em linhas, sem cortar', async () => {
    await render(
      <EstadoVazio titulo={'Título longo '.repeat(10)} texto={'Texto longo '.repeat(20)} />,
    );

    expect(screen.getByRole('heading').props.numberOfLines).toBeUndefined();
    expect(screen.getByText(/Texto longo/).props.numberOfLines).toBeUndefined();
  });
});
