import { raio, tamanho, temaClaro } from '@bairrin/tokens';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { CaixaDeSelecao, type CaixaDeSelecaoProps } from './CaixaDeSelecao.tsx';
import { anelDeFoco } from './estilos.ts';

const TEXTO = 'Li e aceito os Termos de Uso e a Política de Privacidade';

function Aceite({
  aoAbrirTermos = jest.fn(),
  aoAbrirPolitica = jest.fn(),
  aoAlternar,
  ...resto
}: Partial<CaixaDeSelecaoProps> & {
  aoAbrirTermos?: () => void;
  aoAbrirPolitica?: () => void;
}) {
  const [marcada, setMarcada] = useState(false);
  return (
    <CaixaDeSelecao
      rotulo={[
        'Li e aceito os ',
        { texto: 'Termos de Uso', aoPressionar: aoAbrirTermos },
        ' e a ',
        { texto: 'Política de Privacidade', aoPressionar: aoAbrirPolitica },
      ]}
      marcada={marcada}
      aoAlternar={(valor) => {
        setMarcada(valor);
        aoAlternar?.(valor);
      }}
      {...resto}
    />
  );
}

const caixa = () => screen.getByRole('checkbox', { name: TEXTO });

describe('CaixaDeSelecao', () => {
  it('o nome acessível é o texto completo e começa desmarcada', async () => {
    await render(<Aceite />);

    expect(caixa()).toBeOnTheScreen();
    expect(caixa()).not.toBeChecked();
  });

  it('o toque alterna o estado, exposto como marcado ou não para o leitor de tela', async () => {
    const aoAlternar = jest.fn();
    await render(<Aceite aoAlternar={aoAlternar} />);

    await fireEvent.press(caixa());
    expect(caixa()).toBeChecked();
    expect(aoAlternar).toHaveBeenLastCalledWith(true);

    await fireEvent.press(caixa());
    expect(caixa()).not.toBeChecked();
    expect(aoAlternar).toHaveBeenLastCalledWith(false);
  });

  it('marcada: fundo `action.primary` e check branco escondido do leitor de tela', async () => {
    await render(<Aceite />);
    await fireEvent.press(caixa());

    const marca = screen.getByText('✓', { includeHiddenElements: true });
    expect(marca).toHaveStyle({ color: temaClaro.text.onAction });
    expect(marca.parent).toHaveStyle({
      backgroundColor: temaClaro.action.primary,
      width: 24,
      height: 24,
    });
    expect(screen.queryByText('✓')).toBeNull();
  });

  it('desmarcada: borda `border.control` e sem check', async () => {
    await render(<Aceite />);

    expect(screen.queryByText('✓', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('caixa-de-selecao-quadrado')).toHaveStyle({
      borderColor: temaClaro.border.control,
      backgroundColor: temaClaro.bg.surface,
      borderRadius: raio.sm,
    });
  });

  it('o alvo de toque é a linha inteira, de 44 de altura no mínimo', async () => {
    await render(<Aceite />);

    expect(caixa()).toHaveStyle({ minHeight: tamanho.touch.min, borderRadius: raio.md });
  });

  describe('links', () => {
    it('os dois nomes abrem seus leitores e não alternam a caixa', async () => {
      const aoAbrirTermos = jest.fn();
      const aoAbrirPolitica = jest.fn();
      await render(<Aceite aoAbrirTermos={aoAbrirTermos} aoAbrirPolitica={aoAbrirPolitica} />);

      await fireEvent.press(screen.getByRole('link', { name: 'Termos de Uso' }));
      expect(aoAbrirTermos).toHaveBeenCalledTimes(1);
      await fireEvent.press(screen.getByRole('link', { name: 'Política de Privacidade' }));
      expect(aoAbrirPolitica).toHaveBeenCalledTimes(1);
      expect(caixa()).not.toBeChecked();
    });

    it('os links são sublinhados na cor de link (não dependem só da cor)', async () => {
      await render(<Aceite />);

      expect(screen.getByRole('link', { name: 'Termos de Uso' })).toHaveStyle({
        color: temaClaro.text.link,
        textDecorationLine: 'underline',
      });
    });

    it('para o leitor de tela, os links saem como ações do controle', async () => {
      const aoAbrirTermos = jest.fn();
      const aoAbrirPolitica = jest.fn();
      await render(<Aceite aoAbrirTermos={aoAbrirTermos} aoAbrirPolitica={aoAbrirPolitica} />);

      expect(caixa().props.accessibilityActions).toEqual([
        { name: 'abrir-link-0', label: 'Abrir Termos de Uso' },
        { name: 'abrir-link-1', label: 'Abrir Política de Privacidade' },
      ]);
      await fireEvent(caixa(), 'accessibilityAction', {
        nativeEvent: { actionName: 'abrir-link-1' },
      });
      expect(aoAbrirPolitica).toHaveBeenCalledTimes(1);
      expect(aoAbrirTermos).not.toHaveBeenCalled();
    });

    it('ação desconhecida ou fora da lista não faz nada', async () => {
      const aoAbrirTermos = jest.fn();
      await render(<Aceite aoAbrirTermos={aoAbrirTermos} />);

      await fireEvent(caixa(), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
      await fireEvent(caixa(), 'accessibilityAction', {
        nativeEvent: { actionName: 'abrir-link-9' },
      });
      expect(aoAbrirTermos).not.toHaveBeenCalled();
    });

    it('rótulo só de texto não tem ações nem links', async () => {
      await render(
        <CaixaDeSelecao rotulo={['Guardei os códigos']} marcada={false} aoAlternar={jest.fn()} />,
      );

      expect(
        screen.getByRole('checkbox', { name: 'Guardei os códigos' }).props.accessibilityActions,
      ).toEqual([]);
      expect(screen.queryByRole('link')).toBeNull();
    });
  });

  describe('erro', () => {
    it('borda de perigo e mensagem em perigo, lida como dica da caixa', async () => {
      await render(<Aceite erro="Para criar a conta, aceite os Termos e a Política" />);

      expect(screen.getByText('Para criar a conta, aceite os Termos e a Política')).toHaveStyle({
        color: temaClaro.status.danger.fg,
      });
      expect(caixa().props.accessibilityHint).toBe(
        'Para criar a conta, aceite os Termos e a Política',
      );
      expect(screen.getByTestId('caixa-de-selecao-quadrado')).toHaveStyle({
        borderColor: temaClaro.status.danger.solid,
      });
    });

    it('a mensagem fica numa região viva educada que existe antes do erro', async () => {
      const { rerender } = await render(<Aceite />);
      await rerender(<Aceite erro="Aceite os Termos" />);

      expect(
        screen.getByText('Aceite os Termos').parent?.parent?.props.accessibilityLiveRegion,
      ).toBe('polite');
    });
  });

  describe('anúncio do erro só no iOS (D9)', () => {
    let anunciar: jest.SpyInstance;
    beforeEach(() => {
      anunciar = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
      anunciar.mockClear();
    });
    afterEach(() => jest.restoreAllMocks());

    it.each([
      ['ios', 1],
      ['android', 0],
    ] as const)('em %s anuncia à mão %i vez(es)', async (sistema, vezes) => {
      jest.replaceProperty(Platform, 'OS', sistema);
      const { rerender } = await render(<Aceite />);
      await rerender(<Aceite erro="Aceite os Termos" />);

      expect(anunciar).toHaveBeenCalledTimes(vezes);
    });
  });

  it('desabilitada: exposta como desabilitada, ignora o toque e os links', async () => {
    const aoAbrirTermos = jest.fn();
    await render(<Aceite desabilitada aoAbrirTermos={aoAbrirTermos} />);

    expect(caixa()).toBeDisabled();
    await fireEvent.press(caixa());
    expect(caixa()).not.toBeChecked();
    await fireEvent.press(screen.getByRole('link', { name: 'Termos de Uso' }));
    expect(aoAbrirTermos).not.toHaveBeenCalled();
  });

  it('foco: anel de 2 px `focus.ring` na linha', async () => {
    await render(<Aceite />);
    expect(caixa()).not.toHaveStyle({ outlineWidth: 2 });

    await fireEvent(caixa(), 'focus');
    expect(caixa()).toHaveStyle(anelDeFoco);
    await fireEvent(caixa(), 'blur');
    expect(caixa()).not.toHaveStyle({ outlineWidth: 2 });
  });

  it('o check não cresce com a fonte do sistema: cabe no quadrado de 24 px a 200% (D11)', async () => {
    await render(<Aceite />);
    await fireEvent.press(screen.getByRole('checkbox'));

    const marca = screen.getByText('✓', { includeHiddenElements: true });
    expect(marca.props.allowFontScaling).toBe(false);
  });
});
