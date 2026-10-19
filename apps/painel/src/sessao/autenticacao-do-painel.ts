// Sessão do admin no painel (plano 01b, etapa 15; ADR-012, S9, S80). Monta o cliente da API com o
// cookie da renovação e o cliente autenticado no modo `cookie`, e expõe às telas só as chamadas de
// que elas precisam, já tipadas pelos contratos de `@bairrin/contratos`.
//
// Regras da sessão:
// - o token de acesso fica só em memória (`armazenamentoEmMemoria`); recarregar a página renova
//   pelo cookie `HttpOnly`, que o JavaScript não lê;
// - a marca de logout pendente é `{}` no `localStorage` (P14): não leva token nem id;
// - segredo do TOTP, `otpauthUri` e códigos de recuperação nunca passam por aqui para armazenamento
//   algum: as telas os guardam só no estado do componente;
// - `aoFalharEmSegundoPlano` repassa só a `origem` (sem o erro, que pode citar o armazenamento);
// - a interação da pessoa chega ao servidor (R1, S9): o servidor conta os 30 min de inatividade
//   desde a última renovação, então `registrarInteracao` renova quando a última sessão gravada
//   tem mais de `RENOVAR_NA_INTERACAO_APOS_MS`;
// - as abas abertas dividem a sessão (R2, S89): a interação vira o sinal `atividade` e o fim da
//   sessão, o sinal `saiu` (`entre-abas.ts`), sem dado algum.
import {
  criarClienteApi,
  criarClienteAutenticado,
  type ArmazenamentoDeRevogacao,
  type ArmazenamentoDeSessao,
  type ClienteApi,
  type FalhaEmSegundoPlano,
  type FetchInjetavel,
  type MotivoDoEncerramento,
  type OrigemDaFalha,
  type RespostaMinima,
  type ResultadoDoLogout,
  type SinalDeCancelamento,
} from '@bairrin/cliente-api';
import {
  configuracaoDeSegundoFatorSchema,
  contaSchema,
  respostaDeEntrarSchema,
  segundoFatorConfirmadoSchema,
  sessaoSchema,
  z,
  type ConfiguracaoDeSegundoFator,
  type ConfirmarConfiguracao,
  type Conta,
  type Entrar,
  type IniciarConfiguracao,
  type RedefinirSenha,
  type RespostaDeEntrar,
  type Sessao,
  type SegundoFatorConfirmado,
  type SolicitarRecuperacao,
  type VerificarSegundoFator,
} from '@bairrin/contratos';
import { sinaisEntreAbasNoNavegador, type SinaisEntreAbas } from './entre-abas.ts';

export const CAMINHO_DE_ENTRAR = '/v1/sessoes';
export const CAMINHO_DO_SEGUNDO_FATOR = '/v1/sessoes/segundo-fator';
export const CAMINHO_DA_CONFIGURACAO = '/v1/segundo-fator/configuracao';
export const CAMINHO_DA_CONFIRMACAO = '/v1/segundo-fator/confirmacao';
export const CAMINHO_DA_RECUPERACAO = '/v1/senha/recuperacao';
export const CAMINHO_DA_REDEFINICAO = '/v1/senha/redefinicao';
/** Rota mínima do painel (CA-08): só responde a admin com sessão `mfa`. */
export const CAMINHO_DA_CONTA_DO_ADMIN = '/v1/admin/conta';

/** Chave da marca de logout pendente no `localStorage` (P14). O valor é sempre `{}`. */
export const CHAVE_DO_LOGOUT_PENDENTE = 'bairrin.painel.logoutPendente';

/**
 * N do R1 (S9): a interação da pessoa renova a sessão quando a última sessão gravada (login ou
 * renovação, inclusive a do 401) tem mais de 10 min, com no máximo uma tentativa a cada 10 min.
 * O servidor encerra 30 min depois da última renovação; com N = 10, a pessoa que interage tem
 * sempre pelo menos 20 min de folga no servidor, com uma renovação a cada 10 min de uso, no
 * máximo. Limite conhecido: quem interage só nos primeiros 10 min depois da última renovação e
 * para não renova, e o servidor encerra entre 20 e 30 min depois da última interação.
 */
export const RENOVAR_NA_INTERACAO_APOS_MS = 10 * 60_000;

/**
 * Intervalo mínimo entre dois sinais de `atividade` às outras abas (R2). Uma aba ociosa conta a
 * atividade de outra com até este atraso: termina a sessão no máximo 10 s antes da hora certa.
 */
export const INTERVALO_DO_SINAL_DE_ATIVIDADE_MS = 10_000;

/**
 * Por que a sessão terminou, visto pelo painel: os motivos do cliente e `outra_aba`, quando outra
 * aba avisou que a sessão acabou (logout ou renovação recusada).
 */
export type MotivoDoEncerramentoNoPainel = MotivoDoEncerramento | 'outra_aba';

/** `fetch` do navegador, como o painel o usa (injetável nos testes). */
export type FetchDoNavegador = (url: string, init: RequestInit) => Promise<RespostaMinima>;

/**
 * Envolve o `fetch` com `credentials: 'include'`: sem isso o navegador não manda o cookie da
 * renovação à API, que fica em outra origem, nem guarda o que ela devolve no login.
 */
export function criarFetchComCookie(
  buscar: FetchDoNavegador = (url, init) => fetch(url, init),
): FetchInjetavel {
  return (url, pedido) =>
    buscar(url, {
      ...pedido,
      // O cliente base cria o sinal com o `AbortController` do próprio navegador.
      signal: pedido.signal as AbortSignal,
      credentials: 'include',
    });
}

/**
 * Marca de logout pendente no `localStorage` (S80, P14). Grava sempre `{}`, seja qual for o valor
 * recebido. Cada acesso fica num try/catch, porque o navegador pode recusar o armazenamento (modo
 * privado, política do site); a falha vira um erro sem detalhe, que o cliente repassa a
 * `aoFalharEmSegundoPlano`. Uma leitura que falha conta como marca presente: na dúvida, o painel
 * sai pelo cookie antes de restaurar a sessão, e a pessoa só precisa entrar de novo.
 */
export function armazenamentoDeRevogacaoNoNavegador(
  obterArmazenamento: () => Storage = () => window.localStorage,
): ArmazenamentoDeRevogacao {
  return {
    ler() {
      try {
        return Promise.resolve(
          obterArmazenamento().getItem(CHAVE_DO_LOGOUT_PENDENTE) === null ? null : {},
        );
      } catch {
        return Promise.resolve({});
      }
    },
    gravar() {
      try {
        obterArmazenamento().setItem(CHAVE_DO_LOGOUT_PENDENTE, JSON.stringify({}));
        return Promise.resolve();
      } catch {
        return Promise.reject(new Error('Não foi possível gravar a marca de logout pendente.'));
      }
    },
    limpar() {
      try {
        obterArmazenamento().removeItem(CHAVE_DO_LOGOUT_PENDENTE);
        return Promise.resolve();
      } catch {
        return Promise.reject(new Error('Não foi possível apagar a marca de logout pendente.'));
      }
    },
  };
}

/** Sessão só em memória (S9): nada do token de acesso sobrevive a recarregar a página. */
export function armazenamentoEmMemoria(): ArmazenamentoDeSessao {
  let guardada: Sessao | null = null;
  return {
    ler: () => Promise.resolve(guardada),
    gravar: (sessao) => {
      guardada = sessao;
      return Promise.resolve();
    },
    limpar: () => {
      guardada = null;
      return Promise.resolve();
    },
  };
}

/** Destino das falhas em segundo plano (Sentry, quando o painel tiver). Recebe só a origem. */
export type RegistradorDeFalhas = (evento: { origem: OrigemDaFalha }) => void;

/** Repassa só a `origem`: o erro pode citar o armazenamento e nunca sai daqui. */
export function avisoSoComOrigem(
  registrar: RegistradorDeFalhas | undefined,
): (falha: FalhaEmSegundoPlano) => void {
  return (falha) => registrar?.({ origem: falha.origem });
}

export interface OpcoesDaAutenticacaoDoPainel {
  baseUrl: string;
  fetch?: FetchDoNavegador;
  revogacaoPendente?: ArmazenamentoDeRevogacao;
  registrarFalha?: RegistradorDeFalhas;
  tempoLimiteMs?: number;
  /** Sinais entre as abas (R2). Padrão: `BroadcastChannel`, com a reserva do evento `storage`. */
  entreAbas?: SinaisEntreAbas;
}

/** O que as telas do painel usam. As rotas públicas vão pelo cliente base; as protegidas, com Bearer. */
export interface AutenticacaoDoPainel {
  /** Ao abrir (o token só existe em memória): renova pelo cookie. `null` = vai para o login. */
  renovarSessao(): Promise<Sessao | null>;
  /**
   * "Sair", inatividade e perda de acesso. `revogadaNoServidor: false` = API não confirmou (S80).
   * Quando termina (confirmado ou não), avisa as outras abas com `saiu`.
   */
  encerrarSessao(): Promise<ResultadoDoLogout>;
  /**
   * A pessoa interagiu nesta aba (R1, R2). Avisa as outras abas (`atividade`, no máximo um sinal a
   * cada `INTERVALO_DO_SINAL_DE_ATIVIDADE_MS`) e, se a última sessão gravada tiver mais de
   * `RENOVAR_NA_INTERACAO_APOS_MS`, renova na fila única do cliente (uma tentativa por janela).
   * `false` só quando a renovação veio vazia (a sessão acabou); rede e 5xx dão `true`, e a
   * próxima janela tenta de novo.
   */
  registrarInteracao(): Promise<boolean>;
  /**
   * Outra aba saiu (`outra_aba`): esquece a sessão desta aba só na memória, sem DELETE (a outra aba
   * já pediu o logout). Depois disso nenhuma requisição leva o token de acesso antigo.
   */
  descartarSessaoLocal(): void;
  /** A pessoa interagiu em outra aba (sinal `atividade`). Devolve o cancelamento. */
  aoAtividadeEmOutraAba(ouvinte: () => void): () => void;
  /** `POST /v1/sessoes` com `cliente: painel`. Se vier a sessão, ela já fica guardada. */
  entrar(corpo: Entrar): Promise<RespostaDeEntrar>;
  iniciarConfiguracao(corpo: IniciarConfiguracao): Promise<ConfiguracaoDeSegundoFator>;
  /** Confirma o TOTP; a sessão que vem junto já fica guardada. */
  confirmarConfiguracao(corpo: ConfirmarConfiguracao): Promise<SegundoFatorConfirmado>;
  /** Confere o TOTP ou o código de recuperação; a sessão já fica guardada. */
  verificarSegundoFator(corpo: VerificarSegundoFator): Promise<Sessao>;
  solicitarRecuperacao(corpo: SolicitarRecuperacao): Promise<void>;
  redefinirSenha(corpo: RedefinirSenha): Promise<void>;
  /** Rota protegida mínima. Sem polling aqui: um polling futuro passa `renovarEm401: false` (S9). */
  consultarConta(opcoes?: { sinal?: SinalDeCancelamento }): Promise<Conta>;
  consultarSaude: ClienteApi['consultarSaude'];
  /**
   * Avisa quando a sessão termina: o cliente a encerrou (renovação recusada ou logout) ou outra aba
   * mandou `saiu` (`outra_aba`). Devolve o cancelamento.
   */
  aoEncerrar(ouvinte: (motivo: MotivoDoEncerramentoNoPainel) => void): () => void;
}

const respostaSemCorpo = z.unknown();

export function criarAutenticacaoDoPainel(
  opcoes: OpcoesDaAutenticacaoDoPainel,
): AutenticacaoDoPainel {
  const base = criarClienteApi({
    baseUrl: opcoes.baseUrl,
    fetch: criarFetchComCookie(opcoes.fetch),
    ...(opcoes.tempoLimiteMs === undefined ? {} : { tempoLimiteMs: opcoes.tempoLimiteMs }),
  });
  const entreAbas =
    opcoes.entreAbas ?? sinaisEntreAbasNoNavegador({ chaveDaMarca: CHAVE_DO_LOGOUT_PENDENTE });
  const ouvintes = new Set<(motivo: MotivoDoEncerramentoNoPainel) => void>();

  // Hora em que o cliente gravou a última sessão (login, renovação pedida ou renovação do 401):
  // é dela que o servidor conta os 30 min. `undefined` sem sessão.
  let sessaoGravadaEm: number | undefined;
  let ultimaRenovacaoPorInteracao = Number.NEGATIVE_INFINITY;
  let ultimoSinalDeAtividade = Number.NEGATIVE_INFINITY;
  const revogacaoPendente = opcoes.revogacaoPendente ?? armazenamentoDeRevogacaoNoNavegador();

  // Cada cliente autenticado tem a própria memória. `descartarSessaoLocal` troca o cliente inteiro
  // (o `cliente-api` guarda uma cópia da sessão, que limpar o armazenamento não apagaria); o que o
  // cliente descartado ainda terminar depois (uma renovação no ar) não mexe na hora da sessão nem
  // avisa ninguém.
  let geracaoDoCliente = 0;
  function criarCliente() {
    geracaoDoCliente += 1;
    const geracao = geracaoDoCliente;
    const ehAtual = () => geracao === geracaoDoCliente;
    const memoria = armazenamentoEmMemoria();
    const armazenamento: ArmazenamentoDeSessao = {
      ler: () => memoria.ler(),
      async gravar(sessao) {
        await memoria.gravar(sessao);
        if (ehAtual()) sessaoGravadaEm = Date.now();
      },
      async limpar() {
        await memoria.limpar();
        if (ehAtual()) sessaoGravadaEm = undefined;
      },
    };
    return criarClienteAutenticado({
      cliente: base,
      armazenamento,
      revogacaoPendente,
      modoDeRenovacao: 'cookie',
      aoEncerrarSessao: (motivo) => {
        if (!ehAtual()) return;
        // O logout avisa as outras abas quando termina (`encerrarSessao`); a recusa, na hora.
        if (motivo === 'renovacao_recusada') entreAbas.enviar('saiu');
        for (const ouvinte of ouvintes) ouvinte(motivo);
      },
      aoFalharEmSegundoPlano: avisoSoComOrigem(opcoes.registrarFalha),
    });
  }
  let autenticado = criarCliente();

  return {
    renovarSessao: () => autenticado.renovarSessao(),

    descartarSessaoLocal() {
      autenticado = criarCliente();
      sessaoGravadaEm = undefined;
    },

    // `saiu` só depois do logout: outra aba em P1 não deixa a pessoa entrar enquanto o DELETE
    // desta ainda corre (a corrida do cookie do README do `cliente-api`).
    encerrarSessao: () => autenticado.encerrarSessao().finally(() => entreAbas.enviar('saiu')),

    async registrarInteracao() {
      const agora = Date.now();
      if (agora - ultimoSinalDeAtividade >= INTERVALO_DO_SINAL_DE_ATIVIDADE_MS) {
        ultimoSinalDeAtividade = agora;
        entreAbas.enviar('atividade');
      }
      if (
        sessaoGravadaEm === undefined ||
        agora - sessaoGravadaEm <= RENOVAR_NA_INTERACAO_APOS_MS ||
        agora - ultimaRenovacaoPorInteracao <= RENOVAR_NA_INTERACAO_APOS_MS
      ) {
        return true;
      }
      ultimaRenovacaoPorInteracao = agora;
      try {
        return (await autenticado.renovarSessao()) !== null;
      } catch {
        // Rede, tempo ou 5xx: a sessão continua; a próxima janela tenta de novo.
        return true;
      }
    },

    aoAtividadeEmOutraAba: (ouvinte) =>
      entreAbas.ouvir((sinal) => {
        if (sinal === 'atividade') ouvinte();
      }),

    async entrar(corpo) {
      const resposta = await base.requisitar({
        metodo: 'POST',
        caminho: CAMINHO_DE_ENTRAR,
        corpo,
        esquema: respostaDeEntrarSchema,
      });
      if ('tokenAcesso' in resposta) await autenticado.iniciarSessao(resposta);
      return resposta;
    },

    iniciarConfiguracao: (corpo) =>
      base.requisitar({
        metodo: 'POST',
        caminho: CAMINHO_DA_CONFIGURACAO,
        corpo,
        esquema: configuracaoDeSegundoFatorSchema,
      }),

    async confirmarConfiguracao(corpo) {
      const resposta = await base.requisitar({
        metodo: 'POST',
        caminho: CAMINHO_DA_CONFIRMACAO,
        corpo,
        esquema: segundoFatorConfirmadoSchema,
      });
      await autenticado.iniciarSessao(resposta.sessao);
      return resposta;
    },

    async verificarSegundoFator(corpo) {
      const sessao = await base.requisitar({
        metodo: 'POST',
        caminho: CAMINHO_DO_SEGUNDO_FATOR,
        corpo,
        esquema: sessaoSchema,
      });
      await autenticado.iniciarSessao(sessao);
      return sessao;
    },

    async solicitarRecuperacao(corpo) {
      await base.requisitar({
        metodo: 'POST',
        caminho: CAMINHO_DA_RECUPERACAO,
        corpo,
        esquema: respostaSemCorpo,
      });
    },

    async redefinirSenha(corpo) {
      await base.requisitar({
        metodo: 'POST',
        caminho: CAMINHO_DA_REDEFINICAO,
        corpo,
        esquema: respostaSemCorpo,
      });
    },

    consultarConta: (extras) =>
      autenticado.requisitar({
        caminho: CAMINHO_DA_CONTA_DO_ADMIN,
        esquema: contaSchema,
        ...(extras?.sinal ? { sinal: extras.sinal } : {}),
      }),

    consultarSaude: (extras) => base.consultarSaude(extras),

    aoEncerrar(ouvinte) {
      ouvintes.add(ouvinte);
      const pararDeOuvirAbas = entreAbas.ouvir((sinal) => {
        if (sinal === 'saiu') ouvinte('outra_aba');
      });
      return () => {
        ouvintes.delete(ouvinte);
        pararDeOuvirAbas();
      };
    },
  };
}
