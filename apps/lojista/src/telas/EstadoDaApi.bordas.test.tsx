// Bordas da tela de estado da API (QA, M1): o que o teste principal não amarra — dicas de erro e de
// configuração, nova tentativa que volta a falhar, troca de cliente com consulta em andamento e
// acessibilidade (região de status anunciada, símbolo escondido do leitor de tela).
import { ErroCancelado, ErroDeApi, ErroSemConexao, type ClienteApi } from '@bairrin/cliente-api';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { temaClaro } from '@bairrin/tokens';
import { textos } from '../textos/pt-BR.ts';
import { EstadoDaApi } from './EstadoDaApi.tsx';

const t = textos.estadoDaApi;

type ClienteFalso = Pick<ClienteApi, 'consultarSaude'>;

describe('EstadoDaApi, bordas', () => {
  it('mostra a dica do erro da API junto do texto, com botão para tentar de novo', async () => {
    const cliente: ClienteFalso = {
      consultarSaude: () => Promise.reject(new ErroDeApi({ status: 500 })),
    };
    await render(<EstadoDaApi cliente={cliente} />);

    expect(await screen.findByText(t.erroDaApi)).toBeOnTheScreen();
    expect(screen.getByText(t.erroDaApiDica)).toBeOnTheScreen();
  });

  it('mostra a dica de configuração junto do aviso, sem botão', async () => {
    await render(<EstadoDaApi cliente={null} />);

    expect(screen.getByText(t.semConfiguracao)).toBeOnTheScreen();
    expect(screen.getByText(t.semConfiguracaoDica)).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('volta a "Sem conexão" quando a nova tentativa também falha, e a dica some ao verificar', async () => {
    let falhar: ((erro: Error) => void) | undefined;
    const consultarSaude = jest
      .fn<ReturnType<ClienteFalso['consultarSaude']>, []>()
      .mockRejectedValueOnce(new ErroSemConexao('rede'))
      .mockImplementationOnce(
        () =>
          new Promise((_ok, rejeicao) => {
            falhar = rejeicao;
          }),
      );
    await render(<EstadoDaApi cliente={{ consultarSaude }} />);

    await fireEvent.press(await screen.findByRole('button', { name: t.tentarDeNovo }));
    expect(screen.getByRole('status')).toHaveTextContent(t.verificando);
    expect(screen.queryByText(t.semConexaoDica)).toBeNull();

    await act(async () => {
      falhar?.(new ErroSemConexao('tempo_esgotado'));
      await Promise.resolve();
    });
    expect(await screen.findByText('Sem conexão')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: t.tentarDeNovo })).toBeOnTheScreen();
    expect(consultarSaude).toHaveBeenCalledTimes(2);
  });

  it('passa de "Sem conexão" para erro da API quando a nova tentativa recebe erro do servidor', async () => {
    const consultarSaude = jest
      .fn<ReturnType<ClienteFalso['consultarSaude']>, []>()
      .mockRejectedValueOnce(new ErroSemConexao('rede'))
      .mockRejectedValueOnce(new ErroDeApi({ status: 502 }));
    await render(<EstadoDaApi cliente={{ consultarSaude }} />);

    await fireEvent.press(await screen.findByRole('button', { name: t.tentarDeNovo }));

    expect(await screen.findByText(t.erroDaApi)).toBeOnTheScreen();
    expect(screen.queryByText('Sem conexão')).toBeNull();
  });

  it('ao trocar o cliente, cancela a consulta antiga, consulta o novo e ignora o cancelamento do antigo', async () => {
    let sinalAntigo: { aborted: boolean } | undefined;
    let cancelarAntigo: ((erro: Error) => void) | undefined;
    const antigo: ClienteFalso = {
      consultarSaude: (opcoes) => {
        sinalAntigo = opcoes?.sinal;
        return new Promise((_ok, rejeicao) => {
          cancelarAntigo = rejeicao;
        });
      },
    };
    let resolverNovo: (() => void) | undefined;
    const consultarNovo = jest.fn<ReturnType<ClienteFalso['consultarSaude']>, []>(
      () =>
        new Promise((ok) => {
          resolverNovo = () => ok({ status: 'ok' });
        }),
    );

    const { rerender } = await render(<EstadoDaApi cliente={antigo} />);
    await rerender(<EstadoDaApi cliente={{ consultarSaude: consultarNovo }} />);

    expect(sinalAntigo?.aborted).toBe(true);
    expect(consultarNovo).toHaveBeenCalledTimes(1);

    // O cancelamento da consulta antiga chega com a nova ainda em andamento: não pode virar erro.
    await act(async () => {
      cancelarAntigo?.(new ErroCancelado());
      await Promise.resolve();
    });
    expect(screen.getByRole('status')).toHaveTextContent(t.verificando);
    expect(screen.queryByText(t.erroDaApi)).toBeNull();

    resolverNovo?.();
    expect(await screen.findByText(t.disponivel)).toBeOnTheScreen();
  });

  it('anuncia a mudança de estado: região de status educada e símbolo escondido do leitor de tela', async () => {
    const cliente: ClienteFalso = { consultarSaude: () => Promise.resolve({ status: 'ok' }) };
    await render(<EstadoDaApi cliente={cliente} />);
    await screen.findByText(t.disponivel);

    expect(screen.getByRole('status').props.accessibilityLiveRegion).toBe('polite');
    // O símbolo (✓) só reforça o texto para quem não distingue cor: o leitor de tela não o lê.
    expect(screen.queryByText('✓')).toBeNull();
    expect(screen.getByText('✓', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  describe('anúncio no iOS e botão ocupado', () => {
    let anunciar: jest.SpyInstance;
    beforeEach(() => {
      anunciar = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
    });
    afterEach(() => anunciar.mockRestore());

    it('anuncia o resultado, sem anunciar o "Verificando…" inicial', async () => {
      const cliente: ClienteFalso = { consultarSaude: () => Promise.resolve({ status: 'ok' }) };
      await render(<EstadoDaApi cliente={cliente} />);
      expect(anunciar).not.toHaveBeenCalledWith(t.verificando);
      await screen.findByText(t.disponivel);
      expect(anunciar).toHaveBeenCalledWith(t.disponivel);
    });

    it('anuncia texto e dica do erro e da falta de configuração', async () => {
      const cliente: ClienteFalso = {
        consultarSaude: () => Promise.reject(new ErroSemConexao('rede')),
      };
      await render(<EstadoDaApi cliente={cliente} />);
      await screen.findByText(t.semConexao);
      expect(anunciar).toHaveBeenCalledWith(`${t.semConexao}. ${t.semConexaoDica}`);
      expect(anunciar).toHaveBeenCalledTimes(1);

      await render(<EstadoDaApi cliente={null} />);
      expect(anunciar).toHaveBeenCalledWith(`${t.semConfiguracao}. ${t.semConfiguracaoDica}`);
    });

    it('enquanto verifica de novo, o botão fica ocupado, com tokens de desabilitado, e não anuncia', async () => {
      let resolver: (() => void) | undefined;
      const consultarSaude = jest
        .fn<ReturnType<ClienteFalso['consultarSaude']>, []>()
        .mockRejectedValueOnce(new ErroSemConexao('rede'))
        .mockImplementationOnce(
          () =>
            new Promise((ok) => {
              resolver = () => ok({ status: 'ok' });
            }),
        );
      await render(<EstadoDaApi cliente={{ consultarSaude }} />);
      await fireEvent.press(await screen.findByRole('button', { name: t.tentarDeNovo }));
      anunciar.mockClear();

      const botao = screen.getByRole('button', { name: t.verificandoBotao });
      expect(botao).toBeBusy();
      expect(botao).toBeDisabled();
      expect(botao).toHaveStyle({ backgroundColor: temaClaro.bg.subtle });
      expect(screen.getByText(t.verificandoBotao)).toHaveStyle({
        color: temaClaro.text.secondary,
      });
      expect(anunciar).not.toHaveBeenCalled();

      await act(async () => {
        resolver?.();
        await Promise.resolve();
      });
      expect(anunciar).toHaveBeenCalledWith(t.disponivel);
    });

    it('anuncia texto e dica quando a API responde com erro', async () => {
      const cliente: ClienteFalso = {
        consultarSaude: () => Promise.reject(new ErroDeApi({ status: 503 })),
      };
      await render(<EstadoDaApi cliente={cliente} />);
      await screen.findByText(t.erroDaApi);

      expect(anunciar).toHaveBeenCalledWith(`${t.erroDaApi}. ${t.erroDaApiDica}`);
      expect(anunciar).toHaveBeenCalledTimes(1);
    });

    it('anuncia de novo quando a nova tentativa termina com o mesmo resultado', async () => {
      const consultarSaude = jest
        .fn<ReturnType<ClienteFalso['consultarSaude']>, []>()
        .mockRejectedValue(new ErroSemConexao('rede'));
      await render(<EstadoDaApi cliente={{ consultarSaude }} />);
      await fireEvent.press(await screen.findByRole('button', { name: t.tentarDeNovo }));
      await screen.findByRole('button', { name: t.tentarDeNovo });

      // Sem o segundo anúncio, quem usa VoiceOver aperta o botão e não ouve resposta nenhuma.
      expect(consultarSaude).toHaveBeenCalledTimes(2);
      expect(anunciar).toHaveBeenCalledTimes(2);
      expect(anunciar).toHaveBeenNthCalledWith(1, `${t.semConexao}. ${t.semConexaoDica}`);
      expect(anunciar).toHaveBeenNthCalledWith(2, `${t.semConexao}. ${t.semConexaoDica}`);
    });

    it('não anuncia nada se a tela sai antes da resposta', async () => {
      let resolver: (() => void) | undefined;
      const cliente: ClienteFalso = {
        consultarSaude: () =>
          new Promise((ok) => {
            resolver = () => ok({ status: 'ok' });
          }),
      };
      const { unmount } = await render(<EstadoDaApi cliente={cliente} />);
      await unmount();
      await act(async () => {
        resolver?.();
        await Promise.resolve();
      });

      expect(anunciar).not.toHaveBeenCalled();
    });

    it('apertar o botão ocupado não dispara outra consulta', async () => {
      const consultarSaude = jest
        .fn<ReturnType<ClienteFalso['consultarSaude']>, []>()
        .mockRejectedValueOnce(new ErroSemConexao('rede'))
        .mockImplementation(() => new Promise(() => undefined));
      await render(<EstadoDaApi cliente={{ consultarSaude }} />);
      await fireEvent.press(await screen.findByRole('button', { name: t.tentarDeNovo }));
      expect(consultarSaude).toHaveBeenCalledTimes(2);

      await fireEvent.press(screen.getByRole('button', { name: t.verificandoBotao }));
      await fireEvent.press(screen.getByRole('button', { name: t.verificandoBotao }));

      expect(consultarSaude).toHaveBeenCalledTimes(2);
    });

    it('fora da verificação o botão não é marcado como ocupado nem desabilitado e usa a cor de ação', async () => {
      const cliente: ClienteFalso = {
        consultarSaude: () => Promise.reject(new ErroSemConexao('rede')),
      };
      await render(<EstadoDaApi cliente={cliente} />);
      const botao = await screen.findByRole('button', { name: t.tentarDeNovo });

      expect(botao).not.toBeBusy();
      expect(botao).toBeEnabled();
      expect(botao).toHaveStyle({ backgroundColor: temaClaro.action.primary });
      expect(screen.getByText(t.tentarDeNovo)).toHaveStyle({ color: temaClaro.text.onAction });
    });

    it('só o botão livre muda de cor ao ser apertado: o ocupado mantém a cor de desabilitado', async () => {
      const consultarSaude = jest
        .fn<ReturnType<ClienteFalso['consultarSaude']>, []>()
        .mockRejectedValueOnce(new ErroSemConexao('rede'))
        .mockImplementation(() => new Promise(() => undefined));
      await render(<EstadoDaApi cliente={{ consultarSaude }} />);
      // O Pressable sinaliza "pressionado" pelo respondedor; o `fireEvent.press` não passa por ele.
      const evento = {
        nativeEvent: { touches: [], changedTouches: [], timestamp: 1 },
        persist() {},
      };
      const apertar = (nome: string) =>
        act(() => {
          const aoApertar = screen.getByRole('button', { name: nome }).props.onResponderGrant as (
            evento: unknown,
          ) => void;
          aoApertar(evento);
        });

      await apertar(t.tentarDeNovo);
      expect(screen.getByRole('button', { name: t.tentarDeNovo })).toHaveStyle({
        backgroundColor: temaClaro.action.primaryPressed,
      });

      await fireEvent.press(screen.getByRole('button', { name: t.tentarDeNovo }));
      await apertar(t.verificandoBotao);
      expect(screen.getByRole('button', { name: t.verificandoBotao })).toHaveStyle({
        backgroundColor: temaClaro.bg.subtle,
      });
    });
  });
});
