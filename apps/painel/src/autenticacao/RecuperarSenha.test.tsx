// P1c (spec 01, A4): pelo fluxo real a partir de P1 e, com relógio falso, o reenvio de 60 s.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.tsx';
import { textos } from '../textos/pt-BR.ts';
import { criarAutenticacaoDoPainel } from '../sessao/autenticacao-do-painel.ts';
import { ESPERA_DO_REENVIO_S, RecuperarSenha } from './RecuperarSenha.tsx';
import { BASE_URL, criarApiFalsa, problema, type ApiFalsa } from './teste/api-falsa.ts';

const t = textos.autenticacao;
const r = t.recuperacao;
const RECUPERACAO = 'POST /v1/senha/recuperacao';
const REDEFINICAO = 'POST /v1/senha/redefinicao';
const CODIGO_DA_TELA = textos.erroPorTela.recuperacaoDeSenha.codigo.invalido;

let api: ApiFalsa;

const anuncios = () => screen.getAllByRole('status').map((regiao) => regiao.textContent);

function preencher(rotulo: string, valor: string) {
  fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
}

async function irParaRecuperacao(email: string) {
  api.responder('POST /v1/sessoes/renovacao', problema(401, 'nao_autenticado'));
  render(<App autenticacao={criarAutenticacaoDoPainel({ baseUrl: BASE_URL, fetch: api.fetch })} />);
  await screen.findByLabelText(t.entrar.email);
  preencher(t.entrar.email, email);
  fireEvent.click(screen.getByRole('button', { name: t.entrar.esqueci }));
  await screen.findByRole('heading', { level: 1, name: r.titulo });
}

async function pedirCodigo() {
  fireEvent.click(screen.getByRole('button', { name: r.enviar }));
  await screen.findByLabelText(r.codigo);
}

function salvar(codigo: string, novaSenha: string) {
  preencher(r.codigo, codigo);
  preencher(r.novaSenha, novaSenha);
  fireEvent.click(screen.getByRole('button', { name: r.salvar }));
}

beforeEach(() => {
  api = criarApiFalsa();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('P1c pelo fluxo', () => {
  it('pede o código com o e-mail de P1, redefine e volta a P1 com o aviso e o e-mail', async () => {
    api.responder(RECUPERACAO, { status: 202 });
    api.responder(REDEFINICAO, { status: 204 });
    await irParaRecuperacao('pedro@exemplo.com.br');

    expect(screen.getByLabelText<HTMLInputElement>(r.email).value).toBe('pedro@exemplo.com.br');
    await pedirCodigo();
    expect(screen.getByText(r.enviado('pedro@exemplo.com.br'))).toBeTruthy();
    expect(api.pedidosDa(RECUPERACAO)[0]?.corpo).toEqual({ email: 'pedro@exemplo.com.br' });

    salvar('123 456', 'uma-senha-nova-boa');
    expect(await screen.findByText(t.aviso.senhaAlterada)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(t.entrar.email).value).toBe(
      'pedro@exemplo.com.br',
    );
    expect(api.pedidosDa(REDEFINICAO)[0]?.corpo).toEqual({
      email: 'pedro@exemplo.com.br',
      codigo: '123456',
      novaSenha: 'uma-senha-nova-boa',
    });
  });

  it.each([
    [
      '400 campos[codigo]',
      problema(400, 'validacao', [{ campo: 'codigo', codigo: 'invalido', motivo: 'm' }]),
    ],
    ['401', problema(401, 'nao_autenticado')],
    ['429', problema(429, 'limite_excedido')],
  ])('%s dá a mesma mensagem no código ("Peça um novo")', async (_, resposta) => {
    api.responder(RECUPERACAO, { status: 202 });
    api.responder(REDEFINICAO, resposta);
    await irParaRecuperacao('pedro@exemplo.com.br');
    await pedirCodigo();
    salvar('123456', 'uma-senha-nova-boa');

    expect(await screen.findByText(CODIGO_DA_TELA)).toBeTruthy();
    expect(screen.queryByText(textos.erro.codigo.invalido)).toBeNull();
  });

  it('senha nova recusada mostra o `motivo` da API (sem chave própria)', async () => {
    api.responder(RECUPERACAO, { status: 202 });
    api.responder(
      REDEFINICAO,
      problema(400, 'validacao', [
        { campo: 'novaSenha', codigo: 'comum', motivo: 'Essa senha é muito usada. Escolha outra.' },
      ]),
    );
    await irParaRecuperacao('pedro@exemplo.com.br');
    await pedirCodigo();
    salvar('123456', 'uma-senha-nova-boa');
    expect(await screen.findByText('Essa senha é muito usada. Escolha outra.')).toBeTruthy();
  });

  it('validação local: código e senha curtos não chamam a API', async () => {
    api.responder(RECUPERACAO, { status: 202 });
    await irParaRecuperacao('pedro@exemplo.com.br');
    await pedirCodigo();
    salvar('12', 'curta');

    expect(await screen.findByText(CODIGO_DA_TELA)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(r.codigo));
    expect(api.pedidosDa(REDEFINICAO)).toHaveLength(0);
  });

  it('429 ao pedir o código mostra o aviso de espera, sem avançar', async () => {
    api.responder(RECUPERACAO, problema(429, 'limite_excedido'));
    await irParaRecuperacao('pedro@exemplo.com.br');
    fireEvent.click(screen.getByRole('button', { name: r.enviar }));

    expect((await screen.findByRole('alert')).textContent).toContain(r.limite);
    expect(screen.queryByLabelText(r.codigo)).toBeNull();
  });

  it('"Voltar" leva a P1 com o e-mail digitado', async () => {
    await irParaRecuperacao('');
    preencher(r.email, 'ana@exemplo.com.br');
    fireEvent.click(screen.getByRole('button', { name: t.voltarParaEntrar }));
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>(t.entrar.email).value).toBe(
        'ana@exemplo.com.br',
      ),
    );
  });
});

describe('reenvio do código', () => {
  it('fica travado 60 s com a contagem em texto e anuncia quando libera', async () => {
    vi.useFakeTimers();
    const solicitarRecuperacao = vi.fn(() => Promise.resolve());
    render(
      <RecuperarSenha
        autenticacao={{ solicitarRecuperacao, redefinirSenha: vi.fn() }}
        emailInicial="pedro@exemplo.com.br"
        aoConcluir={vi.fn()}
        aoVoltar={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: r.enviar }));
    await act(() => vi.advanceTimersByTimeAsync(0));

    const reenviar = () =>
      screen.getByRole<HTMLButtonElement>('button', { name: /Reenviar código/ });
    expect(reenviar().textContent).toBe(r.reenviarEm('1:00'));
    expect(reenviar().disabled).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(reenviar().textContent).toBe(r.reenviarEm('0:45'));

    await act(() => vi.advanceTimersByTimeAsync((ESPERA_DO_REENVIO_S - 15) * 1000));
    expect(reenviar().textContent).toBe(r.reenviar);
    expect(reenviar().disabled).toBe(false);
    expect(anuncios()).toContain(r.reenvioLiberado);

    fireEvent.click(reenviar());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(solicitarRecuperacao).toHaveBeenCalledTimes(2);
    expect(anuncios()).toContain(r.reenviado);
    expect(reenviar().disabled).toBe(true);
  });
});
