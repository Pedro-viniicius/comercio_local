import {
  ErroCancelado,
  ErroDeApi,
  ErroRespostaInvalida,
  ErroSemConexao,
  type ClienteApi,
} from '@bairrin/cliente-api';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { textos } from '../textos/pt-BR.ts';
import { EstadoDaApi } from './EstadoDaApi.tsx';

const t = textos.estadoDaApi;

type ClienteFalso = Pick<ClienteApi, 'consultarSaude'>;

const clienteQue = (consultarSaude: ClienteFalso['consultarSaude']): ClienteFalso => ({
  consultarSaude,
});

describe('EstadoDaApi', () => {
  it('mostra "API disponível" quando a API responde', async () => {
    const consultarSaude = jest.fn(() => Promise.resolve({ status: 'ok' as const }));
    await render(<EstadoDaApi cliente={clienteQue(consultarSaude)} />);

    expect(await screen.findByText('API disponível')).toBeOnTheScreen();
    expect(screen.getByRole('status')).toHaveTextContent(t.disponivel);
    expect(consultarSaude).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a região de status existe desde o início e diz que está verificando', async () => {
    const consultarSaude = jest.fn(() => new Promise<never>(() => undefined));
    await render(<EstadoDaApi cliente={clienteQue(consultarSaude)} />);

    expect(screen.getByRole('status')).toHaveTextContent(t.verificando);
    expect(screen.getByRole('heading')).toHaveTextContent(t.secao);
  });

  it.each(['rede', 'tempo_esgotado'] as const)(
    'mostra "Sem conexão" com ErroSemConexao (%s) e deixa tentar de novo',
    async (motivo) => {
      const consultarSaude = jest
        .fn<ReturnType<ClienteFalso['consultarSaude']>, []>()
        .mockRejectedValueOnce(new ErroSemConexao(motivo))
        .mockResolvedValueOnce({ status: 'ok' });
      await render(<EstadoDaApi cliente={clienteQue(consultarSaude)} />);

      expect(await screen.findByText('Sem conexão')).toBeOnTheScreen();
      expect(screen.getByText(t.semConexaoDica)).toBeOnTheScreen();

      await fireEvent.press(screen.getByRole('button', { name: t.tentarDeNovo }));
      expect(await screen.findByText('API disponível')).toBeOnTheScreen();
      expect(consultarSaude).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('button')).toBeNull();
    },
  );

  it('mantém o botão na tela e ignora o toque enquanto verifica de novo', async () => {
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
    await render(<EstadoDaApi cliente={clienteQue(consultarSaude)} />);

    await fireEvent.press(await screen.findByRole('button', { name: t.tentarDeNovo }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t.verificando));

    const durante = screen.getByRole('button', { name: t.verificandoBotao });
    expect(durante).toBeDisabled();
    await fireEvent.press(durante);
    expect(consultarSaude).toHaveBeenCalledTimes(2);

    resolver?.();
    expect(await screen.findByText('API disponível')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('mostra o texto de erro da API com ErroDeApi, sem "Sem conexão"', async () => {
    const erro = new ErroDeApi({ status: 503 });
    await render(<EstadoDaApi cliente={clienteQue(() => Promise.reject(erro))} />);

    expect(await screen.findByText(t.erroDaApi)).toBeOnTheScreen();
    expect(screen.queryByText('Sem conexão')).toBeNull();
    expect(screen.getByRole('button', { name: t.tentarDeNovo })).toBeOnTheScreen();
  });

  it('trata resposta fora do contrato como erro da API', async () => {
    await render(
      <EstadoDaApi cliente={clienteQue(() => Promise.reject(new ErroRespostaInvalida(200)))} />,
    );

    expect(await screen.findByText(t.erroDaApi)).toBeOnTheScreen();
  });

  it('não vaza detalhe do erro na tela', async () => {
    const erro = new Error('connect ECONNREFUSED 10.0.0.1:5432 usuario=maria');
    await render(<EstadoDaApi cliente={clienteQue(() => Promise.reject(erro))} />);

    expect(await screen.findByText(t.erroDaApi)).toBeOnTheScreen();
    expect(screen.queryByText(/ECONNREFUSED|maria/)).toBeNull();
  });

  it('mostra aviso de configuração, sem chamar a API, quando falta EXPO_PUBLIC_API_URL', async () => {
    await render(<EstadoDaApi cliente={null} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(new RegExp(t.semConfiguracao));
    expect(status).not.toHaveTextContent('EXPO_PUBLIC_API_URL');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('cancela a consulta ao desmontar e não atualiza a tela depois', async () => {
    let sinal: { aborted: boolean } | undefined;
    let rejeitar: ((erro: Error) => void) | undefined;
    const consultarSaude: ClienteFalso['consultarSaude'] = (opcoes) => {
      sinal = opcoes?.sinal;
      return new Promise((_resolver, rejeicao) => {
        rejeitar = rejeicao;
      });
    };
    const erroNoConsole = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { unmount } = await render(<EstadoDaApi cliente={clienteQue(consultarSaude)} />);
    await unmount();
    expect(sinal?.aborted).toBe(true);

    // A rejeição por cancelamento chega depois da desmontagem e é ignorada, sem aviso do React.
    await act(async () => {
      rejeitar?.(new ErroCancelado());
      await Promise.resolve();
    });
    expect(erroNoConsole).not.toHaveBeenCalled();
    erroNoConsole.mockRestore();
  });
});
