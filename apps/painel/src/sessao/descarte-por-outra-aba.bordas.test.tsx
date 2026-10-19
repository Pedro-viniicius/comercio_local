// QA do grupo C, rodada 3 (R2, S89): o que acontece no painel inteiro depois que outra aba manda
// `saiu` e esta aba esquece a sessão só na memória (`descartarSessaoLocal`). A renovação que estava
// no ar não traz a sessão de volta, nenhuma requisição sai com o token antigo e um login novo
// depois do descarte funciona como o primeiro.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTA, SESSAO, criarApiFalsa, type ApiFalsa } from '../autenticacao/teste/api-falsa.ts';
import {
  CONTA_DO_ADMIN,
  DESAFIO,
  ENTRAR,
  RENOVAR,
  SAIR,
  SEGUNDO_FATOR,
  montarApp,
  preencher,
  t,
} from '../autenticacao/fixtures/fluxo-comum.tsx';
import { RENOVAR_NA_INTERACAO_APOS_MS } from './autenticacao-do-painel.ts';
import { criarAbasFalsas, type AbaFalsa } from './teste/abas-falsas.ts';

const MINUTO = 60_000;
const avancar = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const TOKEN_ANTIGO = SESSAO.tokenAcesso;
const TOKEN_DA_RENOVACAO_NO_AR = 'token-da-renovacao-que-estava-no-ar.xyz';
const TOKEN_NOVO = 'token-do-login-novo.def';

let api: ApiFalsa;
let estaAba: AbaFalsa;
let outraAba: AbaFalsa;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  api = criarApiFalsa();
  api.responder(RENOVAR, { status: 200, corpo: SESSAO });
  api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
  api.responder(SAIR, { status: 204 });
  api.responder(ENTRAR, { status: 200, corpo: { etapa: 'verificar', desafio: DESAFIO } });
  const abas = criarAbasFalsas();
  estaAba = abas.abrirAba();
  outraAba = abas.abrirAba();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

async function abrirPainel() {
  const montado = montarApp(api, { entreAbas: estaAba });
  await avancar(0);
  expect(screen.getByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
  return montado;
}

/** Pedidos que levaram o token de acesso (de qualquer valor) no cabeçalho `Authorization`. */
const pedidosAutenticados = () =>
  api.pedidos.filter((pedido) => pedido.cabecalhos['Authorization'] !== undefined);

async function entrarDeNovoComSegundoFator(sessao: typeof SESSAO) {
  api.responder(SEGUNDO_FATOR, { status: 200, corpo: sessao });
  preencher(t.entrar.email, 'pedro@exemplo.com.br');
  preencher(t.entrar.senha, 'senha-boa-123');
  fireEvent.click(screen.getByRole('button', { name: t.entrar.botao }));
  await avancar(0);
  preencher(t.segundoFator.codigo, '123456');
  await avancar(0);
}

describe('descarte local depois do `saiu` de outra aba', () => {
  it('a renovação por interação que estava no ar não devolve o painel nem nenhum token', async () => {
    const { autenticacao } = await abrirPainel();
    await avancar(RENOVAR_NA_INTERACAO_APOS_MS + 1);
    const liberar = api.segurar(RENOVAR);
    fireEvent.keyDown(document.body, { key: 'a' });
    await avancar(0);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);

    outraAba.enviar('saiu');
    await avancar(0);
    expect(screen.getByText(t.aviso.sessaoTerminou)).toBeTruthy();

    // A resposta chega depois do descarte, com um token válido para o servidor.
    liberar({ status: 200, corpo: { ...SESSAO, tokenAcesso: TOKEN_DA_RENOVACAO_NO_AR } });
    await avancar(0);
    expect(screen.queryByText(t.inicio.conta(CONTA.emailMascarado))).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: t.entrar.titulo })).toBeTruthy();

    // Nenhuma requisição saiu depois do descarte com Authorization, nem com o token antigo nem
    // com o da renovação que voltou tarde.
    const antes = pedidosAutenticados().length;
    await act(() => autenticacao.consultarConta().catch(() => undefined));
    const ultima = api.pedidosDa(CONTA_DO_ADMIN).at(-1);
    expect(ultima?.cabecalhos['Authorization']).toBeUndefined();
    expect(pedidosAutenticados()).toHaveLength(antes);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
  });

  it('em P1, a interação 1 h depois não renova nem pede logout (o relógio e a sessão sumiram)', async () => {
    await abrirPainel();
    outraAba.enviar('saiu');
    await avancar(0);

    await avancar(RENOVAR_NA_INTERACAO_APOS_MS + 1);
    fireEvent.keyDown(document.body, { key: 'a' });
    fireEvent.pointerDown(document.body);
    await avancar(60 * MINUTO);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(1);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
  });

  it('login novo depois do descarte: o painel abre com o token NOVO, sem sobra do antigo', async () => {
    const { autenticacao } = await abrirPainel();
    outraAba.enviar('saiu');
    await avancar(0);

    await entrarDeNovoComSegundoFator({ ...SESSAO, tokenAcesso: TOKEN_NOVO });
    expect(screen.getByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();

    const consultas = api.pedidosDa(CONTA_DO_ADMIN);
    expect(consultas.at(-1)?.cabecalhos['Authorization']).toBe(`Bearer ${TOKEN_NOVO}`);
    // O token antigo só foi usado antes do descarte.
    const comTokenAntigo = api.pedidos.filter(
      (pedido) => pedido.cabecalhos['Authorization'] === `Bearer ${TOKEN_ANTIGO}`,
    );
    expect(comTokenAntigo).toHaveLength(1);
    await act(() => autenticacao.consultarConta());
    expect(api.pedidosDa(CONTA_DO_ADMIN).at(-1)?.cabecalhos['Authorization']).toBe(
      `Bearer ${TOKEN_NOVO}`,
    );
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
  });

  it('a sessão do login novo renova pela interação e termina por inatividade, como qualquer outra', async () => {
    await abrirPainel();
    outraAba.enviar('saiu');
    await avancar(0);
    await entrarDeNovoComSegundoFator({ ...SESSAO, tokenAcesso: TOKEN_NOVO });
    const renovacoesAntes = api.pedidosDa(RENOVAR).length;

    await avancar(RENOVAR_NA_INTERACAO_APOS_MS + 1);
    fireEvent.keyDown(document.body, { key: 'a' });
    await avancar(0);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(renovacoesAntes + 1);

    // Sem mais interação, o fim vem 30 min depois, com um logout só.
    await avancar(28 * MINUTO);
    expect(screen.getByText(t.inicio.expirando)).toBeTruthy();
    await avancar(2 * MINUTO);
    await avancar(0);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
    expect(screen.getByText(t.aviso.sessaoTerminou)).toBeTruthy();
  });

  it('dois `saiu` seguidos (as duas outras abas saíram): uma P1 só, sem erro, e o login seguinte funciona', async () => {
    await abrirPainel();
    outraAba.enviar('saiu');
    outraAba.enviar('saiu');
    await avancar(0);
    expect(screen.getAllByRole('heading', { level: 1, name: t.entrar.titulo })).toHaveLength(1);

    await entrarDeNovoComSegundoFator({ ...SESSAO, tokenAcesso: TOKEN_NOVO });
    expect(screen.getByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
  });

  it('o `saiu` de outra aba durante o login novo (P1a) não derruba a tela do código', async () => {
    await abrirPainel();
    outraAba.enviar('saiu');
    await avancar(0);
    preencher(t.entrar.email, 'pedro@exemplo.com.br');
    preencher(t.entrar.senha, 'senha-boa-123');
    fireEvent.click(screen.getByRole('button', { name: t.entrar.botao }));
    await avancar(0);
    expect(screen.getByRole('heading', { level: 1, name: t.segundoFator.titulo })).toBeTruthy();

    outraAba.enviar('saiu');
    await avancar(0);
    expect(screen.getByRole('heading', { level: 1, name: t.segundoFator.titulo })).toBeTruthy();
  });
});
