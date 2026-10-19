// Cliente autenticado (01b, etapa 5; ADR-012). Envolve um `ClienteApi`, injeta
// `Authorization: Bearer` com o token de acesso da sessão e, em 401, renova uma
// vez com fila única: requisições concorrentes esperam a mesma renovação e
// depois repetem com o token novo. Se a API recusar a renovação, a sessão é
// encerrada no aparelho. O logout que a API não confirmou fica registrado como
// revogação pendente e é tentado de novo (S80). Não registra nada em log, e
// nenhum erro carrega token.
import {
  CABECALHO_DO_CLIENTE,
  clienteDoAppSchema,
  sessaoSchema,
  z,
  type ClienteDoApp,
  type Sessao,
} from '@bairrin/contratos';
import type { ClienteApi, OpcoesDeRequisicao } from './cliente.ts';
import { ErroDeApi } from './erros.ts';

export const CAMINHO_DA_RENOVACAO = '/v1/sessoes/renovacao';
/** Logout dos apps (Bearer). O painel sai por `DELETE` em `CAMINHO_DA_RENOVACAO`, pelo cookie (S80). */
export const CAMINHO_DO_LOGOUT = '/v1/sessoes/atual';

/**
 * Onde a sessão fica guardada entre aberturas do app. Nos apps, o SecureStore
 * (`packages/mobile-base/src/sessao`, etapa 12); no painel, só a memória (S9).
 * O cliente é o único que escreve: lê uma vez, na primeira requisição, e depois
 * mantém a sessão em memória. As escritas (`gravar`, `limpar`) chegam em ordem,
 * uma de cada vez.
 */
export interface ArmazenamentoDeSessao {
  /** A sessão guardada, ou `null`. Um valor fora do formato conta como `null`. */
  ler(): Promise<Sessao | null>;
  gravar(sessao: Sessao): Promise<void>;
  limpar(): Promise<void>;
}

/** Credencial de uma sessão encerrada que o servidor ainda não revogou. */
export interface CredencialPendente {
  tokenAcesso?: string;
  tokenRenovacao?: string;
}

/**
 * Quantos logouts sem confirmação os apps guardam (Q21): o mais novo e até
 * quatro anteriores. Passando disso, sai o mais antigo, cuja credencial já não
 * está em nenhum outro lugar do aparelho.
 */
export const MAXIMO_DE_REVOGACOES_PENDENTES = 5;

/**
 * Logout que o servidor ainda não confirmou (S80). Nos apps, o par da sessão
 * encerrada mais recente e, em `anteriores`, os pares de logouts mais antigos
 * ainda sem confirmação (do mais novo para o mais antigo; o campo só aparece
 * quando há algum). No painel, sempre `{}`: a marca não tem segredo, porque
 * quem revoga é o cookie `HttpOnly`, e o login apaga a marca.
 */
export interface RevogacaoPendente extends CredencialPendente {
  anteriores?: CredencialPendente[];
}

/**
 * Onde a revogação pendente fica entre aberturas, separada da sessão. Nos apps,
 * o SecureStore numa chave própria, longe do par de tokens (etapa 12); no
 * painel, o `localStorage` (etapa 15, P14), que só recebe `{}`. Um valor fora
 * do formato conta como `null` nos apps e como marca presente no painel. As
 * escritas chegam em ordem, uma de cada vez.
 */
export interface ArmazenamentoDeRevogacao {
  ler(): Promise<RevogacaoPendente | null>;
  gravar(pendente: RevogacaoPendente): Promise<void>;
  limpar(): Promise<void>;
}

/**
 * Como a renovação viaja. `token` (apps): `tokenRenovacao` e o `cliente` do app
 * no corpo, com o token guardado com a sessão. `cookie` (painel): corpo vazio,
 * cabeçalho `X-Cliente: painel` e o cookie `HttpOnly`; o `tokenRenovacao` nunca
 * é guardado.
 */
export type ModoDeRenovacao = 'token' | 'cookie';

/** `logout`: pedido pelo usuário. `renovacao_recusada`: a API recusou a renovação. */
export type MotivoDoEncerramento = 'logout' | 'renovacao_recusada';

/**
 * O que falhou sem mudar o resultado da chamada (Q18):
 * - `gravar_sessao`: gravar o par renovado. A sessão segue em memória e o
 *   cliente limpa o armazenamento, para a próxima abertura não renovar com o
 *   par antigo (que pareceria reuso e derrubaria a família).
 * - `limpar_sessao`: limpar depois de uma renovação recusada, ou depois de um
 *   `gravar_sessao`.
 * - `revogacao_pendente`: ler, gravar ou limpar a revogação pendente.
 * - `aviso_de_encerramento`: o `aoEncerrarSessao` lançou.
 */
export type OrigemDaFalha =
  'gravar_sessao' | 'limpar_sessao' | 'revogacao_pendente' | 'aviso_de_encerramento';

export interface FalhaEmSegundoPlano {
  origem: OrigemDaFalha;
  /** O erro como veio do armazenamento ou do aviso. Registre só a origem e o nome do erro. */
  erro: unknown;
}

export interface ResultadoDoLogout {
  /**
   * `true` quando nada do que ficou neste aparelho reabre a sessão encerrada
   * agora: o servidor confirmou o logout, recusou a credencial ou não havia o
   * que revogar. `false` quando a API não confirmou (rede, tempo, 429, 5xx):
   * a revogação fica pendente e o app avisa o usuário (S80). Sem sessão, vale
   * para as pendências anteriores: `true` só se não sobrou nenhuma.
   */
  revogadaNoServidor: boolean;
}

interface OpcoesComunsDoClienteAutenticado {
  /** Cliente base (`criarClienteApi`). Rotas públicas (entrar, cadastro) vão direto por ele. */
  cliente: ClienteApi;
  armazenamento: ArmazenamentoDeSessao;
  /** Onde fica o logout que a API ainda não confirmou (S80). */
  revogacaoPendente: ArmazenamentoDeRevogacao;
  /**
   * Chamado uma vez por sessão encerrada, depois de limpar o armazenamento. É
   * aqui que o app limpa cache, fila offline e `queryClient` (S11). Se lançar,
   * o erro vai para `aoFalharEmSegundoPlano` e não muda o resultado da chamada.
   */
  aoEncerrarSessao?: (motivo: MotivoDoEncerramento) => void;
  /**
   * Avisa o que falhou sem mudar o resultado da chamada (Q18). Um erro lançado
   * aqui é descartado.
   */
  aoFalharEmSegundoPlano?: (falha: FalhaEmSegundoPlano) => void;
}

/**
 * Nos apps (`token`), `clienteDoApp` é obrigatório: vai como `cliente` no corpo
 * de toda renovação, inclusive a da revogação pendente, porque a API compara o
 * `cliente` da requisição para devolver o par da tolerância de 60 s (S16) e
 * recusa com 400 o corpo sem ele. No painel (`cookie`), não é usado: a
 * renovação vai com `X-Cliente: painel`.
 */
export type OpcoesDoClienteAutenticado = OpcoesComunsDoClienteAutenticado &
  (
    | { modoDeRenovacao: 'token'; clienteDoApp: ClienteDoApp }
    | { modoDeRenovacao: 'cookie'; clienteDoApp?: ClienteDoApp }
  );

/** Opções de `ClienteAutenticado.requisitar`: as do cliente base e `renovarEm401`. */
export interface OpcoesDeRequisicaoAutenticada<T> extends OpcoesDeRequisicao<T> {
  /**
   * Padrão `true`. Com `false`, um 401 volta direto ao chamador, sem renovar,
   * sem repetir e sem encerrar a sessão. Todo polling passa `false` (S9): no
   * painel, só a interação do usuário pode estender a inatividade de 30 min,
   * e a renovação conta como atividade no servidor. Não vai para o cliente base.
   */
  renovarEm401?: boolean;
}

export interface ClienteAutenticado {
  /**
   * Como `ClienteApi.requisitar`, com o Bearer da sessão (sem sessão, vai sem
   * ele). Em 401 de uma requisição que levou token: renova uma vez e repete.
   * A repetição que falhar não renova de novo e devolve o próprio erro. Se a
   * renovação for recusada, a sessão é encerrada e a requisição devolve o 401
   * original; se a renovação falhar por rede, tempo ou erro do servidor, a
   * sessão continua e a requisição devolve esse erro. Falha do armazenamento
   * ou do aviso não muda o resultado. Nos apps, cada chamada também retoma a
   * revogação pendente, sem esperar por ela. Com `renovarEm401: false`, o 401
   * volta direto (S9).
   */
  requisitar<T>(opcoes: OpcoesDeRequisicaoAutenticada<T>): Promise<T>;
  /** A sessão atual (lê o armazenamento na primeira vez). */
  obterSessao(): Promise<Sessao | null>;
  /**
   * Guarda a sessão recebida ao entrar. Descarta renovação em curso da sessão
   * anterior. No painel, apaga a marca de logout pendente, que agora apontaria
   * para o cookie da sessão nova.
   */
  iniciarSessao(sessao: Sessao): Promise<void>;
  /**
   * Renova agora, na mesma fila das renovações automáticas. O painel chama ao
   * abrir, porque o token de acesso só existe em memória. `null` quando não há
   * como renovar ou a API recusou. No painel, com logout pendente, tenta o
   * logout e devolve `null` sem renovar (S80).
   */
  renovarSessao(): Promise<Sessao | null>;
  /**
   * Logout (CA-05): limpa a sessão no aparelho na hora, registra a revogação
   * pendente e, depois de gravá-la, pede a revogação ao servidor; a pendência
   * só sai quando o servidor confirma. Apps: `DELETE /v1/sessoes/atual` com o Bearer (e, se o
   * token de acesso venceu, renova e repete). Painel: `DELETE
   * /v1/sessoes/renovacao` pelo cookie, mesmo sem sessão em memória. Nos
   * apps, as pendências anteriores continuam guardadas (Q21) e, sem sessão,
   * são tentadas de novo. Rejeita só se não conseguir limpar o armazenamento
   * da sessão.
   */
  encerrarSessao(): Promise<ResultadoDoLogout>;
}

/** A API recusou a renovação: token inválido, vencido, revogado ou reusado. */
function ehRecusaDaRenovacao(erro: unknown): boolean {
  return (
    erro instanceof ErroDeApi && (erro.status === 400 || erro.status === 401 || erro.status === 403)
  );
}

function ehNaoAutenticado(erro: unknown): boolean {
  return erro instanceof ErroDeApi && erro.status === 401;
}

const credencialPendenteSchema = z.object({
  tokenAcesso: z.string().optional(),
  tokenRenovacao: z.string().optional(),
});
const revogacaoPendenteSchema = credencialPendenteSchema.extend({
  anteriores: z.array(z.unknown()).optional(),
});

/** Só os dois tokens, e só os que existem. Sempre um objeto novo. */
function copiarCredencial(origem: CredencialPendente): CredencialPendente {
  const copia: CredencialPendente = {};
  if (origem.tokenAcesso !== undefined) copia.tokenAcesso = origem.tokenAcesso;
  if (origem.tokenRenovacao !== undefined) copia.tokenRenovacao = origem.tokenRenovacao;
  return copia;
}

function temToken(credencial: CredencialPendente): boolean {
  return credencial.tokenAcesso !== undefined || credencial.tokenRenovacao !== undefined;
}

/**
 * O `cliente` do corpo da renovação nos apps. Confere também em tempo de
 * execução: sem ele, toda renovação levaria 400 e encerraria a sessão.
 */
function clienteDaRenovacao(opcoes: OpcoesDoClienteAutenticado): ClienteDoApp | undefined {
  if (opcoes.modoDeRenovacao !== 'token') return undefined;
  const lido = clienteDoAppSchema.safeParse(opcoes.clienteDoApp);
  if (!lido.success) {
    throw new TypeError(
      'clienteDoApp é obrigatório no modo token: use app_consumidor ou app_lojista.',
    );
  }
  return lido.data;
}

export function criarClienteAutenticado(opcoes: OpcoesDoClienteAutenticado): ClienteAutenticado {
  const {
    cliente,
    armazenamento,
    revogacaoPendente: armazenamentoDaRevogacao,
    modoDeRenovacao,
    aoEncerrarSessao,
    aoFalharEmSegundoPlano,
  } = opcoes;
  const clienteDoApp = clienteDaRenovacao(opcoes);

  // Estado em memória. Toda decisão da fila é síncrona sobre ele, para que
  // nenhuma leitura assíncrona do armazenamento abra espaço para uma segunda
  // renovação. `geracao` muda quando a sessão é iniciada ou encerrada: o que
  // começou numa geração não grava nem repete na seguinte (troca de conta).
  let sessao: Sessao | null = null;
  let carregada = false;
  let carregamento: Promise<void> | undefined;
  let geracao = 0;
  let renovacaoEmCurso: Promise<Sessao | null> | undefined;
  let escritas: Promise<void> = Promise.resolve();

  // Revogações pendentes (S80, Q21), com a mesma ideia de carga única. A lista
  // vai da mais nova para a mais antiga e vira outro array a cada decisão:
  // quem guardou a referência sabe se ainda pode gravar o par trocado ou tirar
  // as confirmadas. Cada credencial é um objeto próprio, comparado por
  // identidade. No painel, a lista é `[]` ou `[{}]`.
  let pendentes: readonly CredencialPendente[] = [];
  let pendentesCarregadas = false;
  let carregamentoDasPendentes: Promise<void> | undefined;
  let revogacaoEmCurso: Promise<readonly boolean[]> | undefined;
  let escritasDasPendentes: Promise<void> = Promise.resolve();

  function avisarFalha(origem: OrigemDaFalha, erro: unknown): void {
    try {
      aoFalharEmSegundoPlano?.({ origem, erro });
    } catch {
      // Quem só observa não muda o resultado da chamada.
    }
  }

  function avisarEncerramento(motivo: MotivoDoEncerramento): void {
    try {
      aoEncerrarSessao?.(motivo);
    } catch (erro) {
      avisarFalha('aviso_de_encerramento', erro);
    }
  }

  /** Copia só os campos do contrato; no modo `cookie`, sem `tokenRenovacao`. */
  function paraGuardar(origem: Sessao): Sessao {
    const copia: Sessao = {
      tokenAcesso: origem.tokenAcesso,
      expiraEm: origem.expiraEm,
      emailVerificado: origem.emailVerificado,
    };
    if (modoDeRenovacao === 'token' && origem.tokenRenovacao !== undefined) {
      copia.tokenRenovacao = origem.tokenRenovacao;
    }
    return copia;
  }

  /** Escritas em fila: um `limpar` nunca termina antes de um `gravar` anterior. */
  function persistir(operacao: () => Promise<void>): Promise<void> {
    const proxima = escritas.catch(() => undefined).then(operacao);
    escritas = proxima;
    return proxima;
  }

  async function carregar(): Promise<void> {
    const geracaoDaLeitura = geracao;
    const lida = sessaoSchema.safeParse(await armazenamento.ler());
    if (!carregada && geracao === geracaoDaLeitura) {
      sessao = lida.success ? paraGuardar(lida.data) : null;
      carregada = true;
    }
  }

  async function obterSessao(): Promise<Sessao | null> {
    if (!carregada) {
      const leitura = (carregamento ??= carregar());
      try {
        await leitura;
      } catch (erro) {
        // Se a sessão foi iniciada ou encerrada enquanto lia, a falha não importa.
        if (!carregada) throw erro;
      } finally {
        // Uma leitura que falhou não fica guardada: a próxima chamada lê de novo.
        if (carregamento === leitura) carregamento = undefined;
      }
    }
    return sessao;
  }

  /**
   * Encerra no aparelho, se a geração ainda for a mesma, e avisa se havia
   * sessão. Não rejeita: devolve a falha do armazenamento para quem chamou.
   */
  async function encerrarNoAparelho(
    geracaoEsperada: number,
    motivo: MotivoDoEncerramento,
  ): Promise<{ erro: unknown } | undefined> {
    if (geracao !== geracaoEsperada) return undefined;
    const haviaSessao = sessao !== null;
    geracao += 1;
    sessao = null;
    carregada = true;
    renovacaoEmCurso = undefined;
    let falha: { erro: unknown } | undefined;
    try {
      await persistir(() => armazenamento.limpar());
    } catch (erro) {
      falha = { erro };
    }
    // Mesmo se o armazenamento falhar, o app precisa saber para limpar o resto.
    if (haviaSessao) avisarEncerramento(motivo);
    return falha;
  }

  /** Renovação recusada: encerra, e a falha do armazenamento não troca o 401 (Q18). */
  async function encerrarPorRecusa(geracaoDaRenovacao: number): Promise<void> {
    const falha = await encerrarNoAparelho(geracaoDaRenovacao, 'renovacao_recusada');
    if (falha !== undefined) avisarFalha('limpar_sessao', falha.erro);
  }

  /**
   * Única saída da renovação, da sessão atual e da revogação pendente. Nos
   * apps, o corpo leva sempre o `cliente`: sem ele, a API responderia 400, que
   * conta como recusa e encerraria a sessão (ou daria por revogada uma
   * pendência ainda viva no servidor).
   */
  function pedirRenovacao(tokenRenovacao: string | undefined): Promise<Sessao> {
    return cliente.requisitar({
      metodo: 'POST',
      caminho: CAMINHO_DA_RENOVACAO,
      esquema: sessaoSchema,
      ...(modoDeRenovacao === 'token'
        ? { corpo: { tokenRenovacao, cliente: clienteDoApp } }
        : { cabecalhos: { [CABECALHO_DO_CLIENTE]: 'painel' } }),
    });
  }

  /**
   * Grava o par renovado. Se falhar, a sessão segue em memória e a requisição
   * repete do mesmo jeito (Q18). O armazenamento é limpo para não guardar o
   * par antigo: na próxima abertura ele pareceria reuso e derrubaria a família.
   */
  async function gravarRenovada(guardada: Sessao, geracaoDaRenovacao: number): Promise<void> {
    try {
      await persistir(() => armazenamento.gravar(guardada));
    } catch (erro) {
      avisarFalha('gravar_sessao', erro);
      // Um login ou logout no meio já decidiu o que fica guardado.
      if (geracao !== geracaoDaRenovacao) return;
      try {
        await persistir(() => armazenamento.limpar());
      } catch (erroAoLimpar) {
        avisarFalha('limpar_sessao', erroAoLimpar);
      }
    }
  }

  async function executarRenovacao(geracaoDaRenovacao: number): Promise<Sessao | null> {
    const tokenRenovacao = sessao?.tokenRenovacao;
    if (modoDeRenovacao === 'token' && tokenRenovacao === undefined) {
      // Sem token de renovação não há como renovar: o token de acesso já não vale.
      await encerrarPorRecusa(geracaoDaRenovacao);
      return null;
    }

    let nova: Sessao;
    try {
      nova = await pedirRenovacao(tokenRenovacao);
    } catch (erro) {
      // Rede, tempo, 5xx, 429 ou 2xx fora do contrato: a sessão continua e uma
      // requisição seguinte tenta de novo (a API tolera o token recém-trocado
      // por 60 s, S16). Só a recusa da API encerra.
      if (!ehRecusaDaRenovacao(erro)) throw erro;
      await encerrarPorRecusa(geracaoDaRenovacao);
      return null;
    }

    if (geracao !== geracaoDaRenovacao) return null;
    const guardada = paraGuardar(nova);
    sessao = guardada;
    await gravarRenovada(guardada, geracaoDaRenovacao);
    return guardada;
  }

  /** Fila única: enquanto uma renovação corre, quem chega espera a mesma. */
  function renovarUmaVez(): Promise<Sessao | null> {
    if (renovacaoEmCurso === undefined) {
      const promessa = executarRenovacao(geracao).finally(() => {
        if (renovacaoEmCurso === promessa) renovacaoEmCurso = undefined;
      });
      renovacaoEmCurso = promessa;
    }
    return renovacaoEmCurso;
  }

  /**
   * Sessão para repetir uma requisição que levou 401 com `tokenUsado`. Se outra
   * requisição já renovou, usa o token novo sem renovar de novo. `null` se a
   * sessão foi encerrada ou trocada desde o envio.
   */
  function sessaoParaRepetir(
    tokenUsado: string,
    geracaoDoEnvio: number,
  ): Sessao | null | Promise<Sessao | null> {
    if (geracao !== geracaoDoEnvio || sessao === null) return null;
    if (sessao.tokenAcesso !== tokenUsado) return sessao;
    return renovarUmaVez();
  }

  function comToken<T>(pedido: OpcoesDeRequisicao<T>, tokenAcesso: string): OpcoesDeRequisicao<T> {
    const cabecalhos: Record<string, string> = {};
    for (const [nome, valor] of Object.entries(pedido.cabecalhos ?? {})) {
      if (nome.toLowerCase() !== 'authorization') cabecalhos[nome] = valor;
    }
    cabecalhos['Authorization'] = `Bearer ${tokenAcesso}`;
    return { ...pedido, cabecalhos };
  }

  // ---- Revogações pendentes (S80, Q21) ----

  /** Formato guardado: a mais nova no topo e, se houver, as anteriores em `anteriores`. */
  function paraGuardarPendentes(
    maisNova: CredencialPendente,
    anteriores: readonly CredencialPendente[],
  ): RevogacaoPendente {
    const guardada: RevogacaoPendente = copiarCredencial(maisNova);
    if (anteriores.length > 0) guardada.anteriores = anteriores.map(copiarCredencial);
    return guardada;
  }

  /**
   * Decide as revogações pendentes em memória e grava em fila. Não rejeita: a
   * falha do armazenamento vira `revogacao_pendente` e a decisão em memória
   * vale até o app fechar.
   */
  function definirPendentes(nova: readonly CredencialPendente[]): Promise<void> {
    pendentes = nova;
    pendentesCarregadas = true;
    const [maisNova, ...anteriores] = nova;
    const proxima = escritasDasPendentes
      .then(() =>
        maisNova === undefined
          ? armazenamentoDaRevogacao.limpar()
          : armazenamentoDaRevogacao.gravar(paraGuardarPendentes(maisNova, anteriores)),
      )
      .catch((erro: unknown) => avisarFalha('revogacao_pendente', erro));
    escritasDasPendentes = proxima;
    return proxima;
  }

  function interpretarPendentes(valor: unknown): readonly CredencialPendente[] {
    if (valor === null || valor === undefined) return [];
    // No painel, qualquer valor conta como marca: na dúvida, sai antes de restaurar.
    if (modoDeRenovacao === 'cookie') return [{}];
    const lida = revogacaoPendenteSchema.safeParse(valor);
    if (!lida.success) return [];
    const anteriores = (lida.data.anteriores ?? []).flatMap((item) => {
      const credencial = credencialPendenteSchema.safeParse(item);
      return credencial.success ? [copiarCredencial(credencial.data)] : [];
    });
    return [copiarCredencial(lida.data), ...anteriores]
      .filter(temToken)
      .slice(0, MAXIMO_DE_REVOGACOES_PENDENTES);
  }

  async function carregarPendentes(): Promise<void> {
    const lida: unknown = await armazenamentoDaRevogacao.ler();
    if (!pendentesCarregadas) {
      pendentes = interpretarPendentes(lida);
      pendentesCarregadas = true;
    }
  }

  async function obterPendentes(): Promise<readonly CredencialPendente[]> {
    if (!pendentesCarregadas) {
      const leitura = (carregamentoDasPendentes ??= carregarPendentes());
      try {
        await leitura;
      } catch (erro) {
        if (!pendentesCarregadas) throw erro;
      } finally {
        if (carregamentoDasPendentes === leitura) carregamentoDasPendentes = undefined;
      }
    }
    return pendentes;
  }

  type RespostaDoLogout = 'confirmado' | 'recusado' | 'falhou';

  async function pedirLogout(
    pedido: Omit<OpcoesDeRequisicao<unknown>, 'esquema' | 'metodo'>,
  ): Promise<RespostaDoLogout> {
    try {
      await cliente.requisitar({ ...pedido, metodo: 'DELETE', esquema: z.unknown() });
      return 'confirmado';
    } catch (erro) {
      return erro instanceof ErroDeApi && (erro.status === 401 || erro.status === 403)
        ? 'recusado'
        : 'falhou';
    }
  }

  /**
   * Revoga no servidor, sem tocar na sessão em memória. `true` quando nada do
   * que ficou aqui reabre a sessão; `false` em rede, tempo, 429, 5xx ou 2xx
   * fora do contrato.
   * - Painel: `DELETE /v1/sessoes/renovacao` pelo cookie e `X-Cliente: painel`,
   *   sem Bearer e sem renovar antes; a API responde 204 sempre.
   * - Apps: `DELETE /v1/sessoes/atual` com o Bearer. Se a API recusar o token
   *   de acesso, renova com o de renovação (o par trocado vai para
   *   `aoTrocarPar`) e repete; renovação recusada conta como revogada.
   */
  async function revogar(
    credencial: CredencialPendente,
    aoTrocarPar: (par: CredencialPendente) => void,
  ): Promise<boolean> {
    if (modoDeRenovacao === 'cookie') {
      const resposta = await pedirLogout({
        caminho: CAMINHO_DA_RENOVACAO,
        cabecalhos: { [CABECALHO_DO_CLIENTE]: 'painel' },
      });
      return resposta === 'confirmado';
    }

    if (credencial.tokenAcesso !== undefined) {
      const resposta = await pedirLogout({
        caminho: CAMINHO_DO_LOGOUT,
        cabecalhos: { Authorization: `Bearer ${credencial.tokenAcesso}` },
      });
      if (resposta !== 'recusado') return resposta === 'confirmado';
    }
    // Sem token de renovação, nenhuma credencial deste aparelho abre a sessão.
    if (credencial.tokenRenovacao === undefined) return true;

    let renovada: Sessao;
    try {
      renovada = await pedirRenovacao(credencial.tokenRenovacao);
    } catch (erro) {
      return ehRecusaDaRenovacao(erro);
    }
    aoTrocarPar(copiarCredencial(renovada));
    const resposta = await pedirLogout({
      caminho: CAMINHO_DO_LOGOUT,
      cabecalhos: { Authorization: `Bearer ${renovada.tokenAcesso}` },
    });
    return resposta === 'confirmado';
  }

  /**
   * Revoga cada credencial de `alvo`, em paralelo, e tira da lista atual as que
   * o servidor confirmou. Devolve, na mesma ordem, se cada uma foi revogada.
   */
  async function revogarPendentes(
    alvo: readonly CredencialPendente[],
  ): Promise<readonly boolean[]> {
    const resultados = await Promise.all(
      alvo.map(async (credencial) => {
        let vigente = credencial;
        const confirmada = await revogar(credencial, (par) => {
          // O token de renovação antigo foi trocado: a próxima tentativa usa o par novo.
          if (!pendentes.includes(vigente)) return;
          const trocada = vigente;
          vigente = par;
          void definirPendentes(pendentes.map((item) => (item === trocada ? par : item)));
        });
        return { confirmada, vigente };
      }),
    );
    // Sai da lista só a credencial confirmada, pela identidade: a marca nova do
    // painel (depois de um login) ou a de um logout mais novo nunca sai por engano.
    const confirmadas = new Set(resultados.filter((r) => r.confirmada).map((r) => r.vigente));
    const restantes = pendentes.filter((item) => !confirmadas.has(item));
    if (restantes.length !== pendentes.length) await definirPendentes(restantes);
    return resultados.map((r) => r.confirmada);
  }

  function iniciarRevogacao(
    execucao: () => Promise<readonly boolean[]>,
  ): Promise<readonly boolean[]> {
    const promessa = execucao().finally(() => {
      if (revogacaoEmCurso === promessa) revogacaoEmCurso = undefined;
    });
    revogacaoEmCurso = promessa;
    return promessa;
  }

  /**
   * Tenta de novo as revogações pendentes; `true` se não sobrou nenhuma.
   * Junta-se à tentativa que já corre. Rejeita se não conseguir ler a lista.
   */
  async function tentarRevogacoesPendentes(): Promise<boolean> {
    const resultados = await (revogacaoEmCurso ??
      iniciarRevogacao(async () => revogarPendentes(await obterPendentes())));
    return resultados.every(Boolean);
  }

  /** Nos apps, toda chamada é uma chance de revogar o logout que ficou sem rede. Não espera. */
  function retomarRevogacoesPendentes(): void {
    if (pendentesCarregadas && pendentes.length === 0) return;
    tentarRevogacoesPendentes().catch((erro: unknown) => avisarFalha('revogacao_pendente', erro));
  }

  // ---- Operações públicas ----

  async function requisitar<T>(opcoesDaRequisicao: OpcoesDeRequisicaoAutenticada<T>): Promise<T> {
    // `renovarEm401` fica aqui: o cliente base não o conhece.
    const { renovarEm401, ...pedido } = opcoesDaRequisicao;
    if (modoDeRenovacao === 'token') retomarRevogacoesPendentes();
    const atual = await obterSessao();
    if (atual === null) return cliente.requisitar(pedido);

    const geracaoDoEnvio = geracao;
    try {
      return await cliente.requisitar(comToken(pedido, atual.tokenAcesso));
    } catch (erro) {
      // Só um `false` explícito desliga a renovação (S9).
      if (!ehNaoAutenticado(erro) || renovarEm401 === false) throw erro;
      const renovada = await sessaoParaRepetir(atual.tokenAcesso, geracaoDoEnvio);
      if (renovada === null) throw erro;
      // 401 vem da guarda, antes de qualquer efeito: repetir é seguro mesmo
      // numa escrita. A repetição não volta para cá: se falhar, falha.
      return cliente.requisitar(comToken(pedido, renovada.tokenAcesso));
    }
  }

  async function iniciarSessao(nova: Sessao): Promise<void> {
    const guardada = paraGuardar(nova);
    geracao += 1;
    renovacaoEmCurso = undefined;
    sessao = guardada;
    carregada = true;
    // No painel, o login trocou o cookie: a marca agora apontaria para a sessão nova.
    const marcaApagada = modoDeRenovacao === 'cookie' ? definirPendentes([]) : undefined;
    await persistir(() => armazenamento.gravar(guardada));
    await marcaApagada;
  }

  async function renovarSessao(): Promise<Sessao | null> {
    await obterSessao();
    if (modoDeRenovacao === 'token') {
      retomarRevogacoesPendentes();
      return renovarUmaVez();
    }
    // Painel com logout pendente: o cookie ainda abriria a sessão. Sai primeiro
    // e não restaura, tenha o servidor confirmado ou não (S80).
    if ((await obterPendentes()).length > 0) {
      await tentarRevogacoesPendentes();
      return null;
    }
    return renovarUmaVez();
  }

  async function encerrarSessao(): Promise<ResultadoDoLogout> {
    // Nos apps, as pendências anteriores continuam na lista (Q21). A leitura
    // começa junto com a da sessão; se falhar, vira aviso e o logout segue.
    let leituraFalhou = false;
    const lerAnteriores =
      modoDeRenovacao === 'token'
        ? obterPendentes().catch((erro: unknown) => {
            leituraFalhou = true;
            avisarFalha('revogacao_pendente', erro);
            return [];
          })
        : Promise.resolve([]);
    const atual = await obterSessao();

    if (atual === null && modoDeRenovacao === 'token') {
      // Sem sessão não há credencial nova: restam as pendências, se houver.
      await lerAnteriores;
      if (leituraFalhou) return { revogadaNoServidor: false };
      try {
        return { revogadaNoServidor: await tentarRevogacoesPendentes() };
      } catch (erro) {
        avisarFalha('revogacao_pendente', erro);
        return { revogadaNoServidor: false };
      }
    }

    let nova: CredencialPendente;
    let pendenciaGravada: Promise<void>;
    let noAparelho: Promise<{ erro: unknown } | undefined>;
    if (atual === null || modoDeRenovacao === 'cookie') {
      // Painel: a marca vai sem segredo e o cookie revoga, com ou sem sessão em
      // memória. O login apaga a marca, então não há marca anterior a manter.
      nova = {};
      pendenciaGravada = definirPendentes([nova]);
      noAparelho = encerrarNoAparelho(geracao, 'logout');
    } else {
      // Apps: o aparelho é limpo na hora, e o par segue só em `nova` até entrar
      // na lista, na frente das anteriores ainda não confirmadas.
      nova = copiarCredencial({
        tokenAcesso: atual.tokenAcesso,
        tokenRenovacao: atual.tokenRenovacao,
      });
      noAparelho = encerrarNoAparelho(geracao, 'logout');
      await lerAnteriores;
      pendenciaGravada = definirPendentes(
        [nova, ...pendentes].slice(0, MAXIMO_DE_REVOGACOES_PENDENTES),
      );
    }
    // O DELETE só sai depois de a pendência ser gravada: se o app fechar no
    // meio, a próxima abertura tenta de novo. As anteriores ficam para a
    // próxima tentativa, sem atrasar este logout.
    const resultados = await iniciarRevogacao(async () => {
      await pendenciaGravada;
      return revogarPendentes([nova]);
    });
    const falha = await noAparelho;
    if (falha !== undefined) throw falha.erro;
    return { revogadaNoServidor: resultados[0] ?? false };
  }

  return { requisitar, obterSessao, iniciarSessao, renovarSessao, encerrarSessao };
}
