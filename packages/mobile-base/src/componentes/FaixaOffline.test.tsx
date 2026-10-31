import { tamanho, temaClaro } from '@bairrin/tokens';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';
import { anelDeFocoSobreEscuro } from './estilos.ts';
import { FaixaOffline } from './FaixaOffline.tsx';

const TEXTO_PADRAO = 'Você está offline. Mostrando o que foi carregado por último.';

afterEach(() => jest.restoreAllMocks());

describe('FaixaOffline', () => {
  it('mostra o texto do design system em `banner.offline` com texto `text.onAction`', async () => {
    await render(<FaixaOffline testID="faixa" />);

    expect(screen.getByTestId('faixa')).toHaveStyle({ backgroundColor: temaClaro.banner.offline });
    expect(screen.getByText(TEXTO_PADRAO)).toHaveStyle({ color: temaClaro.text.onAction });
  });

  it('o texto é uma região de status educada; o símbolo não é lido', async () => {
    await render(<FaixaOffline />);

    expect(screen.getByRole('status')).toHaveTextContent(TEXTO_PADRAO);
    expect(screen.getByRole('status').props.accessibilityLiveRegion).toBe('polite');
    expect(screen.queryByText('!')).toBeNull();
  });

  it('aceita outra mensagem', async () => {
    await render(<FaixaOffline mensagem="Sem conexão: tente quando voltar" />);

    expect(screen.getByText('Sem conexão: tente quando voltar')).toBeOnTheScreen();
    expect(screen.queryByText(TEXTO_PADRAO)).toBeNull();
  });

  it('sem `aoTentarDeNovo` não há botão; com ele, "Tentar de novo" de 44 chama o callback', async () => {
    const aoTentarDeNovo = jest.fn();
    const { rerender } = await render(<FaixaOffline />);
    expect(screen.queryByRole('button')).toBeNull();

    await rerender(<FaixaOffline aoTentarDeNovo={aoTentarDeNovo} />);
    const botao = screen.getByRole('button', { name: 'Tentar de novo' });
    expect(botao).toHaveStyle({ minHeight: tamanho.touch.min });
    await fireEvent.press(botao);
    expect(aoTentarDeNovo).toHaveBeenCalledTimes(1);
  });

  it('o foco no botão mostra o anel branco (o azul não passa de 3:1 sobre a faixa) (D8)', async () => {
    await render(<FaixaOffline aoTentarDeNovo={jest.fn()} />);

    await fireEvent(screen.getByRole('button', { name: 'Tentar de novo' }), 'focus');
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toHaveStyle(
      anelDeFocoSobreEscuro,
    );
  });

  it('não some sozinha: continua na tela depois de muito tempo', async () => {
    jest.useFakeTimers();
    await render(<FaixaOffline />);
    jest.advanceTimersByTime(10 * 60 * 1000);

    expect(screen.getByText(TEXTO_PADRAO)).toBeOnTheScreen();
    jest.useRealTimers();
  });

  it.each([
    ['ios', 1],
    ['android', 0],
  ] as const)('em %s anuncia à mão %i vez(es) (D9)', async (sistema, vezes) => {
    const anunciar = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
    anunciar.mockClear();
    jest.replaceProperty(Platform, 'OS', sistema);
    await render(<FaixaOffline />);

    expect(anunciar).toHaveBeenCalledTimes(vezes);
  });
});
