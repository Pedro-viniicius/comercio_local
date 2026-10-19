// QA do grupo C (etapa 15, CA-05, S9, S80): a sessão do painel no navegador. `localStorage`
// indisponível, a corrida do cookie (login só depois do logout), o modo estrito do React (efeitos
// duas vezes em desenvolvimento), a URL que não muda e o console que nunca recebe dado pessoal.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAVE_DO_LOGOUT_PENDENTE } from '../sessao/autenticacao-do-painel.ts';
import {
  CONFIGURACAO,
  CONFIRMACAO,
  CODIGOS,
  CONTA_DO_ADMIN,
  DESAFIO,
  EMAIL,
  ENTRAR,
  RENOVAR,
  SAIR,
  SEGREDO,
  SEGUNDO_FATOR,
  SENHA,
  URI,
  campo,
  entrarComSenha,
  montarApp,
  preencher,
  t,
} from './fixtures/fluxo-comum.tsx';
import { CONTA, SESSAO, criarApiFalsa, problema, type ApiFalsa } from './teste/api-falsa.ts';

let api: ApiFalsa;
// No jsdom do vitest o `localStorage` é propriedade própria da janela: guarda o original para devolver.
const descritorOriginal = Object.getOwnPropertyDescriptor(window, 'localStorage');

beforeEach(() => {
  api = criarApiFalsa();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Devolve o `localStorage` verdadeiro, se o teste o trocou por um que lança.
  if (descritorOriginal) Object.defineProperty(window, 'localStorage', descritorOriginal);
  localStorage.clear();
});

const botao = (nome: string) => screen.getByRole<HTMLButtonElement>('button', { name: nome });

function bloquearLocalStorage() {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('acesso negado a pedro@exemplo.com.br', 'SecurityError');
    },
  });
}

describe('localStorage indisponível (modo privado, site bloqueado)', () => {
  it('abrir, entrar e sair funcionam; a leitura que falha conta como marca e sai pelo cookie primeiro', async () => {
    bloquearLocalStorage();
    const registrarFalha = vi.fn();
    api.responder(SAIR, { status: 204 });
    api.responder(ENTRAR, { status: 200, corpo: SESSAO });
    api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
    montarApp(api, { registrarFalha });

    // Sem como ler a marca, o painel presume logout pendente: sai pelo cookie e não renova.
    await screen.findByLabelText(t.entrar.email);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(0);

    preencher(t.entrar.email, EMAIL);
    preencher(t.entrar.senha, SENHA);
    fireEvent.click(botao(t.entrar.botao));
    expect(await screen.findByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();

    fireEvent.click(botao(t.sair));
    expect(await screen.findByText(t.aviso.saiu)).toBeTruthy();
  });

  it('a falha do armazenamento chega ao registrador só com a origem (sem e-mail, sem erro)', async () => {
    bloquearLocalStorage();
    const registrarFalha = vi.fn();
    api.responder(SAIR, { status: 204 });
    montarApp(api, { registrarFalha });
    await screen.findByLabelText(t.entrar.email);

    await waitFor(() => expect(registrarFalha).toHaveBeenCalled());
    for (const [evento] of registrarFalha.mock.calls) {
      expect(Object.keys(evento as object)).toEqual(['origem']);
    }
    expect(JSON.stringify(registrarFalha.mock.calls)).not.toContain('@');
    expect(document.body.textContent).not.toContain('acesso negado');
  });

  it('cota cheia na escrita: "Sair" sem rede mostra o aviso do S80 e "Tentar de novo" ainda sai', async () => {
    api.responder(RENOVAR, { status: 200, corpo: SESSAO });
    api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
    api.responder(SAIR, 'rede', { status: 204 });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cota cheia', 'QuotaExceededError');
    });
    montarApp(api);
    await screen.findByText(t.inicio.conta(CONTA.emailMascarado));

    fireEvent.click(botao(t.sair));
    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.naoSaiu);

    fireEvent.click(botao(t.tentarDeNovo));
    expect(await screen.findByText(t.aviso.saiu)).toBeTruthy();
    expect(api.pedidosDa(SAIR)).toHaveLength(2);
  });
});

describe('corrida do cookie (S80)', () => {
  it('"Sair" e entrar logo depois: o DELETE termina antes de o login sair, e nada do token vai ao armazenamento', async () => {
    api.responder(RENOVAR, { status: 200, corpo: SESSAO });
    api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
    const liberar = api.segurar(SAIR);
    api.responder(ENTRAR, { status: 200, corpo: SESSAO });
    montarApp(api);
    await screen.findByText(t.inicio.conta(CONTA.emailMascarado));

    fireEvent.click(botao(t.sair));
    await waitFor(() => expect(api.pedidosDa(SAIR)).toHaveLength(1));
    expect(screen.queryByLabelText(t.entrar.email)).toBeNull();
    expect(api.pedidosDa(ENTRAR)).toHaveLength(0);

    liberar({ status: 204 });
    await screen.findByText(t.aviso.saiu);
    preencher(t.entrar.email, EMAIL);
    preencher(t.entrar.senha, SENHA);
    fireEvent.click(botao(t.entrar.botao));
    await screen.findByText(t.inicio.conta(CONTA.emailMascarado));

    const ordem = api.pedidos.map((p) => `${p.metodo} ${p.caminho}`);
    expect(ordem.indexOf(SAIR)).toBeLessThan(ordem.indexOf(ENTRAR));
    expect(JSON.stringify({ ...localStorage })).not.toContain(SESSAO.tokenAcesso);
  });

  it('logout sem rede, login e recarregar: a marca some no login e a renovação do cookie novo funciona', async () => {
    api.responder(RENOVAR, { status: 200, corpo: SESSAO });
    api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
    api.responder(SAIR, 'rede');
    const primeira = montarApp(api);
    await screen.findByText(t.inicio.conta(CONTA.emailMascarado));
    fireEvent.click(botao(t.sair));
    await screen.findByText(t.aviso.naoSaiu);
    expect(localStorage.getItem(CHAVE_DO_LOGOUT_PENDENTE)).toBe('{}');

    api.responder(ENTRAR, { status: 200, corpo: SESSAO });
    preencher(t.entrar.email, EMAIL);
    preencher(t.entrar.senha, SENHA);
    fireEvent.click(botao(t.entrar.botao));
    await screen.findByText(t.inicio.conta(CONTA.emailMascarado));
    expect(localStorage.getItem(CHAVE_DO_LOGOUT_PENDENTE)).toBeNull();

    // Recarregar a página: mesma API e mesmo `localStorage`, aplicação nova.
    primeira.unmount();
    const renovacoesAntes = api.pedidosDa(RENOVAR).length;
    const saidasAntes = api.pedidosDa(SAIR).length;
    montarApp(api);
    expect(await screen.findByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
    expect(api.pedidosDa(RENOVAR)).toHaveLength(renovacoesAntes + 1);
    expect(api.pedidosDa(SAIR)).toHaveLength(saidasAntes);
  });

  it('marca presente e o DELETE cai: P1 sem renovar, sem aviso, e a marca continua para a próxima abertura', async () => {
    localStorage.setItem(CHAVE_DO_LOGOUT_PENDENTE, '{}');
    api.responder(SAIR, 'rede');
    api.responder(RENOVAR, { status: 200, corpo: SESSAO });
    montarApp(api);

    await screen.findByLabelText(t.entrar.email);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(0);
    expect(localStorage.getItem(CHAVE_DO_LOGOUT_PENDENTE)).toBe('{}');
  });
});

describe('modo estrito do React (efeitos duas vezes em desenvolvimento)', () => {
  it('com cookie válido, a abertura renova uma vez só e a conta é consultada com o Bearer', async () => {
    api.responder(RENOVAR, { status: 200, corpo: SESSAO });
    api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
    montarApp(api, { envolver: StrictMode });

    expect(await screen.findByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
    expect(api.pedidosDa(RENOVAR)).toHaveLength(1);
    for (const consulta of api.pedidosDa(CONTA_DO_ADMIN)) {
      expect(consulta.cabecalhos['Authorization']).toBe(`Bearer ${SESSAO.tokenAcesso}`);
    }
  });

  it('com logout pendente, o DELETE sai uma vez só', async () => {
    localStorage.setItem(CHAVE_DO_LOGOUT_PENDENTE, '{}');
    api.responder(SAIR, { status: 204 });
    montarApp(api, { envolver: StrictMode });

    await screen.findByLabelText(t.entrar.email);
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(0);
  });

  it('sem cookie, P1 aparece uma vez, sem banner', async () => {
    api.responder(RENOVAR, problema(401, 'nao_autenticado'));
    montarApp(api, { envolver: StrictMode });

    await screen.findByLabelText(t.entrar.email);
    expect(document.querySelectorAll('form')).toHaveLength(1);
    expect(document.querySelector('.ui-banner')).toBeNull();
  });
});

describe('URL, histórico e console', () => {
  it('o fluxo inteiro (P1, P1b, início, sair) não muda a URL nem empilha histórico', async () => {
    const urlAntes = window.location.href;
    const historicoAntes = window.history.length;
    api.responder(RENOVAR, problema(401, 'nao_autenticado'));
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'configurar', desafio: DESAFIO } });
    api.responder(CONFIGURACAO, {
      status: 200,
      corpo: { otpauthUri: URI, segredoBase32: SEGREDO },
    });
    api.responder(CONFIRMACAO, {
      status: 200,
      corpo: { codigosRecuperacao: CODIGOS, sessao: SESSAO },
    });
    api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
    api.responder(SAIR, { status: 204 });
    montarApp(api);

    await entrarComSenha();
    fireEvent.click(await screen.findByRole('button', { name: t.configuracao.passo1.botao }));
    await screen.findByRole('img', { name: t.configuracao.passo2.qr });
    preencher(t.configuracao.passo2.codigo, '654321');
    fireEvent.click(botao(t.configuracao.passo2.botao));
    await screen.findByText(t.configuracao.passo3.aviso);
    fireEvent.click(screen.getByRole('checkbox', { name: t.configuracao.passo3.guardei }));
    fireEvent.click(botao(t.configuracao.passo3.botao));
    await screen.findByText(t.inicio.conta(CONTA.emailMascarado));
    fireEvent.click(botao(t.sair));
    await screen.findByText(t.aviso.saiu);

    expect(window.location.href).toBe(urlAntes);
    expect(window.history.length).toBe(historicoAntes);
  });

  it('o console não recebe e-mail, senha, token, segredo nem código durante o fluxo inteiro', async () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((nivel) =>
      vi.spyOn(console, nivel).mockImplementation(() => undefined),
    );
    api.responder(RENOVAR, problema(401, 'nao_autenticado'));
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'verificar', desafio: DESAFIO } });
    api.responder(
      SEGUNDO_FATOR,
      problema(400, 'validacao', [{ campo: 'codigo', codigo: 'invalido', motivo: 'm' }]),
      {
        status: 200,
        corpo: SESSAO,
      },
    );
    api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
    api.responder(SAIR, { status: 204 });
    montarApp(api);

    await entrarComSenha();
    await screen.findByRole('heading', { level: 1, name: t.segundoFator.titulo });
    preencher(t.segundoFator.codigo, '111111');
    await screen.findByText(/Código inválido/);
    fireEvent.click(botao(t.segundoFator.botao));
    await screen.findByText(t.inicio.conta(CONTA.emailMascarado));
    fireEvent.click(botao(t.sair));
    await screen.findByText(t.aviso.saiu);

    const escrito = JSON.stringify(espioes.flatMap((e) => e.mock.calls.map((c) => c.map(String))));
    for (const proibido of [EMAIL, SENHA, SESSAO.tokenAcesso, DESAFIO, '111111']) {
      expect(escrito, proibido).not.toContain(proibido);
    }
    // Aviso do React (chave repetida, act, propriedade desconhecida) também reprova.
    expect(espioes.flatMap((e) => e.mock.calls)).toEqual([]);
  });

  it('depois de um 401 em P1, a senha digitada não fica em nenhum texto da página nem no título', async () => {
    api.responder(RENOVAR, problema(401, 'nao_autenticado'));
    api.responder(ENTRAR, problema(401, 'nao_autenticado'));
    montarApp(api);
    await entrarComSenha();
    await screen.findByRole('alert');

    expect(campo(t.entrar.senha).value).toBe('');
    expect((document.body.textContent ?? '') + document.title).not.toContain(SENHA);
  });
});
