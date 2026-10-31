import { tamanho, temaClaro } from '@bairrin/tokens';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { BarraSuperior, textoDoSelo } from './BarraSuperior.tsx';
import { anelDeFoco, sombraDeElevacao } from './estilos.ts';

describe('BarraSuperior', () => {
  it('mostra o título como cabeçalho, em uma linha com reticências; o texto completo é o nome', async () => {
    const titulo =
      'Termos de Uso do Bairrin e muito mais texto que não cabe numa linha só da barra';
    await render(<BarraSuperior titulo={titulo} />);

    const cabecalho = screen.getByRole('heading');
    expect(cabecalho).toHaveTextContent(titulo);
    expect(cabecalho.props.numberOfLines).toBe(1);
    expect(cabecalho.props.ellipsizeMode).toBe('tail');
  });

  it('altura mínima de 56, fundo `bg.surface` e sem sombra por padrão', async () => {
    await render(<BarraSuperior titulo="Entrar" testID="barra" />);

    expect(screen.getByTestId('barra')).toHaveStyle({
      minHeight: 56,
      backgroundColor: temaClaro.bg.surface,
    });
    expect(
      StyleSheet.flatten(screen.getByTestId('barra').props.style as StyleProp<ViewStyle>)
        ?.boxShadow,
    ).toBeUndefined();
  });

  it('elevada (conteúdo rolado) ganha a sombra de `elevation.1`', async () => {
    await render(<BarraSuperior titulo="Entrar" elevada testID="barra" />);

    expect(screen.getByTestId('barra')).toHaveStyle(sombraDeElevacao(1));
    expect(sombraDeElevacao(1).boxShadow).toBe('0px 1px 2px rgba(21, 25, 32, 0.08)');
  });

  describe('voltar', () => {
    it('sem `aoVoltar` não há botão', async () => {
      await render(<BarraSuperior titulo="Entrar" />);

      expect(screen.queryByRole('button')).toBeNull();
    });

    it('com `aoVoltar`: botão "Voltar" de 44×44 que chama o callback', async () => {
      const aoVoltar = jest.fn();
      await render(<BarraSuperior titulo="Privacidade e dados" aoVoltar={aoVoltar} />);

      const voltar = screen.getByRole('button', { name: 'Voltar' });
      expect(voltar).toHaveStyle({ width: tamanho.touch.min, height: tamanho.touch.min });
      await fireEvent.press(voltar);
      expect(aoVoltar).toHaveBeenCalledTimes(1);
      // O símbolo "‹" é decorativo: o nome acessível é "Voltar".
      expect(screen.queryByText('‹')).toBeNull();
    });

    it('o foco no "Voltar" mostra o anel (D8)', async () => {
      await render(<BarraSuperior titulo="Privacidade" aoVoltar={jest.fn()} />);

      await fireEvent(screen.getByRole('button', { name: 'Voltar' }), 'focus');
      expect(screen.getByRole('button', { name: 'Voltar' })).toHaveStyle(anelDeFoco);
    });
  });

  describe('ações', () => {
    it('mostra até duas ações à direita, cada uma com nome acessível, e ignora a terceira', async () => {
      const aoCompartilhar = jest.fn();
      await render(
        <BarraSuperior
          titulo="Loja"
          acoes={[
            { rotulo: 'Compartilhar', conteudo: <Text>↗</Text>, aoPressionar: aoCompartilhar },
            { rotulo: 'Notificações', conteudo: <Text>🔔</Text>, aoPressionar: jest.fn() },
            { rotulo: 'Terceira', conteudo: <Text>x</Text>, aoPressionar: jest.fn() },
          ]}
        />,
      );

      expect(screen.getAllByRole('button')).toHaveLength(2);
      expect(screen.queryByRole('button', { name: 'Terceira' })).toBeNull();
      await fireEvent.press(screen.getByRole('button', { name: 'Compartilhar' }));
      expect(aoCompartilhar).toHaveBeenCalledTimes(1);
    });

    it('o ícone da ação é escondido do leitor de tela e o alvo é 44×44', async () => {
      await render(
        <BarraSuperior
          titulo="Loja"
          acoes={[{ rotulo: 'Compartilhar', conteudo: <Text>↗</Text>, aoPressionar: jest.fn() }]}
        />,
      );

      expect(screen.queryByText('↗')).toBeNull();
      expect(screen.getByText('↗', { includeHiddenElements: true })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Compartilhar' })).toHaveStyle({
        width: 44,
        height: 44,
      });
    });

    it('selo: mostra a contagem, diz no nome acessível e vira "99+" acima de 99', async () => {
      const { rerender } = await render(
        <BarraSuperior
          titulo="Pedidos"
          acoes={[
            { rotulo: 'Notificações', conteudo: <Text>n</Text>, aoPressionar: jest.fn(), selo: 3 },
          ]}
        />,
      );
      expect(screen.getByRole('button', { name: 'Notificações, 3' })).toBeOnTheScreen();
      expect(screen.getByText('3', { includeHiddenElements: true })).toHaveStyle({
        color: temaClaro.text.onAction,
      });

      await rerender(
        <BarraSuperior
          titulo="Pedidos"
          acoes={[
            {
              rotulo: 'Notificações',
              conteudo: <Text>n</Text>,
              aoPressionar: jest.fn(),
              selo: 100,
            },
          ]}
        />,
      );
      expect(screen.getByRole('button', { name: 'Notificações, 99+' })).toBeOnTheScreen();
    });

    it('selo zero ou ausente não aparece', async () => {
      await render(
        <BarraSuperior
          titulo="Pedidos"
          acoes={[
            { rotulo: 'Notificações', conteudo: <Text>n</Text>, aoPressionar: jest.fn(), selo: 0 },
          ]}
        />,
      );

      expect(screen.getByRole('button', { name: 'Notificações' })).toBeOnTheScreen();
      expect(screen.queryByText('0', { includeHiddenElements: true })).toBeNull();
    });
  });

  it('textoDoSelo', () => {
    expect(textoDoSelo(1)).toBe('1');
    expect(textoDoSelo(99)).toBe('99');
    expect(textoDoSelo(100)).toBe('99+');
  });
});
