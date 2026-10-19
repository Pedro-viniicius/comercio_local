// Exclusão da conta pedida pela própria pessoa (CA-11; `POST
// /v1/privacidade/exclusao`, etapa 19), confirmada com a senha atual.
//
// Três passos, e a senha é conferida entre duas transações curtas, sem conexão
// aberta nem trava (S91, como o login):
// 1. reserva da tentativa, numa transação: trava o freio por e-mail da conta
//    (S14: a senha da exclusão soma no mesmo freio do login e da redefinição);
//    freio ativo devolve `freado` sem conferir a senha. Relê a conta com o
//    freio travado e já conta uma falha: tentativas simultâneas não passam do
//    limiar;
// 2. fora da transação, confere a senha. Errada: a falha reservada fica (soma
//    exatamente uma) e o resultado é `senha_incorreta`, que vira 400
//    `campos[senha].invalido` (nunca 401: o `cliente-api` renova e repete todo
//    401, e a senha contaria duas vezes);
// 3. senha certa, noutra transação: trava o freio de novo e relê a conta. A
//    redefinição de senha trava o mesmo freio antes de gravar a senha, então
//    as duas não se atropelam: se a senha mudou no meio, a conferida era a
//    antiga e o resultado é `senha_incorreta` (a falha reservada fica). Senão,
//    zera o freio (`registrarSucesso`) e consulta as pendências de outros
//    módulos (pedido em andamento, saldo a repassar):
//    - com pendência, nada muda na conta: a solicitação fica
//      `aguardando_pendencias` e o resultado leva o aviso (409). Consulta que
//      falha rejeita e desfaz tudo (na dúvida, a exclusão não segue);
//    - sem pendência: desativa a conta (`gravarDesativacao`, só se ainda ativa,
//      S95) e revoga todas as sessões (S8), grava a solicitação `pendente` (a
//      tarefa da etapa 13 anonimiza em até 30 dias com `AnonimizarContaCasoDeUso`) e
//      publica `ContaDesativada`.
//
// Nenhum resultado traz dado da conta além das pendências (módulo e tipo).
import { Injectable } from '@nestjs/common';
import { PublicadorDeEventos } from '../../../../compartilhado/eventos/publicador.ts';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import type { Conta } from '../../dominio/conta.ts';
import {
  RepositorioDeBloqueios,
  RepositorioDeContas,
  RepositorioDeSessoes,
  RepositorioDeSolicitacoes,
  type StatusDaSolicitacao,
} from '../../dominio/repositorios.ts';
import { chaveDoFreioPorEmail } from '../comum/chaves.ts';
import { eventoDeIdentidade } from '../eventos.ts';
import { Cifrador } from '../portas/cifrador.ts';
import { GeradorDeSegredos } from '../portas/gerador-de-segredos.ts';
import { Hasher } from '../portas/hasher.ts';
import {
  type PendenciaDeExclusao,
  VerificadorDePendencias,
} from '../portas/verificador-de-pendencias.ts';

export interface EntradaDaSolicitacaoDeExclusao {
  /** Conta da sessão. */
  contaId: string;
  /** Senha atual, como digitada (o `Hasher` normaliza). */
  senha: string;
}

/**
 * - `desativada`: conta desativada e sessões revogadas (202);
 * - `senha_incorreta`: uma falha somada no freio por e-mail (400
 *   `campos[senha].invalido`);
 * - `freado`: freio por e-mail ativo, senha não conferida (429 com
 *   `Retry-After` = `segundosDeEspera`);
 * - `com_pendencias`: a exclusão aguarda (409 com o aviso);
 * - `conta_indisponivel`: a conta deixou de estar ativa entre a guarda e o caso
 *   de uso (corrida com outra exclusão); a próxima requisição já cai na guarda.
 */
export type ResultadoDaSolicitacaoDeExclusao =
  | { tipo: 'desativada' }
  | { tipo: 'senha_incorreta' }
  | { tipo: 'freado'; segundosDeEspera: number }
  | { tipo: 'com_pendencias'; pendencias: readonly PendenciaDeExclusao[] }
  | { tipo: 'conta_indisponivel' };

const CONTA_INDISPONIVEL = { tipo: 'conta_indisponivel' } as const;
const SENHA_INCORRETA = { tipo: 'senha_incorreta' } as const;

/** A conta saiu de `ativa` entre a releitura e a desativação: desfaz tudo. */
class ContaIndisponivelNoMeio extends Error {
  constructor() {
    super('A conta deixou de estar ativa durante a exclusão.');
    this.name = 'ContaIndisponivelNoMeio';
  }
}

/** O que a reserva da tentativa devolve: um resultado final, ou a conta com a falha já contada. */
type Reserva =
  | { readonly tipo: 'resolvida'; readonly resultado: ResultadoDaSolicitacaoDeExclusao }
  | { readonly tipo: 'reservada'; readonly conta: Conta; readonly chave: string };

@Injectable()
export class SolicitarExclusaoCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly contas: RepositorioDeContas,
    private readonly sessoes: RepositorioDeSessoes,
    private readonly bloqueios: RepositorioDeBloqueios,
    private readonly solicitacoes: RepositorioDeSolicitacoes,
    private readonly pendencias: VerificadorDePendencias,
    private readonly publicador: PublicadorDeEventos,
    private readonly hasher: Hasher,
    private readonly cifrador: Cifrador,
    private readonly gerador: GeradorDeSegredos,
    private readonly relogio: Relogio,
  ) {}

  async executar({
    contaId,
    senha,
  }: EntradaDaSolicitacaoDeExclusao): Promise<ResultadoDaSolicitacaoDeExclusao> {
    const agora = this.relogio.agora();
    const reserva = await this.unidade.executar(() => this.#reservar(contaId, agora));
    if (reserva.tipo === 'resolvida') return reserva.resultado;

    // Fora de transação: o Argon2id não segura conexão nem trava (S91).
    if (!(await this.#senhaConfere(reserva.conta, senha))) return SENHA_INCORRETA;

    try {
      return await this.unidade.executar(() => this.#excluir(reserva, agora));
    } catch (erro) {
      if (erro instanceof ContaIndisponivelNoMeio) return CONTA_INDISPONIVEL;
      throw erro;
    }
  }

  /** Passo 1: trava o freio, relê a conta e conta a falha da tentativa. */
  async #reservar(contaId: string, agora: Date): Promise<Reserva> {
    // O e-mail da conta ativa não muda; a leitura sem trava serve só para a chave do freio.
    const lida = await this.contas.buscarPorId(contaId);
    if (lida === null || lida.status !== 'ativa') {
      return { tipo: 'resolvida', resultado: CONTA_INDISPONIVEL };
    }
    const chave = chaveDoFreioPorEmail(this.cifrador, lida.email);
    const freio = await this.bloqueios.buscarParaAtualizar(chave, 'email', agora);
    if (freio.estaBloqueado(agora)) {
      const segundosDeEspera = freio.segundosDeEspera(agora);
      return { tipo: 'resolvida', resultado: { tipo: 'freado', segundosDeEspera } };
    }
    const conta = await this.contas.buscarPorId(contaId);
    if (conta === null || conta.status !== 'ativa') {
      await this.bloqueios.salvar(freio);
      return { tipo: 'resolvida', resultado: CONTA_INDISPONIVEL };
    }
    freio.registrarFalha(agora);
    await this.bloqueios.salvar(freio);
    return { tipo: 'reservada', conta, chave };
  }

  /**
   * Passo 3, com a senha certa: trava o freio, relê a conta (a senha conferida
   * tem de ser a atual), zera o freio e segue com as pendências e a exclusão.
   */
  async #excluir(
    reserva: Extract<Reserva, { tipo: 'reservada' }>,
    agora: Date,
  ): Promise<ResultadoDaSolicitacaoDeExclusao> {
    const freio = await this.bloqueios.buscarParaAtualizar(reserva.chave, 'email', agora);
    const conta = await this.contas.buscarPorId(reserva.conta.id);
    if (conta === null || conta.status !== 'ativa') {
      await this.bloqueios.salvar(freio);
      return CONTA_INDISPONIVEL;
    }
    // A senha conferida era a de antes: redefinição confirmada no meio.
    if (conta.senhaHash !== reserva.conta.senhaHash) {
      await this.bloqueios.salvar(freio);
      return SENHA_INCORRETA;
    }
    freio.registrarSucesso('senha');
    await this.bloqueios.salvar(freio);

    const pendencias = await this.pendencias.pendenciasDaConta(conta.id);
    if (pendencias.length > 0) {
      await this.#registrarSolicitacao(conta.id, 'aguardando_pendencias', agora);
      return { tipo: 'com_pendencias', pendencias };
    }

    // Só `status` e `desativada_em`, e só com a conta ainda ativa (S95).
    if (!(await this.contas.gravarDesativacao(conta.id, agora))) {
      throw new ContaIndisponivelNoMeio();
    }
    await this.sessoes.revogarDaConta(conta.id, 'conta_desativada', agora);
    await this.#registrarSolicitacao(conta.id, 'pendente', agora);
    await this.publicador.publicar(eventoDeIdentidade('ContaDesativada', { contaId: conta.id }));
    return { tipo: 'desativada' };
  }

  /** Conta sem senha (admin antes da primeira redefinição) gasta o mesmo tempo e não confere. */
  async #senhaConfere(conta: Conta, senha: string): Promise<boolean> {
    if (conta.senhaHash === null) {
      await this.hasher.simularVerificacao(senha);
      return false;
    }
    return this.hasher.verificar(senha, conta.senhaHash);
  }

  /**
   * Uma solicitação de exclusão aberta por conta: o pedido repetido enquanto
   * aguarda pendências reaproveita a mesma, e a que aguardava passa a
   * `pendente` quando a exclusão finalmente acontece.
   */
  async #registrarSolicitacao(
    contaId: string,
    status: Exclude<StatusDaSolicitacao, 'concluida'>,
    agora: Date,
  ): Promise<void> {
    const ultima = await this.solicitacoes.buscarUltima(contaId, 'exclusao');
    if (ultima !== null && ultima.status !== 'concluida') {
      if (ultima.status !== status) await this.solicitacoes.atualizar({ ...ultima, status });
      return;
    }
    await this.solicitacoes.inserir({
      id: this.gerador.novoId(),
      contaId,
      tipo: 'exclusao',
      status,
      solicitadaEm: agora,
      concluidaEm: null,
    });
  }
}
