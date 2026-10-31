import { raio, temaClaro } from '@bairrin/tokens';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { CampoDeCodigo, digitosDoCodigo, type CampoDeCodigoProps } from './CampoDeCodigo.tsx';

function Controlado({
  inicial = '',
  aoMudarTexto,
  ...resto
}: Partial<CampoDeCodigoProps> & { inicial?: string }) {
  const [valor, setValor] = useState(inicial);
  return (
    <CampoDeCodigo
      testID="codigo"
      valor={valor}
      aoMudarTexto={(texto) => {
        setValor(texto);
        aoMudarTexto?.(texto);
      }}
      {...resto}
    />
  );
}

const campo = () => screen.getByLabelText('Código de 6 dígitos');
const casa = (indice: number) =>
  screen.getByTestId(`codigo-casa-${indice}`, { includeHiddenElements: true });

describe('digitosDoCodigo', () => {
  it.each([
    ['123456', '123456'],
    ['123 456', '123456'],
    ['123-456', '123456'],
    ['  12a34b56  ', '123456'],
    ['1234567890', '123456'],
    ['', ''],
    ['abc', ''],
  ])('%j → %j', (entrada, esperado) => {
    expect(digitosDoCodigo(entrada)).toBe(esperado);
  });
});

describe('CampoDeCodigo', () => {
  it('é um campo só, numérico, com o rótulo "Código de 6 dígitos" como nome acessível', async () => {
    await render(<Controlado />);

    expect(campo()).toBeOnTheScreen();
    expect(screen.getAllByLabelText('Código de 6 dígitos')).toHaveLength(1);
    expect(campo().props.keyboardType).toBe('number-pad');
    expect(campo().props.inputMode).toBe('numeric');
  });

  it('liga o preenchimento automático de código de uso único (Android e iOS)', async () => {
    await render(<Controlado />);

    expect(campo().props.autoComplete).toBe('one-time-code');
    expect(campo().props.textContentType).toBe('oneTimeCode');
  });

  it('mostra o rótulo visível e as seis casas, escondidas do leitor de tela', async () => {
    await render(<Controlado />);

    expect(
      screen.getByText('Código de 6 dígitos', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    for (let indice = 0; indice < 6; indice += 1) expect(casa(indice)).toBeOnTheScreen();
    expect(screen.queryByTestId('codigo-casa-6', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('codigo-casa-0')).toBeNull();
  });

  it('desenha cada dígito na sua casa, com algarismos tabulares', async () => {
    await render(<Controlado inicial="1234" />);

    const digitos = [0, 1, 2, 3, 4, 5].map((indice) => casa(indice).children[0]);
    expect(digitos).toHaveLength(6);
    expect(screen.getByText('1', { includeHiddenElements: true })).toHaveStyle({
      fontVariant: ['tabular-nums'],
      fontSize: 22,
      lineHeight: 28,
    });
    expect(screen.getByText('4', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(casa(4)).toHaveTextContent('');
  });

  it('só aceita dígitos: letras somem e o excesso é cortado', async () => {
    const aoMudarTexto = jest.fn();
    await render(<Controlado aoMudarTexto={aoMudarTexto} />);

    await fireEvent.changeText(campo(), '12ab34');
    expect(aoMudarTexto).toHaveBeenLastCalledWith('1234');
    expect(campo()).toHaveDisplayValue('1234');

    await fireEvent.changeText(campo(), '123456789');
    expect(aoMudarTexto).toHaveBeenLastCalledWith('123456');
  });

  describe('aoCompletar', () => {
    it('chama ao chegar a 6 dígitos digitados, uma vez', async () => {
      const aoCompletar = jest.fn();
      await render(<Controlado aoCompletar={aoCompletar} />);

      await fireEvent.changeText(campo(), '12345');
      expect(aoCompletar).not.toHaveBeenCalled();
      await fireEvent.changeText(campo(), '123456');
      expect(aoCompletar).toHaveBeenCalledTimes(1);
      expect(aoCompletar).toHaveBeenCalledWith('123456');
    });

    it('chama também ao colar o código inteiro, com espaço ou hífen', async () => {
      const aoCompletar = jest.fn();
      await render(<Controlado aoCompletar={aoCompletar} />);

      await fireEvent.changeText(campo(), '123 456');
      expect(aoCompletar).toHaveBeenCalledWith('123456');
    });

    it('não chama de novo ao reeditar um código que já estava completo', async () => {
      const aoCompletar = jest.fn();
      await render(<Controlado inicial="123456" aoCompletar={aoCompletar} />);

      await fireEvent.changeText(campo(), '1234567');
      expect(aoCompletar).not.toHaveBeenCalled();
    });

    it('chama de novo se a pessoa apagar um dígito e completar outra vez', async () => {
      const aoCompletar = jest.fn();
      await render(<Controlado aoCompletar={aoCompletar} />);

      await fireEvent.changeText(campo(), '123456');
      await fireEvent.changeText(campo(), '12345');
      await fireEvent.changeText(campo(), '123450');
      expect(aoCompletar).toHaveBeenCalledTimes(2);
      expect(aoCompletar).toHaveBeenLastCalledWith('123450');
    });

    it('colar texto sem 6 dígitos não completa', async () => {
      const aoCompletar = jest.fn();
      await render(<Controlado aoCompletar={aoCompletar} />);

      await fireEvent.changeText(campo(), 'abc 12');
      expect(aoCompletar).not.toHaveBeenCalled();
    });
  });

  describe('foco e estados', () => {
    it('em foco, a casa do próximo dígito ganha borda de 2 px `focus.ring`; as outras não', async () => {
      await render(<Controlado inicial="12" />);
      expect(casa(2)).toHaveStyle({ borderWidth: 1 });

      await fireEvent(campo(), 'focus');
      expect(casa(2)).toHaveStyle({ borderWidth: 2, borderColor: temaClaro.focus.ring });
      expect(casa(0)).toHaveStyle({ borderWidth: 1 });
      expect(casa(3)).toHaveStyle({ borderWidth: 1 });

      await fireEvent(campo(), 'blur');
      expect(casa(2)).toHaveStyle({ borderWidth: 1 });
    });

    it('com 6 dígitos, o foco fica na última casa', async () => {
      await render(<Controlado inicial="123456" />);

      await fireEvent(campo(), 'focus');
      expect(casa(5)).toHaveStyle({ borderWidth: 2 });
    });

    it('com erro: casas com borda de perigo e mensagem de perigo lida como dica', async () => {
      await render(<Controlado erro="Código inválido ou expirado. Confira ou peça um novo." />);

      expect(casa(0)).toHaveStyle({ borderColor: temaClaro.status.danger.solid });
      expect(screen.getByText('Código inválido ou expirado. Confira ou peça um novo.')).toHaveStyle(
        {
          color: temaClaro.status.danger.fg,
        },
      );
      expect(campo().props.accessibilityHint).toBe(
        'Erro: Código inválido ou expirado. Confira ou peça um novo.',
      );
    });

    it('desabilitado: casas apagadas, não editável e sem anel de foco', async () => {
      await render(<Controlado desabilitado />);

      expect(campo().props.editable).toBe(false);
      expect(campo()).toBeDisabled();
      expect(casa(0)).toHaveStyle({ backgroundColor: temaClaro.bg.subtle, borderRadius: raio.md });
      await fireEvent(campo(), 'focus');
      expect(casa(0)).toHaveStyle({ borderWidth: 1 });
    });

    it('rótulo e ajuda personalizados', async () => {
      await render(<Controlado rotulo="Código do e-mail" ajuda="Vale por 30 minutos." />);

      expect(screen.getByLabelText('Código do e-mail')).toBeOnTheScreen();
      expect(screen.getByText('Vale por 30 minutos.')).toBeOnTheScreen();
      expect(screen.getByLabelText('Código do e-mail').props.accessibilityHint).toBe(
        'Vale por 30 minutos.',
      );
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
      const { rerender } = await render(<Controlado />);
      await rerender(<Controlado erro="Código inválido" />);

      expect(anunciar).toHaveBeenCalledTimes(vezes);
    });
  });
});
