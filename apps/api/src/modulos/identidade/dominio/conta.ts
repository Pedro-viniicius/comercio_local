// Conta: o agregado da Identidade (`identidade.contas` + `perfis_conta`).
//
// Regras desta camada (plano 01b, Decisão e etapa 4):
// - uma conta por e-mail normalizado; o cadastro nasce com o perfil
//   `consumidor` (CA-01) e o mesmo login vale nos dois apps (CA-07);
// - o recadastro de um e-mail existente, verificado ou não, nunca altera a
//   conta (P1-dono, substitui o S6): `decidirCadastro` só diz que é repetido;
// - o login vale sem e-mail verificado e grava `ultimo_login_em` (a renovação
//   da sessão também grava, etapa 9);
//   `emailVerificado` vai para a sessão só para a interface (P1-dono);
// - a redefinição de senha conta como verificação do e-mail;
// - conta não verificada e sem login nem renovação há mais de 7 dias é
//   apagada (`deveSerExpurgada`);
// - `admin` nunca é concedido pelo caminho comum (`concederPerfil` recusa) e só
//   entra no token de sessão do painel com segundo fator (`sessao.ts`); a conta
//   admin nasce pela CLI `seed:admin` (`criarAdmin`), sem senha;
// - exclusão (CA-11): `desativar` na hora; `anonimizar` em até 30 dias, só
//   depois de desativada, apagando nome, e-mail, telefone e senha.
//
// Tempo: todo método recebe `agora` de quem chama (a aplicação lê o `Relogio`).
// Campos privados (`#`): `JSON.stringify` de uma conta dá `{}`.
import {
  type Perfil,
  normalizarNome,
  problemaDoNome,
  type ProblemaDoNome,
} from '@bairrin/contratos/validadores';
import { Email } from './email.ts';
import { Telefone } from './telefone.ts';

export type StatusDaConta = 'ativa' | 'desativada' | 'anonimizada';

/** Perfis que um caso de uso pode conceder. `admin` só por `concederAdmin` (CLI). */
export type PerfilConcedivel = Exclude<Perfil, 'admin'>;

export interface PerfilConcedido {
  readonly perfil: Perfil;
  readonly concedidoEm: Date;
  /** Conta que concedeu; `null` quando foi o próprio sistema (cadastro, CLI). */
  readonly concedidoPor: string | null;
}

/** Forma persistida da conta, coluna a coluna (`contas`) mais os `perfis_conta`. */
export interface DadosDaConta {
  readonly id: string;
  readonly nome: string;
  readonly emailNormalizado: string;
  /** `null` só na conta anonimizada. */
  readonly telefoneE164: string | null;
  /** `null` na conta criada pela CLI antes da primeira redefinição e na anonimizada. */
  readonly senhaHash: string | null;
  readonly emailVerificadoEm: Date | null;
  readonly ultimoLoginEm: Date | null;
  readonly status: StatusDaConta;
  readonly criadaEm: Date;
  readonly desativadaEm: Date | null;
  readonly anonimizadaEm: Date | null;
  readonly perfis: readonly PerfilConcedido[];
}

/** Dias sem login até a conta não verificada ser apagada (P1-dono). */
export const DIAS_ATE_EXPURGO_DE_NAO_VERIFICADA = 7;
/** Prazo para anonimizar a conta desativada (CA-11). */
export const DIAS_PARA_ANONIMIZAR = 30;
/** Passado este prazo desde a desativação, a tarefa de anonimização alerta (etapa 13). */
export const DIAS_PARA_ALERTA_DE_ANONIMIZACAO = 25;
/** Nome que fica na conta anonimizada. */
export const NOME_DA_CONTA_ANONIMIZADA = 'Conta anonimizada';

const UM_DIA_EM_MS = 24 * 60 * 60 * 1000;

/** Nome recusado pela regra de `problemaDoNome`. A mensagem nunca repete o valor. */
export class NomeInvalido extends Error {
  constructor(readonly problema: ProblemaDoNome) {
    super(`Nome inválido (${problema}).`);
    this.name = 'NomeInvalido';
  }
}

/** Hash de senha vazio: erro de programação de quem chama. */
export class HashDeSenhaInvalido extends Error {
  constructor() {
    super('O hash da senha não pode ser vazio.');
    this.name = 'HashDeSenhaInvalido';
  }
}

/** A operação não vale no estado atual da conta (ex.: entrar com conta desativada). */
export class OperacaoInvalidaNaConta extends Error {
  constructor(
    readonly operacao: string,
    readonly status: StatusDaConta,
  ) {
    super(`A operação ${operacao} não vale para conta ${status}.`);
    this.name = 'OperacaoInvalidaNaConta';
  }
}

/**
 * Estado lido que fere as regras da conta (as mesmas dos CHECKs de
 * `identidade.contas`): conta não anonimizada sem telefone, desativada sem
 * `desativada_em`, anonimizada com senha ou telefone. Erro de dado, não de
 * entrada; a mensagem não traz valor da conta.
 */
export class EstadoDeContaInvalido extends Error {
  constructor(motivo: string) {
    super(`Estado de conta inválido: ${motivo}.`);
    this.name = 'EstadoDeContaInvalido';
  }
}

/**
 * Já existe conta com o e-mail. O repositório lança ao inserir quando perde a
 * corrida para outro cadastro do mesmo e-mail (a unicidade é do banco); o caso
 * de uso responde igual ao cadastro repetido (CA-02).
 */
export class EmailJaCadastrado extends Error {
  constructor() {
    super('Já existe conta com este e-mail.');
    this.name = 'EmailJaCadastrado';
  }
}

/**
 * O banco recusou apagar a conta (trigger `contas_so_expurgo`, S78, código
 * 23514): ela não cumpre a regra do expurgo pelo relógio do banco (`now()`).
 * Uma conta na fronteira dos 7 dias pode passar em `deveSerExpurgada`, que usa
 * o `agora` da aplicação, e não na trigger: a tarefa trata como "não apagou".
 * A mensagem não traz dado da conta.
 */
export class ContaForaDoExpurgo extends Error {
  constructor() {
    super('O banco recusou apagar a conta: ela não cumpre a regra do expurgo.');
    this.name = 'ContaForaDoExpurgo';
  }
}

export interface NovaConta {
  id: string;
  /** Como a pessoa digitou: a conta normaliza e valida (`normalizarNome`, `problemaDoNome`). */
  nome: string;
  email: Email;
  telefone: Telefone;
  senhaHash: string;
  agora: Date;
}

/** Conta admin criada pela CLI `seed:admin`: sem senha, com telefone (CHECK do banco). */
export interface NovoAdmin {
  id: string;
  /** Como foi digitado: a conta normaliza e valida, como no cadastro. */
  nome: string;
  email: Email;
  telefone: Telefone;
  agora: Date;
}

export class Conta {
  readonly #id: string;
  #nome: string;
  #email: Email;
  #telefone: Telefone | null;
  #senhaHash: string | null;
  #emailVerificadoEm: Date | null;
  #ultimoLoginEm: Date | null;
  #status: StatusDaConta;
  readonly #criadaEm: Date;
  #desativadaEm: Date | null;
  #anonimizadaEm: Date | null;
  readonly #perfis: PerfilConcedido[];

  private constructor(dados: DadosDaConta) {
    validarEstado(dados);
    this.#id = dados.id;
    this.#nome = dados.nome;
    this.#email = Email.criar(dados.emailNormalizado);
    this.#telefone = dados.telefoneE164 === null ? null : Telefone.criar(dados.telefoneE164);
    this.#senhaHash = dados.senhaHash;
    this.#emailVerificadoEm = copiarData(dados.emailVerificadoEm);
    this.#ultimoLoginEm = copiarData(dados.ultimoLoginEm);
    this.#status = dados.status;
    this.#criadaEm = new Date(dados.criadaEm.getTime());
    this.#desativadaEm = copiarData(dados.desativadaEm);
    this.#anonimizadaEm = copiarData(dados.anonimizadaEm);
    this.#perfis = dados.perfis.map(copiarPerfil);
  }

  /** Cadastro (CA-01): conta ativa, e-mail não verificado e perfil `consumidor`. */
  static criar(nova: NovaConta): Conta {
    const nome = normalizarNome(nova.nome);
    const problema = problemaDoNome(nome);
    if (problema !== null) throw new NomeInvalido(problema);
    exigirHash(nova.senhaHash);
    return new Conta({
      id: nova.id,
      nome,
      emailNormalizado: nova.email.valor,
      telefoneE164: nova.telefone.valor,
      senhaHash: nova.senhaHash,
      emailVerificadoEm: null,
      ultimoLoginEm: null,
      status: 'ativa',
      criadaEm: nova.agora,
      desativadaEm: null,
      anonimizadaEm: null,
      perfis: [{ perfil: 'consumidor', concedidoEm: nova.agora, concedidoPor: null }],
    });
  }

  /**
   * Conta admin da CLI `seed:admin` (CA-07: nenhuma rota concede admin). Nasce
   * ativa, com os perfis `consumidor` e `admin`, e SEM senha (`senha_hash`
   * nulo): `podeEntrar` é falso até a primeira redefinição pelo código enviado
   * ao e-mail, que também verifica o e-mail. Nada de senha aleatória
   * descartada. Não verificada, mas `deveSerExpurgada` poupa conta `admin`.
   */
  static criarAdmin(novo: NovoAdmin): Conta {
    const nome = normalizarNome(novo.nome);
    const problema = problemaDoNome(nome);
    if (problema !== null) throw new NomeInvalido(problema);
    const conta = new Conta({
      id: novo.id,
      nome,
      emailNormalizado: novo.email.valor,
      telefoneE164: novo.telefone.valor,
      senhaHash: null,
      emailVerificadoEm: null,
      ultimoLoginEm: null,
      status: 'ativa',
      criadaEm: novo.agora,
      desativadaEm: null,
      anonimizadaEm: null,
      perfis: [{ perfil: 'consumidor', concedidoEm: novo.agora, concedidoPor: null }],
    });
    conta.concederAdmin(novo.agora);
    return conta;
  }

  /** Remonta a conta a partir do que o repositório leu. */
  static reconstituir(dados: DadosDaConta): Conta {
    return new Conta(dados);
  }

  get id(): string {
    return this.#id;
  }

  get nome(): string {
    return this.#nome;
  }

  get email(): Email {
    return this.#email;
  }

  get telefone(): Telefone | null {
    return this.#telefone;
  }

  get senhaHash(): string | null {
    return this.#senhaHash;
  }

  get status(): StatusDaConta {
    return this.#status;
  }

  get emailVerificado(): boolean {
    return this.#emailVerificadoEm !== null;
  }

  get emailVerificadoEm(): Date | null {
    return copiarData(this.#emailVerificadoEm);
  }

  get ultimoLoginEm(): Date | null {
    return copiarData(this.#ultimoLoginEm);
  }

  get criadaEm(): Date {
    return new Date(this.#criadaEm.getTime());
  }

  get desativadaEm(): Date | null {
    return copiarData(this.#desativadaEm);
  }

  get anonimizadaEm(): Date | null {
    return copiarData(this.#anonimizadaEm);
  }

  /** Perfis da conta, na ordem de concessão. Quais vão para o token decide `sessao.ts`. */
  get perfis(): readonly Perfil[] {
    return this.#perfis.map(({ perfil }) => perfil);
  }

  temPerfil(perfil: Perfil): boolean {
    return this.#perfis.some((concedido) => concedido.perfil === perfil);
  }

  /**
   * A senha pode ser conferida: conta ativa e com senha. Conta não verificada
   * entra (P1-dono). Quem chama mantém a mesma resposta e o mesmo tempo para
   * conta que não pode entrar e senha errada (CA-04).
   */
  get podeEntrar(): boolean {
    return this.#status === 'ativa' && this.#senhaHash !== null;
  }

  /**
   * Login (ou renovação de sessão) com sucesso: grava `ultimo_login_em`
   * (P1-dono, base do expurgo: último login ou renovação).
   */
  registrarLogin(agora: Date): void {
    this.#exigirAtiva('registrarLogin');
    this.#ultimoLoginEm = new Date(agora.getTime());
  }

  /** Código de verificação aceito. Idempotente: guarda a primeira data. */
  verificarEmail(agora: Date): void {
    this.#exigirAtiva('verificarEmail');
    this.#emailVerificadoEm ??= new Date(agora.getTime());
  }

  /**
   * Senha redefinida pelo código enviado ao e-mail: troca o hash e conta como
   * verificação do e-mail (P1-dono). Quem chama revoga todas as sessões da
   * conta na mesma transação (CA-05).
   */
  redefinirSenha(novoHash: string, agora: Date): void {
    this.#exigirAtiva('redefinirSenha');
    exigirHash(novoHash);
    this.#senhaHash = novoHash;
    this.verificarEmail(agora);
  }

  /**
   * Concede `consumidor` ou `lojista` (o `lojista` vem da fatia 2, ao criar a
   * loja; CA-07). Idempotente: o perfil já concedido fica como está.
   */
  concederPerfil(perfil: PerfilConcedivel, agora: Date, concedidoPor: string | null = null): void {
    if ((perfil as Perfil) === 'admin') {
      throw new OperacaoInvalidaNaConta('concederPerfil(admin)', this.#status);
    }
    this.#conceder(perfil, agora, concedidoPor);
  }

  /**
   * Concede `admin`. Só a CLI `seed:admin` chama (CA-07: nenhuma rota concede
   * admin). O perfil só vale no token de sessão do painel com segundo fator.
   */
  concederAdmin(agora: Date): void {
    this.#conceder('admin', agora, null);
  }

  /** Exclusão confirmada com a senha (CA-11): desativa na hora. */
  desativar(agora: Date): void {
    this.#exigirAtiva('desativar');
    this.#status = 'desativada';
    this.#desativadaEm = new Date(agora.getTime());
  }

  /**
   * Anonimização (CA-11): troca nome e e-mail por valores fixos não
   * reversíveis e apaga telefone e senha. Ficam o id, os perfis, as datas e o
   * status, para os registros que a lei manda guardar continuarem ligados a um
   * id. Só depois de `desativar`; idempotente (o anonimizador roda de novo do
   * início depois de uma falha).
   */
  anonimizar(agora: Date): void {
    if (this.#status === 'anonimizada') return;
    if (this.#status !== 'desativada') {
      throw new OperacaoInvalidaNaConta('anonimizar', this.#status);
    }
    this.#nome = NOME_DA_CONTA_ANONIMIZADA;
    this.#email = Email.substitutoDaAnonimizacao(this.#id);
    this.#telefone = null;
    this.#senhaHash = null;
    this.#status = 'anonimizada';
    this.#anonimizadaEm = new Date(agora.getTime());
  }

  /** Fim do prazo de anonimização da conta desativada; `null` se ela não está desativada. */
  get prazoDeAnonimizacao(): Date | null {
    if (this.#status !== 'desativada' || this.#desativadaEm === null) return null;
    return new Date(this.#desativadaEm.getTime() + DIAS_PARA_ANONIMIZAR * UM_DIA_EM_MS);
  }

  /**
   * Início do alerta da anonimização: `prazoDeAnonimizacao` menos 5 dias, ou
   * seja, 25 dias depois de `desativada_em` (`DIAS_PARA_ALERTA_DE_ANONIMIZACAO`).
   * Conta pela desativação, nunca pela data do pedido: a exclusão que aguardou
   * pendências reaproveita a solicitação antiga, e o CA-11 conta os 30 dias da
   * desativação. `null` se a conta não está desativada.
   */
  get inicioDoAlertaDeAnonimizacao(): Date | null {
    const prazo = this.prazoDeAnonimizacao;
    if (prazo === null) return null;
    const folga = (DIAS_PARA_ANONIMIZAR - DIAS_PARA_ALERTA_DE_ANONIMIZACAO) * UM_DIA_EM_MS;
    return new Date(prazo.getTime() - folga);
  }

  /** A conta desativada passou de 25 dias sem anonimização: a tarefa alerta. */
  deveAlertarAnonimizacao(agora: Date): boolean {
    const inicio = this.inicioDoAlertaDeAnonimizacao;
    return inicio !== null && agora.getTime() > inicio.getTime();
  }

  /**
   * Conta não verificada e sem login nem renovação há mais de 7 dias
   * (P1-dono): a tarefa diária a apaga. A referência é o último login ou
   * renovação (`ultimo_login_em`); sem nenhum, o cadastro. Nunca apaga conta
   * com perfil `admin` (criada pela CLI e verificada só na primeira
   * redefinição) nem `lojista` (tem loja da fatia 2), nem conta já em exclusão.
   */
  deveSerExpurgada(agora: Date): boolean {
    if (this.#status !== 'ativa' || this.#emailVerificadoEm !== null) return false;
    if (this.temPerfil('admin') || this.temPerfil('lojista')) return false;
    const referencia = this.#ultimoLoginEm ?? this.#criadaEm;
    return referencia.getTime() < limiteDoExpurgo(agora).getTime();
  }

  /** Cópia do estado, na forma que o repositório grava. */
  get dados(): DadosDaConta {
    return {
      id: this.#id,
      nome: this.#nome,
      emailNormalizado: this.#email.valor,
      telefoneE164: this.#telefone?.valor ?? null,
      senhaHash: this.#senhaHash,
      emailVerificadoEm: copiarData(this.#emailVerificadoEm),
      ultimoLoginEm: copiarData(this.#ultimoLoginEm),
      status: this.#status,
      criadaEm: new Date(this.#criadaEm.getTime()),
      desativadaEm: copiarData(this.#desativadaEm),
      anonimizadaEm: copiarData(this.#anonimizadaEm),
      perfis: this.#perfis.map(copiarPerfil),
    };
  }

  #conceder(perfil: Perfil, agora: Date, concedidoPor: string | null): void {
    this.#exigirAtiva('concederPerfil');
    if (this.temPerfil(perfil)) return;
    this.#perfis.push({ perfil, concedidoEm: new Date(agora.getTime()), concedidoPor });
  }

  #exigirAtiva(operacao: string): void {
    if (this.#status !== 'ativa') throw new OperacaoInvalidaNaConta(operacao, this.#status);
  }
}

/**
 * Instante antes do qual a última atividade (login ou, sem login, o cadastro)
 * de uma conta não verificada a torna apagável. O repositório usa o mesmo
 * limite na consulta (`RepositorioDeContas.listarParaExpurgo`).
 */
export function limiteDoExpurgo(agora: Date): Date {
  return new Date(agora.getTime() - DIAS_ATE_EXPURGO_DE_NAO_VERIFICADA * UM_DIA_EM_MS);
}

/** Resultado do cadastro: conta nova ou e-mail que já tem conta. */
export type DecisaoDeCadastro = { tipo: 'criar' } | { tipo: 'repetido'; contaId: string };

/**
 * O recadastro nunca altera a conta existente, verificada ou não, em qualquer
 * status (P1-dono): a resposta é a mesma do cadastro (CA-02) e o dono do
 * e-mail recebe o aviso (evento `CadastroRepetidoTentado`). Não há método da
 * conta que troque nome, telefone ou e-mail.
 */
export function decidirCadastro(existente: Conta | null): DecisaoDeCadastro {
  return existente === null ? { tipo: 'criar' } : { tipo: 'repetido', contaId: existente.id };
}

export type TipoDeDocumentoLegal = 'termos' | 'privacidade';

/**
 * Aceite versionado (CA-01, S24): devolve os documentos cuja versão aceita
 * difere da vigente, na ordem `termos`, `privacidade`. Vazio quando confere.
 */
export function aceitesDivergentes(
  aceitas: Readonly<Record<TipoDeDocumentoLegal, string>>,
  vigentes: Readonly<Record<TipoDeDocumentoLegal, string>>,
): TipoDeDocumentoLegal[] {
  return (['termos', 'privacidade'] as const).filter((tipo) => aceitas[tipo] !== vigentes[tipo]);
}

/**
 * As regras de estado que o banco também confere (CHECKs da migração
 * `20261017120000_identidade`): a conta não chega a um estado que o banco
 * recusaria, nem é remontada a partir de um.
 */
function validarEstado(dados: DadosDaConta): void {
  if (dados.telefoneE164 === null && dados.status !== 'anonimizada') {
    throw new EstadoDeContaInvalido('só a conta anonimizada fica sem telefone');
  }
  if (dados.status !== 'ativa' && dados.desativadaEm === null) {
    throw new EstadoDeContaInvalido('conta desativada ou anonimizada sem desativada_em');
  }
  if (
    dados.status === 'anonimizada' &&
    (dados.anonimizadaEm === null || dados.senhaHash !== null || dados.telefoneE164 !== null)
  ) {
    throw new EstadoDeContaInvalido('conta anonimizada com senha, telefone ou sem anonimizada_em');
  }
  if (dados.senhaHash !== null && dados.senhaHash.trim().length === 0) {
    throw new EstadoDeContaInvalido('hash de senha vazio');
  }
}

function exigirHash(hash: string): void {
  if (hash.trim().length === 0) throw new HashDeSenhaInvalido();
}

function copiarData(data: Date | null): Date | null {
  return data === null ? null : new Date(data.getTime());
}

function copiarPerfil(perfil: PerfilConcedido): PerfilConcedido {
  return {
    perfil: perfil.perfil,
    concedidoEm: new Date(perfil.concedidoEm.getTime()),
    concedidoPor: perfil.concedidoPor,
  };
}
