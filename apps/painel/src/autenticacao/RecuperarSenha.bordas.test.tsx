// QA do grupo C (etapa 15, CA-06): bordas do reenvio de 60 s da P1c com relógio falso. A conta
// segue a data (aba suspensa atrasa o timer), o botão não deixa passar pedido antes da hora, o
// contador reinicia a cada pedido que a API aceitou e nenhum timer sobra depois de sair da tela.
import { ErroDeApi } from '@bairrin/cliente-api';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { textos } from '../textos/pt-BR.ts';
import { ESPERA_DO_REENVIO_S, RecuperarSenha } from './RecuperarSenha.tsx';

const t = textos.autenticacao;
const r = t.recuperacao;
const avancar = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const reenviar = () => screen.getByRole<HTMLButtonElement>('button', { name: /Reenviar código/ });
const anuncios = () => screen.getAllByRole('status').map((regiao) => regiao.textContent);

function montar(solicitarRecuperacao = vi.fn(() => Promise.resolve())) {
  const aoVoltar = vi.fn();
  const resultado = render(
    <RecuperarSenha
      autenticacao={{ solicitarRecuperacao, redefinirSenha: vi.fn() }}
      emailInicial="pedro@exemplo.com.br"
      aoConcluir={vi.fn()}
      aoVoltar={aoVoltar}
    />,
  );
  return { solicitarRecuperacao, aoVoltar, ...resultado };
}

async function pedirOPrimeiroCodigo() {
  fireEvent.click(screen.getByRole('button', { name: r.enviar }));
  await avancar(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('contagem do reenvio', () => {
  it('mostra 1:00 no primeiro instante, 0:59 depois de 1 s e 0:01 aos 59 s; libera aos 60 s', async () => {
    montar();
    await pedirOPrimeiroCodigo();
    expect(reenviar().textContent).toBe(r.reenviarEm('1:00'));

    await avancar(1000);
    expect(reenviar().textContent).toBe(r.reenviarEm('0:59'));
    await avancar(58_000);
    expect(reenviar().textContent).toBe(r.reenviarEm('0:01'));
    expect(reenviar().disabled).toBe(true);

    await avancar(1000);
    expect(reenviar().textContent).toBe(r.reenviar);
    expect(reenviar().disabled).toBe(false);
  });

  it('aba suspensa por 90 s: no primeiro tick o botão libera de uma vez e o anúncio sai uma vez só', async () => {
    montar();
    await pedirOPrimeiroCodigo();

    vi.setSystemTime(Date.now() + 90_000);
    await avancar(1000);

    expect(reenviar().disabled).toBe(false);
    expect(anuncios().filter((texto) => texto === r.reenvioLiberado)).toHaveLength(1);
    await avancar(30_000);
    expect(anuncios().filter((texto) => texto === r.reenvioLiberado)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('o anúncio da liberação não repete ao longo da contagem (só a liberação é dita)', async () => {
    montar();
    await pedirOPrimeiroCodigo();
    for (let segundo = 1; segundo < ESPERA_DO_REENVIO_S; segundo += 1) {
      await avancar(1000);
      expect(anuncios().join('|')).not.toContain('0:');
    }
    expect(anuncios().join('')).not.toContain(r.reenvioLiberado);
  });

  it('clique no botão travado não chama a API, nem por Enter no foco', async () => {
    const { solicitarRecuperacao } = montar();
    await pedirOPrimeiroCodigo();

    fireEvent.click(reenviar());
    fireEvent.keyDown(reenviar(), { key: 'Enter' });
    await avancar(30_000);
    fireEvent.click(reenviar());

    expect(solicitarRecuperacao).toHaveBeenCalledTimes(1);
  });

  it('cada pedido aceito reinicia os 60 s, com o contador antigo cancelado', async () => {
    const { solicitarRecuperacao } = montar();
    await pedirOPrimeiroCodigo();
    await avancar(ESPERA_DO_REENVIO_S * 1000);
    fireEvent.click(reenviar());
    await avancar(0);

    expect(solicitarRecuperacao).toHaveBeenCalledTimes(2);
    expect(reenviar().textContent).toBe(r.reenviarEm('1:00'));
    expect(vi.getTimerCount()).toBe(1);
    await avancar(59_000);
    expect(reenviar().disabled).toBe(true);
    await avancar(1000);
    expect(reenviar().disabled).toBe(false);
  });
});

describe('reenvio que falha', () => {
  it('429 no reenvio mostra o aviso de espera e o botão continua liberado (a API é quem limita)', async () => {
    const solicitar = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ErroDeApi({ status: 429 }));
    montar(solicitar);
    await pedirOPrimeiroCodigo();
    await avancar(ESPERA_DO_REENVIO_S * 1000);

    fireEvent.click(reenviar());
    await avancar(0);

    expect(screen.getByRole('alert').textContent).toContain(r.limite);
    expect(reenviar().disabled).toBe(false);
    expect(screen.getByLabelText(r.codigo)).toBeTruthy();
  });

  it('erro de rede no reenvio mostra o erro inesperado, sem iniciar a contagem', async () => {
    const solicitar = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    montar(solicitar);
    await pedirOPrimeiroCodigo();
    await avancar(ESPERA_DO_REENVIO_S * 1000);

    fireEvent.click(reenviar());
    await avancar(0);

    expect(screen.getByRole('alert').textContent).toContain(t.aviso.servidor);
    expect(reenviar().textContent).toBe(r.reenviar);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('sair da tela', () => {
  it('"Voltar" no meio da contagem leva o e-mail e não deixa timer', async () => {
    const { aoVoltar, unmount } = montar();
    await pedirOPrimeiroCodigo();
    await avancar(10_000);

    fireEvent.click(screen.getByRole('button', { name: t.voltarParaEntrar }));
    expect(aoVoltar).toHaveBeenCalledWith('pedro@exemplo.com.br');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await avancar(120_000);
  });

  it('o foco vai ao campo de código quando o passo 2 abre', async () => {
    montar();
    await pedirOPrimeiroCodigo();
    expect(document.activeElement).toBe(screen.getByLabelText(r.codigo));
  });
});
