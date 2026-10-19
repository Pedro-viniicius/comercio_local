// A interação da pessoa chega ao servidor (R1, S9) e as abas dividem a sessão (R2, S89): regras de
// `registrarInteracao`, dos sinais `atividade` e `saiu` e de `aoEncerrar` com `outra_aba`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_URL, SESSAO, criarApiFalsa, problema } from '../autenticacao/teste/api-falsa.ts';
import {
  INTERVALO_DO_SINAL_DE_ATIVIDADE_MS,
  RENOVAR_NA_INTERACAO_APOS_MS,
  criarAutenticacaoDoPainel,
  type MotivoDoEncerramentoNoPainel,
} from './autenticacao-do-painel.ts';
import { criarAbasFalsas } from './teste/abas-falsas.ts';

const RENOVAR = 'POST /v1/sessoes/renovacao';
const SAIR = 'DELETE /v1/sessoes/renovacao';
const MINUTO = 60_000;

function montar() {
  const api = criarApiFalsa();
  api.responder(RENOVAR, { status: 200, corpo: SESSAO });
  api.responder(SAIR, { status: 204 });
  const abas = criarAbasFalsas();
  const estaAba = abas.abrirAba();
  const outraAba = abas.abrirAba();
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
  const recebidosNaOutra: string[] = [];
  outraAba.ouvir((sinal) => recebidosNaOutra.push(sinal));
  return { api, autenticacao, estaAba, outraAba, recebidosNaOutra };
}

/** Deixa as microtarefas (respostas da API falsa e entregas entre abas) terminarem. */
async function esvaziar() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('registrarInteracao: renovação no servidor (R1)', () => {
  it('N é 10 min e o sinal de atividade sai no máximo a cada 10 s', () => {
    expect(RENOVAR_NA_INTERACAO_APOS_MS).toBe(10 * MINUTO);
    expect(INTERVALO_DO_SINAL_DE_ATIVIDADE_MS).toBe(10_000);
  });

  it('sem sessão nesta aba, não renova', async () => {
    const { api, autenticacao } = montar();
    vi.advanceTimersByTime(30 * MINUTO);
    expect(await autenticacao.registrarInteracao()).toBe(true);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(0);
  });

  it('até 10 min depois da última renovação não renova; passou disso, renova uma vez', async () => {
    const { api, autenticacao } = montar();
    await autenticacao.renovarSessao();

    vi.advanceTimersByTime(RENOVAR_NA_INTERACAO_APOS_MS);
    expect(await autenticacao.registrarInteracao()).toBe(true);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(await autenticacao.registrarInteracao()).toBe(true);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);
    // A renovação nova recomeça a janela.
    vi.advanceTimersByTime(5 * MINUTO);
    await autenticacao.registrarInteracao();
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);
  });

  it('a renovação do 401 (requisição) também conta como última renovação', async () => {
    const { api, autenticacao } = montar();
    api.responder('GET /v1/admin/conta', problema(401, 'nao_autenticado'), {
      status: 200,
      corpo: { nome: 'Pedro', emailMascarado: 'p***@exemplo.com.br', perfis: ['admin'] },
    });
    await autenticacao.renovarSessao();
    vi.advanceTimersByTime(9 * MINUTO);
    await autenticacao.consultarConta();
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);

    vi.advanceTimersByTime(9 * MINUTO);
    await autenticacao.registrarInteracao();
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);
  });

  it('interações seguidas na mesma hora juntam numa renovação só (fila única)', async () => {
    const { api, autenticacao } = montar();
    await autenticacao.renovarSessao();
    vi.advanceTimersByTime(11 * MINUTO);
    const resultados = await Promise.all([
      autenticacao.registrarInteracao(),
      autenticacao.registrarInteracao(),
      autenticacao.registrarInteracao(),
    ]);
    expect(resultados).toEqual([true, true, true]);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);
  });

  it('sem rede: a sessão segue e a próxima tentativa só sai na janela seguinte', async () => {
    const { api, autenticacao } = montar();
    await autenticacao.renovarSessao();
    api.responder(RENOVAR, 'rede');
    vi.advanceTimersByTime(11 * MINUTO);
    expect(await autenticacao.registrarInteracao()).toBe(true);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);

    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(MINUTO);
      await autenticacao.registrarInteracao();
    }
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);
    vi.advanceTimersByTime(1);
    await autenticacao.registrarInteracao();
    expect(api.pedidosDa(RENOVAR)).toHaveLength(3);
  });

  it('renovação recusada devolve `false`, encerra pelo cliente e avisa as outras abas com `saiu`', async () => {
    const { api, autenticacao, recebidosNaOutra } = montar();
    const motivos: MotivoDoEncerramentoNoPainel[] = [];
    autenticacao.aoEncerrar((motivo) => motivos.push(motivo));
    await autenticacao.renovarSessao();
    api.responder(RENOVAR, problema(401, 'nao_autenticado'));
    vi.advanceTimersByTime(11 * MINUTO);

    expect(await autenticacao.registrarInteracao()).toBe(false);
    await esvaziar();
    expect(motivos).toEqual(['renovacao_recusada']);
    expect(recebidosNaOutra).toContain('saiu');
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
  });
});

describe('sinais entre abas (R2, S89)', () => {
  it('a interação manda `atividade`, no máximo um a cada 10 s, só a palavra', async () => {
    const { autenticacao, estaAba, recebidosNaOutra } = montar();
    await autenticacao.registrarInteracao();
    vi.advanceTimersByTime(INTERVALO_DO_SINAL_DE_ATIVIDADE_MS - 1);
    await autenticacao.registrarInteracao();
    expect(estaAba.enviados).toEqual(['atividade']);

    vi.advanceTimersByTime(1);
    await autenticacao.registrarInteracao();
    await esvaziar();
    expect(estaAba.enviados).toEqual(['atividade', 'atividade']);
    expect(recebidosNaOutra).toEqual(['atividade', 'atividade']);
  });

  it('"Sair" manda `saiu` só depois do DELETE terminar, confirmado ou não', async () => {
    const { api, autenticacao, estaAba } = montar();
    await autenticacao.renovarSessao();
    const liberar = api.segurar(SAIR);

    const saida = autenticacao.encerrarSessao();
    await esvaziar();
    expect(api.pedidosDa(SAIR)).toHaveLength(1);
    expect(estaAba.enviados).toEqual([]);

    liberar('rede');
    expect(await saida).toEqual({ revogadaNoServidor: false });
    expect(estaAba.enviados).toEqual(['saiu']);
  });

  it('`saiu` de outra aba chega como `outra_aba`, sem pedir logout nem renovar', async () => {
    const { api, autenticacao, outraAba } = montar();
    const motivos: MotivoDoEncerramentoNoPainel[] = [];
    const parar = autenticacao.aoEncerrar((motivo) => motivos.push(motivo));
    await autenticacao.renovarSessao();

    outraAba.enviar('saiu');
    outraAba.enviar('atividade');
    await esvaziar();
    expect(motivos).toEqual(['outra_aba']);
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    expect(api.pedidosDa(RENOVAR)).toHaveLength(1);

    parar();
    outraAba.enviar('saiu');
    await esvaziar();
    expect(motivos).toEqual(['outra_aba']);
  });

  it('`descartarSessaoLocal` esquece o token sem DELETE; a renovação que estava no ar não o devolve', async () => {
    const { api, autenticacao } = montar();
    const motivos: MotivoDoEncerramentoNoPainel[] = [];
    autenticacao.aoEncerrar((motivo) => motivos.push(motivo));
    api.responder('GET /v1/admin/conta', problema(401, 'nao_autenticado'));
    await autenticacao.renovarSessao();
    vi.advanceTimersByTime(11 * MINUTO);
    const liberar = api.segurar(RENOVAR);
    const interacao = autenticacao.registrarInteracao();
    await esvaziar();

    autenticacao.descartarSessaoLocal();
    liberar({ status: 200, corpo: { ...SESSAO, tokenAcesso: 'token-novo-do-cliente-antigo' } });
    await interacao;
    await autenticacao.consultarConta().catch(() => undefined);

    const consulta = api.pedidosDa('GET /v1/admin/conta').at(-1);
    expect(consulta?.cabecalhos['Authorization']).toBeUndefined();
    expect(api.pedidosDa(SAIR)).toHaveLength(0);
    expect(motivos).toEqual([]);
    // Sem sessão nesta aba, a interação não renova.
    vi.advanceTimersByTime(11 * MINUTO);
    await autenticacao.registrarInteracao();
    expect(api.pedidosDa(RENOVAR)).toHaveLength(2);
  });

  it('a recusa que chega ao cliente descartado não avisa ninguém nem manda `saiu`', async () => {
    const { api, autenticacao, estaAba } = montar();
    const motivos: MotivoDoEncerramentoNoPainel[] = [];
    autenticacao.aoEncerrar((motivo) => motivos.push(motivo));
    await autenticacao.renovarSessao();
    vi.advanceTimersByTime(11 * MINUTO);
    const liberar = api.segurar(RENOVAR);
    const interacao = autenticacao.registrarInteracao();
    await esvaziar();

    autenticacao.descartarSessaoLocal();
    liberar(problema(401, 'nao_autenticado'));
    await interacao;
    await esvaziar();
    expect(motivos).toEqual([]);
    expect(estaAba.enviados).not.toContain('saiu');
  });

  it('`atividade` de outra aba vai a `aoAtividadeEmOutraAba`; `saiu` não', async () => {
    const { autenticacao, estaAba, outraAba } = montar();
    const ouvinte = vi.fn();
    const parar = autenticacao.aoAtividadeEmOutraAba(ouvinte);
    expect(estaAba.ouvintes()).toBe(1);

    outraAba.enviar('atividade');
    outraAba.enviar('saiu');
    await esvaziar();
    expect(ouvinte).toHaveBeenCalledTimes(1);

    parar();
    expect(estaAba.ouvintes()).toBe(0);
  });
});
