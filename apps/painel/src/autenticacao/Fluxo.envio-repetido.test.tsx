// QA do grupo C (etapa 15): duplo clique, Enter repetido e reenvio nas telas P1 a P1c. Em todos os
// casos a API vê UM pedido por intenção da pessoa, o botão fica `aria-busy` e os campos só de
// leitura enquanto espera, e depois de uma falha o mesmo envio pode ser refeito.
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONFIGURACAO,
  CONFIRMACAO,
  CODIGOS,
  CONTA_DO_ADMIN,
  DESAFIO,
  ENTRAR,
  RECUPERACAO,
  REDEFINICAO,
  RENOVAR,
  SAIR,
  SEGREDO,
  SEGUNDO_FATOR,
  URI,
  campo,
  digitarCredenciais,
  entrarComSenha,
  montarApp,
  preencher,
  t,
} from './fixtures/fluxo-comum.tsx';
import { CONTA, SESSAO, criarApiFalsa, problema, type ApiFalsa } from './teste/api-falsa.ts';

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

// Carregando, o nome acessível do botão vira "Enviando…" (o rótulo fica escondido).
const botao = (nome: string) =>
  screen.queryByRole<HTMLButtonElement>('button', { name: nome }) ??
  screen.getByRole<HTMLButtonElement>('button', { name: t.enviando });

describe('P1: envio repetido', () => {
  it('clique e Enter repetidos com o envio no ar mandam um pedido só e travam os campos', async () => {
    const liberar = api.segurar(ENTRAR);
    montarApp(api);
    await digitarCredenciais();
    const formulario = botao(t.entrar.botao).closest('form') as HTMLFormElement;

    fireEvent.click(botao(t.entrar.botao));
    for (let i = 0; i < 3; i += 1) fireEvent.click(botao(t.entrar.botao));
    fireEvent.submit(formulario);
    fireEvent.submit(formulario);

    await waitFor(() => expect(api.pedidosDa(ENTRAR)).toHaveLength(1));
    expect(botao(t.entrar.botao).getAttribute('aria-busy')).toBe('true');
    expect(campo(t.entrar.email).readOnly).toBe(true);
    expect(campo(t.entrar.senha).readOnly).toBe(true);
    expect(screen.getAllByRole('status').map((r) => r.textContent)).toContain(t.enviando);

    liberar(problema(401, 'nao_autenticado'));
    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.credenciais);
    expect(api.pedidosDa(ENTRAR)).toHaveLength(1);
    expect(botao(t.entrar.botao).getAttribute('aria-busy')).toBeNull();
    expect(campo(t.entrar.senha).readOnly).toBe(false);
  });

  it('depois da falha, a pessoa envia de novo e a API recebe o segundo pedido', async () => {
    api.responder(ENTRAR, problema(401, 'nao_autenticado'), {
      status: 200,
      corpo: { etapa: 'verificar', desafio: DESAFIO },
    });
    montarApp(api);
    await entrarComSenha();
    await screen.findByRole('alert');

    preencher(t.entrar.senha, 'outra-senha-boa');
    fireEvent.click(botao(t.entrar.botao));

    await screen.findByRole('heading', { level: 1, name: t.segundoFator.titulo });
    expect(api.pedidosDa(ENTRAR)).toHaveLength(2);
    expect(api.pedidosDa(ENTRAR)[1]?.corpo).toMatchObject({ senha: 'outra-senha-boa' });
  });
});

describe('P1a: código digitado, clique e Enter ao mesmo tempo', () => {
  beforeEach(() => {
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'verificar', desafio: DESAFIO } });
  });

  async function chegarAoSegundoFator() {
    montarApp(api);
    await entrarComSenha();
    await screen.findByRole('heading', { level: 1, name: t.segundoFator.titulo });
  }

  it('o envio automático dos 6 dígitos, o clique e o Enter viram um pedido só', async () => {
    const liberar = api.segurar(SEGUNDO_FATOR);
    api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
    await chegarAoSegundoFator();
    const formulario = botao(t.segundoFator.botao).closest('form') as HTMLFormElement;

    preencher(t.segundoFator.codigo, '123456');
    fireEvent.click(botao(t.segundoFator.botao));
    fireEvent.click(botao(t.segundoFator.botao));
    fireEvent.submit(formulario);

    await waitFor(() => expect(api.pedidosDa(SEGUNDO_FATOR)).toHaveLength(1));
    expect(botao(t.segundoFator.botao).getAttribute('aria-busy')).toBe('true');

    liberar({ status: 200, corpo: SESSAO });
    expect(await screen.findByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
    expect(api.pedidosDa(SEGUNDO_FATOR)).toHaveLength(1);
  });

  it('o mesmo código dos mesmos 6 dígitos, digitado de novo depois de um 5xx, é enviado outra vez', async () => {
    api.responder(SEGUNDO_FATOR, problema(503, 'indisponivel'), { status: 200, corpo: SESSAO });
    api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
    await chegarAoSegundoFator();

    preencher(t.segundoFator.codigo, '123456');
    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
    expect(campo(t.segundoFator.codigo).value).toBe('123456');

    fireEvent.click(botao(t.segundoFator.botao));
    expect(await screen.findByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
    expect(api.pedidosDa(SEGUNDO_FATOR)).toHaveLength(2);
  });

  it('digitar mais um caractere depois dos 6 não reenvia sozinho (só o botão envia)', async () => {
    api.responder(SEGUNDO_FATOR, problema(503, 'indisponivel'));
    await chegarAoSegundoFator();

    preencher(t.segundoFator.codigo, '123456');
    await screen.findByRole('alert');
    preencher(t.segundoFator.codigo, '1234567');
    await act(() => Promise.resolve());

    expect(api.pedidosDa(SEGUNDO_FATOR)).toHaveLength(1);
  });
});

describe('P1b: configuração', () => {
  beforeEach(() => {
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'configurar', desafio: DESAFIO } });
  });

  it('"Já tenho, continuar" com o pedido no ar não pede a configuração duas vezes', async () => {
    const liberar = api.segurar(CONFIGURACAO);
    montarApp(api);
    await entrarComSenha();
    await screen.findByText(t.configuracao.passo1.titulo);

    for (let i = 0; i < 3; i += 1) fireEvent.click(botao(t.configuracao.passo1.botao));
    await waitFor(() => expect(api.pedidosDa(CONFIGURACAO)).toHaveLength(1));
    expect(botao(t.configuracao.passo1.botao).getAttribute('aria-busy')).toBe('true');

    liberar({ status: 200, corpo: { otpauthUri: URI, segredoBase32: SEGREDO } });
    await screen.findByRole('img', { name: t.configuracao.passo2.qr });
    expect(api.pedidosDa(CONFIGURACAO)).toHaveLength(1);
  });

  it('"Confirmar" repetido consome o código uma vez só e o passo 3 aparece uma vez', async () => {
    api.responder(CONFIGURACAO, {
      status: 200,
      corpo: { otpauthUri: URI, segredoBase32: SEGREDO },
    });
    const liberar = api.segurar(CONFIRMACAO);
    montarApp(api);
    await entrarComSenha();
    fireEvent.click(await screen.findByRole('button', { name: t.configuracao.passo1.botao }));
    await screen.findByRole('img', { name: t.configuracao.passo2.qr });

    preencher(t.configuracao.passo2.codigo, '654321');
    const formulario = botao(t.configuracao.passo2.botao).closest('form') as HTMLFormElement;
    fireEvent.click(botao(t.configuracao.passo2.botao));
    fireEvent.click(botao(t.configuracao.passo2.botao));
    fireEvent.submit(formulario);
    await waitFor(() => expect(api.pedidosDa(CONFIRMACAO)).toHaveLength(1));
    expect(campo(t.configuracao.passo2.codigo).readOnly).toBe(true);

    liberar({ status: 200, corpo: { codigosRecuperacao: CODIGOS, sessao: SESSAO } });
    await screen.findByText(t.configuracao.passo3.aviso);
    expect(api.pedidosDa(CONFIRMACAO)).toHaveLength(1);
    expect(screen.getAllByRole('listitem')).toHaveLength(CODIGOS.length);
  });
});

describe('P1c: recuperar senha', () => {
  const r = t.recuperacao;

  async function irParaRecuperacao() {
    montarApp(api);
    await digitarCredenciais();
    fireEvent.click(botao(t.entrar.esqueci));
    await screen.findByRole('heading', { level: 1, name: r.titulo });
  }

  it('"Enviar código" repetido pede um e-mail só', async () => {
    const liberar = api.segurar(RECUPERACAO);
    await irParaRecuperacao();
    const formulario = botao(r.enviar).closest('form') as HTMLFormElement;

    fireEvent.click(botao(r.enviar));
    fireEvent.click(botao(r.enviar));
    fireEvent.submit(formulario);
    await waitFor(() => expect(api.pedidosDa(RECUPERACAO)).toHaveLength(1));
    expect(campo(r.email).readOnly).toBe(true);

    liberar({ status: 202 });
    await screen.findByLabelText(r.codigo);
    expect(api.pedidosDa(RECUPERACAO)).toHaveLength(1);
  });

  it('"Salvar nova senha" repetido redefine uma vez; o código não é gasto duas vezes', async () => {
    api.responder(RECUPERACAO, { status: 202 });
    const liberar = api.segurar(REDEFINICAO);
    await irParaRecuperacao();
    fireEvent.click(botao(r.enviar));
    await screen.findByLabelText(r.codigo);

    preencher(r.codigo, '123456');
    preencher(r.novaSenha, 'uma-senha-nova-boa');
    const formulario = botao(r.salvar).closest('form') as HTMLFormElement;
    fireEvent.click(botao(r.salvar));
    fireEvent.click(botao(r.salvar));
    fireEvent.submit(formulario);
    await waitFor(() => expect(api.pedidosDa(REDEFINICAO)).toHaveLength(1));
    // Reenviar também fica de fora enquanto a redefinição está no ar.
    fireEvent.click(screen.getByRole('button', { name: /Reenviar código/ }));
    expect(api.pedidosDa(RECUPERACAO)).toHaveLength(1);

    liberar({ status: 204 });
    expect(await screen.findByText(t.aviso.senhaAlterada)).toBeTruthy();
    expect(api.pedidosDa(REDEFINICAO)).toHaveLength(1);
  });
});

describe('Sair e "Tentar de novo" repetidos', () => {
  it('dois cliques seguidos em "Sair" fazem um logout só', async () => {
    api.responder(RENOVAR, { status: 200, corpo: SESSAO });
    api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
    const liberar = api.segurar(SAIR);
    montarApp(api);
    await screen.findByText(t.inicio.conta(CONTA.emailMascarado));

    const sair = botao(t.sair);
    // No mesmo instante, antes de a tela trocar: vale a guarda do fluxo, não o botão sumir.
    act(() => {
      sair.click();
      sair.click();
    });
    expect(screen.getByRole('status').textContent).toBe(t.saindo);
    await waitFor(() => expect(api.pedidosDa(SAIR)).toHaveLength(1));

    liberar({ status: 204 });
    expect(await screen.findByText(t.aviso.saiu)).toBeTruthy();
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
  });

  it('"Tentar de novo" ao abrir, com dois cliques no mesmo instante, renova uma vez a mais', async () => {
    api.responder(RENOVAR, 'rede', problema(401, 'nao_autenticado'));
    montarApp(api);
    await screen.findByText(t.aviso.servidor);

    const tentar = botao(t.tentarDeNovo);
    act(() => {
      tentar.click();
      tentar.click();
    });

    await screen.findByLabelText(t.entrar.email);
    // O pedido inicial e uma renovação nova: a fila única do cliente junta as duas chamadas.
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);
  });
});
