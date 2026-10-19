// Fluxo do painel de ponta a ponta, com o cliente real (`criarAutenticacaoDoPainel`) e uma API
// falsa no `fetch` (as rotas HTTP da Identidade são da etapa 16). Cobre a abertura pelo cookie, a
// corrida do cookie (P1 só depois de renovar ou sair), o CA-09 (senha + TOTP; sem 2FA, configura
// antes de tudo), o "Sair" sem rede (S80) e a volta a P1 em 401 ou 403.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './App.tsx';
import {
  CHAVE_DO_LOGOUT_PENDENTE,
  criarAutenticacaoDoPainel,
} from './sessao/autenticacao-do-painel.ts';
import {
  BASE_URL,
  CONTA,
  criarApiFalsa,
  problema,
  SESSAO,
  type ApiFalsa,
} from './autenticacao/teste/api-falsa.ts';
import { textos } from './textos/pt-BR.ts';

const t = textos.autenticacao;

const RENOVAR = 'POST /v1/sessoes/renovacao';
const SAIR = 'DELETE /v1/sessoes/renovacao';
const ENTRAR = 'POST /v1/sessoes';
const SEGUNDO_FATOR = 'POST /v1/sessoes/segundo-fator';
const CONFIGURACAO = 'POST /v1/segundo-fator/configuracao';
const CONFIRMACAO = 'POST /v1/segundo-fator/confirmacao';
const CONTA_DO_ADMIN = 'GET /v1/admin/conta';
const SAUDE = 'GET /v1/saude';

const DESAFIO = 'desafio-id.segredo-do-desafio';
const SEGREDO = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const URI = `otpauth://totp/Bairrin:p***%40exemplo.com.br?secret=${SEGREDO}&issuer=Bairrin`;
const CODIGOS = Array.from({ length: 10 }, (_, i) => `ABCDEFGH${'AB234567CD'[i] ?? 'A'}Z`);

let api: ApiFalsa;

function montar() {
  api.responder(SAUDE, { status: 200, corpo: { status: 'ok' } });
  const autenticacao = criarAutenticacaoDoPainel({ baseUrl: BASE_URL, fetch: api.fetch });
  render(<App autenticacao={autenticacao} />);
}

function preencher(rotulo: string, valor: string) {
  fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
}

async function entrarComSenha(email = 'pedro@exemplo.com.br', senha = 'senha-boa-123') {
  await screen.findByRole('heading', { level: 1, name: t.entrar.titulo });
  preencher(t.entrar.email, email);
  preencher(t.entrar.senha, senha);
  fireEvent.click(screen.getByRole('button', { name: t.entrar.botao }));
}

function textoDosBanners(): string {
  return [...document.querySelectorAll('.ui-banner')].map((b) => b.textContent ?? '').join(' | ');
}

beforeEach(() => {
  api = criarApiFalsa();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('abertura', () => {
  it('sem cookie (renovação 401) vai a P1 só depois que a renovação termina', async () => {
    const liberar = api.segurar(RENOVAR);
    montar();

    expect(screen.getByRole('status').textContent).toBe(t.abrindo);
    expect(screen.queryByLabelText(t.entrar.email)).toBeNull();

    liberar(problema(401, 'nao_autenticado'));
    expect(await screen.findByLabelText(t.entrar.email)).toBeTruthy();
    expect(textoDosBanners()).toBe('');

    const [renovacao] = api.pedidosDa(RENOVAR);
    expect(renovacao?.credentials).toBe('include');
    expect(renovacao?.cabecalhos['X-Cliente']).toBe('painel');
    expect(renovacao?.cabecalhos['Authorization']).toBeUndefined();
    expect(renovacao?.corpo).toBeUndefined();
  });

  it('com cookie válido abre a área protegida e chama a rota do admin com o Bearer', async () => {
    api.responder(RENOVAR, { status: 200, corpo: SESSAO });
    api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
    montar();

    expect(await screen.findByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t.inicio.titulo);
    const [consulta] = api.pedidosDa(CONTA_DO_ADMIN);
    expect(consulta?.cabecalhos['Authorization']).toBe(`Bearer ${SESSAO.tokenAcesso}`);
    expect(consulta?.credentials).toBe('include');
  });

  it('com logout pendente sai pelo cookie antes de tudo e só então mostra P1 (S80)', async () => {
    localStorage.setItem(CHAVE_DO_LOGOUT_PENDENTE, '{}');
    const liberar = api.segurar(SAIR);
    api.responder(RENOVAR, { status: 200, corpo: SESSAO });
    montar();

    await waitFor(() => expect(api.pedidosDa(SAIR)).toHaveLength(1));
    expect(screen.queryByLabelText(t.entrar.email)).toBeNull();

    liberar({ status: 204 });
    expect(await screen.findByLabelText(t.entrar.email)).toBeTruthy();
    expect(api.pedidosDa(RENOVAR)).toHaveLength(0);
    expect(localStorage.getItem(CHAVE_DO_LOGOUT_PENDENTE)).toBeNull();
  });

  it('sem rede ao abrir mostra P1 com o erro inesperado e "Tentar de novo" renova de novo', async () => {
    api.responder(RENOVAR, 'rede', problema(401, 'nao_autenticado'));
    montar();

    expect(await screen.findByText(t.aviso.servidor)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t.tentarDeNovo }));

    await waitFor(() => expect(api.pedidosDa(RENOVAR)).toHaveLength(2));
    await waitFor(() => expect(textoDosBanners()).toBe(''));
    expect(screen.getByLabelText(t.entrar.email)).toBeTruthy();
  });
});

describe('CA-09: admin entra com senha e TOTP', () => {
  it('P1 → P1a → Início, com `cliente: painel` e o código do app', async () => {
    api.responder(RENOVAR, problema(401, 'nao_autenticado'));
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'verificar', desafio: DESAFIO } });
    api.responder(SEGUNDO_FATOR, { status: 200, corpo: SESSAO });
    api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
    montar();

    await entrarComSenha('Pedro@Exemplo.com.br');
    await screen.findByRole('heading', { level: 1, name: t.segundoFator.titulo });
    expect(api.pedidosDa(ENTRAR)[0]?.corpo).toEqual({
      email: 'pedro@exemplo.com.br',
      senha: 'senha-boa-123',
      cliente: 'painel',
    });

    preencher(t.segundoFator.codigo, '123456');
    expect(await screen.findByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
    expect(api.pedidosDa(SEGUNDO_FATOR)[0]?.corpo).toEqual({ desafio: DESAFIO, codigo: '123456' });
    expect(api.pedidosDa(SEGUNDO_FATOR)[0]?.credentials).toBe('include');
  });

  it('sem 2FA configura antes de tudo: nenhuma rota protegida antes de "Concluir e entrar"', async () => {
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
    montar();

    await entrarComSenha();
    await screen.findByText(t.configuracao.passo1.titulo);
    expect(screen.getByText(textos.componentes.passo(1, 3))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t.configuracao.passo1.botao }));

    // Passo 2: QR desenhado no DOM (sem imagem remota) e a chave em grupos de 4.
    const qr = await screen.findByRole('img', { name: t.configuracao.passo2.qr });
    expect(qr.tagName.toLowerCase()).toBe('svg');
    expect(document.querySelector('img[src^="http"], img[src^="data:"]')).toBeNull();
    expect(document.querySelector('.aut-chave')?.textContent).toContain('JBSW Y3DP EHPK 3PXP');
    expect(api.pedidosDa(CONFIGURACAO)[0]?.corpo).toEqual({ desafio: DESAFIO });

    preencher(t.configuracao.passo2.codigo, '654321');
    fireEvent.click(screen.getByRole('button', { name: t.configuracao.passo2.botao }));

    // Passo 3: os códigos aparecem uma vez e "Concluir" só vale depois da caixa marcada.
    await screen.findByText(t.configuracao.passo3.aviso);
    expect(api.pedidosDa(CONFIRMACAO)[0]?.corpo).toEqual({ desafio: DESAFIO, codigo: '654321' });
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    const concluir = screen.getByRole<HTMLButtonElement>('button', {
      name: t.configuracao.passo3.botao,
    });
    expect(concluir.disabled).toBe(true);
    expect(api.pedidosDa(CONTA_DO_ADMIN)).toHaveLength(0);

    // Segredo, URI e códigos não vão para o armazenamento do navegador nem para a URL.
    const guardado = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    for (const segredo of [SEGREDO, URI, DESAFIO, SESSAO.tokenAcesso, ...CODIGOS]) {
      expect(guardado).not.toContain(segredo);
      expect(window.location.href).not.toContain(segredo);
    }
    expect(document.title).toBe(t.tituloDaAba(t.configuracao.titulo));

    fireEvent.click(screen.getByRole('checkbox', { name: t.configuracao.passo3.guardei }));
    expect(concluir.disabled).toBe(false);
    fireEvent.click(concluir);
    expect(await screen.findByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
    // A sessão da confirmação já estava guardada: a rota protegida vai com o Bearer dela.
    expect(api.pedidosDa(CONTA_DO_ADMIN)[0]?.cabecalhos['Authorization']).toBe(
      `Bearer ${SESSAO.tokenAcesso}`,
    );
  });
});

describe('P1 (respostas de POST /v1/sessoes)', () => {
  beforeEach(() => api.responder(RENOVAR, problema(401, 'nao_autenticado')));

  it.each([
    ['401', problema(401, 'nao_autenticado')],
    ['429', problema(429, 'limite_excedido')],
  ])('%s dá a mesma mensagem, apaga a senha e mantém o e-mail (CA-04)', async (_, resposta) => {
    api.responder(ENTRAR, resposta);
    montar();
    await entrarComSenha();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(t.aviso.credenciais);
    expect(screen.getByLabelText<HTMLInputElement>(t.entrar.email).value).toBe(
      'pedro@exemplo.com.br',
    );
    expect(screen.getByLabelText<HTMLInputElement>(t.entrar.senha).value).toBe('');
    const botao = screen.getByRole<HTMLButtonElement>('button', { name: t.entrar.botao });
    expect(botao.disabled).toBe(false);
    expect(document.body.textContent).not.toMatch(/tentativas|Retry-After|minuto\(s\)/i);
  });

  it('403 sem_acesso_painel mostra a mensagem do S23', async () => {
    api.responder(ENTRAR, problema(403, 'sem_acesso_painel'));
    montar();
    await entrarComSenha();

    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.semAcesso);
  });

  it('5xx e rede mostram o erro inesperado e mantêm a senha', async () => {
    api.responder(ENTRAR, problema(503, 'indisponivel'), 'rede');
    montar();
    await entrarComSenha();
    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
    expect(screen.getByLabelText<HTMLInputElement>(t.entrar.senha).value).toBe('senha-boa-123');

    fireEvent.click(screen.getByRole('button', { name: t.entrar.botao }));
    await waitFor(() => expect(api.pedidosDa(ENTRAR)).toHaveLength(2));
    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
  });

  it('validação local: campos vazios não chamam a API; foco no primeiro e anúncio do total', async () => {
    montar();
    await entrarComSenha('', '');

    expect(await screen.findByText(textos.erro.email.obrigatorio)).toBeTruthy();
    expect(screen.getByText(textos.erro.senha.obrigatorio)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(t.entrar.email));
    expect(screen.getAllByRole('status').map((s) => s.textContent)).toContain(t.errosNoEnvio(2));
    expect(api.pedidosDa(ENTRAR)).toHaveLength(0);
  });

  it('400 com campos mostra o erro no campo pelo `mensagemDoCampo`', async () => {
    api.responder(
      ENTRAR,
      problema(400, 'validacao', [{ campo: 'email', codigo: 'invalido', motivo: 'm' }]),
    );
    montar();
    await entrarComSenha();
    expect(await screen.findByText(textos.erro.email.invalido)).toBeTruthy();
  });
});

describe('P1a (Respostas do 2FA)', () => {
  beforeEach(() => {
    api.responder(RENOVAR, problema(401, 'nao_autenticado'));
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'verificar', desafio: DESAFIO } });
  });

  async function chegarAoSegundoFator() {
    montar();
    await entrarComSenha();
    await screen.findByRole('heading', { level: 1, name: t.segundoFator.titulo });
  }

  it('400 campos[codigo] fica na tela com o texto da P1a', async () => {
    api.responder(
      SEGUNDO_FATOR,
      problema(400, 'validacao', [{ campo: 'codigo', codigo: 'invalido', motivo: 'm' }]),
    );
    await chegarAoSegundoFator();
    preencher(t.segundoFator.codigo, '111111');

    expect(await screen.findByText(textos.erro.codigo.invalido)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t.segundoFator.titulo);
  });

  it('401 volta a P1 com o e-mail preenchido e o aviso de desafio vencido', async () => {
    api.responder(SEGUNDO_FATOR, problema(401, 'nao_autenticado'));
    await chegarAoSegundoFator();
    preencher(t.segundoFator.codigo, '111111');

    expect(await screen.findByText(t.aviso.desafioVencido)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(t.entrar.email).value).toBe(
      'pedro@exemplo.com.br',
    );
    expect(screen.getByLabelText<HTMLInputElement>(t.entrar.senha).value).toBe('');
  });

  it('429 volta a P1 com o Banner genérico', async () => {
    api.responder(SEGUNDO_FATOR, problema(429, 'limite_excedido'));
    await chegarAoSegundoFator();
    preencher(t.segundoFator.codigo, '111111');

    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.credenciais);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t.entrar.titulo);
  });

  it('5xx fica na tela com o erro inesperado', async () => {
    api.responder(SEGUNDO_FATOR, problema(500, 'erro_interno'));
    await chegarAoSegundoFator();
    preencher(t.segundoFator.codigo, '111111');

    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t.segundoFator.titulo);
  });

  it('código de recuperação: manda `codigoRecuperacao` e mostra o erro dele', async () => {
    api.responder(
      SEGUNDO_FATOR,
      problema(400, 'validacao', [{ campo: 'codigoRecuperacao', codigo: 'invalido', motivo: 'm' }]),
      { status: 200, corpo: SESSAO },
    );
    api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
    await chegarAoSegundoFator();

    fireEvent.click(screen.getByRole('button', { name: t.segundoFator.usarRecuperacao }));
    preencher(t.segundoFator.codigoRecuperacao, 'abcde-fghij');
    fireEvent.click(screen.getByRole('button', { name: t.segundoFator.botao }));
    expect(await screen.findByText(textos.erro.codigoRecuperacao.invalido)).toBeTruthy();
    expect(api.pedidosDa(SEGUNDO_FATOR)[0]?.corpo).toEqual({
      desafio: DESAFIO,
      codigoRecuperacao: 'ABCDEFGHIJ',
    });

    fireEvent.click(screen.getByRole('button', { name: t.segundoFator.botao }));
    expect(await screen.findByText(t.inicio.conta(CONTA.emailMascarado))).toBeTruthy();
  });
});

describe('P1b (Respostas do 2FA)', () => {
  beforeEach(() => {
    api.responder(RENOVAR, problema(401, 'nao_autenticado'));
    api.responder(ENTRAR, { status: 200, corpo: { etapa: 'configurar', desafio: DESAFIO } });
    api.responder(CONFIGURACAO, {
      status: 200,
      corpo: { otpauthUri: URI, segredoBase32: SEGREDO },
    });
  });

  async function chegarAoPasso2() {
    montar();
    await entrarComSenha();
    fireEvent.click(await screen.findByRole('button', { name: t.configuracao.passo1.botao }));
    await screen.findByRole('img', { name: t.configuracao.passo2.qr });
  }

  function confirmar(codigo = '222222') {
    preencher(t.configuracao.passo2.codigo, codigo);
    fireEvent.click(screen.getByRole('button', { name: t.configuracao.passo2.botao }));
  }

  it('400 no passo 2 mostra o texto próprio da P1b, não o da P1a', async () => {
    api.responder(
      CONFIRMACAO,
      problema(400, 'validacao', [{ campo: 'codigo', codigo: 'invalido', motivo: 'm' }]),
    );
    await chegarAoPasso2();
    confirmar();

    expect(
      await screen.findByText(textos.erroPorTela.configuracaoDoSegundoFator.codigo.invalido),
    ).toBeTruthy();
    expect(screen.queryByText(textos.erro.codigo.invalido)).toBeNull();
    expect(screen.getByRole('img', { name: t.configuracao.passo2.qr })).toBeTruthy();
  });

  it('401 na confirmação volta a P1 com o aviso de desafio vencido', async () => {
    api.responder(CONFIRMACAO, problema(401, 'nao_autenticado'));
    await chegarAoPasso2();
    confirmar();
    expect(await screen.findByText(t.aviso.desafioVencido)).toBeTruthy();
  });

  it('429 na confirmação volta a P1 com o Banner genérico', async () => {
    api.responder(CONFIRMACAO, problema(429, 'limite_excedido'));
    await chegarAoPasso2();
    confirmar();
    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.credenciais);
  });

  it('5xx na confirmação fica no passo 2 com o erro inesperado', async () => {
    api.responder(CONFIRMACAO, problema(502, 'erro_generico'));
    await chegarAoPasso2();
    confirmar();
    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
    expect(screen.getByRole('img', { name: t.configuracao.passo2.qr })).toBeTruthy();
  });

  it('401 ao pedir a configuração volta a P1 com o aviso de desafio vencido', async () => {
    api.responder(CONFIGURACAO, problema(401, 'nao_autenticado'));
    montar();
    await entrarComSenha();
    fireEvent.click(await screen.findByRole('button', { name: t.configuracao.passo1.botao }));
    expect(await screen.findByText(t.aviso.desafioVencido)).toBeTruthy();
  });

  it('URI fora do formato não vira QR: erro inesperado no passo 1', async () => {
    api.responder(CONFIGURACAO, {
      status: 200,
      corpo: { otpauthUri: 'https://exemplo.invalido', segredoBase32: SEGREDO },
    });
    montar();
    await entrarComSenha();
    fireEvent.click(await screen.findByRole('button', { name: t.configuracao.passo1.botao }));
    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.servidor);
    expect(screen.queryByRole('img', { name: t.configuracao.passo2.qr })).toBeNull();
    expect(document.body.textContent).not.toContain(SEGREDO.slice(0, 4) + ' ');
  });

  it('"Sair" no canto do cartão encerra pelo cookie e volta a P1', async () => {
    api.responder(SAIR, { status: 204 });
    await chegarAoPasso2();
    fireEvent.click(screen.getByRole('button', { name: t.sair }));
    expect(await screen.findByText(t.aviso.saiu)).toBeTruthy();
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
  });
});

describe('sair e perder o acesso', () => {
  beforeEach(() => {
    api.responder(RENOVAR, { status: 200, corpo: SESSAO });
    api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
  });

  it('"Sair" confirmado: P1 só depois do logout, com "Você saiu da sua conta"', async () => {
    const liberar = api.segurar(SAIR);
    montar();
    await screen.findByText(t.inicio.conta(CONTA.emailMascarado));

    fireEvent.click(screen.getByRole('button', { name: t.sair }));
    expect(screen.getByRole('status').textContent).toBe(t.saindo);
    expect(screen.queryByLabelText(t.entrar.email)).toBeNull();

    liberar({ status: 204 });
    expect(await screen.findByText(t.aviso.saiu)).toBeTruthy();
    const [logout] = api.pedidosDa(SAIR);
    expect(logout?.credentials).toBe('include');
    expect(logout?.cabecalhos['X-Cliente']).toBe('painel');
    expect(localStorage.getItem(CHAVE_DO_LOGOUT_PENDENTE)).toBeNull();
  });

  it('"Sair" sem rede mostra a mensagem do S80, guarda a marca `{}` e deixa tentar de novo', async () => {
    api.responder(SAIR, 'rede', { status: 204 });
    montar();
    await screen.findByText(t.inicio.conta(CONTA.emailMascarado));

    fireEvent.click(screen.getByRole('button', { name: t.sair }));
    expect((await screen.findByRole('alert')).textContent).toContain(t.aviso.naoSaiu);
    expect(localStorage.getItem(CHAVE_DO_LOGOUT_PENDENTE)).toBe('{}');

    fireEvent.click(screen.getByRole('button', { name: t.tentarDeNovo }));
    expect(await screen.findByText(t.aviso.saiu)).toBeTruthy();
    expect(localStorage.getItem(CHAVE_DO_LOGOUT_PENDENTE)).toBeNull();
  });

  it('401 na rota protegida com renovação recusada: P1 com "Sua sessão terminou"', async () => {
    api.responder(RENOVAR, { status: 200, corpo: SESSAO }, problema(401, 'nao_autenticado'));
    api.responder(CONTA_DO_ADMIN, problema(401, 'nao_autenticado'));
    api.responder(SAIR, { status: 204 });
    montar();

    expect(await screen.findByText(t.aviso.sessaoTerminou)).toBeTruthy();
    expect(screen.getByLabelText(t.entrar.email)).toBeTruthy();
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);
    // A API já recusou o cookie: não há o que revogar, e P1 não troca por "Saindo…".
    await new Promise((resolver) => setTimeout(resolver, 30));
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    expect(screen.getByLabelText(t.entrar.email)).toBeTruthy();
  });

  it('403 na rota protegida encerra a sessão e volta a P1 com "Sua sessão terminou"', async () => {
    api.responder(CONTA_DO_ADMIN, problema(403, 'sem_permissao'));
    api.responder(SAIR, { status: 204 });
    montar();

    expect(await screen.findByText(t.aviso.sessaoTerminou)).toBeTruthy();
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
  });

  it('a sessão não fica no armazenamento do navegador (token só em memória)', async () => {
    montar();
    await screen.findByText(t.inicio.conta(CONTA.emailMascarado));
    const guardado = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(guardado).not.toContain(SESSAO.tokenAcesso);
  });
});

describe('sem VITE_API_URL', () => {
  it('mostra só o aviso de configuração, com o título da página', () => {
    render(<App autenticacao={null} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(textos.estadoDaApi.titulo);
    expect(screen.getByRole('status').textContent).toContain(textos.estadoDaApi.semConfiguracao);
    expect(screen.queryByLabelText(t.entrar.email)).toBeNull();
  });
});
