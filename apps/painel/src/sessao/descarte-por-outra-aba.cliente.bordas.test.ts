// QA do grupo C, rodada 3: a renovação do cliente descartado (`descartarSessaoLocal`) que termina
// DEPOIS de um login novo não pode mexer na sessão nova: nem apagar a hora em que ela foi gravada
// (a interação deixaria de renová-la e o servidor a encerraria por inatividade) nem devolver o
// token antigo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BASE_URL,
  CONTA,
  SESSAO,
  criarApiFalsa,
  problema,
} from '../autenticacao/teste/api-falsa.ts';
import {
  RENOVAR_NA_INTERACAO_APOS_MS,
  criarAutenticacaoDoPainel,
  type MotivoDoEncerramentoNoPainel,
} from './autenticacao-do-painel.ts';
import { criarAbasFalsas } from './teste/abas-falsas.ts';

const RENOVAR = 'POST /v1/sessoes/renovacao';
const SAIR = 'DELETE /v1/sessoes/renovacao';
const SEGUNDO_FATOR = 'POST /v1/sessoes/segundo-fator';
const CONTA_DO_ADMIN = 'GET /v1/admin/conta';
const TOKEN_NOVO = 'token-do-login-novo.def';

function montar() {
  const api = criarApiFalsa();
  api.responder(RENOVAR, { status: 200, corpo: SESSAO });
  api.responder(SAIR, { status: 204 });
  // 200: um 401 aqui faria o cliente renovar e trocar o token, e o teste mediria outra coisa.
  api.responder(CONTA_DO_ADMIN, { status: 200, corpo: CONTA });
  const estaAba = criarAbasFalsas().abrirAba();
  const autenticacao = criarAutenticacaoDoPainel({
    baseUrl: BASE_URL,
    fetch: api.fetch,
    entreAbas: estaAba,
    revogacaoPendente: {
      ler: () => Promise.resolve(null),
      gravar: () => Promise.resolve(),
      limpar: () => Promise.resolve(),
    },
  });
  return { api, autenticacao, estaAba };
}

async function esvaziar() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Sessão aberta, renovação por interação no ar, descarte e login novo (2FA) antes da resposta. */
async function descartarComRenovacaoNoArEEntrarDeNovo() {
  const montado = montar();
  const { api, autenticacao } = montado;
  const motivos: MotivoDoEncerramentoNoPainel[] = [];
  autenticacao.aoEncerrar((motivo) => motivos.push(motivo));
  await autenticacao.renovarSessao();
  vi.advanceTimersByTime(RENOVAR_NA_INTERACAO_APOS_MS + 1);
  const liberar = api.segurar(RENOVAR);
  const interacao = autenticacao.registrarInteracao();
  await esvaziar();

  autenticacao.descartarSessaoLocal();
  api.responder(SEGUNDO_FATOR, { status: 200, corpo: { ...SESSAO, tokenAcesso: TOKEN_NOVO } });
  await autenticacao.verificarSegundoFator({ desafio: 'desafio.segredo', codigo: '123456' });
  return { ...montado, liberar, interacao, motivos };
}

describe('renovação do cliente descartado que termina depois do login novo', () => {
  it('recusada (401): a sessão nova continua renovando pela interação e o token novo segue valendo', async () => {
    const { api, autenticacao, liberar, interacao, motivos, estaAba } =
      await descartarComRenovacaoNoArEEntrarDeNovo();

    liberar(problema(401, 'nao_autenticado'));
    await interacao;
    await esvaziar();
    expect(motivos).toEqual([]);
    expect(estaAba.enviados).not.toContain('saiu');

    // A sessão nova passou 11 min sem renovar: a interação tem de renová-la.
    const antes = api.pedidosDa(RENOVAR).length;
    api.responder(RENOVAR, { status: 200, corpo: { ...SESSAO, tokenAcesso: TOKEN_NOVO } });
    vi.advanceTimersByTime(RENOVAR_NA_INTERACAO_APOS_MS + 1);
    await autenticacao.registrarInteracao();
    expect(api.pedidosDa(RENOVAR)).toHaveLength(antes + 1);

    await autenticacao.consultarConta();
    expect(api.pedidosDa(CONTA_DO_ADMIN).at(-1)?.cabecalhos['Authorization']).toBe(
      `Bearer ${TOKEN_NOVO}`,
    );
  });

  it('aceita (200 com outro token): o token do cliente antigo não substitui o da sessão nova', async () => {
    const { api, autenticacao, liberar, interacao } =
      await descartarComRenovacaoNoArEEntrarDeNovo();

    liberar({ status: 200, corpo: { ...SESSAO, tokenAcesso: 'token-do-cliente-antigo.zzz' } });
    await interacao;
    await esvaziar();

    await autenticacao.consultarConta();
    expect(api.pedidosDa(CONTA_DO_ADMIN).at(-1)?.cabecalhos['Authorization']).toBe(
      `Bearer ${TOKEN_NOVO}`,
    );
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
  });
});
