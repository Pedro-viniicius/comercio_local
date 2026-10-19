import {
  ErroCancelado,
  ErroDeApi,
  ErroRespostaInvalida,
  ErroSemConexao,
  type ClienteApi,
} from '@bairrin/cliente-api';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EstadoDaApi } from './EstadoDaApi.tsx';
import { textos } from './textos/pt-BR.ts';

const t = textos.estadoDaApi;

type ClienteFalso = Pick<ClienteApi, 'consultarSaude'>;

const clienteQue = (consultarSaude: ClienteFalso['consultarSaude']): ClienteFalso => ({
  consultarSaude,
});

afterEach(cleanup);

describe('EstadoDaApi', () => {
  it('mostra "API disponível" quando a API responde', async () => {
    const consultarSaude = vi.fn(() => Promise.resolve({ status: 'ok' as const }));
    render(<EstadoDaApi cliente={clienteQue(consultarSaude)} />);

    // Antes da resposta, a região de status já existe e diz que está verificando.
    expect(screen.getByRole('status').textContent).toContain(t.verificando);

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('API disponível'));
    expect(consultarSaude).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each(['rede', 'tempo_esgotado'] as const)(
    'mostra "Sem conexão" com ErroSemConexao (%s) e deixa tentar de novo',
    async (motivo) => {
      const consultarSaude = vi
        .fn<ClienteFalso['consultarSaude']>()
        .mockRejectedValueOnce(new ErroSemConexao(motivo))
        .mockResolvedValueOnce({ status: 'ok' });
      render(<EstadoDaApi cliente={clienteQue(consultarSaude)} />);

      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Sem conexão'));

      fireEvent.click(screen.getByRole('button', { name: t.tentarDeNovo }));
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toContain('API disponível'),
      );
      expect(consultarSaude).toHaveBeenCalledTimes(2);
    },
  );

  it('mantém o botão no DOM e com o foco enquanto verifica de novo', async () => {
    let resolver: (() => void) | undefined;
    const consultarSaude = vi
      .fn<ClienteFalso['consultarSaude']>()
      .mockRejectedValueOnce(new ErroSemConexao('rede'))
      .mockImplementationOnce(
        () =>
          new Promise((ok) => {
            resolver = () => ok({ status: 'ok' });
          }),
      );
    render(<EstadoDaApi cliente={clienteQue(consultarSaude)} />);

    const botao = await screen.findByRole('button', { name: t.tentarDeNovo });
    botao.focus();
    fireEvent.click(botao);

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(t.verificando));
    const durante = screen.getByRole('button', { name: t.verificandoBotao });
    expect(durante).toBe(botao);
    expect(document.activeElement).toBe(botao);
    expect(durante.getAttribute('aria-disabled')).toBe('true');
    expect(durante.hasAttribute('disabled')).toBe(false);

    // Clique durante a verificação é ignorado.
    fireEvent.click(durante);
    expect(consultarSaude).toHaveBeenCalledTimes(2);

    resolver?.();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('API disponível'));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('mostra o texto de erro da API com ErroDeApi', async () => {
    const erro = new ErroDeApi({ status: 503 });
    render(<EstadoDaApi cliente={clienteQue(() => Promise.reject(erro))} />);

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(t.erroDaApi));
    expect(screen.getByRole('status').textContent).not.toContain('Sem conexão');
    expect(screen.getByRole('button', { name: t.tentarDeNovo })).toBeTruthy();
  });

  it('trata resposta fora do contrato como erro da API', async () => {
    render(
      <EstadoDaApi cliente={clienteQue(() => Promise.reject(new ErroRespostaInvalida(200)))} />,
    );

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(t.erroDaApi));
  });

  it('não vaza detalhe do erro na tela', async () => {
    const erro = new Error('connect ECONNREFUSED 10.0.0.1:5432 usuario=maria');
    render(<EstadoDaApi cliente={clienteQue(() => Promise.reject(erro))} />);

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(t.erroDaApi));
    expect(document.body.textContent).not.toContain('ECONNREFUSED');
  });

  it('mostra aviso de configuração, sem chamar a API, quando falta VITE_API_URL', () => {
    render(<EstadoDaApi cliente={null} />);

    const status = screen.getByRole('status');
    expect(status.textContent).toContain(t.semConfiguracao);
    expect(status.textContent).not.toContain('VITE_API_URL');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('cancela a consulta ao desmontar e não atualiza a tela depois', async () => {
    let sinal: { aborted: boolean } | undefined;
    const consultarSaude: ClienteFalso['consultarSaude'] = (opcoes) => {
      sinal = opcoes?.sinal;
      return new Promise((_resolver, rejeitar) => {
        setTimeout(() => rejeitar(new ErroCancelado()), 0);
      });
    };
    const erroNoConsole = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { unmount } = render(<EstadoDaApi cliente={clienteQue(consultarSaude)} />);
    unmount();
    await new Promise((resolver) => setTimeout(resolver, 5));

    expect(sinal?.aborted).toBe(true);
    expect(erroNoConsole).not.toHaveBeenCalled();
    erroNoConsole.mockRestore();
  });

  it('é uma região nomeada (h2) com o estado como região de status', () => {
    render(<EstadoDaApi cliente={null} />);

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(t.secao);
    expect(screen.getByRole('region', { name: t.secao })).toBeTruthy();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
});
