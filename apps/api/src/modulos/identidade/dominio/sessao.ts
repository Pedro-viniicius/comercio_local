// Sessão (`identidade.sessoes`, ADR-012): o `id` é o `sid` do JWT de acesso, e
// o token opaco de renovação é guardado só como HMAC (`token_hash`).
//
// Regras (plano 01b, Decisão; S1, S8, S16):
// - renovação rotativa: cada renovação troca o token na mesma linha (o `sid`
//   não muda) e guarda o hash anterior em `token_anterior_hash`; todo token
//   trocado vai também para o histórico da família
//   (`tokens_de_renovacao_usados`, S77) até a sessão sumir;
// - tolerância de 60 s: o par novo (token de acesso + renovação) fica cifrado
//   em `par_novo_cifrado` por 60 s e volta só ao mesmo `cliente` que
//   apresentar o token recém-trocado (rede instável); fora disso, o token
//   anterior apresentado é reuso e revoga a família inteira;
// - token mais antigo que o anterior imediato (T1 depois de T1→T2→T3) não está
//   mais na sessão, mas está no histórico: também é reuso, sem tolerância, e
//   revoga a família (`avaliarTokenJaUsado`, S77). Sem o histórico, quem roubou
//   T1 e renovou duas vezes seguiria com a família viva depois que o dono
//   apresentasse T1;
// - apps: 30 dias deslizantes, sem teto (`expira_absoluto_em` nulo); painel: 30
//   min de inatividade e 12 h no máximo, conferidos no servidor (S9);
// - `mfa` só existe em sessão do painel e a renovação o herda (a linha é a
//   mesma); `admin` só entra no token com `cliente = painel` e `mfa` (S1);
// - revogação com data e motivo; logout, redefinição e exclusão revogam na
//   mesma transação do caso de uso (S8).
//
// O domínio não vê o token nem o par em claro: recebe o HMAC e o texto
// cifrado prontos da aplicação (portas `Cifrador` e `GeradorDeSegredos`).
import type { Cliente, Perfil } from '@bairrin/contratos/validadores';
import type { Conta } from './conta.ts';

/** Vida do JWT de acesso (ADR-012). O emissor assina com este `expiresIn`. */
export const SEGUNDOS_DO_TOKEN_DE_ACESSO = 15 * 60;
/** Tolerância ao token de renovação recém-trocado (S16). */
export const SEGUNDOS_DE_TOLERANCIA_DA_RENOVACAO = 60;

const UM_MINUTO_EM_MS = 60 * 1000;
const UMA_HORA_EM_MS = 60 * UM_MINUTO_EM_MS;
const UM_DIA_EM_MS = 24 * UMA_HORA_EM_MS;

/** Janela deslizante da renovação nos apps (30 dias). */
export const JANELA_DA_SESSAO_NOS_APPS_EM_MS = 30 * UM_DIA_EM_MS;
/** Inatividade máxima no painel (S9): cada renovação empurra o fim por mais 30 min. */
export const INATIVIDADE_MAXIMA_NO_PAINEL_EM_MS = 30 * UM_MINUTO_EM_MS;
/** Vida máxima da sessão do painel, contada da criação (S9). */
export const DURACAO_MAXIMA_NO_PAINEL_EM_MS = 12 * UMA_HORA_EM_MS;

export type MotivoDeRevogacao =
  /** `DELETE /v1/sessoes/atual` (CA-05). */
  | 'logout'
  /** Redefinição de senha: todas as sessões da conta (CA-05, P1-dono). */
  | 'senha_redefinida'
  /** Token de renovação anterior apresentado fora da tolerância: a família toda. */
  | 'reuso_detectado'
  /** Exclusão da conta (CA-11, S8). */
  | 'conta_desativada'
  /** Trocada por uma sessão nova da mesma família (ex.: verificação de e-mail). */
  | 'substituida'
  /** Segundo fator reconfigurado pela CLI. */
  | 'segundo_fator_reconfigurado'
  /**
   * Senha apagada pelo freio de segundo fator (P16: acionado de novo no nível
   * máximo, ou o teto diário de erros, S103): todas as sessões da conta (S104).
   */
  | 'segundo_fator_freado';

/** Forma persistida da sessão, coluna a coluna. */
export interface DadosDaSessao {
  readonly id: string;
  readonly contaId: string;
  /** Sessões que descendem do mesmo login; o reuso revoga todas. */
  readonly familiaId: string;
  readonly cliente: Cliente;
  readonly tokenHash: string;
  readonly tokenAnteriorHash: string | null;
  readonly parNovoCifrado: string | null;
  readonly parNovoExpiraEm: Date | null;
  readonly trocadoEm: Date | null;
  readonly expiraEm: Date;
  /** Teto da sessão do painel (12 h); `null` nos apps. */
  readonly expiraAbsolutoEm: Date | null;
  readonly ultimoUsoEm: Date;
  readonly mfa: boolean;
  readonly revogadaEm: Date | null;
  readonly motivoRevogacao: MotivoDeRevogacao | null;
  readonly criadaEm: Date;
}

export interface NovaSessao {
  id: string;
  contaId: string;
  cliente: Cliente;
  /** HMAC do primeiro token de renovação. */
  tokenHash: string;
  /** Senha + segundo fator concluídos (S1). Só no painel. */
  mfa: boolean;
  agora: Date;
  /** Família de uma sessão anterior que esta substitui; sem ela, a família é a própria sessão. */
  familiaId?: string;
  /**
   * Teto (`expira_absoluto_em`) da sessão do painel que esta substitui na mesma
   * família, como na verificação de e-mail (S9, S101): a substituta nunca vive
   * além das 12 h contadas do login. Fica o menor entre ele e as 12 h a partir
   * de agora. `null` ou ausente: o teto conta de agora. Só no painel; nos apps,
   * que não têm teto, um valor aqui é recusado.
   */
  tetoHerdado?: Date | null;
}

/** O que fazer com um token de renovação apresentado. */
export type AvaliacaoDaRenovacao =
  /** Token atual e sessão válida: a aplicação gera o par novo e chama `rotacionar`. */
  | { tipo: 'rotacionar' }
  /** Token recém-trocado, dentro de 60 s e do mesmo cliente: devolver o par já emitido. */
  | { tipo: 'tolerancia'; parNovoCifrado: string }
  /**
   * Token anterior fora da tolerância, ou token mais antigo achado no histórico
   * (`avaliarTokenJaUsado`, S77): revogar a família (`revogarDaFamilia`).
   */
  | { tipo: 'reuso' }
  /** Sessão revogada ou vencida, cliente trocado ou token que não é desta sessão: 401. */
  | { tipo: 'invalida' };

/** Token de renovação já trocado, guardado só como HMAC (`identidade.tokens_de_renovacao_usados`, S77). */
export interface TokenDeRenovacaoUsado {
  readonly tokenHash: string;
  /** Família a revogar se o token voltar. */
  readonly familiaId: string;
  readonly sessaoId: string;
  /** Quando foi trocado (`trocado_em` da rotação). */
  readonly usadoEm: Date;
}

/** Claims do JWT de acesso. O emissor põe `contaId` em `sub`. */
export interface ReivindicacoesDoToken {
  readonly contaId: string;
  readonly sid: string;
  readonly perfis: readonly Perfil[];
  readonly mfa: boolean;
  readonly emailVerificado: boolean;
}

/** Operação recusada pelo estado da sessão: erro de programação de quem chama. */
export class OperacaoInvalidaNaSessao extends Error {
  constructor(motivo: string) {
    super(`Operação inválida na sessão: ${motivo}.`);
    this.name = 'OperacaoInvalidaNaSessao';
  }
}

export class Sessao {
  readonly #id: string;
  readonly #contaId: string;
  readonly #familiaId: string;
  readonly #cliente: Cliente;
  #tokenHash: string;
  #tokenAnteriorHash: string | null;
  #parNovoCifrado: string | null;
  #parNovoExpiraEm: Date | null;
  #trocadoEm: Date | null;
  #expiraEm: Date;
  readonly #expiraAbsolutoEm: Date | null;
  #ultimoUsoEm: Date;
  readonly #mfa: boolean;
  #revogadaEm: Date | null;
  #motivoRevogacao: MotivoDeRevogacao | null;
  readonly #criadaEm: Date;

  private constructor(dados: DadosDaSessao) {
    validarEstado(dados);
    this.#id = dados.id;
    this.#contaId = dados.contaId;
    this.#familiaId = dados.familiaId;
    this.#cliente = dados.cliente;
    this.#tokenHash = dados.tokenHash;
    this.#tokenAnteriorHash = dados.tokenAnteriorHash;
    this.#parNovoCifrado = dados.parNovoCifrado;
    this.#parNovoExpiraEm = copiarData(dados.parNovoExpiraEm);
    this.#trocadoEm = copiarData(dados.trocadoEm);
    this.#expiraEm = new Date(dados.expiraEm.getTime());
    this.#expiraAbsolutoEm = copiarData(dados.expiraAbsolutoEm);
    this.#ultimoUsoEm = new Date(dados.ultimoUsoEm.getTime());
    this.#mfa = dados.mfa;
    this.#revogadaEm = copiarData(dados.revogadaEm);
    this.#motivoRevogacao = dados.motivoRevogacao;
    this.#criadaEm = new Date(dados.criadaEm.getTime());
  }

  /** Sessão nova, depois da senha (apps) ou da senha + segundo fator (painel). */
  static criar(nova: NovaSessao): Sessao {
    const herdado = nova.tetoHerdado ?? null;
    if (herdado !== null && nova.cliente !== 'painel') {
      throw new OperacaoInvalidaNaSessao('teto absoluto só existe em sessão do painel');
    }
    const tetoDeAgora = nova.agora.getTime() + DURACAO_MAXIMA_NO_PAINEL_EM_MS;
    const expiraAbsolutoEm =
      nova.cliente === 'painel'
        ? new Date(Math.min(tetoDeAgora, herdado?.getTime() ?? tetoDeAgora))
        : null;
    return new Sessao({
      id: nova.id,
      contaId: nova.contaId,
      familiaId: nova.familiaId ?? nova.id,
      cliente: nova.cliente,
      tokenHash: nova.tokenHash,
      tokenAnteriorHash: null,
      parNovoCifrado: null,
      parNovoExpiraEm: null,
      trocadoEm: null,
      expiraEm: proximoFim(nova.cliente, nova.agora, expiraAbsolutoEm),
      expiraAbsolutoEm,
      ultimoUsoEm: nova.agora,
      mfa: nova.mfa,
      revogadaEm: null,
      motivoRevogacao: null,
      criadaEm: nova.agora,
    });
  }

  static reconstituir(dados: DadosDaSessao): Sessao {
    return new Sessao(dados);
  }

  get id(): string {
    return this.#id;
  }

  get contaId(): string {
    return this.#contaId;
  }

  get familiaId(): string {
    return this.#familiaId;
  }

  get cliente(): Cliente {
    return this.#cliente;
  }

  get mfa(): boolean {
    return this.#mfa;
  }

  get expiraEm(): Date {
    return new Date(this.#expiraEm.getTime());
  }

  /**
   * O token trocado na última rotação, na forma do histórico (S77); `null` se a
   * sessão nunca rotacionou. O repositório o grava junto com a rotação
   * (`RepositorioDeSessoes.gravarRotacao`).
   */
  get ultimoTokenTrocado(): TokenDeRenovacaoUsado | null {
    if (this.#tokenAnteriorHash === null || this.#trocadoEm === null) return null;
    return {
      tokenHash: this.#tokenAnteriorHash,
      familiaId: this.#familiaId,
      sessaoId: this.#id,
      usadoEm: new Date(this.#trocadoEm.getTime()),
    };
  }

  get revogada(): boolean {
    return this.#revogadaEm !== null;
  }

  get motivoRevogacao(): MotivoDeRevogacao | null {
    return this.#motivoRevogacao;
  }

  /** Não revogada e dentro do prazo (deslizante e, no painel, do teto de 12 h). */
  estaAtiva(agora: Date): boolean {
    return this.#revogadaEm === null && !this.#venceu(agora);
  }

  /**
   * Decide a renovação a partir do HMAC do token apresentado e do cliente que
   * o apresentou. Não altera a sessão: a aplicação age conforme o resultado.
   */
  avaliarRenovacao(tokenHash: string, cliente: Cliente, agora: Date): AvaliacaoDaRenovacao {
    if (this.#revogadaEm !== null) return { tipo: 'invalida' };
    if (this.#tokenAnteriorHash !== null && tokenHash === this.#tokenAnteriorHash) {
      const dentroDaTolerancia =
        this.#parNovoCifrado !== null &&
        this.#parNovoExpiraEm !== null &&
        agora.getTime() < this.#parNovoExpiraEm.getTime() &&
        cliente === this.#cliente &&
        !this.#venceu(agora);
      return dentroDaTolerancia && this.#parNovoCifrado !== null
        ? { tipo: 'tolerancia', parNovoCifrado: this.#parNovoCifrado }
        : { tipo: 'reuso' };
    }
    if (tokenHash !== this.#tokenHash) return { tipo: 'invalida' };
    if (cliente !== this.#cliente || this.#venceu(agora)) return { tipo: 'invalida' };
    return { tipo: 'rotacionar' };
  }

  /**
   * Troca o token de renovação (depois de `avaliarRenovacao` dar `rotacionar`):
   * o atual vira o anterior, o par novo fica cifrado por 60 s (S16) e o prazo
   * desliza (apps: +30 dias; painel: +30 min, até o teto de 12 h). O `mfa`
   * continua o da sessão. A aplicação grava com `RepositorioDeSessoes.gravarRotacao`,
   * que leva o token trocado ao histórico (S77) e não grava se outra renovação
   * rotacionou antes (R1).
   */
  rotacionar(novoTokenHash: string, parNovoCifrado: string, agora: Date): void {
    if (!this.estaAtiva(agora)) {
      throw new OperacaoInvalidaNaSessao('rotacionar sessão revogada ou vencida');
    }
    exigirHash(novoTokenHash);
    if (novoTokenHash === this.#tokenHash) {
      throw new OperacaoInvalidaNaSessao('o token novo deve ser diferente do atual');
    }
    if (parNovoCifrado.length === 0) {
      throw new OperacaoInvalidaNaSessao('o par novo cifrado não pode ser vazio');
    }
    this.#tokenAnteriorHash = this.#tokenHash;
    this.#tokenHash = novoTokenHash;
    this.#parNovoCifrado = parNovoCifrado;
    this.#parNovoExpiraEm = new Date(agora.getTime() + SEGUNDOS_DE_TOLERANCIA_DA_RENOVACAO * 1000);
    this.#trocadoEm = new Date(agora.getTime());
    this.#ultimoUsoEm = new Date(agora.getTime());
    this.#expiraEm = proximoFim(this.#cliente, agora, this.#expiraAbsolutoEm);
  }

  /**
   * Revoga a sessão e apaga o par novo cifrado. Idempotente: a primeira
   * revogação (data e motivo) fica.
   */
  revogar(motivo: MotivoDeRevogacao, agora: Date): void {
    if (this.#revogadaEm !== null) return;
    this.#revogadaEm = new Date(agora.getTime());
    this.#motivoRevogacao = motivo;
    this.#parNovoCifrado = null;
    this.#parNovoExpiraEm = null;
  }

  /** Cópia do estado, na forma que o repositório grava. */
  get dados(): DadosDaSessao {
    return {
      id: this.#id,
      contaId: this.#contaId,
      familiaId: this.#familiaId,
      cliente: this.#cliente,
      tokenHash: this.#tokenHash,
      tokenAnteriorHash: this.#tokenAnteriorHash,
      parNovoCifrado: this.#parNovoCifrado,
      parNovoExpiraEm: copiarData(this.#parNovoExpiraEm),
      trocadoEm: copiarData(this.#trocadoEm),
      expiraEm: new Date(this.#expiraEm.getTime()),
      expiraAbsolutoEm: copiarData(this.#expiraAbsolutoEm),
      ultimoUsoEm: new Date(this.#ultimoUsoEm.getTime()),
      mfa: this.#mfa,
      revogadaEm: copiarData(this.#revogadaEm),
      motivoRevogacao: this.#motivoRevogacao,
      criadaEm: new Date(this.#criadaEm.getTime()),
    };
  }

  #venceu(agora: Date): boolean {
    if (agora.getTime() >= this.#expiraEm.getTime()) return true;
    return this.#expiraAbsolutoEm !== null && agora.getTime() >= this.#expiraAbsolutoEm.getTime();
  }
}

/**
 * Token de renovação que não é o atual nem o anterior imediato de nenhuma
 * sessão (`RepositorioDeSessoes.buscarPorTokenHash` deu `null`), consultado no
 * histórico (`buscarTokenUsado`): se já foi usado, é `reuso`, e a aplicação
 * revoga a família `uso.familiaId` (`revogarDaFamilia`, `reuso_detectado`).
 * Não há tolerância aqui: a de 60 s vale só para o anterior imediato (S16), que
 * ainda está na sessão e passa por `avaliarRenovacao`. Fora do histórico, `invalida`.
 */
export function avaliarTokenJaUsado(uso: TokenDeRenovacaoUsado | null): AvaliacaoDaRenovacao {
  return uso === null ? { tipo: 'invalida' } : { tipo: 'reuso' };
}

/**
 * Claims do token de acesso (S1): `admin` só entra se a sessão é do painel e
 * passou pelo segundo fator. Nos apps, a conta admin entra sem poderes de
 * admin. `emailVerificado` serve só para a interface (P1-dono).
 */
export function reivindicacoesDoToken(conta: Conta, sessao: Sessao): ReivindicacoesDoToken {
  if (conta.id !== sessao.contaId) {
    throw new OperacaoInvalidaNaSessao('a sessão é de outra conta');
  }
  const admin = sessao.cliente === 'painel' && sessao.mfa;
  return {
    contaId: conta.id,
    sid: sessao.id,
    perfis: conta.perfis.filter((perfil) => perfil !== 'admin' || admin),
    mfa: sessao.mfa,
    emailVerificado: conta.emailVerificado,
  };
}

/**
 * O painel só abre para conta com perfil `admin` (S23): senha certa sem o
 * perfil vira `sem_acesso_painel`, sem sessão.
 */
export function podeUsarOPainel(conta: Conta): boolean {
  return conta.temPerfil('admin');
}

/**
 * As regras de estado que o banco também confere (CHECKs da migração
 * `20261017120000_identidade`): `mfa` só no painel (S1), painel sempre com fim
 * absoluto (S9), par novo e o prazo dele sempre juntos (S16).
 */
function validarEstado(dados: DadosDaSessao): void {
  if (dados.mfa && dados.cliente !== 'painel') {
    throw new OperacaoInvalidaNaSessao('mfa só existe em sessão do painel');
  }
  if (dados.cliente === 'painel' && dados.expiraAbsolutoEm === null) {
    throw new OperacaoInvalidaNaSessao('sessão do painel sem fim absoluto');
  }
  if ((dados.parNovoCifrado === null) !== (dados.parNovoExpiraEm === null)) {
    throw new OperacaoInvalidaNaSessao('par novo sem prazo, ou prazo sem par novo');
  }
  if ((dados.revogadaEm === null) !== (dados.motivoRevogacao === null)) {
    throw new OperacaoInvalidaNaSessao('revogação sem motivo, ou motivo sem revogação');
  }
  exigirHash(dados.tokenHash);
}

function proximoFim(cliente: Cliente, agora: Date, expiraAbsolutoEm: Date | null): Date {
  if (cliente !== 'painel') return new Date(agora.getTime() + JANELA_DA_SESSAO_NOS_APPS_EM_MS);
  const porInatividade = agora.getTime() + INATIVIDADE_MAXIMA_NO_PAINEL_EM_MS;
  const teto = expiraAbsolutoEm?.getTime() ?? porInatividade;
  return new Date(Math.min(porInatividade, teto));
}

function exigirHash(hash: string): void {
  if (hash.length === 0) throw new OperacaoInvalidaNaSessao('o hash do token não pode ser vazio');
}

function copiarData(data: Date | null): Date | null {
  return data === null ? null : new Date(data.getTime());
}
