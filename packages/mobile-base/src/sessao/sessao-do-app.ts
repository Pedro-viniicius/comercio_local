// Sessão dos apps (plano 01b, etapa 12; ADR-012, CA-03, CA-05, S11, S18, S80, Q18). Liga o
// `criarClienteAutenticado` ao SecureStore e limpa os dados da conta no aparelho quando a sessão
// termina. O `ProvedorDeSessao` (React) só assina este estado.
//
// Regras:
// - o par de tokens vive só no SecureStore (`armazenamento-seguro.ts`), e o que sai daqui para as
//   telas é o estado e `emailVerificado` (só para a interface), nunca o token;
// - logout, expiração (renovação recusada) e troca de conta limpam o `queryClient`, o cache
//   persistido e a fila offline (S11); o SecureStore da sessão é limpo pelo cliente autenticado;
// - a tela de login (`sem_sessao`) só aparece depois que `renovarSessao()` ou `encerrarSessao()`
//   terminou (Q18);
// - `registrarFalha` recebe só a `origem`: o erro pode trazer mensagem nativa do armazenamento e
//   nunca sai daqui (ADR-014: o app não manda o erro ao Sentry nem chama `setUser`).
import {
  criarClienteAutenticado,
  type ClienteApi,
  type ClienteAutenticado,
  type MotivoDoEncerramento,
  type OpcoesDeRequisicaoAutenticada,
  type OrigemDaFalha,
  type ResultadoDoLogout,
} from '@bairrin/cliente-api';
import { sessaoSchema, type ClienteDoApp, type Sessao } from '@bairrin/contratos';
import type { QueryClient } from '@tanstack/react-query';
import {
  criarCofreDaSessao,
  type CofreDaSessao,
  type OrigemDaFalhaNoCofre,
} from './armazenamento-seguro.ts';
import type { PersisterDoCache } from './persistencia-permitida.ts';

/** `POST /v1/sessoes` (público), pelo cliente base. */
export const CAMINHO_DE_ENTRAR = '/v1/sessoes';

/**
 * O que falhou sem mudar o resultado para quem usa a sessão:
 * - as origens do cliente autenticado (`gravar_sessao`, `limpar_sessao`, `revogacao_pendente`,
 *   `aviso_de_encerramento`) e do cofre (`marca_de_instalacao`);
 * - `ler_sessao`: a leitura da sessão guardada falhou ao abrir o app;
 * - `limpar_cache` e `limpar_fila`: a limpeza do cache persistido ou da fila offline falhou.
 */
export type OrigemDaFalhaDaSessao =
  OrigemDaFalha | OrigemDaFalhaNoCofre | 'ler_sessao' | 'limpar_cache' | 'limpar_fila';

/** O que a sessão precisa da fila offline (`src/fila-offline`, plano 02): só limpar. */
export interface FilaOfflineDaConta {
  limpar(): Promise<void>;
}

/**
 * `carregando`: abrindo o app, ou saindo; `sem_sessao`: a tela de login; `com_sessao`: há
 * sessão neste aparelho (pode estar sem rede: a próxima requisição renova).
 */
export type EstadoDaSessao = 'carregando' | 'sem_sessao' | 'com_sessao';

export interface SituacaoDaSessao {
  estado: EstadoDaSessao;
  /** Só para a interface (P1-dono): quem exige e-mail verificado é o servidor. */
  emailVerificado: boolean | null;
}

export interface CredenciaisDeEntrada {
  email: string;
  senha: string;
}

/**
 * Requisição autenticada que devolve uma sessão nova da mesma conta: hoje, a verificação do
 * e-mail (`POST /v1/conta/verificacao-email`). O esquema da resposta é sempre o da sessão.
 */
export type PedidoDeSessaoSubstituta = Omit<OpcoesDeRequisicaoAutenticada<Sessao>, 'esquema'>;

/**
 * A fila offline da conta anterior não foi apagada: a conta nova não entra, para não enviar
 * operações da outra conta. A mensagem é fixa.
 */
export class ErroAoLimparDadosDaConta extends Error {
  readonly tipo = 'limpeza_da_conta';

  constructor() {
    super('Não foi possível limpar os dados da conta anterior neste aparelho.');
    this.name = 'ErroAoLimparDadosDaConta';
  }
}

export interface OpcoesDaSessaoDoApp {
  /** Cliente base (`criarClienteApi`) com o endereço de `urlDaApiConfigurada`. */
  cliente: ClienteApi;
  /** Vai como `cliente` no login e em toda renovação (S16, 5c). */
  clienteDoApp: ClienteDoApp;
  queryClient: QueryClient;
  /** O persister do cache, já envolvido por `criarPersisterPermitido` (S11). */
  persister?: PersisterDoCache;
  filaOffline?: FilaOfflineDaConta;
  /** Só a origem; ligue ao Sentry quando ele entrar nos apps (ADR-014). Um erro aqui é descartado. */
  registrarFalha?: (origem: OrigemDaFalhaDaSessao) => void;
  /** Padrão: o SecureStore (`criarCofreDaSessao`). */
  cofre?: CofreDaSessao;
  /** Padrão: `Date.now`. */
  agora?: () => number;
}

export interface SessaoDoApp {
  obterSituacao: () => SituacaoDaSessao;
  assinar: (ouvinte: () => void) => () => void;
  /** Ao abrir o app: lê a sessão guardada e, se o token de acesso venceu, renova. Uma vez só. */
  iniciar: () => Promise<void>;
  /**
   * Login. Com outra sessão aberta (troca de conta), encerra a anterior antes de guardar a nova.
   * Rejeita com o erro da API (`ErroDeApi`, `ErroSemConexao`...) ou `ErroAoLimparDadosDaConta`;
   * neste caso, a sessão recebida é revogada (ou fica como revogação pendente), nenhuma fica no
   * aparelho e o estado vai para `sem_sessao` (R8).
   */
  entrar: (credenciais: CredenciaisDeEntrada) => Promise<void>;
  /**
   * Faz a requisição que devolve uma sessão nova da mesma conta e troca o par guardado, sem limpar
   * os dados da conta (R9): depois de verificar o e-mail, a API marca a sessão anterior como
   * `substituida`, e a próxima renovação com o par antigo seria recusada. O token não passa pela
   * tela. Se a sessão foi encerrada ou trocada enquanto a requisição corria, a sessão recebida
   * não entra: é revogada quando não há outra em uso. Rejeita com o erro da requisição (código
   * errado: `ErroDeApi` 400).
   */
  substituirSessao: (pedido: PedidoDeSessaoSubstituta) => Promise<void>;
  /** Logout (CA-05). Rejeita só se o SecureStore não apagou a sessão. */
  sair: () => Promise<ResultadoDoLogout>;
  /** Requisição com o Bearer da sessão e a renovação em 401 do cliente autenticado. */
  requisitar: <T>(opcoes: OpcoesDeRequisicaoAutenticada<T>) => Promise<T>;
}

export function criarSessaoDoApp(opcoes: OpcoesDaSessaoDoApp): SessaoDoApp {
  const { cliente, clienteDoApp, queryClient, persister, filaOffline } = opcoes;
  const agora = opcoes.agora ?? (() => Date.now());

  function registrar(origem: OrigemDaFalhaDaSessao): void {
    try {
      opcoes.registrarFalha?.(origem);
    } catch {
      // Quem só observa não muda o resultado.
    }
  }

  const cofre = opcoes.cofre ?? criarCofreDaSessao({ aoFalhar: registrar });

  let situacao: SituacaoDaSessao = { estado: 'carregando', emailVerificado: null };
  const ouvintes = new Set<() => void>();
  // Muda a cada `entrar` e `sair`: o que começou antes não decide mais o estado.
  let versao = 0;
  let inicio: Promise<void> | undefined;
  let limpeza: Promise<{ fila: boolean }> = Promise.resolve({ fila: true });

  function definir(nova: SituacaoDaSessao): void {
    situacao = nova;
    for (const ouvinte of ouvintes) ouvinte();
  }

  function definirSessao(sessao: Sessao | null): void {
    definir(
      sessao === null
        ? { estado: 'sem_sessao', emailVerificado: null }
        : { estado: 'com_sessao', emailVerificado: sessao.emailVerificado },
    );
  }

  async function tentar(
    origem: OrigemDaFalhaDaSessao,
    tarefa: (() => Promise<void> | void) | undefined,
  ): Promise<boolean> {
    if (tarefa === undefined) return true;
    try {
      await tarefa();
      return true;
    } catch {
      registrar(origem);
      return false;
    }
  }

  /**
   * Limpa o que é da conta no aparelho (S11). O `queryClient` sai na hora; o cache persistido e a
   * fila, em seguida. Não rejeita: diz se a fila foi apagada.
   */
  function limparDadosDaConta(): Promise<{ fila: boolean }> {
    void queryClient.cancelQueries();
    queryClient.clear();
    const atual = Promise.all([
      tentar('limpar_cache', persister && (() => persister.removeClient())),
      tentar('limpar_fila', filaOffline && (() => filaOffline.limpar())),
    ]).then(([, fila]) => ({ fila }));
    limpeza = atual;
    return atual;
  }

  function aoEncerrarSessao(motivo: MotivoDoEncerramento): void {
    void limparDadosDaConta();
    // No logout, quem decide o estado é `sair`, depois de `encerrarSessao()` terminar.
    if (motivo !== 'renovacao_recusada') return;
    const versaoDoAviso = versao;
    // O aviso chega de dentro da renovação recusada, que ainda vai terminar. O que resta dela são
    // microtarefas, e o `setTimeout` só roda depois de todas: a tela de login aparece com a
    // renovação já terminada (Q18) e a limpeza concluída.
    setTimeout(() => {
      void limpeza.then(() => {
        if (versao === versaoDoAviso) definirSessao(null);
      });
    }, 0);
  }

  const autenticado: ClienteAutenticado = criarClienteAutenticado({
    cliente,
    armazenamento: cofre.sessao,
    revogacaoPendente: cofre.revogacaoPendente,
    modoDeRenovacao: 'token',
    clienteDoApp,
    aoEncerrarSessao,
    // Só a origem: o erro fica aqui (Q18, ADR-014).
    aoFalharEmSegundoPlano: ({ origem }) => registrar(origem),
  });

  function expirou(sessao: Sessao): boolean {
    const fim = Date.parse(sessao.expiraEm);
    return Number.isNaN(fim) || fim <= agora();
  }

  async function carregar(): Promise<void> {
    const versaoDoInicio = versao;
    let guardada: Sessao | null = null;
    try {
      guardada = await autenticado.obterSessao();
    } catch {
      registrar('ler_sessao');
    }
    let resultado = guardada;
    // Sem sessão, `renovarSessao()` não chama a API: só retoma as revogações pendentes (S80).
    if (guardada === null || expirou(guardada)) {
      try {
        resultado = await autenticado.renovarSessao();
      } catch {
        // Rede, tempo ou 5xx: a sessão guardada continua, e a próxima requisição renova.
        resultado = guardada;
      }
    }
    if (versao !== versaoDoInicio) return;
    await limpeza;
    if (versao !== versaoDoInicio) return;
    definirSessao(resultado);
  }

  /**
   * Revoga no servidor uma sessão recebida que não vai ficar no aparelho (R8, R9). O cliente
   * autenticado só revoga a sessão em uso: ela entra e sai em seguida, e o `encerrarSessao()` guarda
   * o par como revogação pendente antes do DELETE, que se repete na próxima abertura se faltar rede
   * (S80). Só chame sem outra sessão em uso. Não rejeita: as falhas viram só a origem.
   */
  async function revogarSemGuardar(sessao: Sessao): Promise<void> {
    try {
      await autenticado.iniciarSessao(sessao);
    } catch {
      // Em memória ela entrou; o `encerrarSessao()` abaixo a tira de lá e do SecureStore.
      registrar('gravar_sessao');
    }
    try {
      await autenticado.encerrarSessao();
    } catch {
      registrar('limpar_sessao');
    }
  }

  async function entrar({ email, senha }: CredenciaisDeEntrada): Promise<void> {
    const nova = await cliente.requisitar({
      metodo: 'POST',
      caminho: CAMINHO_DE_ENTRAR,
      corpo: { email, senha, cliente: clienteDoApp },
      esquema: sessaoSchema,
    });
    versao += 1;
    const versaoDoLogin = versao;
    let anterior: Sessao | null = null;
    try {
      anterior = await autenticado.obterSessao();
    } catch {
      // Sem leitura, a gravação da sessão nova substitui o que estiver guardado.
    }
    if (anterior !== null) {
      // Troca de conta: a anterior é revogada (ou fica pendente) antes de a nova entrar.
      try {
        await autenticado.encerrarSessao();
      } catch {
        registrar('limpar_sessao');
      }
    }
    const { fila } = await limparDadosDaConta();
    if (!fila) {
      // A conta nova não entra (não envia operação da anterior) nem fica viva no servidor sem
      // ninguém com o token. A anterior, se havia, já foi encerrada: a tela volta ao login (R8).
      await revogarSemGuardar(nova);
      if (versao === versaoDoLogin) definirSessao(null);
      throw new ErroAoLimparDadosDaConta();
    }
    try {
      await autenticado.iniciarSessao(nova);
    } catch {
      // A sessão vale em memória até o app fechar; a próxima abertura pede login.
      registrar('gravar_sessao');
    }
    definirSessao(nova);
  }

  async function substituirSessao(pedido: PedidoDeSessaoSubstituta): Promise<void> {
    const versaoDoPedido = versao;
    const nova = await autenticado.requisitar({ ...pedido, esquema: sessaoSchema });
    let atual: Sessao | null = null;
    try {
      atual = await autenticado.obterSessao();
    } catch {
      registrar('ler_sessao');
    }
    if (atual === null) {
      // Logout ou expiração no meio: a sessão recebida não reabre a conta.
      await revogarSemGuardar(nova);
      return;
    }
    // Outra conta entrou no meio: a dela fica, e a recebida vence no servidor sem ninguém com o
    // token (revogá-la pelo cliente tiraria a sessão em uso).
    if (versao !== versaoDoPedido) return;
    // Sem `await` entre a conferência acima e a troca: nada entra no meio.
    const gravacao = autenticado.iniciarSessao(nova);
    definirSessao(nova);
    try {
      await gravacao;
    } catch {
      // Como no login: vale em memória até o app fechar; a próxima abertura pede login.
      registrar('gravar_sessao');
    }
  }

  async function sair(): Promise<ResultadoDoLogout> {
    versao += 1;
    const versaoDoLogout = versao;
    definir({ estado: 'carregando', emailVerificado: null });
    try {
      return await autenticado.encerrarSessao();
    } catch (erro) {
      registrar('limpar_sessao');
      throw erro;
    } finally {
      await limpeza;
      if (versao === versaoDoLogout) definirSessao(null);
    }
  }

  return {
    obterSituacao: () => situacao,
    assinar: (ouvinte) => {
      ouvintes.add(ouvinte);
      return () => {
        ouvintes.delete(ouvinte);
      };
    },
    iniciar: () => {
      inicio ??= carregar();
      return inicio;
    },
    entrar,
    substituirSessao,
    sair,
    requisitar: (opcoesDaRequisicao) => autenticado.requisitar(opcoesDaRequisicao),
  };
}
