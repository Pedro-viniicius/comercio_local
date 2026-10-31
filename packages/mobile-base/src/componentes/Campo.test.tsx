import { raio, tamanho, temaClaro } from '@bairrin/tokens';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createRef, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  type StyleProp,
  type TextInputInstance,
  type ViewStyle,
} from 'react-native';
import { Campo, type CampoProps } from './Campo.tsx';

type Parcial = Partial<CampoProps> & { inicial?: string };

/** Campo controlado, como as telas o usam. */
function Controlado({ inicial = '', aoMudarTexto, ...resto }: Parcial) {
  const [valor, setValor] = useState(inicial);
  return (
    <Campo
      rotulo="E-mail"
      valor={valor}
      aoMudarTexto={(texto) => {
        setValor(texto);
        aoMudarTexto?.(texto);
      }}
      {...resto}
    />
  );
}

describe('Campo', () => {
  it('mostra o rótulo acima, mostra o valor e avisa as mudanças', async () => {
    const aoMudarTexto = jest.fn();
    await render(<Controlado aoMudarTexto={aoMudarTexto} />);

    expect(screen.getByText('E-mail', { includeHiddenElements: true })).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'ana@exemplo.com.br');
    expect(aoMudarTexto).toHaveBeenCalledWith('ana@exemplo.com.br');
    expect(screen.getByLabelText('E-mail')).toHaveDisplayValue('ana@exemplo.com.br');
  });

  it('o nome acessível do campo é o rótulo, e o rótulo visível não se repete para o leitor de tela', async () => {
    await render(<Controlado />);

    expect(screen.getByLabelText('E-mail')).toBeOnTheScreen();
    expect(screen.queryByText('E-mail')).toBeNull();
  });

  it('o rótulo continua visível com valor preenchido e com placeholder (nunca só o placeholder)', async () => {
    await render(<Controlado placeholder="nome@exemplo.com" inicial="ana@exemplo.com" />);

    expect(screen.getByText('E-mail', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('nome@exemplo.com')).toBeOnTheScreen();
  });

  describe('tipos e preenchimento automático', () => {
    it('texto comum: sem dicas além do padrão; com `preenchimento="nome"`, nome e iniciais maiúsculas', async () => {
      const { rerender } = await render(<Controlado rotulo="Nome" tipo="texto" />);
      expect(screen.getByLabelText('Nome').props.autoComplete).toBeUndefined();

      await rerender(<Controlado rotulo="Nome" preenchimento="nome" />);
      const nome = screen.getByLabelText('Nome');
      expect(nome.props.autoComplete).toBe('name');
      expect(nome.props.textContentType).toBe('name');
      expect(nome.props.autoCapitalize).toBe('words');
    });

    it('e-mail: teclado de e-mail, sem maiúscula nem corretor, preenchimento de e-mail', async () => {
      await render(<Controlado tipo="email" />);

      const campo = screen.getByLabelText('E-mail');
      expect(campo.props.keyboardType).toBe('email-address');
      expect(campo.props.autoCapitalize).toBe('none');
      expect(campo.props.autoCorrect).toBe(false);
      expect(campo.props.autoComplete).toBe('email');
      expect(campo.props.textContentType).toBe('emailAddress');
    });

    it('telefone: teclado de telefone, preenchimento de telefone e máscara ao digitar e colar', async () => {
      const aoMudarTexto = jest.fn();
      await render(<Controlado rotulo="Celular" tipo="telefone" aoMudarTexto={aoMudarTexto} />);

      const campo = screen.getByLabelText('Celular');
      expect(campo.props.keyboardType).toBe('phone-pad');
      expect(campo.props.autoComplete).toBe('tel');
      expect(campo.props.textContentType).toBe('telephoneNumber');

      await fireEvent.changeText(campo, '35999991');
      expect(aoMudarTexto).toHaveBeenLastCalledWith('(35) 99999-1');
      await fireEvent.changeText(screen.getByLabelText('Celular'), '+55 35 99999-1234');
      expect(aoMudarTexto).toHaveBeenLastCalledWith('(35) 99999-1234');
      expect(screen.getByLabelText('Celular')).toHaveDisplayValue('(35) 99999-1234');
    });

    it('senha atual (login) e senha nova (cadastro) pedem o preenchimento certo ao gerenciador', async () => {
      const { rerender } = await render(<Controlado rotulo="Senha" tipo="senha" />);
      let campo = screen.getByLabelText('Senha');
      expect(campo.props.autoComplete).toBe('current-password');
      expect(campo.props.textContentType).toBe('password');

      await rerender(<Controlado rotulo="Senha" tipo="senha" preenchimento="senha-nova" />);
      campo = screen.getByLabelText('Senha');
      expect(campo.props.autoComplete).toBe('new-password');
      expect(campo.props.textContentType).toBe('newPassword');
      expect(campo.props.autoCapitalize).toBe('none');
      expect(campo.props.autoCorrect).toBe(false);
    });
  });

  describe('senha', () => {
    it('começa oculta; "Mostrar senha" revela e vira "Ocultar senha", anunciando o estado', async () => {
      await render(<Controlado rotulo="Senha" tipo="senha" inicial="segredo123" />);
      expect(screen.getByLabelText('Senha').props.secureTextEntry).toBe(true);

      await fireEvent.press(screen.getByRole('button', { name: 'Mostrar senha' }));
      expect(screen.getByLabelText('Senha').props.secureTextEntry).toBe(false);
      expect(screen.getByRole('status')).toHaveTextContent('Senha visível');
      expect(screen.getByRole('button', { name: 'Ocultar senha' })).toBeOnTheScreen();

      await fireEvent.press(screen.getByRole('button', { name: 'Ocultar senha' }));
      expect(screen.getByLabelText('Senha').props.secureTextEntry).toBe(true);
      expect(screen.getByRole('status')).toHaveTextContent('Senha oculta');
    });

    it('o botão tem alvo de 44×44 e texto visível que começa o nome acessível', async () => {
      await render(<Controlado rotulo="Senha" tipo="senha" />);

      const botao = screen.getByRole('button', { name: 'Mostrar senha' });
      expect(botao).toHaveStyle({ minWidth: tamanho.touch.min, minHeight: tamanho.touch.min });
      expect(screen.getByText('Mostrar')).toBeOnTheScreen();
    });

    it('a senha tem o botão, e o anúncio de estado fica vazio até a primeira troca', async () => {
      await render(<Controlado rotulo="Senha" tipo="senha" />);
      expect(screen.getByRole('status')).toHaveTextContent('');
      expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('e-mail e telefone não têm botão nem região de anúncio da senha', async () => {
      await render(<Controlado rotulo="Outro" tipo="email" />);

      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('o toque no "Mostrar senha" é ignorado com o campo desabilitado ou somente leitura', async () => {
      await render(<Controlado rotulo="Senha" tipo="senha" somenteLeitura />);

      await fireEvent.press(screen.getByRole('button', { name: 'Mostrar senha' }));
      expect(screen.getByLabelText('Senha').props.secureTextEntry).toBe(true);
    });
  });

  describe('ajuda e erro', () => {
    it('mostra a ajuda abaixo e a lê como dica do campo', async () => {
      await render(<Controlado ajuda="Usamos para a loja falar com você." />);

      expect(screen.getByText('Usamos para a loja falar com você.')).toBeOnTheScreen();
      expect(screen.getByLabelText('E-mail').props.accessibilityHint).toBe(
        'Usamos para a loja falar com você.',
      );
    });

    it('com erro: borda de perigo, mensagem em perigo, erro lido junto do campo e região viva educada', async () => {
      await render(<Controlado erro="Informe seu e-mail" ajuda="Ajuda" />);

      expect(screen.getByText('Informe seu e-mail')).toHaveStyle({
        color: temaClaro.status.danger.fg,
      });
      expect(screen.getByLabelText('E-mail').props.accessibilityHint).toBe(
        'Erro: Informe seu e-mail. Ajuda',
      );
      // O símbolo "!" reforça a cor para quem não a distingue e não é lido.
      expect(screen.queryByText('!')).toBeNull();
      expect(screen.getByText('!', { includeHiddenElements: true })).toBeOnTheScreen();
      expect(
        screen.getByText('Informe seu e-mail').parent?.parent?.props.accessibilityLiveRegion,
      ).toBe('polite');
    });

    it('a região do erro existe antes do erro, então o erro novo é anunciado', async () => {
      const { rerender } = await render(<Controlado />);
      expect(screen.queryByText('Informe seu e-mail')).toBeNull();

      await rerender(<Controlado erro="Informe seu e-mail" />);
      expect(screen.getByText('Informe seu e-mail')).toBeOnTheScreen();
    });

    it('sem erro, não sobra mensagem nem dica de erro', async () => {
      await render(<Controlado />);

      expect(screen.getByLabelText('E-mail').props.accessibilityHint).toBeUndefined();
    });
  });

  describe('anúncio do erro só no iOS (D9)', () => {
    let anunciar: jest.SpyInstance;
    beforeEach(() => {
      anunciar = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
      // O espião herda as chamadas que outros testes fizeram no mock global do React Native.
      anunciar.mockClear();
    });
    afterEach(() => {
      anunciar.mockRestore();
      jest.restoreAllMocks();
    });

    it('no iOS, o erro novo é anunciado à mão', async () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      const { rerender } = await render(<Controlado />);
      expect(anunciar).not.toHaveBeenCalled();

      await rerender(<Controlado erro="Informe seu e-mail" />);
      expect(anunciar).toHaveBeenCalledWith('Informe seu e-mail');
    });

    it('no Android, a região viva anuncia e a chamada manual não acontece', async () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      const { rerender } = await render(<Controlado />);
      await rerender(<Controlado erro="Informe seu e-mail" />);

      expect(anunciar).not.toHaveBeenCalled();
    });

    it('trocar a senha de visível para oculta é anunciado só no iOS', async () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      await render(<Controlado rotulo="Senha" tipo="senha" />);
      await fireEvent.press(screen.getByRole('button', { name: 'Mostrar senha' }));
      expect(anunciar).not.toHaveBeenCalled();

      jest.replaceProperty(Platform, 'OS', 'ios');
      await fireEvent.press(screen.getByRole('button', { name: 'Ocultar senha' }));
      expect(anunciar).toHaveBeenCalledWith('Senha oculta');
    });
  });

  describe('estados', () => {
    it('foco: borda de 2 px `focus.ring`, sem mudar a altura mínima; some ao sair', async () => {
      await render(<Controlado />);
      const caixa = () => screen.getByLabelText('E-mail').parent;
      expect(caixa()).toHaveStyle({ borderWidth: 1, borderColor: temaClaro.border.control });

      await fireEvent(screen.getByLabelText('E-mail'), 'focus');
      expect(caixa()).toHaveStyle({ borderWidth: 2, borderColor: temaClaro.focus.ring });
      expect(caixa()).toHaveStyle({ minHeight: tamanho.control.height.mobile });

      await fireEvent(screen.getByLabelText('E-mail'), 'blur');
      expect(caixa()).toHaveStyle({ borderWidth: 1 });
    });

    it('erro tem a borda de perigo; foco no campo com erro vale o foco', async () => {
      await render(<Controlado erro="Erro" />);
      const caixa = () => screen.getByLabelText('E-mail').parent;
      expect(caixa()).toHaveStyle({ borderColor: temaClaro.status.danger.solid });

      await fireEvent(screen.getByLabelText('E-mail'), 'focus');
      expect(caixa()).toHaveStyle({ borderColor: temaClaro.focus.ring });
    });

    it('desabilitado: fundo e texto de desabilitado, não editável, exposto como desabilitado', async () => {
      await render(<Controlado desabilitado inicial="ana" />);
      const campo = screen.getByLabelText('E-mail');

      expect(campo.props.editable).toBe(false);
      expect(campo).toBeDisabled();
      expect(campo).toHaveStyle({ color: temaClaro.text.tertiary });
      expect(campo.parent).toHaveStyle({ backgroundColor: temaClaro.bg.subtle });
    });

    it('somente leitura: sem borda, fundo `bg.subtle`, não editável e sem anel de foco', async () => {
      await render(<Controlado somenteLeitura inicial="ana" />);
      const campo = screen.getByLabelText('E-mail');

      expect(campo.props.editable).toBe(false);
      expect(campo.parent).toHaveStyle({
        backgroundColor: temaClaro.bg.subtle,
        borderColor: 'transparent',
      });
      await fireEvent(campo, 'focus');
      expect(screen.getByLabelText('E-mail').parent).toHaveStyle({ borderWidth: 1 });
    });

    it('altura mínima de 48 e raio de campo; sem altura fixa para o texto ampliado', async () => {
      await render(<Controlado />);
      const caixa = screen.getByLabelText('E-mail').parent;

      expect(caixa).toHaveStyle({ minHeight: 48, borderRadius: raio.md });
      expect(
        StyleSheet.flatten(caixa?.props.style as StyleProp<ViewStyle>)?.height,
      ).toBeUndefined();
    });
  });

  it('Enter do teclado chama aoEnviar, com a ação do teclado pedida', async () => {
    const aoEnviar = jest.fn();
    await render(<Controlado aoEnviar={aoEnviar} acaoDoTeclado="next" />);

    const campo = screen.getByLabelText('E-mail');
    expect(campo.props.returnKeyType).toBe('next');
    await fireEvent(campo, 'submitEditing');
    expect(aoEnviar).toHaveBeenCalledTimes(1);
  });

  it('a tela pode pôr o foco no campo pelo ref', async () => {
    const ref = createRef<TextInputInstance>();
    await render(<Campo ref={ref} rotulo="E-mail" valor="" aoMudarTexto={jest.fn()} />);

    // O ref chega ao `TextInput` de verdade: é por ele que a tela põe o foco no primeiro erro.
    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.focus).toBe('function');
    await act(() => {
      ref.current?.focus();
    });
  });
});
