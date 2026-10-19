// QA do grupo C, rodada 2 (D6, D7 e o foco no `h1` do Início): ajustes visuais do designer que mudam
// o que o leitor de tela e o teclado recebem. O jsdom não desenha, então o que se prova é o texto
// do botão, o momento em que o texto entra na região de status e o elemento que tem o foco.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RegiaoDeStatus } from './RegiaoDeStatus.tsx';
import {
  CONTA_DO_ADMIN,
  DESAFIO,
  ENTRAR,
  RENOVAR,
  SEGUNDO_FATOR,
  entrarComSenha,
  irParaEntrar,
  montarApp,
  preencher,
  t,
} from './fixtures/fluxo-comum.tsx';
import { CONTA, SESSAO, criarApiFalsa, problema, type ApiFalsa } from './teste/api-falsa.ts';

let api: ApiFalsa;

beforeEach(() => {
  localStorage.clear();
  api = criarApiFalsa();
  api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('D6: o botão que volta a P1 diz para onde vai', () => {
  it('o texto é "Voltar para entrar" e não sobra botão "Voltar" solto em P1a nem em P1c', async () => {
    expect(t.voltarParaEntrar).toBe('Voltar para entrar');
    api.responder(RENOVAR, problema(401, 'nao_autenticado'));
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'verificar', desafio: DESAFIO } });
    montarApp(api);
    await entrarComSenha();
    await screen.findByRole('heading', { level: 1, name: t.segundoFator.titulo });

    expect(screen.getByRole('button', { name: 'Voltar para entrar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Voltar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para entrar' }));
    await irParaEntrar();

    fireEvent.click(screen.getByRole('button', { name: t.entrar.esqueci }));
    await screen.findByRole('heading', { level: 1, name: t.recuperacao.titulo });
    expect(screen.getByRole('button', { name: 'Voltar para entrar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Voltar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para entrar' }));
    await irParaEntrar();
  });

  it('em P1c com o e-mail digitado, "Voltar para entrar" devolve P1 com o e-mail preenchido', async () => {
    api.responder(RENOVAR, problema(401, 'nao_autenticado'));
    montarApp(api);
    await irParaEntrar();
    preencher(t.entrar.email, 'pedro@exemplo.com.br');
    fireEvent.click(screen.getByRole('button', { name: t.entrar.esqueci }));
    await screen.findByRole('heading', { level: 1, name: t.recuperacao.titulo });

    fireEvent.click(screen.getByRole('button', { name: t.voltarParaEntrar }));
    await irParaEntrar();
    expect(screen.getByLabelText<HTMLInputElement>(t.entrar.email).value).toBe(
      'pedro@exemplo.com.br',
    );
  });
});

describe('D7: a região de status monta vazia e o texto entra depois', () => {
  it('na marcação do servidor a região existe, com `role="status"` e sem texto', () => {
    const html = renderToStaticMarkup(
      <RegiaoDeStatus texto="Carregando o painel…" className="x" />,
    );
    expect(html).toContain('role="status"');
    expect(html).not.toContain('Carregando o painel…');
  });

  it('no navegador o texto entra numa região que já estava no DOM, e some quando a tela troca', async () => {
    const registros: MutationRecord[] = [];
    const observador = new MutationObserver((lote) => registros.push(...lote));
    observador.observe(document.body, { childList: true, subtree: true, characterData: true });
    const { container, unmount } = render(<RegiaoDeStatus texto="Carregando o painel…" />);
    await Promise.resolve();
    observador.disconnect();

    const regiao = container.querySelector('p[role="status"]');
    expect(regiao?.textContent).toBe('Carregando o painel…');
    // A região foi inserida primeiro; o texto entrou em outra mutação, com a região já no DOM.
    const insercaoDaRegiao = registros.findIndex((r) => [...r.addedNodes].includes(regiao as Node));
    const entradaDoTexto = registros.findIndex(
      (r) =>
        (r.target === regiao &&
          [...r.addedNodes].some((n) => n.textContent === 'Carregando o painel…')) ||
        (r.type === 'characterData' && r.target.parentNode === regiao),
    );
    expect(insercaoDaRegiao).toBeGreaterThanOrEqual(0);
    expect(entradaDoTexto).toBeGreaterThan(insercaoDaRegiao);
    unmount();
  });

  it('o painel mostra "Carregando o painel…" numa única região de status enquanto abre', async () => {
    const liberar = api.segurar(RENOVAR);
    montarApp(api);
    const regiao = await screen.findByRole('status');
    expect(regiao.textContent).toBe(t.abrindo);
    expect(screen.getAllByRole('status')).toHaveLength(1);

    liberar(problema(401, 'nao_autenticado'));
    await irParaEntrar();
  });
});

describe('o foco no `h1` do Início', () => {
  it('ao abrir com a sessão do cookie, o foco vai ao título "Início" (focável por código)', async () => {
    api.responder(RENOVAR, { status: 200, corpo: SESSAO });
    montarApp(api);
    const titulo = await screen.findByRole('heading', { level: 1, name: t.inicio.titulo });

    expect(document.activeElement).toBe(titulo);
    expect(titulo.getAttribute('tabindex')).toBe('-1');
    expect(document.title).toBe(t.tituloDaAba(t.inicio.titulo));
  });

  it('depois do login com senha e código, o foco vai ao título "Início"', async () => {
    api.responder(RENOVAR, problema(401, 'nao_autenticado'));
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'verificar', desafio: DESAFIO } });
    api.responder(SEGUNDO_FATOR, { status: 200, corpo: SESSAO });
    montarApp(api);
    await entrarComSenha();
    await screen.findByRole('heading', { level: 1, name: t.segundoFator.titulo });
    preencher(t.segundoFator.codigo, '123456');

    const titulo = await screen.findByRole('heading', { level: 1, name: t.inicio.titulo });
    expect(document.activeElement).toBe(titulo);
  });
});
