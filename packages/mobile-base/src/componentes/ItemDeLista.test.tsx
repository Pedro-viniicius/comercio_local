import { espaco, temaClaro } from '@bairrin/tokens';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { anelDeFoco } from './estilos.ts';
import { ItemDeLista } from './ItemDeLista.tsx';

const evento = { nativeEvent: { touches: [], changedTouches: [], timestamp: 1 }, persist() {} };

describe('ItemDeLista', () => {
  it('com `aoPressionar` é um botão de toque na linha inteira, com seta que navega', async () => {
    const aoPressionar = jest.fn();
    await render(<ItemDeLista titulo="Privacidade e dados" aoPressionar={aoPressionar} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Privacidade e dados' }));
    expect(aoPressionar).toHaveBeenCalledTimes(1);
    // A seta é decorativa: o leitor de tela não a lê.
    expect(screen.queryByText('›')).toBeNull();
    expect(screen.getByText('›', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('sem `aoPressionar` é só informação: sem botão e sem seta', async () => {
    await render(<ItemDeLista titulo="Versão 1.0" />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Versão 1.0')).toBeOnTheScreen();
    expect(screen.queryByText('›', { includeHiddenElements: true })).toBeNull();
  });

  it('`navega` liga ou desliga a seta contra o padrão', async () => {
    const { rerender } = await render(
      <ItemDeLista titulo="Sair" aoPressionar={jest.fn()} navega={false} />,
    );
    expect(screen.queryByText('›', { includeHiddenElements: true })).toBeNull();

    await rerender(<ItemDeLista titulo="Info" navega />);
    expect(screen.getByText('›', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('altura mínima de 56 com uma linha e de 72 com duas', async () => {
    const { rerender } = await render(
      <ItemDeLista titulo="Termos de Uso" aoPressionar={jest.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Termos de Uso' })).toHaveStyle({ minHeight: 56 });

    await rerender(
      <ItemDeLista titulo="Termos de Uso" descricao="Versão 1.0" aoPressionar={jest.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Termos de Uso. Versão 1.0' })).toHaveStyle({
      minHeight: 72,
    });
    expect(screen.getByText('Versão 1.0')).toHaveStyle({ color: temaClaro.text.secondary });
  });

  it('o ícone fica à esquerda e é escondido do leitor de tela', async () => {
    await render(<ItemDeLista titulo="Sair" icone={<Text>⏻</Text>} aoPressionar={jest.fn()} />);

    expect(screen.queryByText('⏻')).toBeNull();
    expect(screen.getByText('⏻', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  describe('separador', () => {
    const separador = () => screen.getByTestId('item-separador', { includeHiddenElements: true });

    it('1 px `border.subtle`, recuado até o texto (a margem da tela)', async () => {
      await render(<ItemDeLista titulo="Termos" aoPressionar={jest.fn()} testID="item" />);

      expect(separador()).toHaveStyle({
        height: 1,
        backgroundColor: temaClaro.border.subtle,
        marginLeft: espaco[4],
      });
    });

    it('com ícone o recuo inclui o ícone e o respiro até o texto', async () => {
      await render(
        <ItemDeLista titulo="Sair" icone={<Text>i</Text>} aoPressionar={jest.fn()} testID="item" />,
      );

      expect(separador()).toHaveStyle({ marginLeft: espaco[4] + 24 + espaco[3] });
    });

    it('`semSeparador` tira a linha', async () => {
      await render(
        <ItemDeLista titulo="Sair" aoPressionar={jest.fn()} testID="item" semSeparador />,
      );

      expect(screen.queryByTestId('item-separador', { includeHiddenElements: true })).toBeNull();
    });
  });

  it('destrutivo pinta o título de `red.700`; desabilitado, de `text.tertiary` e ignora o toque', async () => {
    const aoPressionar = jest.fn();
    const { rerender } = await render(
      <ItemDeLista titulo="Excluir minha conta" aoPressionar={aoPressionar} destrutivo />,
    );
    expect(screen.getByText('Excluir minha conta')).toHaveStyle({
      color: temaClaro.status.danger.fg,
    });

    await rerender(<ItemDeLista titulo="Sair" aoPressionar={aoPressionar} desabilitado />);
    expect(screen.getByText('Sair')).toHaveStyle({ color: temaClaro.text.tertiary });
    expect(screen.getByRole('button', { name: 'Sair' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Sair' }));
    expect(aoPressionar).not.toHaveBeenCalled();
  });

  it('pressionado ganha fundo `bg.subtle`; foco mostra o anel (D8)', async () => {
    await render(<ItemDeLista titulo="Termos" aoPressionar={jest.fn()} />);
    const item = () => screen.getByRole('button', { name: 'Termos' });
    expect(item()).not.toHaveStyle({ backgroundColor: temaClaro.bg.subtle });

    await act(() => {
      (item().props.onResponderGrant as (e: unknown) => void)(evento);
    });
    expect(item()).toHaveStyle({ backgroundColor: temaClaro.bg.subtle });

    await fireEvent(item(), 'focus');
    expect(item()).toHaveStyle(anelDeFoco);
  });

  it('título longo quebra em linhas e não corta', async () => {
    await render(<ItemDeLista titulo={'Texto muito longo '.repeat(10)} aoPressionar={jest.fn()} />);

    expect(screen.getByText(/Texto muito longo/).props.numberOfLines).toBeUndefined();
  });
});
