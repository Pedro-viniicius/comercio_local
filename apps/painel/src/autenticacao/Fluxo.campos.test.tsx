// QA do grupo C (etapa 15, CA-13): valores de borda digitados nas telas. O texto de cada erro vem
// de `mensagemDoCampo`; a senha nunca é aparada (espaços contam) e nenhum valor digitado vai
// parar em texto de erro.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { textos } from '../textos/pt-BR.ts';
import {
  DESAFIO,
  ENTRAR,
  RECUPERACAO,
  REDEFINICAO,
  RENOVAR,
  SEGUNDO_FATOR,
  campo,
  digitarCredenciais,
  irParaEntrar,
  montarApp,
  preencher,
  t,
} from './fixtures/fluxo-comum.tsx';
import { SESSAO, criarApiFalsa, problema, type ApiFalsa } from './teste/api-falsa.ts';

let api: ApiFalsa;

beforeEach(() => {
  api = criarApiFalsa();
  localStorage.clear();
  api.responder(RENOVAR, problema(401, 'nao_autenticado'));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const botao = (nome: string) => screen.getByRole<HTMLButtonElement>('button', { name: nome });
const mensagensDeErro = () =>
  [...document.querySelectorAll('.ui-campo__erro')].map((e) => e.textContent ?? '');

describe('P1: valores de borda', () => {
  it('e-mail de 300 caracteres e senha de 5.000 dão erro em português, sem repetir o valor', async () => {
    montarApp(api);
    await digitarCredenciais(`${'a'.repeat(300)}@exemplo.com.br`, 'x'.repeat(5000));
    fireEvent.click(botao(t.entrar.botao));

    expect(mensagensDeErro()).toEqual([
      `! ${textos.erro.email.invalido}`,
      '! Use até 128 caracteres',
    ]);
    expect(document.body.textContent).not.toContain('aaaa');
    expect(document.body.textContent).not.toContain('xxxx');
    expect(api.pedidosDa(ENTRAR)).toHaveLength(0);
  });

  it('a senha vai à API exatamente como digitada, com espaços nas pontas', async () => {
    api.responder(ENTRAR, problema(401, 'nao_autenticado'));
    montarApp(api);
    await digitarCredenciais('  Pedro@Exemplo.com.br ', '  uma senha com espaços  ');
    fireEvent.click(botao(t.entrar.botao));
    await screen.findByRole('alert');

    expect(api.pedidosDa(ENTRAR)[0]?.corpo).toEqual({
      email: 'pedro@exemplo.com.br',
      senha: '  uma senha com espaços  ',
      cliente: 'painel',
    });
  });

  it('senha só de espaços vai à API como digitada: a senha atual não passa pela regra de senha nova', async () => {
    api.responder(ENTRAR, problema(401, 'nao_autenticado'));
    montarApp(api);
    await digitarCredenciais('pedro@exemplo.com.br', '        ');
    fireEvent.click(botao(t.entrar.botao));
    await screen.findByRole('alert');

    expect(api.pedidosDa(ENTRAR)[0]?.corpo).toMatchObject({ senha: '        ' });
  });

  it('e-mail com HTML ou aspas é só texto: o erro nunca o interpreta nem o devolve', async () => {
    montarApp(api);
    await digitarCredenciais('<img src=x onerror=alert(1)>@x', 'senha-boa-123');
    fireEvent.click(botao(t.entrar.botao));

    expect(await screen.findByText(textos.erro.email.invalido)).toBeTruthy();
    expect(document.querySelector('img[onerror]')).toBeNull();
    // O valor só existe como atributo `value` do campo (escapado) e em nenhum texto da página.
    expect(document.body.textContent).not.toContain('onerror');
  });
});

describe('P1a: código', () => {
  beforeEach(() => {
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'verificar', desafio: DESAFIO } });
  });

  async function chegar() {
    montarApp(api);
    await digitarCredenciais();
    fireEvent.click(botao(t.entrar.botao));
    await screen.findByRole('heading', { level: 1, name: t.segundoFator.titulo });
  }

  it.each([
    ['com espaço no meio', '123 456'],
    ['com espaços nas pontas', ' 123456 '],
  ])('código %s é normalizado para 6 dígitos', async (_n, digitado) => {
    api.responder(SEGUNDO_FATOR, { status: 200, corpo: SESSAO });
    await chegar();
    // Com os 6 dígitos completos o envio sai sozinho: não precisa clicar.
    preencher(t.segundoFator.codigo, digitado);

    await waitFor(() => expect(api.pedidosDa(SEGUNDO_FATOR)).toHaveLength(1));
    expect(api.pedidosDa(SEGUNDO_FATOR)[0]?.corpo).toEqual({ desafio: DESAFIO, codigo: '123456' });
  });

  it.each([
    ['letras', 'abcdef'],
    ['5 dígitos', '12345'],
    ['7 dígitos', '1234567'],
    ['algarismos fora do ASCII', '١٢٣٤٥٦'],
    ['texto enorme', '1'.repeat(10_000)],
  ])('código com %s: erro de campo local, sem chamar a API', async (_n, digitado) => {
    await chegar();
    preencher(t.segundoFator.codigo, digitado);
    fireEvent.click(botao(t.segundoFator.botao));

    expect(await screen.findByText(textos.erro.codigo.invalido)).toBeTruthy();
    expect(api.pedidosDa(SEGUNDO_FATOR)).toHaveLength(0);
  });

  it('código de recuperação com hífen, minúsculas e espaços vai normalizado', async () => {
    api.responder(
      SEGUNDO_FATOR,
      problema(400, 'validacao', [{ campo: 'codigoRecuperacao', codigo: 'invalido', motivo: 'm' }]),
    );
    await chegar();
    fireEvent.click(screen.getByRole('button', { name: t.segundoFator.usarRecuperacao }));
    preencher(t.segundoFator.codigoRecuperacao, ' abcde-fghjk ');
    fireEvent.click(botao(t.segundoFator.botao));

    expect(await screen.findByText(textos.erro.codigoRecuperacao.invalido)).toBeTruthy();
    expect(api.pedidosDa(SEGUNDO_FATOR)[0]?.corpo).toEqual({
      desafio: DESAFIO,
      codigoRecuperacao: 'ABCDEFGHJK',
    });
  });

  // Q23: depois de um código recusado o campo guarda os 6 dígitos. Colar ou autopreencher OUTRO código
  // completo por cima (Ctrl+A, Ctrl+V; preenchimento do SMS/gerenciador) não envia sozinho, porque
  // o envio automático só dispara quando o valor ANTERIOR estava incompleto. A tela promete enviar ao
  // completar os 6 dígitos (wireframe P1).
  it('Q23: colar um código novo completo por cima do código recusado envia sozinho', async () => {
    api.responder(
      SEGUNDO_FATOR,
      problema(400, 'validacao', [{ campo: 'codigo', codigo: 'invalido', motivo: 'm' }]),
      { status: 200, corpo: SESSAO },
    );
    await chegar();
    preencher(t.segundoFator.codigo, '111111');
    await screen.findByText(textos.erro.codigo.invalido);
    expect(api.pedidosDa(SEGUNDO_FATOR)).toHaveLength(1);

    preencher(t.segundoFator.codigo, '222222');

    await waitFor(() => expect(api.pedidosDa(SEGUNDO_FATOR)).toHaveLength(2));
    expect(api.pedidosDa(SEGUNDO_FATOR)[1]?.corpo).toEqual({ desafio: DESAFIO, codigo: '222222' });
  });
});

describe('P1c: valores de borda', () => {
  const r = t.recuperacao;

  async function irParaRecuperacao(email = 'pedro@exemplo.com.br') {
    montarApp(api);
    await irParaEntrar();
    preencher(t.entrar.email, email);
    fireEvent.click(botao(t.entrar.esqueci));
    await screen.findByRole('heading', { level: 1, name: r.titulo });
  }

  it('e-mail vazio ou inválido no passo 1: erro de campo, sem pedir código', async () => {
    await irParaRecuperacao('');
    fireEvent.click(botao(r.enviar));
    expect(await screen.findByText(textos.erro.email.obrigatorio)).toBeTruthy();
    expect(document.activeElement).toBe(campo(r.email));

    preencher(r.email, 'sem-arroba');
    fireEvent.click(botao(r.enviar));
    expect(await screen.findByText(textos.erro.email.invalido)).toBeTruthy();
    expect(api.pedidosDa(RECUPERACAO)).toHaveLength(0);
  });

  it('o e-mail aparece aparado na frase do passo 2 e a senha nova vai sem ser aparada', async () => {
    api.responder(RECUPERACAO, { status: 202 });
    api.responder(REDEFINICAO, problema(503, 'indisponivel'));
    await irParaRecuperacao('  pedro@exemplo.com.br  ');
    fireEvent.click(botao(r.enviar));
    await screen.findByLabelText(r.codigo);
    expect(screen.getByText(r.enviado('pedro@exemplo.com.br'))).toBeTruthy();

    preencher(r.codigo, '123456');
    preencher(r.novaSenha, '  senha nova com espaços  ');
    fireEvent.click(botao(r.salvar));
    await screen.findByRole('alert');
    expect(api.pedidosDa(REDEFINICAO)[0]?.corpo).toEqual({
      email: 'pedro@exemplo.com.br',
      codigo: '123456',
      novaSenha: '  senha nova com espaços  ',
    });
  });

  it.each([
    ['curta', 'abc123', 'Use 8 caracteres ou mais'],
    ['longa', 'a1'.repeat(65), 'Use até 128 caracteres'],
  ])(
    'senha nova %s: erro local com o motivo do contrato, sem chamar a API',
    async (_n, senha, motivo) => {
      api.responder(RECUPERACAO, { status: 202 });
      await irParaRecuperacao();
      fireEvent.click(botao(r.enviar));
      await screen.findByLabelText(r.codigo);

      preencher(r.codigo, '123456');
      preencher(r.novaSenha, senha);
      fireEvent.click(botao(r.salvar));

      expect(await screen.findByText(motivo)).toBeTruthy();
      expect(document.activeElement).toBe(campo(r.novaSenha));
      expect(api.pedidosDa(REDEFINICAO)).toHaveLength(0);
      expect(document.body.textContent).not.toContain(senha);
    },
  );
});
