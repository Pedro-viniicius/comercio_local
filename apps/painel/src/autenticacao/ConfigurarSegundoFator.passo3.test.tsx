// P1b, passo 3 (D1, S88, R5): os códigos de recuperação aparecem uma vez e a sessão já existe.
// "Sair" sem a caixa marcada pede confirmação num Banner em linha, com o foco no botão seguro; 30 min
// sem interação limpam os códigos e encerram a sessão; o endereço `blob:` do arquivo sai ~1 s depois.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
import {
  ATRASO_PARA_SOLTAR_O_ARQUIVO_MS,
  ConfigurarSegundoFator,
} from './ConfigurarSegundoFator.tsx';
import { CONTA, SESSAO, criarApiFalsa, problema, type ApiFalsa } from './teste/api-falsa.ts';
import type { SinaisEntreAbas } from '../sessao/entre-abas.ts';
import { criarAbasFalsas } from '../sessao/teste/abas-falsas.ts';

const MINUTO = 60_000;
const p3 = t.configuracao.passo3;
const confirmacao = p3.confirmarSaida;
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
  vi.restoreAllMocks();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  localStorage.clear();
});

/** Do login ao passo 3, com o relógio falso (sem `findBy`, que espera timers de verdade). */
async function irAoPasso3(entreAbas: SinaisEntreAbas = sinaisMudos) {
  montarApp(api, { entreAbas });
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
  expect(screen.getByText(p3.aviso)).toBeTruthy();
}

const temCodigoNaPagina = () =>
  [...CODIGOS, ...CODIGOS_NA_TELA].some((codigo) =>
    document.documentElement.outerHTML.includes(codigo),
  );

describe('D1: "Sair" no passo 3 sem a caixa marcada', () => {
  it('pede confirmação num Banner em linha, com o texto da spec e o foco em "Voltar aos códigos"', async () => {
    await irAoPasso3();
    fireEvent.click(botao(t.sair));

    const banner = screen.getByText(confirmacao.titulo).closest('.ui-banner');
    expect(banner?.textContent).toContain(confirmacao.texto);
    expect(confirmacao.titulo).toBe('Sair sem guardar os códigos?');
    expect(confirmacao.texto).toBe(
      'Eles não aparecem de novo. Sem eles, você só recupera o acesso com ajuda de quem cuida do sistema.',
    );
    expect(document.activeElement).toBe(botao(confirmacao.voltar));
    expect(botao(confirmacao.sair)).toBeTruthy();
    // Nada saiu: os códigos seguem na tela e nenhum logout foi pedido.
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    expect(screen.getAllByRole('listitem')).toHaveLength(CODIGOS.length);
  });

  it('"Voltar aos códigos" fecha a confirmação e leva o foco ao título do passo', async () => {
    await irAoPasso3();
    fireEvent.click(botao(t.sair));
    fireEvent.click(botao(confirmacao.voltar));

    expect(screen.queryByText(confirmacao.titulo)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: p3.titulo }));
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
  });

  it('"Sair" de novo com a confirmação aberta só devolve o foco ao botão seguro', async () => {
    await irAoPasso3();
    fireEvent.click(botao(t.sair));
    botao(p3.copiarTodos).focus();
    fireEvent.click(botao(t.sair));

    expect(screen.getAllByText(confirmacao.titulo)).toHaveLength(1);
    expect(document.activeElement).toBe(botao(confirmacao.voltar));
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
  });

  it('"Sair mesmo assim" limpa os códigos e sai pelo cookie, com "Você saiu"', async () => {
    await irAoPasso3();
    fireEvent.click(botao(t.sair));
    fireEvent.click(botao(confirmacao.sair));
    await avancar(0);

    expect(api.pedidosDa(SAIR)).toHaveLength(1);
    expect(screen.getByText(t.aviso.saiu)).toBeTruthy();
    expect(temCodigoNaPagina()).toBe(false);
  });

  it('com a caixa marcada, "Sair" sai direto', async () => {
    await irAoPasso3();
    fireEvent.click(screen.getByRole('checkbox', { name: p3.guardei }));
    fireEvent.click(botao(t.sair));
    await avancar(0);

    expect(screen.queryByText(confirmacao.titulo)).toBeNull();
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
  });

  it('nos passos 1 e 2 não há códigos: "Sair" sai direto', async () => {
    montarApp(api, { entreAbas: sinaisMudos });
    await avancar(0);
    preencher(t.entrar.email, 'pedro@exemplo.com.br');
    preencher(t.entrar.senha, 'senha-boa-123');
    fireEvent.click(botao(t.entrar.botao));
    await avancar(0);
    fireEvent.click(botao(t.sair));
    await avancar(0);

    expect(screen.queryByText(confirmacao.titulo)).toBeNull();
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
  });
});

describe('S88: inatividade no passo 3', () => {
  it('30 min sem interação limpam os códigos e encerram a sessão, com "Sua sessão terminou"', async () => {
    await irAoPasso3();
    await avancar(30 * MINUTO - 1);
    expect(screen.getAllByRole('listitem')).toHaveLength(CODIGOS.length);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);

    await avancar(1);
    await avancar(0);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
    expect(screen.getByText(t.aviso.sessaoTerminou)).toBeTruthy();
    expect(temCodigoNaPagina()).toBe(false);
  });

  it('a tela limpa os códigos sozinha ao expirar, antes de o pai trocar de tela', async () => {
    const aoSair = vi.fn();
    render(
      <ConfigurarSegundoFator
        autenticacao={{
          iniciarConfiguracao: () => Promise.resolve({ otpauthUri: URI, segredoBase32: SEGREDO }),
          confirmarConfiguracao: () =>
            Promise.resolve({ codigosRecuperacao: CODIGOS, sessao: SESSAO }),
          registrarInteracao: () => Promise.resolve(true),
          aoAtividadeEmOutraAba: () => () => undefined,
        }}
        desafio={DESAFIO}
        aoConcluir={vi.fn()}
        aoVoltar={vi.fn()}
        aoSair={aoSair}
      />,
    );
    fireEvent.click(botao(t.configuracao.passo1.botao));
    await avancar(0);
    preencher(t.configuracao.passo2.codigo, '654321');
    fireEvent.click(botao(t.configuracao.passo2.botao));
    await avancar(0);
    expect(temCodigoNaPagina()).toBe(true);

    await avancar(30 * MINUTO);
    expect(aoSair).toHaveBeenCalledWith('inatividade');
    expect(temCodigoNaPagina()).toBe(false);
  });

  it('R8: sem aviso na tela, a interação aos 29 min conta e o prazo recomeça (sem "avisado" escondido)', async () => {
    await irAoPasso3();
    await avancar(29 * MINUTO);
    fireEvent.keyDown(document.body, { key: 'Tab' });
    await avancar(29 * MINUTO);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    expect(screen.getAllByRole('listitem')).toHaveLength(CODIGOS.length);
    expect(screen.queryByText(t.inicio.expirando)).toBeNull();
    await avancar(1 * MINUTO);
    await avancar(0);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
  });

  it('R10: a atividade de outra aba conta no passo 3; parada a outra, encerra 30 min depois do último sinal', async () => {
    const abas = criarAbasFalsas();
    const estaAba = abas.abrirAba();
    const outraAba = abas.abrirAba();
    await irAoPasso3(estaAba);
    expect(estaAba.ouvintes()).toBeGreaterThan(0);

    await avancar(20 * MINUTO);
    outraAba.enviar('atividade');
    await avancar(29 * MINUTO);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    expect(screen.getAllByRole('listitem')).toHaveLength(CODIGOS.length);
    await avancar(1 * MINUTO);
    await avancar(0);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
    expect(temCodigoNaPagina()).toBe(false);
  });

  it('com a confirmação de saída aberta, o fim do prazo também limpa e encerra', async () => {
    await irAoPasso3();
    fireEvent.click(botao(t.sair));
    await avancar(30 * MINUTO);
    await avancar(0);

    expect(api.pedidosDa(SAIR)).toHaveLength(1);
    expect(temCodigoNaPagina()).toBe(false);
  });

  it('a interação recomeça o prazo; nos passos 1 e 2 o relógio não roda', async () => {
    montarApp(api, { entreAbas: sinaisMudos });
    await avancar(0);
    preencher(t.entrar.email, 'pedro@exemplo.com.br');
    preencher(t.entrar.senha, 'senha-boa-123');
    fireEvent.click(botao(t.entrar.botao));
    await avancar(0);
    await avancar(40 * MINUTO);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    fireEvent.click(botao(t.configuracao.passo1.botao));
    await avancar(0);
    preencher(t.configuracao.passo2.codigo, '654321');
    fireEvent.click(botao(t.configuracao.passo2.botao));
    await avancar(0);

    api.responder(RENOVAR, { status: 200, corpo: SESSAO });
    await avancar(20 * MINUTO);
    fireEvent.keyDown(document.body, { key: 'Tab' });
    await avancar(0);
    // A sessão da confirmação tem mais de 10 min: a interação renova no servidor (R1).
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);
    await avancar(29 * MINUTO);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    expect(screen.getAllByRole('listitem')).toHaveLength(CODIGOS.length);
    await avancar(1 * MINUTO);
    await avancar(0);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
  });

  it('"Concluir e entrar" desliga o relógio do passo 3 (o Início tem o seu)', async () => {
    await irAoPasso3();
    await avancar(20 * MINUTO);
    fireEvent.click(screen.getByRole('checkbox', { name: p3.guardei }));
    fireEvent.click(botao(p3.botao));
    await avancar(0);
    expect(screen.getByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();

    await avancar(15 * MINUTO);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
  });
});

describe('R5: o endereço do arquivo dos códigos', () => {
  it('sai cerca de 1 s depois do download, não antes', async () => {
    const revogar = vi.fn();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:falso-1'), revokeObjectURL: revogar });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await irAoPasso3();

    fireEvent.click(botao(p3.baixar));
    expect(ATRASO_PARA_SOLTAR_O_ARQUIVO_MS).toBe(1_000);
    await avancar(ATRASO_PARA_SOLTAR_O_ARQUIVO_MS - 1);
    expect(revogar).not.toHaveBeenCalled();
    await avancar(1);
    expect(revogar).toHaveBeenCalledWith('blob:falso-1');
  });
});
