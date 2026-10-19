// QA do grupo C, rodada 3 (R8, R10, S88): bordas do passo 3 da P1b depois de o relógio passar a
// rodar sem aviso (`comAviso: false`). Cobre a interação no último milissegundo, a ida e volta
// (sair e entrar de novo não deixa o relógio do passo 3 anterior vivo) e a atividade de outra aba
// misturada com a interação daqui.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CODIGOS,
  CODIGOS_NA_TELA,
  CONFIGURACAO,
  CONFIRMACAO,
  CONTA_DO_ADMIN,
  DESAFIO,
  ENTRAR,
  RENOVAR,
  SAIR,
  SEGREDO,
  URI,
  montarApp,
  preencher,
  t,
} from './fixtures/fluxo-comum.tsx';
import { CONTA, SESSAO, criarApiFalsa, problema, type ApiFalsa } from './teste/api-falsa.ts';
import { criarAbasFalsas, type AbaFalsa } from '../sessao/teste/abas-falsas.ts';

const MINUTO = 60_000;
const p3 = t.configuracao.passo3;
const avancar = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const botao = (nome: string) => screen.getByRole<HTMLButtonElement>('button', { name: nome });

let api: ApiFalsa;
let estaAba: AbaFalsa;
let outraAba: AbaFalsa;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  api = criarApiFalsa();
  api.responder(RENOVAR, problema(401, 'nao_autenticado'));
  api.responder(ENTRAR, { status: 200, corpo: { etapa: 'configurar', desafio: DESAFIO } });
  api.responder(CONFIGURACAO, { status: 200, corpo: { otpauthUri: URI, segredoBase32: SEGREDO } });
  api.responder(CONFIRMACAO, {
    status: 200,
    corpo: { codigosRecuperacao: CODIGOS, sessao: SESSAO },
  });
  api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
  api.responder(SAIR, { status: 204 });
  const abas = criarAbasFalsas();
  estaAba = abas.abrirAba();
  outraAba = abas.abrirAba();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

const temCodigoNaPagina = () =>
  [...CODIGOS, ...CODIGOS_NA_TELA].some((codigo) =>
    document.documentElement.outerHTML.includes(codigo),
  );

async function entrarEConfigurar() {
  preencher(t.entrar.email, 'pedro@exemplo.com.br');
  preencher(t.entrar.senha, 'senha-boa-123');
  fireEvent.click(botao(t.entrar.botao));
  await avancar(0);
  fireEvent.click(botao(t.configuracao.passo1.botao));
  await avancar(0);
  preencher(t.configuracao.passo2.codigo, '654321');
  fireEvent.click(botao(t.configuracao.passo2.botao));
  await avancar(0);
  expect(screen.getByText(p3.aviso)).toBeTruthy();
  // Depois da confirmação a renovação do servidor passa a responder (a sessão existe).
  api.responder(RENOVAR, { status: 200, corpo: SESSAO });
}

async function irAoPasso3() {
  montarApp(api, { entreAbas: estaAba });
  await avancar(0);
  await entrarEConfigurar();
}

describe('passo 3 sem aviso: borda dos 30 min (R8)', () => {
  it('interação no último milissegundo (29:59.999) adia o fim em 30 min inteiros', async () => {
    await irAoPasso3();
    await avancar(30 * MINUTO - 1);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    fireEvent.pointerDown(document.body);

    // O timer original dispara aos 30:00 e encontra só 1 ms de ociosidade: não encerra.
    await avancar(1);
    await avancar(0);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    expect(temCodigoNaPagina()).toBe(true);
    await avancar(30 * MINUTO - 2);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    await avancar(1);
    await avancar(0);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
    expect(temCodigoNaPagina()).toBe(false);
  });

  it('nunca mostra aviso de expiração nem "Continuar conectado" no passo 3', async () => {
    await irAoPasso3();
    await avancar(29 * MINUTO + 30_000);
    expect(screen.queryByText(t.inicio.expirando)).toBeNull();
    expect(screen.queryByRole('button', { name: t.inicio.continuar })).toBeNull();
    // O único Banner do passo 3 é o dos códigos, nunca o de inatividade.
    expect(document.querySelectorAll('.ui-banner')).toHaveLength(1);
    expect(screen.getByText(p3.aviso).closest('.ui-banner')).toBeTruthy();
  });

  it('a interação nos últimos 2 min renova a sessão no servidor (o servidor conta 30 min da renovação)', async () => {
    await irAoPasso3();
    await avancar(29 * MINUTO);
    const antes = api.pedidosDa(RENOVAR).length;
    fireEvent.keyDown(document.body, { key: 'Tab' });
    await avancar(0);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(antes + 1);
  });
});

describe('passo 3 sem aviso: ida e volta', () => {
  it('sair e entrar de novo: o relógio do passo 3 anterior não encerra a sessão nova', async () => {
    await irAoPasso3();
    await avancar(10 * MINUTO);
    fireEvent.click(botao(t.sair));
    fireEvent.click(botao(p3.confirmarSaida.sair));
    await avancar(0);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
    expect(screen.getByText(t.aviso.saiu)).toBeTruthy();

    api.responder(RENOVAR, problema(401, 'nao_autenticado'));
    await entrarEConfigurar();
    expect(temCodigoNaPagina()).toBe(true);

    // 30 min do primeiro passo 3: o relógio velho teria disparado agora.
    await avancar(20 * MINUTO);
    await avancar(0);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
    expect(temCodigoNaPagina()).toBe(true);
    await avancar(10 * MINUTO - 1);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
    await avancar(1);
    await avancar(0);
    expect(api.pedidosDa(SAIR)).toHaveLength(2);
    expect(temCodigoNaPagina()).toBe(false);
  });

  it('o tempo parado nos passos 1 e 2 não conta: o relógio nasce ao entrar no passo 3', async () => {
    montarApp(api, { entreAbas: estaAba });
    await avancar(0);
    preencher(t.entrar.email, 'pedro@exemplo.com.br');
    preencher(t.entrar.senha, 'senha-boa-123');
    fireEvent.click(botao(t.entrar.botao));
    await avancar(0);
    await avancar(25 * MINUTO);
    fireEvent.click(botao(t.configuracao.passo1.botao));
    await avancar(0);
    await avancar(3 * MINUTO);
    preencher(t.configuracao.passo2.codigo, '654321');
    fireEvent.click(botao(t.configuracao.passo2.botao));
    await avancar(0);
    api.responder(RENOVAR, { status: 200, corpo: SESSAO });

    await avancar(30 * MINUTO - 1);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    expect(temCodigoNaPagina()).toBe(true);
    await avancar(1);
    await avancar(0);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
  });

  it('concluir ("Concluir e entrar") desliga o relógio do passo 3: só o Início conta dali em diante', async () => {
    await irAoPasso3();
    await avancar(5 * MINUTO);
    fireEvent.click(screen.getByRole('checkbox', { name: p3.guardei }));
    fireEvent.click(botao(p3.botao));
    await avancar(0);
    expect(screen.getByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();

    // O relógio do passo 3 venceria aos 25 min a partir daqui; o do Início, aos 30.
    await avancar(25 * MINUTO);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    await avancar(5 * MINUTO);
    await avancar(0);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
  });
});

describe('passo 3 sem aviso: atividade de outra aba (R10)', () => {
  it('conta como a interação mais recente e não gera requisição nesta aba', async () => {
    await irAoPasso3();
    const pedidosAntes = api.pedidos.length;
    await avancar(29 * MINUTO + 59_999);
    outraAba.enviar('atividade');
    await avancar(0);
    expect(api.pedidos).toHaveLength(pedidosAntes);

    await avancar(30 * MINUTO - 2);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    expect(temCodigoNaPagina()).toBe(true);
    await avancar(2);
    await avancar(0);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
  });

  it('a interação daqui depois da atividade da outra aba vale, e vice-versa: vence o sinal mais recente', async () => {
    await irAoPasso3();
    await avancar(20 * MINUTO);
    outraAba.enviar('atividade');
    await avancar(25 * MINUTO);
    // Aqui, 45 min depois do início: a pessoa mexe nesta aba e o prazo recomeça de novo.
    fireEvent.keyDown(document.body, { key: 'Tab' });
    await avancar(29 * MINUTO + 59_999);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    await avancar(1);
    await avancar(0);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
  });

  it('o sinal de atividade da outra aba nos passos 1 e 2 não cria relógio nem encerra nada', async () => {
    montarApp(api, { entreAbas: estaAba });
    await avancar(0);
    preencher(t.entrar.email, 'pedro@exemplo.com.br');
    preencher(t.entrar.senha, 'senha-boa-123');
    fireEvent.click(botao(t.entrar.botao));
    await avancar(0);
    outraAba.enviar('atividade');
    await avancar(60 * MINUTO);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    expect(screen.getByRole('button', { name: t.configuracao.passo1.botao })).toBeTruthy();
  });

  it('depois de sair do passo 3, a atividade da outra aba não mexe em nada (ouvinte removido)', async () => {
    await irAoPasso3();
    fireEvent.click(screen.getByRole('checkbox', { name: p3.guardei }));
    fireEvent.click(botao(t.sair));
    await avancar(0);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);

    const pedidosAntes = api.pedidos.length;
    outraAba.enviar('atividade');
    await avancar(60 * MINUTO);
    expect(api.pedidos).toHaveLength(pedidosAntes);
  });
});
