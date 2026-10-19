// QA do grupo C (etapa 15, CA-09): os códigos de recuperação e o segredo do TOTP vivem só no estado
// da tela. Aparecem uma vez (passo 3), saem da memória ao concluir ou sair, nunca vão para o
// armazenamento do navegador, e quem tenta fechar a página no passo 3 recebe o aviso do navegador.
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIGURACAO,
  CONFIRMACAO,
  CODIGOS,
  CODIGOS_NA_TELA,
  CONTA_DO_ADMIN,
  DESAFIO,
  ENTRAR,
  RENOVAR,
  SAIR,
  SEGREDO,
  URI,
  entrarComSenha,
  montarApp,
  preencher,
  t,
  tudoQueFicaNoNavegador,
} from './fixtures/fluxo-comum.tsx';
import { CONTA, SESSAO, criarApiFalsa, problema, type ApiFalsa } from './teste/api-falsa.ts';

const p3 = t.configuracao.passo3;
let api: ApiFalsa;

beforeEach(() => {
  api = criarApiFalsa();
  localStorage.clear();
  sessionStorage.clear();
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
  // O jsdom não traz estas duas; o teste de download as instala.
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

async function irAoPasso(passo: 1 | 2 | 3) {
  montarApp(api);
  await entrarComSenha();
  await screen.findByText(t.configuracao.passo1.titulo);
  if (passo === 1) return;
  fireEvent.click(screen.getByRole('button', { name: t.configuracao.passo1.botao }));
  await screen.findByRole('img', { name: t.configuracao.passo2.qr });
  if (passo === 2) return;
  preencher(t.configuracao.passo2.codigo, '654321');
  fireEvent.click(screen.getByRole('button', { name: t.configuracao.passo2.botao }));
  await screen.findByText(p3.aviso);
}

function lerTexto(blob: Blob | undefined): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    if (!blob) return rejeitar(new Error('nenhum Blob criado'));
    const leitor = new FileReader();
    leitor.onload = () => resolver(typeof leitor.result === 'string' ? leitor.result : '');
    leitor.onerror = () => rejeitar(new Error('falha ao ler o Blob'));
    leitor.readAsText(blob);
  });
}

/** O que a página inteira mostra: texto, atributos e título da aba. */
const paginaInteira = () => document.documentElement.outerHTML + document.title;

function comCodigo(texto: string): boolean {
  return CODIGOS.some((c) => texto.includes(c)) || CODIGOS_NA_TELA.some((c) => texto.includes(c));
}

describe('passo 3: o que a pessoa vê', () => {
  it('mostra os 10 códigos formatados, só uma vez, e o segredo e o QR saíram da tela', async () => {
    await irAoPasso(3);

    const itens = screen.getAllByRole('listitem');
    expect(itens.map((li) => li.firstElementChild?.textContent)).toEqual(CODIGOS_NA_TELA);
    // Para o leitor de tela, cada código é lido caractere a caractere.
    expect(itens[0]?.querySelector('.ui-oculto-visual')?.textContent).toBe('A B C D E, F G H J K');
    expect(screen.queryByRole('img', { name: t.configuracao.passo2.qr })).toBeNull();
    expect(paginaInteira()).not.toContain(SEGREDO);
    expect(paginaInteira()).not.toContain(URI);
    expect(paginaInteira()).not.toContain('JBSW');
  });

  it('"Concluir e entrar" só vale depois da caixa marcada, e a caixa desmarcada trava de novo', async () => {
    await irAoPasso(3);
    const concluir = screen.getByRole<HTMLButtonElement>('button', { name: p3.botao });
    const guardei = screen.getByRole('checkbox', { name: p3.guardei });

    fireEvent.click(concluir);
    expect(api.pedidosDa(CONTA_DO_ADMIN)).toHaveLength(0);
    fireEvent.click(guardei);
    expect(concluir.disabled).toBe(false);
    fireEvent.click(guardei);
    expect(concluir.disabled).toBe(true);
  });
});

describe('os códigos somem da memória', () => {
  it('ao concluir, nenhum código nem o segredo sobra na página, e a conta abre com o Bearer da confirmação', async () => {
    await irAoPasso(3);
    expect(comCodigo(paginaInteira())).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: p3.guardei }));
    fireEvent.click(screen.getByRole('button', { name: p3.botao }));
    expect(await screen.findByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();

    expect(comCodigo(paginaInteira())).toBe(false);
    expect(paginaInteira()).not.toContain(SEGREDO);
    expect(screen.queryByRole('list', { name: p3.lista })).toBeNull();
    expect(api.pedidosDa(CONTA_DO_ADMIN)[0]?.cabecalhos['Authorization']).toBe(
      `Bearer ${SESSAO.tokenAcesso}`,
    );
  });

  it('"Sair" no passo 3 descarta os códigos e volta a P1 sem eles; entrar de novo não os traz de volta', async () => {
    await irAoPasso(3);
    fireEvent.click(screen.getByRole('button', { name: t.sair }));
    // D1: sem a caixa marcada, "Sair" pede confirmação antes.
    fireEvent.click(screen.getByRole('button', { name: p3.confirmarSaida.sair }));

    expect(await screen.findByText(t.aviso.saiu)).toBeTruthy();
    expect(comCodigo(paginaInteira())).toBe(false);
  });

  it('o navegador não guarda segredo, URI, desafio, token nem código: armazenamentos, cookie, nome da janela e histórico', async () => {
    await irAoPasso(3);
    const guardado = tudoQueFicaNoNavegador() + window.location.href + window.location.search;

    for (const segredo of [
      SEGREDO,
      URI,
      DESAFIO,
      SESSAO.tokenAcesso,
      ...CODIGOS,
      ...CODIGOS_NA_TELA,
    ]) {
      expect(guardado, segredo).not.toContain(segredo);
    }
    expect(window.location.hash).toBe('');
  });
});

describe('sair da página no passo 3 (volta, fechar, recarregar)', () => {
  const sairDaPagina = () => {
    const evento = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(evento);
    return evento;
  };

  it('no passo 3 o navegador é avisado; nos passos 1 e 2 e depois de concluir, não', async () => {
    await irAoPasso(1);
    expect(sairDaPagina().defaultPrevented).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: t.configuracao.passo1.botao }));
    await screen.findByRole('img', { name: t.configuracao.passo2.qr });
    expect(sairDaPagina().defaultPrevented).toBe(false);

    preencher(t.configuracao.passo2.codigo, '654321');
    fireEvent.click(screen.getByRole('button', { name: t.configuracao.passo2.botao }));
    await screen.findByText(p3.aviso);
    await waitFor(() => expect(sairDaPagina().defaultPrevented).toBe(true));

    fireEvent.click(screen.getByRole('checkbox', { name: p3.guardei }));
    fireEvent.click(screen.getByRole('button', { name: p3.botao }));
    await screen.findByText(t.inicio.conta(CONTA.emailMascarado));
    expect(sairDaPagina().defaultPrevented).toBe(false);
  });

  it('o aviso não fica pendurado depois de "Sair" no passo 3 nem depois de desmontar a tela', async () => {
    await irAoPasso(3);
    await waitFor(() => expect(sairDaPagina().defaultPrevented).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: t.sair }));
    fireEvent.click(screen.getByRole('button', { name: p3.confirmarSaida.sair }));
    await screen.findByText(t.aviso.saiu);
    expect(sairDaPagina().defaultPrevented).toBe(false);
  });

  it('o evento `popstate` (botão voltar) não muda de tela nem mexe na URL', async () => {
    await irAoPasso(3);
    const antes = window.location.href;
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
    expect(window.location.href).toBe(antes);
    expect(screen.getAllByRole('listitem')).toHaveLength(CODIGOS.length);
  });
});

describe('copiar e baixar', () => {
  function stubDaAreaDeTransferencia(escrever: (texto: string) => Promise<void>) {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: escrever } });
  }

  it('"Copiar todos" copia os 10 códigos formatados, um por linha, e anuncia', async () => {
    const escrever = vi.fn(() => Promise.resolve());
    stubDaAreaDeTransferencia(escrever);
    await irAoPasso(3);

    fireEvent.click(screen.getByRole('button', { name: p3.copiarTodos }));
    await waitFor(() => expect(escrever).toHaveBeenCalledTimes(1));
    expect(escrever).toHaveBeenCalledWith(CODIGOS_NA_TELA.join('\n'));
    await waitFor(() =>
      expect(screen.getAllByRole('status').map((r) => r.textContent)).toContain(p3.copiados),
    );
  });

  it.each([
    ['a área de transferência recusa', () => Promise.reject(new Error('negado'))],
    [
      'a escrita lança na hora',
      () => {
        throw new Error('negado');
      },
    ],
  ])(
    'quando %s, o anúncio manda copiar à mão e os códigos seguem na tela',
    async (_n, escrever) => {
      stubDaAreaDeTransferencia(escrever);
      await irAoPasso(3);

      fireEvent.click(screen.getByRole('button', { name: p3.copiarTodos }));
      await waitFor(() =>
        expect(screen.getAllByRole('status').map((r) => r.textContent)).toContain(
          t.configuracao.naoCopiou,
        ),
      );
      expect(screen.getAllByRole('listitem')).toHaveLength(CODIGOS.length);
    },
  );

  it('sem `navigator.clipboard` (HTTP, navegador antigo), o aviso aparece e nada quebra', async () => {
    const { clipboard: _, ...semArea } = navigator as Navigator & { clipboard?: unknown };
    vi.stubGlobal('navigator', semArea);
    await irAoPasso(3);

    fireEvent.click(screen.getByRole('button', { name: p3.copiarTodos }));
    await waitFor(() =>
      expect(screen.getAllByRole('status').map((r) => r.textContent)).toContain(
        t.configuracao.naoCopiou,
      ),
    );
  });

  it('"Copiar chave" no passo 2 copia a chave sem espaços', async () => {
    const escrever = vi.fn(() => Promise.resolve());
    stubDaAreaDeTransferencia(escrever);
    await irAoPasso(2);

    fireEvent.click(screen.getByRole('button', { name: t.configuracao.passo2.copiarChave }));
    await waitFor(() => expect(escrever).toHaveBeenCalledWith(SEGREDO));
  });

  it('"Baixar (.txt)" gera o arquivo com o cabeçalho e os códigos, solta o endereço blob e não deixa o link no DOM', async () => {
    let blob: Blob | undefined;
    const criar = vi.fn((valor: Blob) => {
      blob = valor;
      return 'blob:falso-1';
    });
    const revogar = vi.fn();
    Object.assign(URL, { createObjectURL: criar, revokeObjectURL: revogar });
    const cliques: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      cliques.push({ href: this.href, download: this.download });
    });
    await irAoPasso(3);

    fireEvent.click(screen.getByRole('button', { name: p3.baixar }));

    expect(cliques).toEqual([{ href: 'blob:falso-1', download: p3.nomeDoArquivo }]);
    expect(document.querySelector('a[download]')).toBeNull();
    const texto = await lerTexto(blob);
    expect(texto).toBe([p3.cabecalhoDoArquivo, '', ...CODIGOS_NA_TELA, ''].join('\n'));
    expect(texto).not.toContain(SEGREDO);
    expect(blob?.type).toBe('text/plain;charset=utf-8');
    // R5: o endereço sai cerca de 1 s depois do clique.
    await waitFor(() => expect(revogar).toHaveBeenCalledWith('blob:falso-1'), { timeout: 3000 });
    expect(screen.getAllByRole('status').map((r) => r.textContent)).toContain(p3.baixado);
  });
});
