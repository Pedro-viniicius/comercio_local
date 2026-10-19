// QA do grupo C (etapa 15): 5xx, queda de rede e resposta fora do contrato em cada passo do fluxo.
// Regra comum: a pessoa continua na tela, nada do que digitou se perde, o banner genérico aparece
// (sem detalhe técnico) e o mesmo envio pode ser refeito.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONFIGURACAO,
  CONFIRMACAO,
  CODIGOS,
  CODIGOS_NA_TELA,
  CONTA_DO_ADMIN,
  DESAFIO,
  EMAIL,
  ENTRAR,
  RECUPERACAO,
  REDEFINICAO,
  RENOVAR,
  SAIR,
  SEGREDO,
  SEGUNDO_FATOR,
  SENHA,
  URI,
  campo,
  digitarCredenciais,
  entrarComSenha,
  montarApp,
  preencher,
  t,
  textoDosBanners,
} from './fixtures/fluxo-comum.tsx';
import {
  CONTA,
  SESSAO,
  criarApiFalsa,
  problema,
  type ApiFalsa,
  type RespostaFalsa,
} from './teste/api-falsa.ts';

let api: ApiFalsa;

beforeEach(() => {
  api = criarApiFalsa();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const botao = (nome: string) => screen.getByRole<HTMLButtonElement>('button', { name: nome });
const FALHAS: [string, RespostaFalsa][] = [
  ['500', problema(500, 'erro_interno')],
  ['503', problema(503, 'indisponivel')],
  ['rede', 'rede'],
  ['2xx fora do contrato', { status: 200, corpo: { qualquer: 'coisa' } }],
  ['2xx com texto que não é JSON', { status: 200, corpo: 'texto solto' }],
];

describe('abertura (renovação pelo cookie)', () => {
  it.each(FALHAS)(
    '%s: P1 com o erro inesperado, sem apagar a marca nem sair pelo cookie',
    async (_n, falha) => {
      api.responder(RENOVAR, falha, problema(401, 'nao_autenticado'));
      montarApp(api);

      expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
      expect(api.pedidosDa(SAIR)).toHaveLength(0);
      expect(screen.queryByText(t.aviso.sessaoTerminou)).toBeNull();
      // "Tentar de novo" renova de novo e, sem cookie, cai em P1 sem aviso.
      fireEvent.click(botao(t.tentarDeNovo));
      await waitFor(() => expect(api.pedidosDa(RENOVAR)).toHaveLength(2));
      await waitFor(() => expect(textoDosBanners()).toBe(''));
    },
  );

  it('429 na renovação conta como falha passageira: P1 com "Tentar de novo", sessão não encerrada', async () => {
    api.responder(RENOVAR, problema(429, 'limite_excedido'), { status: 200, corpo: SESSAO });
    api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
    montarApp(api);

    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
    fireEvent.click(botao(t.tentarDeNovo));
    expect(await screen.findByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
  });

  it('cookie recusado (401, 403 ou 400) leva a P1 sem aviso: não é falha, é só não ter sessão', async () => {
    for (const recusa of [
      problema(401, 'nao_autenticado'),
      problema(403, 'proibido'),
      problema(400, 'validacao'),
    ]) {
      const outra = criarApiFalsa();
      outra.responder(RENOVAR, recusa);
      montarApp(outra);
      await screen.findByLabelText(t.entrar.email);
      expect(textoDosBanners()).toBe('');
      cleanup();
    }
  });
});

describe('P1: falhas do envio', () => {
  beforeEach(() => api.responder(RENOVAR, problema(401, 'nao_autenticado')));

  it.each(FALHAS)(
    '%s: banner genérico, e-mail e senha mantidos, e o reenvio chega ao passo seguinte',
    async (_n, falha) => {
      api.responder(ENTRAR, falha, {
        status: 200,
        corpo: { etapa: 'verificar', desafio: DESAFIO },
      });
      montarApp(api);
      await entrarComSenha();

      expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
      expect(campo(t.entrar.email).value).toBe(EMAIL);
      expect(campo(t.entrar.senha).value).toBe(SENHA);
      expect(
        screen.getByRole('button', { name: t.entrar.botao }).getAttribute('aria-busy'),
      ).toBeNull();

      fireEvent.click(botao(t.entrar.botao));
      await screen.findByRole('heading', { level: 1, name: t.segundoFator.titulo });
    },
  );

  it('falha repetida mostra o banner de novo (o leitor de tela anuncia outra vez)', async () => {
    api.responder(ENTRAR, problema(503, 'indisponivel'));
    montarApp(api);
    await entrarComSenha();
    const primeiro = await screen.findByRole('alert');

    fireEvent.click(botao(t.entrar.botao));
    await waitFor(() => expect(api.pedidosDa(ENTRAR)).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('alert')).not.toBe(primeiro));
    expect(document.querySelectorAll('.ui-banner')).toHaveLength(1);
  });

  it('o texto do erro nunca traz o e-mail, a senha nem o status', async () => {
    api.responder(ENTRAR, problema(500, 'erro_interno'));
    montarApp(api);
    await entrarComSenha();
    await screen.findByRole('alert');

    const visivel = document.body.textContent ?? '';
    for (const proibido of [EMAIL, SENHA, '500', 'erro_interno', 'req-teste', 'Failed to fetch']) {
      expect(visivel, proibido).not.toContain(proibido);
    }
  });
});

describe('P1a: falhas do código', () => {
  beforeEach(() => {
    api.responder(RENOVAR, problema(401, 'nao_autenticado'));
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'verificar', desafio: DESAFIO } });
  });

  it.each(FALHAS)(
    '%s: fica em P1a com o código digitado, e o botão tenta de novo',
    async (_n, falha) => {
      api.responder(SEGUNDO_FATOR, falha, { status: 200, corpo: SESSAO });
      api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
      montarApp(api);
      await entrarComSenha();
      await screen.findByRole('heading', { level: 1, name: t.segundoFator.titulo });

      preencher(t.segundoFator.codigo, '123456');
      expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t.segundoFator.titulo);
      expect(campo(t.segundoFator.codigo).value).toBe('123456');

      fireEvent.click(botao(t.segundoFator.botao));
      expect(await screen.findByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
    },
  );

  it('403 (qualquer outro) no código também fica na tela com o erro inesperado', async () => {
    api.responder(SEGUNDO_FATOR, problema(403, 'proibido'));
    montarApp(api);
    await entrarComSenha();
    await screen.findByRole('heading', { level: 1, name: t.segundoFator.titulo });
    preencher(t.segundoFator.codigo, '123456');
    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
  });

  it('o desafio em P1a não aparece em lugar nenhum da página nem do navegador', async () => {
    montarApp(api);
    await entrarComSenha();
    await screen.findByRole('heading', { level: 1, name: t.segundoFator.titulo });

    expect(document.documentElement.outerHTML).not.toContain(DESAFIO);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(DESAFIO);
    expect(window.location.href).not.toContain(DESAFIO);
  });
});

describe('P1b: falhas de cada passo', () => {
  beforeEach(() => {
    api.responder(RENOVAR, problema(401, 'nao_autenticado'));
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'configurar', desafio: DESAFIO } });
  });

  const configuracaoBoa = { status: 200, corpo: { otpauthUri: URI, segredoBase32: SEGREDO } };

  it.each(FALHAS)(
    'passo 1, %s: fica no passo 1 com o banner, e tentar de novo leva ao QR',
    async (_n, falha) => {
      api.responder(CONFIGURACAO, falha, configuracaoBoa);
      montarApp(api);
      await entrarComSenha();
      fireEvent.click(await screen.findByRole('button', { name: t.configuracao.passo1.botao }));

      expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
      expect(screen.queryByRole('img', { name: t.configuracao.passo2.qr })).toBeNull();
      fireEvent.click(botao(t.configuracao.passo1.botao));
      await screen.findByRole('img', { name: t.configuracao.passo2.qr });
      expect(document.querySelectorAll('.ui-banner')).toHaveLength(0);
    },
  );

  it('passo 1, 429: volta a P1 com a mensagem genérica (CA-04)', async () => {
    api.responder(CONFIGURACAO, problema(429, 'limite_excedido'));
    montarApp(api);
    await entrarComSenha();
    fireEvent.click(await screen.findByRole('button', { name: t.configuracao.passo1.botao }));
    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.credenciais);
  });

  it.each(FALHAS)(
    'passo 2, %s: fica no passo 2 com o QR e o código digitado; o reenvio chega aos códigos',
    async (_n, falha) => {
      api.responder(CONFIGURACAO, configuracaoBoa);
      api.responder(CONFIRMACAO, falha, {
        status: 200,
        corpo: { codigosRecuperacao: CODIGOS, sessao: SESSAO },
      });
      montarApp(api);
      await entrarComSenha();
      fireEvent.click(await screen.findByRole('button', { name: t.configuracao.passo1.botao }));
      await screen.findByRole('img', { name: t.configuracao.passo2.qr });

      preencher(t.configuracao.passo2.codigo, '654321');
      fireEvent.click(botao(t.configuracao.passo2.botao));
      expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
      expect(screen.getByRole('img', { name: t.configuracao.passo2.qr })).toBeTruthy();
      expect(campo(t.configuracao.passo2.codigo).value).toBe('654321');
      // O segredo continua na tela: sem ele a pessoa não consegue refazer o app autenticador.
      expect(document.querySelector('.aut-chave')?.textContent).toContain('JBSW Y3DP');

      fireEvent.click(botao(t.configuracao.passo2.botao));
      await screen.findByText(t.configuracao.passo3.aviso);
      expect(
        screen.getAllByRole('listitem').map((li) => li.firstElementChild?.textContent),
      ).toEqual(CODIGOS_NA_TELA);
    },
  );

  it('passo 2: o segredo, o QR e o desafio não vazam em texto de erro nem na falha de rede', async () => {
    api.responder(CONFIGURACAO, configuracaoBoa);
    api.responder(CONFIRMACAO, 'rede');
    montarApp(api);
    await entrarComSenha();
    fireEvent.click(await screen.findByRole('button', { name: t.configuracao.passo1.botao }));
    await screen.findByRole('img', { name: t.configuracao.passo2.qr });
    preencher(t.configuracao.passo2.codigo, '654321');
    fireEvent.click(botao(t.configuracao.passo2.botao));

    await screen.findByRole('alert');
    expect(textoDosBanners().replace(/^\S\s*/u, '')).toBe(t.aviso.servidor);
    expect(document.documentElement.outerHTML).not.toContain(URI);
    expect(document.documentElement.outerHTML).not.toContain(DESAFIO);
  });
});

describe('P1c: falhas dos dois passos', () => {
  const r = t.recuperacao;
  beforeEach(() => api.responder(RENOVAR, problema(401, 'nao_autenticado')));

  async function irParaRecuperacao() {
    montarApp(api);
    await digitarCredenciais();
    fireEvent.click(botao(t.entrar.esqueci));
    await screen.findByRole('heading', { level: 1, name: r.titulo });
  }

  it.each([
    ['500', problema(500, 'erro_interno')],
    ['503', problema(503, 'indisponivel')],
    ['rede', 'rede' as const],
  ])(
    'passo 1, %s: fica no passo 1 com o e-mail digitado, e o reenvio avança',
    async (_n, falha) => {
      api.responder(RECUPERACAO, falha, { status: 202 });
      await irParaRecuperacao();
      fireEvent.click(botao(r.enviar));

      expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
      expect(campo(r.email).value).toBe(EMAIL);
      expect(screen.queryByLabelText(r.codigo)).toBeNull();
      fireEvent.click(botao(r.enviar));
      await screen.findByLabelText(r.codigo);
    },
  );

  it.each([
    ['500', problema(500, 'erro_interno')],
    ['503', problema(503, 'indisponivel')],
    ['rede', 'rede' as const],
  ])(
    'passo 2, %s: o código e a senha nova ficam nos campos e o botão tenta de novo',
    async (_n, falha) => {
      api.responder(RECUPERACAO, { status: 202 });
      api.responder(REDEFINICAO, falha, { status: 204 });
      await irParaRecuperacao();
      fireEvent.click(botao(r.enviar));
      await screen.findByLabelText(r.codigo);

      preencher(r.codigo, '123456');
      preencher(r.novaSenha, 'uma-senha-nova-boa');
      fireEvent.click(botao(r.salvar));

      expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
      expect(campo(r.codigo).value).toBe('123456');
      expect(campo(r.novaSenha).value).toBe('uma-senha-nova-boa');
      expect(screen.queryByText(t.aviso.senhaAlterada)).toBeNull();

      fireEvent.click(botao(r.salvar));
      expect(await screen.findByText(t.aviso.senhaAlterada)).toBeTruthy();
      expect(api.pedidosDa(REDEFINICAO)).toHaveLength(2);
    },
  );

  it('passo 2, 429 ao reenviar o código: aviso de espera, o contador segue e o passo 2 permanece', async () => {
    api.responder(RECUPERACAO, { status: 202 }, problema(429, 'limite_excedido'));
    await irParaRecuperacao();
    fireEvent.click(botao(r.enviar));
    await screen.findByLabelText(r.codigo);
    // Antes dos 60 s o botão de reenvio está desabilitado: nenhum pedido sai.
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /Reenviar código/ }).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Reenviar código/ }));
    expect(api.pedidosDa(RECUPERACAO)).toHaveLength(1);
  });

  it('a senha nova e o código nunca aparecem fora dos campos (texto, título, banner)', async () => {
    api.responder(RECUPERACAO, { status: 202 });
    api.responder(REDEFINICAO, problema(503, 'indisponivel'));
    await irParaRecuperacao();
    fireEvent.click(botao(r.enviar));
    await screen.findByLabelText(r.codigo);
    preencher(r.codigo, '123456');
    preencher(r.novaSenha, 'uma-senha-nova-boa');
    fireEvent.click(botao(r.salvar));
    await screen.findByRole('alert');

    const visivel = (document.body.textContent ?? '') + document.title;
    expect(visivel).not.toContain('uma-senha-nova-boa');
    expect(visivel).not.toContain('123456');
  });
});

describe('área protegida: falhas', () => {
  beforeEach(() => api.responder(RENOVAR, { status: 200, corpo: SESSAO }));

  it.each([
    ['500', problema(500, 'erro_interno')],
    ['rede', 'rede' as const],
    ['2xx fora do contrato', { status: 200, corpo: { nome: 1 } }],
  ])(
    'conta com %s: banner com "Tentar de novo", sem sair; o segundo pedido mostra a conta',
    async (_n, falha) => {
      api.responder(CONTA_DO_ADMIN, falha, { status: 200, corpo: CONTA });
      montarApp(api);

      expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
      expect(api.pedidosDa(SAIR)).toHaveLength(0);
      fireEvent.click(botao(t.tentarDeNovo));
      expect(await screen.findByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
    },
  );

  it('401 e depois queda de rede na renovação: a sessão continua e o painel mostra o erro, não o login', async () => {
    api.responder(RENOVAR, { status: 200, corpo: SESSAO }, 'rede');
    api.responder(CONTA_DO_ADMIN, problema(401, 'nao_autenticado'), { status: 200, corpo: CONTA });
    montarApp(api);

    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
    expect(screen.queryByLabelText(t.entrar.email)).toBeNull();
    expect(screen.queryByText(t.aviso.sessaoTerminou)).toBeNull();
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
  });

  it('401 renovado com sucesso: a conta aparece sem passar por P1 e a renovação foi uma só (CA-05)', async () => {
    api.responder(
      RENOVAR,
      { status: 200, corpo: SESSAO },
      { status: 200, corpo: { ...SESSAO, tokenAcesso: 'novo.token' } },
    );
    api.responder(CONTA_DO_ADMIN, problema(401, 'nao_autenticado'), { status: 200, corpo: CONTA });
    montarApp(api);

    expect(await screen.findByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);
    expect(api.pedidosDa(CONTA_DO_ADMIN).map((p) => p.cabecalhos['Authorization'])).toEqual([
      `Bearer ${SESSAO.tokenAcesso}`,
      'Bearer novo.token',
    ]);
  });

  it.each([
    ['500', problema(500, 'erro_interno')],
    ['429', problema(429, 'limite_excedido')],
    ['rede', 'rede' as const],
  ])(
    '"Sair" com a API respondendo %s: S80, "Não foi possível sair", marca guardada',
    async (_n, falha) => {
      api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
      api.responder(SAIR, falha);
      montarApp(api);
      await screen.findByText(t.inicio.conta(CONTA.emailMascarado));

      fireEvent.click(botao(t.sair));
      expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.naoSaiu);
      expect(localStorage.getItem('bairrin.painel.logoutPendente')).toBe('{}');
      expect(campo(t.entrar.email)).toBeTruthy();
    },
  );
});
