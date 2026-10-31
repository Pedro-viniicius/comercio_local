import { tamanho, temaClaro } from '@bairrin/tokens';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Botao, type VarianteDoBotao } from './Botao.tsx';
import { anelDeFoco } from './estilos.ts';

// O Pressable sinaliza "pressionado" pelo respondedor; o `fireEvent.press` não passa por ele.
const evento = { nativeEvent: { touches: [], changedTouches: [], timestamp: 1 }, persist() {} };
const apertar = (nome: string) =>
  act(() => {
    const aoApertar = screen.getByRole('button', { name: nome }).props.onResponderGrant as (
      evento: unknown,
    ) => void;
    aoApertar(evento);
  });

describe('Botao', () => {
  it('chama aoPressionar e expõe o rótulo como nome do botão', async () => {
    const aoPressionar = jest.fn();
    await render(<Botao rotulo="Criar conta" aoPressionar={aoPressionar} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Criar conta' }));
    expect(aoPressionar).toHaveBeenCalledTimes(1);
  });

  it.each<[VarianteDoBotao, string, string, string]>([
    [
      'primario',
      temaClaro.action.primary,
      temaClaro.text.onAction,
      temaClaro.action.primaryPressed,
    ],
    ['secundario', temaClaro.bg.surface, temaClaro.text.link, temaClaro.bg.subtle],
    ['terciario', 'transparent', temaClaro.text.link, temaClaro.bg.subtle],
    [
      'destrutivo',
      temaClaro.action.destructive,
      temaClaro.text.onAction,
      temaClaro.action.destructivePressed,
    ],
  ])(
    'variante %s usa os tokens do design system, também pressionada',
    async (variante, fundo, texto, pressionado) => {
      await render(<Botao rotulo="Ação" variante={variante} aoPressionar={jest.fn()} />);
      const botao = screen.getByRole('button', { name: 'Ação' });

      expect(botao).toHaveStyle({ backgroundColor: fundo });
      expect(screen.getByText('Ação')).toHaveStyle({ color: texto });
      await apertar('Ação');
      expect(screen.getByRole('button', { name: 'Ação' })).toHaveStyle({
        backgroundColor: pressionado,
      });
    },
  );

  it('o secundário tem borda de ação e o primário não tem borda visível', async () => {
    await render(
      <>
        <Botao rotulo="Secundário" variante="secundario" aoPressionar={jest.fn()} />
        <Botao rotulo="Primário" aoPressionar={jest.fn()} />
      </>,
    );

    expect(screen.getByRole('button', { name: 'Secundário' })).toHaveStyle({
      borderColor: temaClaro.action.primary,
    });
    expect(screen.getByRole('button', { name: 'Primário' })).toHaveStyle({
      borderColor: 'transparent',
    });
  });

  it('alvo de toque: 48 de altura mínima (44 no terciário), sem altura fixa', async () => {
    await render(
      <>
        <Botao rotulo="Primário" aoPressionar={jest.fn()} />
        <Botao rotulo="Terciário" variante="terciario" aoPressionar={jest.fn()} />
      </>,
    );

    const primario = screen.getByRole('button', { name: 'Primário' });
    const terciario = screen.getByRole('button', { name: 'Terciário' });
    expect(primario).toHaveStyle({ minHeight: tamanho.control.height.mobile });
    expect(terciario).toHaveStyle({ minHeight: tamanho.touch.min });
    expect(
      StyleSheet.flatten(primario.props.style as StyleProp<ViewStyle>)?.height,
    ).toBeUndefined();
    expect(tamanho.touch.min).toBe(44);
  });

  describe('desabilitado', () => {
    it('é exposto como desabilitado, ignora o toque e usa fundo e texto de desabilitado', async () => {
      const aoPressionar = jest.fn();
      await render(<Botao rotulo="Entrar" desabilitado aoPressionar={aoPressionar} />);
      const botao = screen.getByRole('button', { name: 'Entrar' });

      expect(botao).toBeDisabled();
      expect(botao).not.toBeBusy();
      expect(botao).toHaveStyle({ backgroundColor: temaClaro.bg.subtle });
      expect(screen.getByText('Entrar')).toHaveStyle({ color: temaClaro.text.tertiary });
      await fireEvent.press(botao);
      expect(aoPressionar).not.toHaveBeenCalled();
    });

    it('não muda de cor ao ser apertado', async () => {
      await render(<Botao rotulo="Entrar" desabilitado aoPressionar={jest.fn()} />);

      await apertar('Entrar');
      expect(screen.getByRole('button', { name: 'Entrar' })).toHaveStyle({
        backgroundColor: temaClaro.bg.subtle,
      });
    });

    it('o terciário desabilitado continua sem fundo, só com o texto apagado', async () => {
      await render(
        <Botao rotulo="Pular" variante="terciario" desabilitado aoPressionar={jest.fn()} />,
      );

      expect(screen.getByRole('button', { name: 'Pular' })).toHaveStyle({
        backgroundColor: 'transparent',
      });
      expect(screen.getByText('Pular')).toHaveStyle({ color: temaClaro.text.tertiary });
    });

    it('a dica (razão) é lida junto do botão', async () => {
      await render(
        <Botao
          rotulo="Entrar"
          desabilitado
          dica="Sem conexão: tente quando voltar"
          aoPressionar={jest.fn()}
        />,
      );

      expect(screen.getByRole('button', { name: 'Entrar' }).props.accessibilityHint).toBe(
        'Sem conexão: tente quando voltar',
      );
    });
  });

  describe('carregando (D2)', () => {
    it('fica ocupado e desabilitado, mostra o indicador e o texto de carregando', async () => {
      await render(<Botao rotulo="Criar conta" carregando aoPressionar={jest.fn()} />);

      const botao = screen.getByRole('button', { name: 'Enviando…' });
      expect(botao).toBeBusy();
      expect(botao).toBeDisabled();
      expect(botao).toHaveStyle({ backgroundColor: temaClaro.bg.subtle });
      expect(screen.getByText('Enviando…')).toHaveStyle({ color: temaClaro.text.secondary });
      expect(screen.queryByText('Criar conta')).toBeNull();
      // O indicador é decorativo: o texto "Enviando…" é o que o leitor de tela diz.
      const indicador = screen.getByTestId('botao-indicador', { includeHiddenElements: true });
      expect(indicador.props.importantForAccessibility).toBe('no-hide-descendants');
      expect(indicador.props.accessibilityElementsHidden).toBe(true);
    });

    it('usa o texto de carregando da tela quando ela manda um', async () => {
      await render(
        <Botao
          rotulo="Tentar de novo"
          carregando
          rotuloCarregando="Verificando…"
          aoPressionar={jest.fn()}
        />,
      );

      expect(screen.getByRole('button', { name: 'Verificando…' })).toBeOnTheScreen();
    });

    it('ignora o toque (sem toque duplo), mas continua na árvore para manter o foco', async () => {
      const aoPressionar = jest.fn();
      await render(<Botao rotulo="Salvar" carregando aoPressionar={aoPressionar} />);

      await fireEvent.press(screen.getByRole('button', { name: 'Enviando…' }));
      expect(aoPressionar).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Enviando…' }).props.disabled).toBeFalsy();
    });

    it('volta ao normal quando termina', async () => {
      const { rerender } = await render(
        <Botao rotulo="Salvar" carregando aoPressionar={jest.fn()} />,
      );
      await rerender(<Botao rotulo="Salvar" aoPressionar={jest.fn()} />);

      const botao = screen.getByRole('button', { name: 'Salvar' });
      expect(botao).not.toBeBusy();
      expect(botao).toBeEnabled();
      expect(botao).toHaveStyle({ backgroundColor: temaClaro.action.primary });
    });
  });

  describe('foco (D8)', () => {
    it('desenha o anel de 2 px `focus.ring` com respiro enquanto está em foco', async () => {
      await render(<Botao rotulo="Entrar" aoPressionar={jest.fn()} />);
      const botao = screen.getByRole('button', { name: 'Entrar' });
      expect(botao).not.toHaveStyle({ outlineWidth: 2 });

      await fireEvent(botao, 'focus');
      expect(screen.getByRole('button', { name: 'Entrar' })).toHaveStyle(anelDeFoco);
      expect(anelDeFoco).toMatchObject({
        outlineWidth: 2,
        outlineColor: temaClaro.focus.ring,
        outlineOffset: 2,
      });

      await fireEvent(screen.getByRole('button', { name: 'Entrar' }), 'blur');
      expect(screen.getByRole('button', { name: 'Entrar' })).not.toHaveStyle({ outlineWidth: 2 });
    });

    it.each<VarianteDoBotao>(['primario', 'secundario', 'terciario', 'destrutivo'])(
      'a variante %s mostra o anel, e o botão ocupado também',
      async (variante) => {
        const { rerender } = await render(
          <Botao rotulo="Ação" variante={variante} aoPressionar={jest.fn()} />,
        );
        await fireEvent(screen.getByRole('button', { name: 'Ação' }), 'focus');
        expect(screen.getByRole('button', { name: 'Ação' })).toHaveStyle(anelDeFoco);

        // O foco não se perde quando o botão passa a ocupado (o botão continua na árvore).
        await rerender(
          <Botao rotulo="Ação" variante={variante} carregando aoPressionar={jest.fn()} />,
        );
        expect(screen.getByRole('button', { name: 'Enviando…' })).toHaveStyle(anelDeFoco);
      },
    );
  });

  it('rótulo longo quebra em linhas sem número fixo de linhas', async () => {
    await render(
      <Botao rotulo="Pedir cópia dos meus dados pessoais agora mesmo" aoPressionar={jest.fn()} />,
    );

    expect(screen.getByText(/Pedir cópia/).props.numberOfLines).toBeUndefined();
  });
});
