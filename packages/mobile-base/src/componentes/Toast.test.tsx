import { temaClaro } from '@bairrin/tokens';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, PixelRatio, Platform, Text } from 'react-native';
import { anelDeFocoSobreEscuro } from './estilos.ts';
import {
  DURACAO_DO_TOAST_COM_ACAO_EM_MS,
  DURACAO_DO_TOAST_EM_MS,
  ProvedorDeToast,
  Toast,
  useToast,
  type OpcoesDoToast,
} from './Toast.tsx';

const avancar = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

beforeEach(() => {
  jest.useFakeTimers();
  // Fonte e leitor de tela comuns; o Jest do React Native devolve escala 2 por padrão.
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Toast', () => {
  it('mostra a mensagem em `toast.bg` com texto `text.onAction` e símbolo escondido do leitor', async () => {
    await render(
      <Toast mensagem="Conta confirmada" tipo="sucesso" aoDispensar={jest.fn()} testID="toast" />,
    );

    expect(screen.getByTestId('toast')).toHaveStyle({ backgroundColor: temaClaro.toast.bg });
    expect(screen.getByText('Conta confirmada')).toHaveStyle({ color: temaClaro.text.onAction });
    expect(screen.getByRole('status')).toHaveTextContent('Conta confirmada');
    expect(screen.queryByText('✓')).toBeNull();
    expect(screen.getByText('✓', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('o símbolo muda por tipo: informativo usa "i"', async () => {
    await render(<Toast mensagem="Aviso" aoDispensar={jest.fn()} />);

    expect(screen.getByText('i', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it(`some em ${DURACAO_DO_TOAST_EM_MS / 1000} s`, async () => {
    const aoDispensar = jest.fn();
    await render(<Toast mensagem="Oi" aoDispensar={aoDispensar} />);

    await avancar(DURACAO_DO_TOAST_EM_MS - 1);
    expect(aoDispensar).not.toHaveBeenCalled();
    await avancar(1);
    expect(aoDispensar).toHaveBeenCalledTimes(1);
  });

  it('com leitor de tela ligado a duração dobra (WCAG 2.2.1, D19)', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const aoDispensar = jest.fn();
    await render(<Toast mensagem="Oi" aoDispensar={aoDispensar} />);

    await avancar(DURACAO_DO_TOAST_EM_MS * 2 - 1);
    expect(aoDispensar).not.toHaveBeenCalled();
    await avancar(1);
    expect(aoDispensar).toHaveBeenCalledTimes(1);
  });

  it('com leitor de tela ligado e ação "Desfazer", a duração é a dobra de 6 s: 12 s (D19)', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const aoDispensar = jest.fn();
    await render(
      <Toast
        mensagem="Item removido"
        acao={{ rotulo: 'Desfazer', aoPressionar: jest.fn() }}
        aoDispensar={aoDispensar}
      />,
    );

    await avancar(DURACAO_DO_TOAST_COM_ACAO_EM_MS * 2 - 1);
    expect(aoDispensar).not.toHaveBeenCalled();
    await avancar(1);
    expect(aoDispensar).toHaveBeenCalledTimes(1);
  });

  it('fonte exatamente em 1,3 não dobra a duração (limite é "acima de")', async () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1.3);
    const aoDispensar = jest.fn();
    await render(<Toast mensagem="Oi" aoDispensar={aoDispensar} />);

    await avancar(DURACAO_DO_TOAST_EM_MS);
    expect(aoDispensar).toHaveBeenCalledTimes(1);
  });

  it('com fonte do sistema ampliada (acima de 1,3) a duração dobra (D19)', async () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(2);
    const aoDispensar = jest.fn();
    await render(<Toast mensagem="Oi" aoDispensar={aoDispensar} />);

    await avancar(DURACAO_DO_TOAST_EM_MS * 2 - 1);
    expect(aoDispensar).not.toHaveBeenCalled();
    await avancar(1);
    expect(aoDispensar).toHaveBeenCalledTimes(1);
  });

  it(`com ação "Desfazer" some em ${DURACAO_DO_TOAST_COM_ACAO_EM_MS / 1000} s`, async () => {
    const aoDispensar = jest.fn();
    await render(
      <Toast
        mensagem="Item removido"
        acao={{ rotulo: 'Desfazer', aoPressionar: jest.fn() }}
        aoDispensar={aoDispensar}
      />,
    );

    await avancar(DURACAO_DO_TOAST_EM_MS);
    expect(aoDispensar).not.toHaveBeenCalled();
    await avancar(DURACAO_DO_TOAST_COM_ACAO_EM_MS - DURACAO_DO_TOAST_EM_MS);
    expect(aoDispensar).toHaveBeenCalledTimes(1);
  });

  it('a ação chama o callback e fecha o toast', async () => {
    const aoPressionar = jest.fn();
    const aoDispensar = jest.fn();
    await render(
      <Toast
        mensagem="Item removido"
        acao={{ rotulo: 'Desfazer', aoPressionar }}
        aoDispensar={aoDispensar}
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Desfazer' }));
    expect(aoPressionar).toHaveBeenCalledTimes(1);
    expect(aoDispensar).toHaveBeenCalledTimes(1);
  });

  it('pausa com o toque e recomeça a contagem inteira ao soltar', async () => {
    const aoDispensar = jest.fn();
    await render(<Toast mensagem="Oi" aoDispensar={aoDispensar} testID="toast" />);

    await avancar(3000);
    await fireEvent(screen.getByTestId('toast'), 'touchStart');
    await avancar(DURACAO_DO_TOAST_EM_MS * 3);
    expect(aoDispensar).not.toHaveBeenCalled();

    await fireEvent(screen.getByTestId('toast'), 'touchEnd');
    await avancar(DURACAO_DO_TOAST_EM_MS - 1);
    expect(aoDispensar).not.toHaveBeenCalled();
    await avancar(1);
    expect(aoDispensar).toHaveBeenCalledTimes(1);
  });

  it('toque cancelado também retoma a contagem', async () => {
    const aoDispensar = jest.fn();
    await render(<Toast mensagem="Oi" aoDispensar={aoDispensar} testID="toast" />);

    await fireEvent(screen.getByTestId('toast'), 'touchStart');
    await fireEvent(screen.getByTestId('toast'), 'touchCancel');
    await avancar(DURACAO_DO_TOAST_EM_MS);
    expect(aoDispensar).toHaveBeenCalledTimes(1);
  });

  it('pausa enquanto a ação está em foco e mostra o anel (D8)', async () => {
    const aoDispensar = jest.fn();
    await render(
      <Toast
        mensagem="Item removido"
        acao={{ rotulo: 'Desfazer', aoPressionar: jest.fn() }}
        aoDispensar={aoDispensar}
      />,
    );

    await fireEvent(screen.getByRole('button', { name: 'Desfazer' }), 'focus');
    expect(screen.getByRole('button', { name: 'Desfazer' })).toHaveStyle(anelDeFocoSobreEscuro);
    await avancar(DURACAO_DO_TOAST_COM_ACAO_EM_MS * 2);
    expect(aoDispensar).not.toHaveBeenCalled();

    await fireEvent(screen.getByRole('button', { name: 'Desfazer' }), 'blur');
    await avancar(DURACAO_DO_TOAST_COM_ACAO_EM_MS);
    expect(aoDispensar).toHaveBeenCalledTimes(1);
  });

  it('o anel sobre o fundo escuro do toast é branco, não o azul de `focus.ring`', () => {
    expect(anelDeFocoSobreEscuro.outlineColor).toBe(temaClaro.text.onAction);
    expect(anelDeFocoSobreEscuro.outlineWidth).toBe(2);
  });

  it('desmontar cancela o relógio', async () => {
    const aoDispensar = jest.fn();
    const { unmount } = await render(<Toast mensagem="Oi" aoDispensar={aoDispensar} />);
    await unmount();

    await avancar(DURACAO_DO_TOAST_COM_ACAO_EM_MS * 2);
    expect(aoDispensar).not.toHaveBeenCalled();
  });

  it('trocar o callback entre renderizações não reinicia a contagem', async () => {
    const primeiro = jest.fn();
    const segundo = jest.fn();
    const { rerender } = await render(<Toast mensagem="Oi" aoDispensar={primeiro} />);

    await avancar(3000);
    await rerender(<Toast mensagem="Oi" aoDispensar={segundo} />);
    await avancar(1000);
    expect(primeiro).not.toHaveBeenCalled();
    expect(segundo).toHaveBeenCalledTimes(1);
  });

  describe('anúncio só no iOS (D9)', () => {
    let anunciar: jest.SpyInstance;
    beforeEach(() => {
      anunciar = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
      anunciar.mockClear();
    });

    it('no iOS anuncia a mensagem; no Android a região viva anuncia e a chamada manual não acontece', async () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      await render(<Toast mensagem="Conta confirmada" aoDispensar={jest.fn()} />);
      expect(anunciar).toHaveBeenCalledWith('Conta confirmada');

      anunciar.mockClear();
      jest.replaceProperty(Platform, 'OS', 'android');
      await render(<Toast mensagem="Outra" aoDispensar={jest.fn()} />);
      expect(anunciar).not.toHaveBeenCalled();
    });
  });
});

function Disparador({ opcoes }: { opcoes: OpcoesDoToast }) {
  const { exibirToast } = useToast();
  return <Text onPress={() => exibirToast(opcoes)}>Disparar</Text>;
}

describe('ProvedorDeToast', () => {
  it('mostra o toast pedido pela tela, acima do conteúdo, e o tira em 4 s', async () => {
    await render(
      <ProvedorDeToast>
        <Disparador opcoes={{ mensagem: 'Você saiu da sua conta' }} />
      </ProvedorDeToast>,
    );
    expect(screen.queryByText('Você saiu da sua conta')).toBeNull();

    await fireEvent.press(screen.getByText('Disparar'));
    expect(screen.getByText('Você saiu da sua conta')).toBeOnTheScreen();

    await avancar(DURACAO_DO_TOAST_EM_MS);
    expect(screen.queryByText('Você saiu da sua conta')).toBeNull();
  });

  it('um toast novo troca o anterior e reinicia o tempo', async () => {
    const { rerender } = await render(
      <ProvedorDeToast>
        <Disparador opcoes={{ mensagem: 'Primeiro' }} />
      </ProvedorDeToast>,
    );
    await fireEvent.press(screen.getByText('Disparar'));
    await avancar(3000);

    await rerender(
      <ProvedorDeToast>
        <Disparador opcoes={{ mensagem: 'Segundo' }} />
      </ProvedorDeToast>,
    );
    await fireEvent.press(screen.getByText('Disparar'));
    expect(screen.queryByText('Primeiro')).toBeNull();
    expect(screen.getByText('Segundo')).toBeOnTheScreen();

    await avancar(DURACAO_DO_TOAST_EM_MS - 1);
    expect(screen.getByText('Segundo')).toBeOnTheScreen();
    await avancar(1);
    expect(screen.queryByText('Segundo')).toBeNull();
  });

  it('o toast fica numa região viva educada que existe desde o início', async () => {
    await render(
      <ProvedorDeToast>
        <Disparador opcoes={{ mensagem: 'Oi' }} />
      </ProvedorDeToast>,
    );
    await fireEvent.press(screen.getByText('Disparar'));

    expect(screen.getByRole('status').parent?.parent?.props.accessibilityLiveRegion).toBe('polite');
  });

  it('respeita a margem inferior pedida (acima da navegação)', async () => {
    await render(
      <ProvedorDeToast margemInferior={96}>
        <Disparador opcoes={{ mensagem: 'Oi' }} />
      </ProvedorDeToast>,
    );
    await fireEvent.press(screen.getByText('Disparar'));

    const area = screen.getByRole('status').parent?.parent;
    expect(area).toHaveStyle({ bottom: 96, position: 'absolute' });
  });

  it('a ação do toast chega à tela e fecha o toast', async () => {
    const aoPressionar = jest.fn();
    await render(
      <ProvedorDeToast>
        <Disparador
          opcoes={{ mensagem: 'Item removido', acao: { rotulo: 'Desfazer', aoPressionar } }}
        />
      </ProvedorDeToast>,
    );
    await fireEvent.press(screen.getByText('Disparar'));
    await fireEvent.press(screen.getByRole('button', { name: 'Desfazer' }));

    expect(aoPressionar).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Item removido')).toBeNull();
  });

  it('`useToast` fora do provedor falha com mensagem clara', async () => {
    const erroNoConsole = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(render(<Disparador opcoes={{ mensagem: 'x' }} />)).rejects.toThrow(
      'useToast precisa estar dentro de um ProvedorDeToast',
    );
    erroNoConsole.mockRestore();
  });
});
