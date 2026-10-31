import { espaco, raio, temaClaro } from '@bairrin/tokens';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, Dimensions } from 'react-native';
import { ModalDeConfirmacao, type ModalDeConfirmacaoProps } from './ModalDeConfirmacao.tsx';

const base: ModalDeConfirmacaoProps = {
  visivel: true,
  titulo: 'Pedir cópia dos seus dados?',
  texto: 'Preparamos sua cópia em até 48 horas e avisamos por e-mail.',
  rotuloConfirmar: 'Pedir cópia',
  rotuloCancelar: 'Cancelar',
  aoConfirmar: jest.fn(),
  aoCancelar: jest.fn(),
};

afterEach(() => jest.clearAllMocks());

describe('ModalDeConfirmacao', () => {
  it('mostra a pergunta como título, a consequência e os dois botões com verbos', async () => {
    await render(<ModalDeConfirmacao {...base} />);

    expect(screen.getByRole('heading')).toHaveTextContent('Pedir cópia dos seus dados?');
    expect(screen.getByText(base.texto)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Pedir cópia' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeOnTheScreen();
  });

  it('fechado, não desenha nada', async () => {
    await render(<ModalDeConfirmacao {...base} visivel={false} />);

    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('cada botão chama o seu callback', async () => {
    const aoConfirmar = jest.fn();
    const aoCancelar = jest.fn();
    await render(
      <ModalDeConfirmacao {...base} aoConfirmar={aoConfirmar} aoCancelar={aoCancelar} />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Pedir cópia' }));
    expect(aoConfirmar).toHaveBeenCalledTimes(1);
    expect(aoCancelar).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    expect(aoCancelar).toHaveBeenCalledTimes(1);
  });

  it('o botão "voltar" do Android cancela', async () => {
    const aoCancelar = jest.fn();
    await render(<ModalDeConfirmacao {...base} aoCancelar={aoCancelar} testID="modal" />);

    await fireEvent(screen.getByTestId('modal'), 'requestClose');
    expect(aoCancelar).toHaveBeenCalledTimes(1);
  });

  it('o scrim usa `overlay.scrim` (48% de `neutral.900`) e o cartão, `radius.xl`', async () => {
    await render(<ModalDeConfirmacao {...base} testID="modal" />);

    const cartao = screen.getByTestId('modal-de-confirmacao-cartao');
    expect(cartao).toHaveStyle({ borderRadius: raio.xl, backgroundColor: temaClaro.bg.surface });
    expect(cartao.parent).toHaveStyle({ backgroundColor: 'rgba(21, 25, 32, 0.48)' });
  });

  it('o conteúdo rola dentro de um cartão com altura máxima: fonte a 200% não corta os botões (D10)', async () => {
    await render(<ModalDeConfirmacao {...base} />);

    const rolagem = screen.getByTestId('modal-de-confirmacao-rolagem');
    expect(rolagem).toBeOnTheScreen();
    expect(screen.getByTestId('modal-de-confirmacao-cartao')).toHaveStyle({
      maxHeight: Dimensions.get('window').height - espaco[4] * 2,
    });
    // Título, texto e botões ficam todos dentro da área rolável.
    expect(within(rolagem).getByRole('heading')).toBeOnTheScreen();
    expect(within(rolagem).getByRole('button', { name: 'Pedir cópia' })).toBeOnTheScreen();
    expect(within(rolagem).getByRole('button', { name: 'Cancelar' })).toBeOnTheScreen();
  });

  it('o limite do cartão acompanha a altura da janela (janela baixa, com fonte a 200%) (D10)', async () => {
    const original = Dimensions.get('window');
    try {
      await act(() => {
        Dimensions.set({ window: { ...original, height: 320 } });
      });
      await render(<ModalDeConfirmacao {...base} />);
      expect(screen.getByTestId('modal-de-confirmacao-cartao')).toHaveStyle({
        maxHeight: 320 - espaco[4] * 2,
      });
    } finally {
      Dimensions.set({ window: original });
    }
  });

  it('com o cartão rolável os dois botões continuam acionáveis (D10)', async () => {
    const aoConfirmar = jest.fn();
    const aoCancelar = jest.fn();
    await render(
      <ModalDeConfirmacao {...base} aoConfirmar={aoConfirmar} aoCancelar={aoCancelar} />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Pedir cópia' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    expect(aoConfirmar).toHaveBeenCalledTimes(1);
    expect(aoCancelar).toHaveBeenCalledTimes(1);
  });

  it('o toque no fundo não fecha: só os botões decidem', async () => {
    const aoCancelar = jest.fn();
    const aoConfirmar = jest.fn();
    await render(
      <ModalDeConfirmacao {...base} aoCancelar={aoCancelar} aoConfirmar={aoConfirmar} />,
    );

    const fundo = screen.getByRole('heading').parent?.parent;
    expect(fundo).toBeTruthy();
    if (fundo) await fireEvent.press(fundo);
    expect(aoCancelar).not.toHaveBeenCalled();
    expect(aoConfirmar).not.toHaveBeenCalled();
  });

  describe('variantes dos botões', () => {
    it('padrão: confirmar primário e cancelar terciário', async () => {
      await render(<ModalDeConfirmacao {...base} />);

      expect(screen.getByRole('button', { name: 'Pedir cópia' })).toHaveStyle({
        backgroundColor: temaClaro.action.primary,
      });
      expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveStyle({
        backgroundColor: 'transparent',
      });
    });

    it('destrutivo: o botão de confirmar é vermelho', async () => {
      await render(<ModalDeConfirmacao {...base} destrutivo rotuloConfirmar="Recusar pedido" />);

      expect(screen.getByRole('button', { name: 'Recusar pedido' })).toHaveStyle({
        backgroundColor: temaClaro.action.destructive,
      });
    });

    it('destrutiva grave: o destaque vai para a ação segura (primária) e a destrutiva fica secundária', async () => {
      await render(
        <ModalDeConfirmacao
          {...base}
          destrutivo
          graveDestrutiva
          titulo="Excluir sua conta?"
          rotuloConfirmar="Excluir minha conta"
          rotuloCancelar="Voltar"
        />,
      );

      expect(screen.getByRole('button', { name: 'Voltar' })).toHaveStyle({
        backgroundColor: temaClaro.action.primary,
      });
      expect(screen.getByRole('button', { name: 'Excluir minha conta' })).toHaveStyle({
        backgroundColor: temaClaro.bg.surface,
        borderColor: temaClaro.action.primary,
      });
    });
  });

  describe('carregando', () => {
    it('o botão de confirmar fica ocupado, o cancelar desligado e o "voltar" do Android ignorado', async () => {
      const aoConfirmar = jest.fn();
      const aoCancelar = jest.fn();
      await render(
        <ModalDeConfirmacao
          {...base}
          carregando
          aoConfirmar={aoConfirmar}
          aoCancelar={aoCancelar}
          testID="modal"
        />,
      );

      expect(screen.getByRole('button', { name: 'Enviando…' })).toBeBusy();
      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
      await fireEvent.press(screen.getByRole('button', { name: 'Enviando…' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
      expect(aoConfirmar).not.toHaveBeenCalled();
      expect(aoCancelar).not.toHaveBeenCalled();
      expect(screen.getByTestId('modal').props.onRequestClose).toBeUndefined();
    });
  });

  describe('acessibilidade', () => {
    it('ao abrir, o leitor de tela vai para o título', async () => {
      const foco = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
      foco.mockClear();
      const { rerender } = await render(<ModalDeConfirmacao {...base} visivel={false} />);
      expect(foco).not.toHaveBeenCalled();

      await rerender(<ModalDeConfirmacao {...base} />);
      expect(foco).toHaveBeenCalledTimes(1);
      expect(foco).toHaveBeenCalledWith(expect.anything(), 'focus');
    });

    it('o cartão é um diálogo modal para o leitor de tela', async () => {
      await render(<ModalDeConfirmacao {...base} />);

      const cartao = screen.getByTestId('modal-de-confirmacao-cartao');
      expect(cartao?.props.accessibilityViewIsModal).toBe(true);
      expect(cartao?.props.role).toBe('alertdialog');
    });
  });

  it('texto longo não corta: sem número fixo de linhas', async () => {
    await render(<ModalDeConfirmacao {...base} texto={'consequência '.repeat(40)} />);

    expect(screen.getByText(/consequência/).props.numberOfLines).toBeUndefined();
  });
});
