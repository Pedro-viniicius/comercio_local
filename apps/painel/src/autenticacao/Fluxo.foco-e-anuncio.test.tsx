// QA do grupo C (etapa 15): foco, título da aba e anúncio para leitor de tela nas trocas de tela
// (spec 01, "Acessibilidade": foco no primeiro erro, anúncio do total, banner de erro assertivo).
// O jsdom não lê tela, então o que se prova é o que o leitor de tela recebe: o elemento focado, o
// papel (`alert` ou `status`) e a região de anúncio que já existe quando o texto entra.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { textos } from '../textos/pt-BR.ts';
import {
  CONFIGURACAO,
  CONFIRMACAO,
  CODIGOS,
  DESAFIO,
  ENTRAR,
  RENOVAR,
  SEGREDO,
  SEGUNDO_FATOR,
  URI,
  anuncios,
  campo,
  entrarComSenha,
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

const titulo = () => document.title;
// O título é gravado num efeito do React, que pode rodar depois do `findByRole` (flaky sob carga).
const esperarTitulo = (esperado: string) => waitFor(() => expect(titulo()).toBe(esperado));
const focado = () => document.activeElement;

describe('P1: foco e título', () => {
  it('ao abrir, o foco vai para o e-mail e a aba se chama "Entrar · Bairrin Painel"', async () => {
    montarApp(api);
    await irParaEntrar();
    expect(focado()).toBe(campo(t.entrar.email));
    await esperarTitulo(t.tituloDaAba(t.entrar.titulo));
  });

  it('o foco vai à senha quando o e-mail já está preenchido (volta de P1a por 401)', async () => {
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'verificar', desafio: DESAFIO } });
    api.responder(SEGUNDO_FATOR, problema(401, 'nao_autenticado'));
    montarApp(api);
    await entrarComSenha();
    await screen.findByRole('heading', { level: 1, name: t.segundoFator.titulo });
    await esperarTitulo(t.tituloDaAba(t.segundoFator.titulo));

    preencher(t.segundoFator.codigo, '111111');
    await screen.findByText(t.aviso.desafioVencido);

    expect(focado()).toBe(campo(t.entrar.senha));
    await esperarTitulo(t.tituloDaAba(t.entrar.titulo));
    // O aviso de desafio vencido é educado (`status`); só o erro de envio é assertivo.
    const aviso = screen.getByText(t.aviso.desafioVencido).closest('.ui-banner');
    expect(aviso?.getAttribute('role')).toBe('status');
  });

  it('429 do segundo fator volta a P1 com o banner assertivo (`alert`) e a mesma mensagem do CA-04', async () => {
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'verificar', desafio: DESAFIO } });
    api.responder(SEGUNDO_FATOR, problema(429, 'limite_excedido'));
    montarApp(api);
    await entrarComSenha();
    await screen.findByRole('heading', { level: 1, name: t.segundoFator.titulo });
    preencher(t.segundoFator.codigo, '111111');

    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.credenciais);
    expect(focado()).toBe(campo(t.entrar.senha));
  });

  it('com dois campos inválidos, o foco vai ao primeiro, o anúncio traz o total e cada erro liga ao seu campo', async () => {
    montarApp(api);
    await irParaEntrar();
    fireEvent.click(screen.getByRole('button', { name: t.entrar.botao }));

    const email = campo(t.entrar.email);
    const senha = campo(t.entrar.senha);
    expect(focado()).toBe(email);
    expect(anuncios()).toContain(t.errosNoEnvio(2));
    for (const entrada of [email, senha]) {
      expect(entrada.getAttribute('aria-invalid')).toBe('true');
      const descricao = entrada.getAttribute('aria-describedby') ?? '';
      expect(descricao).not.toBe('');
      expect(document.getElementById(descricao)?.textContent).toContain('Informe');
    }
  });

  it('corrigido o primeiro campo e erro só no segundo, o foco vai ao segundo', async () => {
    montarApp(api);
    await irParaEntrar();
    preencher(t.entrar.email, 'pedro@exemplo.com.br');
    fireEvent.click(screen.getByRole('button', { name: t.entrar.botao }));

    expect(focado()).toBe(campo(t.entrar.senha));
    expect(anuncios()).toContain(t.errosNoEnvio(1));
    expect(campo(t.entrar.email).getAttribute('aria-invalid')).toBeNull();
  });
});

describe('P1a: foco, troca de modo e erro', () => {
  beforeEach(() => {
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'verificar', desafio: DESAFIO } });
  });

  async function chegar() {
    montarApp(api);
    await entrarComSenha();
    await screen.findByRole('heading', { level: 1, name: t.segundoFator.titulo });
  }

  it('o foco chega no campo de código e o autocompletar é de código de uso único', async () => {
    await chegar();
    const codigo = campo(t.segundoFator.codigo);
    expect(focado()).toBe(codigo);
    expect(codigo.getAttribute('autocomplete')).toBe('one-time-code');
    expect(codigo.getAttribute('inputmode')).toBe('numeric');
  });

  it('trocar para o código de recuperação leva o foco ao campo novo; cada modo guarda o que foi digitado', async () => {
    await chegar();
    preencher(t.segundoFator.codigo, '12');

    // O foco está no botão que a pessoa acabou de apertar: o campo novo tem de tomá-lo.
    const trocar = screen.getByRole('button', { name: t.segundoFator.usarRecuperacao });
    trocar.focus();
    fireEvent.click(trocar);
    const recuperacao = campo(t.segundoFator.codigoRecuperacao);
    expect(focado()).toBe(recuperacao);
    preencher(t.segundoFator.codigoRecuperacao, 'abc');

    const voltar = screen.getByRole('button', { name: t.segundoFator.usarApp });
    voltar.focus();
    fireEvent.click(voltar);
    expect(focado()).toBe(campo(t.segundoFator.codigo));
    expect(campo(t.segundoFator.codigo).value).toBe('12');
  });

  it('o erro de campo entra pelo foco e pelo anúncio, e some ao trocar de modo', async () => {
    api.responder(
      SEGUNDO_FATOR,
      problema(400, 'validacao', [{ campo: 'codigo', codigo: 'invalido', motivo: 'm' }]),
    );
    await chegar();
    preencher(t.segundoFator.codigo, '111111');

    expect(await screen.findByText(textos.erro.codigo.invalido)).toBeTruthy();
    const codigo = campo(t.segundoFator.codigo);
    expect(focado()).toBe(codigo);
    expect(codigo.getAttribute('aria-invalid')).toBe('true');
    expect(anuncios()).toContain(t.errosNoEnvio(1));

    fireEvent.click(screen.getByRole('button', { name: t.segundoFator.usarRecuperacao }));
    expect(screen.queryByText(textos.erro.codigo.invalido)).toBeNull();
    expect(campo(t.segundoFator.codigoRecuperacao).getAttribute('aria-invalid')).toBeNull();
  });

  it('código curto no botão: erro local no campo, sem pedido à API', async () => {
    await chegar();
    preencher(t.segundoFator.codigo, '123');
    const verificar = screen.getByRole('button', { name: t.segundoFator.botao });
    verificar.focus();
    fireEvent.click(verificar);

    expect(await screen.findByText(textos.erro.codigo.invalido)).toBeTruthy();
    expect(focado()).toBe(campo(t.segundoFator.codigo));
    expect(api.pedidosDa(SEGUNDO_FATOR)).toHaveLength(0);
  });

  it('"Voltar" leva a P1 com o e-mail e o foco na senha, sem aviso', async () => {
    await chegar();
    fireEvent.click(screen.getByRole('button', { name: t.voltarParaEntrar }));

    expect(campo(t.entrar.email).value).toBe('pedro@exemplo.com.br');
    expect(focado()).toBe(campo(t.entrar.senha));
    expect(document.querySelector('.ui-banner')).toBeNull();
  });
});

describe('P1b: o foco acompanha o passo', () => {
  beforeEach(() => {
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'configurar', desafio: DESAFIO } });
    api.responder(CONFIGURACAO, {
      status: 200,
      corpo: { otpauthUri: URI, segredoBase32: SEGREDO },
    });
    api.responder(CONFIRMACAO, {
      status: 200,
      corpo: { codigosRecuperacao: CODIGOS, sessao: SESSAO },
    });
  });

  it('a cada passo, o foco vai ao título do passo (focável por código), e a aba mantém o título da tela', async () => {
    montarApp(api);
    await entrarComSenha();
    await screen.findByText(t.configuracao.passo1.titulo);
    await esperarTitulo(t.tituloDaAba(t.configuracao.titulo));

    fireEvent.click(screen.getByRole('button', { name: t.configuracao.passo1.botao }));
    const passo2 = await screen.findByRole('heading', { name: t.configuracao.passo2.titulo });
    expect(focado()).toBe(passo2);
    expect(passo2.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByText(textos.componentes.passo(2, 3))).toBeTruthy();

    preencher(t.configuracao.passo2.codigo, '654321');
    fireEvent.click(screen.getByRole('button', { name: t.configuracao.passo2.botao }));
    const passo3 = await screen.findByRole('heading', { name: t.configuracao.passo3.titulo });
    expect(focado()).toBe(passo3);
    expect(screen.getByText(textos.componentes.passo(3, 3))).toBeTruthy();
    await esperarTitulo(t.tituloDaAba(t.configuracao.titulo));
  });

  it('erro de código no passo 2 devolve o foco ao campo e anuncia o campo destacado', async () => {
    api.responder(
      CONFIRMACAO,
      problema(400, 'validacao', [{ campo: 'codigo', codigo: 'invalido', motivo: 'm' }]),
    );
    montarApp(api);
    await entrarComSenha();
    fireEvent.click(await screen.findByRole('button', { name: t.configuracao.passo1.botao }));
    await screen.findByRole('img', { name: t.configuracao.passo2.qr });

    preencher(t.configuracao.passo2.codigo, '654321');
    fireEvent.click(screen.getByRole('button', { name: t.configuracao.passo2.botao }));

    expect(
      await screen.findByText(textos.erroPorTela.configuracaoDoSegundoFator.codigo.invalido),
    ).toBeTruthy();
    expect(focado()).toBe(campo(t.configuracao.passo2.codigo));
    expect(anuncios()).toContain(t.errosNoEnvio(1));
  });

  it('o QR tem texto alternativo e a chave em texto, lida letra a letra, como alternativa', async () => {
    montarApp(api);
    await entrarComSenha();
    fireEvent.click(await screen.findByRole('button', { name: t.configuracao.passo1.botao }));
    await screen.findByRole('img', { name: t.configuracao.passo2.qr });

    const chave = document.querySelector('.aut-chave');
    expect(chave?.querySelector('[aria-hidden="true"]')?.textContent).toBe(
      'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP',
    );
    // Para o leitor de tela: letras separadas por espaço, grupos por vírgula; nunca uma palavra.
    expect(chave?.querySelector('.ui-oculto-visual')?.textContent).toBe(
      'J B S W, Y 3 D P, E H P K, 3 P X P, J B S W, Y 3 D P, E H P K, 3 P X P',
    );
  });
});

describe('regiões de anúncio', () => {
  it('toda tela do fluxo tem a região `status` montada antes de o texto chegar', async () => {
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'verificar', desafio: DESAFIO } });
    montarApp(api);
    await irParaEntrar();
    expect(document.querySelectorAll('p[role="status"].ui-oculto-visual')).toHaveLength(1);
    expect(anuncios().join('')).toBe('');

    await entrarComSenha();
    await screen.findByRole('heading', { level: 1, name: t.segundoFator.titulo });
    expect(document.querySelectorAll('p[role="status"].ui-oculto-visual')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: t.voltarParaEntrar }));
    fireEvent.click(screen.getByRole('button', { name: t.entrar.esqueci }));
    await screen.findByRole('heading', { level: 1, name: t.recuperacao.titulo });
    expect(document.querySelectorAll('p[role="status"].ui-oculto-visual')).toHaveLength(1);
  });

  it('a tela "Carregando o painel…" é `status`, para a troca não ficar muda', () => {
    api.segurar(RENOVAR);
    montarApp(api);
    expect(screen.getByRole('status').textContent).toBe(t.abrindo);
  });
});
