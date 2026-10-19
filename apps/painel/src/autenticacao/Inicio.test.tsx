// Área protegida: inatividade de 30 min medida só por interação (S9), com aviso 2 min antes. Com o
// aviso aberto, só "Continuar conectado" retoma (D2); a interação chega ao servidor por
// `registrarInteracao` (R1) e a atividade de outra aba conta como interação (R2).
import type { Conta } from '@bairrin/contratos';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { textos } from '../textos/pt-BR.ts';
import { criarAutenticacaoDoPainel } from '../sessao/autenticacao-do-painel.ts';
import type { SinaisEntreAbas } from '../sessao/entre-abas.ts';
import { AVISO_ANTES_DO_FIM_MS, LIMITE_DE_INATIVIDADE_MS } from '../sessao/inatividade.ts';
import { Inicio, type InicioProps } from './Inicio.tsx';
import { BASE_URL, SESSAO, criarApiFalsa, problema } from './teste/api-falsa.ts';

const t = textos.autenticacao;
const MINUTO = 60_000;
const CONTA: Conta = { nome: 'Pedro', emailMascarado: 'p***@exemplo.com.br', perfis: ['admin'] };

type AutenticacaoDoInicio = InicioProps['autenticacao'];

function montar(extras: Partial<AutenticacaoDoInicio> = {}) {
  const ouvintesDeOutrasAbas = new Set<() => void>();
  const autenticacao: AutenticacaoDoInicio = {
    consultarConta: vi.fn(() => Promise.resolve(CONTA)),
    consultarSaude: vi.fn(() => Promise.resolve({ status: 'ok' as const })),
    renovarSessao: vi.fn(() => Promise.resolve(null)),
    registrarInteracao: vi.fn(() => Promise.resolve(true)),
    aoAtividadeEmOutraAba: vi.fn((ouvinte: () => void) => {
      ouvintesDeOutrasAbas.add(ouvinte);
      return () => {
        ouvintesDeOutrasAbas.delete(ouvinte);
      };
    }),
    ...extras,
  };
  const aoTerminarSessao = vi.fn();
  const aoSair = vi.fn();
  render(
    <Inicio autenticacao={autenticacao} aoSair={aoSair} aoTerminarSessao={aoTerminarSessao} />,
  );
  /** Simula o sinal `atividade` vindo de outra aba. */
  const atividadeEmOutraAba = () =>
    act(() => {
      for (const ouvinte of ouvintesDeOutrasAbas) ouvinte();
    });
  return { autenticacao, aoTerminarSessao, aoSair, atividadeEmOutraAba, ouvintesDeOutrasAbas };
}

const avancar = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const continuar = () => screen.getByRole('button', { name: t.inicio.continuar });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Início: inatividade', () => {
  it('os limites são 30 min e o aviso 2 min antes', () => {
    expect(LIMITE_DE_INATIVIDADE_MS).toBe(30 * MINUTO);
    expect(AVISO_ANTES_DO_FIM_MS).toBe(2 * MINUTO);
  });

  it('avisa aos 28 min sem interação e encerra aos 30', async () => {
    const { aoTerminarSessao } = montar();
    await avancar(0);
    expect(screen.getByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();

    await avancar(28 * MINUTO - 1);
    expect(screen.queryByText(t.inicio.expirando)).toBeNull();
    await avancar(1);
    expect(screen.getByText(t.inicio.expirando)).toBeTruthy();
    expect(aoTerminarSessao).not.toHaveBeenCalled();

    await avancar(2 * MINUTO);
    expect(aoTerminarSessao).toHaveBeenCalledTimes(1);
  });

  it('tecla ou clique antes do aviso recomeçam a contagem e vão a `registrarInteracao` (R1)', async () => {
    const { aoTerminarSessao, autenticacao } = montar();
    await avancar(20 * MINUTO);
    fireEvent.keyDown(document.body, { key: 'a' });
    await avancar(5 * MINUTO);
    fireEvent.pointerDown(document.body);
    expect(autenticacao.registrarInteracao).toHaveBeenCalledTimes(2);

    await avancar(29 * MINUTO);
    expect(aoTerminarSessao).not.toHaveBeenCalled();
    await avancar(1 * MINUTO);
    expect(aoTerminarSessao).toHaveBeenCalledTimes(1);
  });

  it('D2: com o aviso aberto, Tab e pointerdown na página não fecham o aviso nem recomeçam o relógio', async () => {
    const { aoTerminarSessao, autenticacao } = montar();
    await avancar(28 * MINUTO);
    expect(screen.getByText(t.inicio.expirando)).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'Tab' });
    fireEvent.keyDown(continuar(), { key: 'Tab' });
    fireEvent.pointerDown(document.body);
    fireEvent.wheel(document.body);
    await avancar(0);

    expect(screen.getByText(t.inicio.expirando)).toBeTruthy();
    expect(autenticacao.registrarInteracao).not.toHaveBeenCalled();
    expect(autenticacao.renovarSessao).not.toHaveBeenCalled();
    await avancar(2 * MINUTO);
    expect(aoTerminarSessao).toHaveBeenCalledTimes(1);
  });

  it('D2: pointerdown no botão e depois o clique renovam no servidor, fecham o aviso e recomeçam o relógio', async () => {
    const renovarSessao = vi.fn(() => Promise.resolve(SESSAO));
    const { aoTerminarSessao, autenticacao } = montar({ renovarSessao });
    await avancar(28 * MINUTO);

    const botao = continuar();
    fireEvent.pointerDown(botao);
    // O botão continua montado depois do pointerdown: o clique chega a ele.
    expect(botao.isConnected).toBe(true);
    fireEvent.click(botao);
    await avancar(0);

    expect(renovarSessao).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t.inicio.expirando)).toBeNull();
    // A retomada também avisa as outras abas (pela `registrarInteracao`).
    expect(autenticacao.registrarInteracao).toHaveBeenCalledTimes(1);
    await avancar(29 * MINUTO);
    expect(aoTerminarSessao).not.toHaveBeenCalled();
    await avancar(1 * MINUTO);
    expect(aoTerminarSessao).toHaveBeenCalledTimes(1);
  });

  it('D2: o aviso só fecha quando a renovação termina; dois cliques renovam uma vez', async () => {
    let liberar: (sessao: typeof SESSAO) => void = () => undefined;
    const renovarSessao = vi.fn(
      () =>
        new Promise<typeof SESSAO>((resolver) => {
          liberar = resolver;
        }),
    );
    montar({ renovarSessao });
    await avancar(28 * MINUTO);

    const botao = continuar();
    fireEvent.click(botao);
    // Enquanto renova, o botão diz "Enviando…" ao leitor de tela e ignora o clique.
    fireEvent.click(botao);
    await avancar(0);
    expect(renovarSessao).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t.inicio.expirando)).toBeTruthy();

    liberar(SESSAO);
    await avancar(0);
    expect(screen.queryByText(t.inicio.expirando)).toBeNull();
  });

  it('D2: "Continuar conectado" sem rede mostra o erro e mantém o aviso; a nova tentativa fecha os dois', async () => {
    const renovarSessao = vi
      .fn<AutenticacaoDoInicio['renovarSessao']>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(SESSAO);
    const { aoTerminarSessao } = montar({ renovarSessao });
    await avancar(28 * MINUTO);

    fireEvent.click(continuar());
    await avancar(0);
    expect(screen.getByRole('alert').textContent).toContain(t.inicio.naoContinuou);
    expect(screen.getByText(t.inicio.expirando)).toBeTruthy();
    expect(aoTerminarSessao).not.toHaveBeenCalled();

    fireEvent.click(continuar());
    await avancar(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(t.inicio.expirando)).toBeNull();
  });

  it('D2: sem rede até o fim, a sessão termina aos 30 min', async () => {
    const renovarSessao = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const { aoTerminarSessao } = montar({ renovarSessao });
    await avancar(28 * MINUTO);
    fireEvent.click(continuar());
    await avancar(2 * MINUTO);
    expect(aoTerminarSessao).toHaveBeenCalledTimes(1);
  });

  it('"Continuar conectado" com a renovação recusada encerra', async () => {
    const renovarSessao = vi.fn(() => Promise.resolve(null));
    const { aoTerminarSessao } = montar({ renovarSessao });
    await avancar(28 * MINUTO);

    fireEvent.click(continuar());
    await avancar(0);
    expect(renovarSessao).toHaveBeenCalledTimes(1);
    expect(aoTerminarSessao).toHaveBeenCalledTimes(1);
  });

  it('R1: a renovação da interação vazia (sessão acabou) encerra', async () => {
    const registrarInteracao = vi.fn(() => Promise.resolve(false));
    const { aoTerminarSessao } = montar({ registrarInteracao });
    await avancar(15 * MINUTO);
    fireEvent.keyDown(document.body, { key: 'a' });
    await avancar(0);
    expect(aoTerminarSessao).toHaveBeenCalledTimes(1);
  });

  it('R2: atividade em outra aba recomeça o relógio e fecha o aviso, sem renovar daqui', async () => {
    const { aoTerminarSessao, autenticacao, atividadeEmOutraAba } = montar();
    await avancar(20 * MINUTO);
    atividadeEmOutraAba();
    await avancar(28 * MINUTO);
    expect(screen.getByText(t.inicio.expirando)).toBeTruthy();

    atividadeEmOutraAba();
    expect(screen.queryByText(t.inicio.expirando)).toBeNull();
    await avancar(29 * MINUTO);
    expect(aoTerminarSessao).not.toHaveBeenCalled();
    expect(autenticacao.renovarSessao).not.toHaveBeenCalled();
    expect(autenticacao.registrarInteracao).not.toHaveBeenCalled();
    await avancar(1 * MINUTO);
    expect(aoTerminarSessao).toHaveBeenCalledTimes(1);
  });

  it('R7: requisição autenticada que leva 401 e renova não conta como interação (S9)', async () => {
    const api = criarApiFalsa();
    api.responder('POST /v1/sessoes/renovacao', { status: 200, corpo: SESSAO });
    api.responder(
      'GET /v1/admin/conta',
      { status: 200, corpo: CONTA },
      problema(401, 'nao_autenticado'),
      { status: 200, corpo: CONTA },
    );
    const entreAbas: SinaisEntreAbas = { enviar: vi.fn(), ouvir: () => () => undefined };
    const autenticacao = criarAutenticacaoDoPainel({
      baseUrl: BASE_URL,
      fetch: api.fetch,
      entreAbas,
    });
    await autenticacao.renovarSessao();
    const aoTerminarSessao = vi.fn();
    render(
      <Inicio autenticacao={autenticacao} aoSair={vi.fn()} aoTerminarSessao={aoTerminarSessao} />,
    );
    await avancar(0);

    await avancar(15 * MINUTO);
    // Como faria um polling sem `renovarEm401: false`: o 401 renova pelo cookie e repete.
    await act(() => autenticacao.consultarConta());
    expect(api.pedidosDa('POST /v1/sessoes/renovacao')).toHaveLength(2);
    expect(api.pedidosDa('GET /v1/admin/conta')).toHaveLength(3);

    await avancar(15 * MINUTO);
    expect(aoTerminarSessao).toHaveBeenCalledTimes(1);
  });

  it('desmontar desliga o relógio e para de ouvir as outras abas', async () => {
    const { aoTerminarSessao, ouvintesDeOutrasAbas } = montar();
    expect(ouvintesDeOutrasAbas.size).toBe(1);
    cleanup();
    expect(ouvintesDeOutrasAbas.size).toBe(0);
    await avancar(31 * MINUTO);
    expect(aoTerminarSessao).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Início: conta e erros', () => {
  it('erro inesperado na rota protegida mostra o Banner e "Tentar de novo" consulta de novo', async () => {
    const consultarConta = vi
      .fn<InicioProps['autenticacao']['consultarConta']>()
      .mockRejectedValueOnce(new Error('falha'))
      .mockResolvedValueOnce(CONTA);
    montar({ consultarConta });
    await avancar(0);

    expect(screen.getByRole('alert').textContent).toContain(t.aviso.servidor);
    fireEvent.click(screen.getByRole('button', { name: t.tentarDeNovo }));
    await avancar(0);
    expect(screen.getByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
    expect(consultarConta).toHaveBeenCalledTimes(2);
  });

  it('"Sair" na barra chama o logout do pai', async () => {
    const { aoSair } = montar();
    await avancar(0);
    fireEvent.click(screen.getByRole('button', { name: t.sair }));
    expect(aoSair).toHaveBeenCalledTimes(1);
  });
});
