// Bordas da revogação pendente (S80) e das falhas em segundo plano (Q18) que o
// `sessao.test.ts` não cobre (01b, etapa 5; CA-05): a pendência de uma conta não
// atinge a sessão da conta seguinte, dois logouts sem rede não perdem a
// primeira credencial, o aviso de falha nunca leva token e o logout do painel
// não depende do Bearer.
import { describe, expect, it, vi } from 'vitest';
import { z, type Sessao } from '@bairrin/contratos';
import {
  CAMINHO_DA_RENOVACAO,
  CAMINHO_DO_LOGOUT,
  criarClienteApi,
  criarClienteAutenticado,
  type ArmazenamentoDeRevogacao,
  type ArmazenamentoDeSessao,
  type FalhaEmSegundoPlano,
  type FetchInjetavel,
  type ModoDeRenovacao,
  type PedidoMinimo,
  type RespostaMinima,
  type RevogacaoPendente,
} from './index.ts';

const BASE = 'https://api.teste';
const URL_DA_RENOVACAO = `${BASE}${CAMINHO_DA_RENOVACAO}`;
const URL_DO_LOGOUT = `${BASE}${CAMINHO_DO_LOGOUT}`;

const sessaoN = (n: number): Sessao => ({
  tokenAcesso: `acesso-${n}.aaa`,
  expiraEm: '2026-10-17T12:15:00Z',
  emailVerificado: false,
  tokenRenovacao: `renovacao-${n}_bbb`,
});
const parN = (n: number): RevogacaoPendente => ({
  tokenAcesso: sessaoN(n).tokenAcesso,
  tokenRenovacao: sessaoN(n).tokenRenovacao ?? '',
});

function resposta(status: number, corpo: string): RespostaMinima {
  return { status, ok: status >= 200 && status < 300, text: () => Promise.resolve(corpo) };
}
const json = (status: number, valor: unknown) => resposta(status, JSON.stringify(valor));
const contaSchema = () => z.object({ nome: z.string() });
const nao401 = () =>
  json(401, {
    type: 'urn:bairrin:erro:nao_autenticado',
    title: 'Não autenticado',
    status: 401,
    codigo: 'nao_autenticado',
  });

type Atendimento = (url: string, pedido: PedidoMinimo) => RespostaMinima | Promise<RespostaMinima>;

function montar(entrada: {
  atendimento: Atendimento;
  inicial?: Sessao | null;
  pendente?: unknown;
  modo?: ModoDeRenovacao;
  /** Substitui os métodos do armazenamento da revogação (falhas injetadas). */
  revogacaoComFalha?: Partial<ArmazenamentoDeRevogacao>;
}) {
  const chamadas: { url: string; pedido: PedidoMinimo }[] = [];
  const fetch: FetchInjetavel = async (url, pedido) => {
    chamadas.push({ url, pedido });
    return entrada.atendimento(url, pedido);
  };
  let sessaoGuardada: Sessao | null = entrada.inicial ?? null;
  const armazenamento: ArmazenamentoDeSessao = {
    ler: () => Promise.resolve(sessaoGuardada),
    gravar: (sessao) => {
      sessaoGuardada = sessao;
      return Promise.resolve();
    },
    limpar: () => {
      sessaoGuardada = null;
      return Promise.resolve();
    },
  };
  let pendenteGuardada: unknown = entrada.pendente ?? null;
  const revogacaoPendente: ArmazenamentoDeRevogacao = {
    ler: () => Promise.resolve(pendenteGuardada as RevogacaoPendente | null),
    gravar: (pendente) => {
      pendenteGuardada = pendente;
      return Promise.resolve();
    },
    limpar: () => {
      pendenteGuardada = null;
      return Promise.resolve();
    },
    ...entrada.revogacaoComFalha,
  };
  const falhas: FalhaEmSegundoPlano[] = [];
  const encerramentos: string[] = [];
  const autenticado = criarClienteAutenticado({
    cliente: criarClienteApi({ baseUrl: BASE, fetch }),
    armazenamento,
    revogacaoPendente,
    modoDeRenovacao: entrada.modo ?? 'token',
    aoEncerrarSessao: (motivo) => encerramentos.push(motivo),
    aoFalharEmSegundoPlano: (falha) => falhas.push(falha),
  });
  const para = (url: string) => chamadas.filter((c) => c.url === url);
  const pedirConta = () => autenticado.requisitar({ caminho: '/v1/conta', esquema: contaSchema() });
  return {
    autenticado,
    chamadas,
    para,
    falhas,
    encerramentos,
    pedirConta,
    sessaoGuardada: () => sessaoGuardada,
    pendenteGuardada: () => pendenteGuardada,
  };
}

describe('pendência de uma conta e sessão de outra (S80, S11)', () => {
  it('a pendência da conta A, recusada em tudo, não encerra nem limpa a sessão da conta B, e o DELETE de A não leva o token de B', async () => {
    const { autenticado, pedirConta, para, sessaoGuardada, pendenteGuardada, encerramentos } =
      montar({
        atendimento: (url, pedido) => {
          if (url === URL_DO_LOGOUT || url === URL_DA_RENOVACAO) return nao401();
          return pedido.headers['Authorization'] === `Bearer ${sessaoN(2).tokenAcesso}`
            ? json(200, { nome: 'Conta B' })
            : nao401();
        },
        inicial: null,
        pendente: parN(1),
      });
    await autenticado.iniciarSessao(sessaoN(2));

    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta B' });
    await vi.waitFor(() => expect(pendenteGuardada()).toBeNull());

    // A pendência de A foi tentada só com os tokens de A.
    for (const { pedido } of para(URL_DO_LOGOUT)) {
      expect(pedido.headers['Authorization']).toBe(`Bearer ${sessaoN(1).tokenAcesso}`);
    }
    expect(para(URL_DA_RENOVACAO).map((c) => c.pedido.body)).toEqual([
      JSON.stringify({ tokenRenovacao: sessaoN(1).tokenRenovacao }),
    ]);
    // A sessão de B segue no aparelho e ninguém avisou encerramento.
    expect(sessaoGuardada()).toEqual(sessaoN(2));
    expect(encerramentos).toEqual([]);
    await expect(pedirConta()).resolves.toEqual({ nome: 'Conta B' });
  });

  it('dois logouts sem rede, com um login no meio, não perdem a credencial da primeira conta', async () => {
    let rede = false;
    const revogados: string[] = [];
    const { autenticado, pedirConta, pendenteGuardada } = montar({
      atendimento: (url, pedido) => {
        if (!rede) return Promise.reject(new TypeError('Network request failed'));
        if (url === URL_DO_LOGOUT) {
          revogados.push(pedido.headers['Authorization'] ?? '');
          return resposta(204, '');
        }
        return json(200, { nome: 'Conta' });
      },
      inicial: sessaoN(1),
    });

    // A conta A sai sem rede; a pendência fica guardada.
    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: false });
    expect(pendenteGuardada()).toEqual(parN(1));

    // A conta B entra (o login é uma rota pública, fora deste cliente) e sai também sem rede.
    await autenticado.iniciarSessao(sessaoN(2));
    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: false });

    // A rede volta: as duas sessões precisam ser revogadas no servidor.
    rede = true;
    await pedirConta();
    await autenticado.encerrarSessao();
    await vi.waitFor(() => expect(pendenteGuardada()).toBeNull());
    expect(revogados).toContain(`Bearer ${sessaoN(1).tokenAcesso}`);
    expect(revogados).toContain(`Bearer ${sessaoN(2).tokenAcesso}`);
  });
});

describe('logout concorrente e repetido (CA-05)', () => {
  it('dois encerrarSessao ao mesmo tempo avisam o encerramento uma vez e deixam a pendência vazia quando o servidor confirma', async () => {
    const { autenticado, encerramentos, pendenteGuardada, sessaoGuardada } = montar({
      atendimento: () => resposta(204, ''),
      inicial: sessaoN(1),
    });

    const resultados = await Promise.all([
      autenticado.encerrarSessao(),
      autenticado.encerrarSessao(),
    ]);

    expect(resultados.every((r) => r.revogadaNoServidor)).toBe(true);
    expect(encerramentos).toEqual(['logout']);
    expect(sessaoGuardada()).toBeNull();
    expect(pendenteGuardada()).toBeNull();
  });

  it('logout no painel sem sessão em memória chama o DELETE do cookie uma vez e não manda Authorization', async () => {
    const { autenticado, para, pendenteGuardada } = montar({
      atendimento: () => resposta(204, ''),
      inicial: null,
      modo: 'cookie',
    });

    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: true });

    const delecoes = para(URL_DA_RENOVACAO);
    expect(delecoes).toHaveLength(1);
    expect(delecoes[0]?.pedido.method).toBe('DELETE');
    expect(delecoes[0]?.pedido.headers['X-Cliente']).toBe('painel');
    expect(delecoes[0]?.pedido.headers['Authorization']).toBeUndefined();
    expect(para(URL_DO_LOGOUT)).toHaveLength(0);
    expect(pendenteGuardada()).toBeNull();
  });

  it('logout no painel sem rede grava só a marca vazia, sem token', async () => {
    const { autenticado, pendenteGuardada } = montar({
      atendimento: () => Promise.reject(new TypeError('Network request failed')),
      inicial: sessaoN(1),
      modo: 'cookie',
    });

    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: false });

    expect(pendenteGuardada()).toEqual({});
  });
});

describe('o aviso de falha em segundo plano não leva token (Q18, S18)', () => {
  it('falha do DELETE por rede não chega ao aviso, e o que chega do armazenamento é só o erro dele', async () => {
    const { autenticado, falhas } = montar({
      atendimento: () => Promise.reject(new TypeError('Network request failed')),
      inicial: sessaoN(1),
      revogacaoComFalha: { gravar: () => Promise.reject(new Error('SecureStore cheio')) },
    });

    await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: false });

    expect(falhas.map((f) => f.origem)).toEqual(['revogacao_pendente']);
    const texto = JSON.stringify(falhas.map((f) => [f.origem, String(f.erro)]));
    expect(texto).not.toContain(sessaoN(1).tokenAcesso);
    expect(texto).not.toContain(sessaoN(1).tokenRenovacao ?? 'x');
  });
});

describe('ordem e resposta do logout (S80)', () => {
  it('o DELETE só sai depois de a pendência ser gravada, e a sessão já foi limpa do aparelho', async () => {
    let liberarGravacao: () => void = () => undefined;
    const gravacao = new Promise<void>((resolver) => {
      liberarGravacao = resolver;
    });
    const { autenticado, para, sessaoGuardada } = montar({
      atendimento: () => resposta(204, ''),
      inicial: sessaoN(1),
      revogacaoComFalha: { gravar: () => gravacao },
    });

    const logout = autenticado.encerrarSessao();
    // Dá várias voltas ao laço de eventos: sem a pendência gravada, o DELETE não pode ter saído.
    for (let volta = 0; volta < 5; volta += 1) await Promise.resolve();
    expect(para(URL_DO_LOGOUT)).toHaveLength(0);
    expect(sessaoGuardada()).toBeNull();

    liberarGravacao();
    await expect(logout).resolves.toEqual({ revogadaNoServidor: true });
    expect(para(URL_DO_LOGOUT)).toHaveLength(1);
  });

  it.each([401, 403])(
    'DELETE recusado com %i e renovação recusada: nada deste aparelho reabre a sessão, então conta como revogada',
    async (statusDoDelete) => {
      const { autenticado, pendenteGuardada } = montar({
        atendimento: (url) => {
          if (url === URL_DO_LOGOUT) {
            return json(statusDoDelete, {
              type: 'urn:bairrin:erro:x',
              title: 'Recusado',
              status: statusDoDelete,
              codigo: statusDoDelete === 401 ? 'nao_autenticado' : 'sem_permissao',
            });
          }
          return nao401();
        },
        inicial: sessaoN(1),
      });

      await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: true });
      expect(pendenteGuardada()).toBeNull();
    },
  );

  it.each([429, 500, 503])(
    'DELETE com %i mantém a pendência e diz que não revogou',
    async (status) => {
      const { autenticado, pendenteGuardada } = montar({
        atendimento: () =>
          json(status, {
            type: 'urn:bairrin:erro:x',
            title: 'Erro',
            status,
            codigo: 'erro_interno',
          }),
        inicial: sessaoN(1),
      });

      await expect(autenticado.encerrarSessao()).resolves.toEqual({ revogadaNoServidor: false });
      expect(pendenteGuardada()).toEqual(parN(1));
    },
  );
});
