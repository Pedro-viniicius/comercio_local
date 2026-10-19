// QA do grupo C, rodada 2 (S88, D2): bordas da inatividade de 30 min no passo 3 da P1b. O passo 3 não
// tem aviso nem "Continuar conectado": quem está usando a tela (copiando os códigos) não pode perder
// os códigos e a sessão por causa de um aviso que ninguém vê.
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
import type { SinaisEntreAbas } from '../sessao/entre-abas.ts';

const MINUTO = 60_000;
const avancar = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const botao = (nome: string) => screen.getByRole<HTMLButtonElement>('button', { name: nome });
const sinaisMudos: SinaisEntreAbas = { enviar: () => undefined, ouvir: () => () => undefined };

let api: ApiFalsa;

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
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

async function irAoPasso3() {
  montarApp(api, { entreAbas: sinaisMudos });
  await avancar(0);
  preencher(t.entrar.email, 'pedro@exemplo.com.br');
  preencher(t.entrar.senha, 'senha-boa-123');
  fireEvent.click(botao(t.entrar.botao));
  await avancar(0);
  fireEvent.click(botao(t.configuracao.passo1.botao));
  await avancar(0);
  preencher(t.configuracao.passo2.codigo, '654321');
  fireEvent.click(botao(t.configuracao.passo2.botao));
  await avancar(0);
  expect(screen.getByText(t.configuracao.passo3.aviso)).toBeTruthy();
}

const temCodigoNaPagina = () =>
  [...CODIGOS, ...CODIGOS_NA_TELA].some((codigo) =>
    document.documentElement.outerHTML.includes(codigo),
  );

describe('S88: inatividade no passo 3, bordas', () => {
  it('interação nos últimos 2 min recomeça os 30 min: quem está usando a tela não perde os códigos', async () => {
    await irAoPasso3();
    // 29 min parado e a pessoa volta e usa a tela (copiar os códigos): é interação.
    await avancar(29 * MINUTO);
    fireEvent.keyDown(document.body, { key: 'Tab' });
    fireEvent.pointerDown(botao(t.configuracao.passo3.copiarTodos));

    await avancar(2 * MINUTO);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    expect(temCodigoNaPagina()).toBe(true);
    expect(screen.queryByText(t.aviso.sessaoTerminou)).toBeNull();
  });

  it('sem interação nenhuma, 30 min exatos limpam os códigos e pedem um logout só', async () => {
    await irAoPasso3();
    await avancar(30 * MINUTO);
    await avancar(0);

    expect(api.pedidosDa(SAIR)).toHaveLength(1);
    expect(temCodigoNaPagina()).toBe(false);
    expect(screen.getByText(t.aviso.sessaoTerminou)).toBeTruthy();
    await avancar(60 * MINUTO);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
  });
});
