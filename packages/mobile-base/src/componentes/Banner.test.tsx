import { tamanho, temaClaro } from '@bairrin/tokens';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';
import { Banner, type TomDoBanner } from './Banner.tsx';
import { anelDeFoco } from './estilos.ts';

const tons: [TomDoBanner, { bg: string; fg: string }, string][] = [
  ['informativo', temaClaro.status.info, 'i'],
  ['sucesso', temaClaro.status.success, '✓'],
  ['aviso', temaClaro.status.warning, '!'],
  ['erro', temaClaro.status.danger, '✕'],
];

describe('Banner', () => {
  it.each(tons)(
    'tom %s: fundo e texto do tom semântico, com símbolo escondido do leitor de tela',
    async (tom, cores, simbolo) => {
      await render(<Banner tom={tom} mensagem="Mensagem do banner" testID="banner" />);

      expect(screen.getByTestId('banner')).toHaveStyle({ backgroundColor: cores.bg });
      expect(screen.getByText('Mensagem do banner')).toHaveStyle({ color: cores.fg });
      // A cor nunca é o único sinal: o símbolo reforça, mas não é lido.
      expect(screen.queryByText(simbolo)).toBeNull();
      expect(screen.getByText(simbolo, { includeHiddenElements: true })).toHaveStyle({
        color: cores.fg,
      });
    },
  );

  it('o erro é assertivo (`role="alert"`) e os outros tons são educados (`role="status"`)', async () => {
    const { rerender } = await render(<Banner tom="erro" mensagem="Algo deu errado" />);
    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Algo deu errado');
    expect(alerta.props.accessibilityLiveRegion).toBe('assertive');
    expect(screen.queryByRole('status')).toBeNull();

    for (const tom of ['informativo', 'sucesso', 'aviso'] as const) {
      await rerender(<Banner tom={tom} mensagem="Aviso" />);
      expect(screen.getByRole('status').props.accessibilityLiveRegion).toBe('polite');
      expect(screen.queryByRole('alert')).toBeNull();
    }
  });

  it('mostra título curto em negrito acima da mensagem, e ambos entram na região viva', async () => {
    await render(<Banner tom="aviso" titulo="Atenção" mensagem="Você tem pedido em andamento." />);

    expect(screen.getByText('Atenção')).toHaveStyle({ fontWeight: '600' });
    expect(screen.getByRole('status')).toHaveTextContent(/Atenção/);
    expect(screen.getByRole('status')).toHaveTextContent(/Você tem pedido em andamento\./);
  });

  it('sem `aoFechar` não há botão; com ele, "Fechar" fecha e o nome acessível cita o aviso', async () => {
    const aoFechar = jest.fn();
    const { rerender } = await render(<Banner tom="informativo" mensagem="Texto" />);
    expect(screen.queryByRole('button')).toBeNull();

    await rerender(<Banner tom="informativo" mensagem="Texto" aoFechar={aoFechar} />);
    const fechar = screen.getByRole('button', { name: 'Fechar aviso' });
    expect(screen.getByText('Fechar')).toBeOnTheScreen();
    await fireEvent.press(fechar);
    expect(aoFechar).toHaveBeenCalledTimes(1);

    await rerender(
      <Banner tom="informativo" titulo="Sessão" mensagem="Texto" aoFechar={aoFechar} />,
    );
    expect(screen.getByRole('button', { name: 'Fechar aviso: Sessão' })).toBeOnTheScreen();
  });

  it('a ação opcional chama o callback, e os botões não ficam dentro da região viva', async () => {
    const aoPressionar = jest.fn();
    await render(
      <Banner
        tom="erro"
        mensagem="Sem conexão"
        acao={{ rotulo: 'Tentar de novo', aoPressionar }}
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(aoPressionar).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/Tentar de novo/);
  });

  it('os botões têm alvo de 44 e foco visível (D8)', async () => {
    await render(
      <Banner
        tom="informativo"
        mensagem="Texto"
        acao={{ rotulo: 'Saiba mais', aoPressionar: jest.fn() }}
        aoFechar={jest.fn()}
      />,
    );

    const acao = screen.getByRole('button', { name: 'Saiba mais' });
    expect(acao).toHaveStyle({ minHeight: tamanho.touch.min });
    await fireEvent(acao, 'focus');
    expect(screen.getByRole('button', { name: 'Saiba mais' })).toHaveStyle(anelDeFoco);
    expect(screen.getByRole('button', { name: 'Fechar aviso' })).not.toHaveStyle({
      outlineWidth: 2,
    });
  });

  it('mensagem longa quebra em linhas, sem número fixo', async () => {
    await render(<Banner tom="informativo" mensagem={'palavra '.repeat(80)} />);

    expect(screen.getByRole('status').children.length).toBeGreaterThan(0);
    expect(screen.getByText(/palavra/).props.numberOfLines).toBeUndefined();
  });

  describe('anúncio só no iOS (D9)', () => {
    let anunciar: jest.SpyInstance;
    beforeEach(() => {
      anunciar = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
      anunciar.mockClear();
    });
    afterEach(() => jest.restoreAllMocks());

    it('no iOS anuncia título e mensagem ao aparecer, e de novo quando o texto muda', async () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      const { rerender } = await render(<Banner tom="erro" titulo="Erro" mensagem="Primeiro" />);
      expect(anunciar).toHaveBeenCalledWith('Erro. Primeiro');

      await rerender(<Banner tom="erro" titulo="Erro" mensagem="Segundo" />);
      expect(anunciar).toHaveBeenLastCalledWith('Erro. Segundo');
      expect(anunciar).toHaveBeenCalledTimes(2);
    });

    it('sem título anuncia só a mensagem', async () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      await render(<Banner tom="sucesso" mensagem="Pedido recebido" />);

      expect(anunciar).toHaveBeenCalledWith('Pedido recebido');
    });

    it('no Android a região viva anuncia e a chamada manual não acontece', async () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      await render(<Banner tom="erro" mensagem="Algo deu errado" />);

      expect(anunciar).not.toHaveBeenCalled();
      expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('assertive');
    });
  });
});
