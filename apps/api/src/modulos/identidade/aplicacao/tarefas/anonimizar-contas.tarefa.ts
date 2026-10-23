// Tarefa diária da anonimização (CA-11, S5; plano 01b, etapa 13): para cada
// exclusão `pendente` (conta desativada esperando a anonimização), chama
// `AnonimizarContaCasoDeUso`, que passa por todos os `AnonimizadorDeTitular`
// registrados e conclui a solicitação numa transação só. Uma anonimização que
// falha não para as outras: fica `pendente` e volta na próxima execução.
//
// Alerta dos 25 dias: a exclusão ainda pendente cuja conta foi desativada há
// mais de 25 dias (`Conta.deveAlertarAnonimizacao`, o prazo de 30 dias da
// desativação menos 5) sai no log como aviso, só com o id da conta e o prazo.
// Conta pela desativação (`desativada_em`), nunca pela data do pedido: a
// exclusão que aguardou pendências reaproveita a solicitação e guarda a data
// do primeiro pedido, quando a conta ainda estava ativa, e o CA-11 conta os
// 30 dias da desativação. O alerta sai antes da tentativa, para o atraso
// aparecer mesmo quando a anonimização desta vez dá certo.
//
// As exclusões `aguardando_pendencias` (conta ainda ativa) não entram aqui.
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import {
  type CursorDeSolicitacao,
  RepositorioDeContas,
  RepositorioDeSolicitacoes,
} from '../../dominio/repositorios.ts';
import { AnonimizarContaCasoDeUso } from '../privacidade/anonimizar-conta.ts';

/** Exclusões lidas por vez (`listarPorStatus`). */
export const LOTE_DA_ANONIMIZACAO = 100;
/** Teto de lotes por execução: o que sobrar fica para o dia seguinte. */
export const MAXIMO_DE_LOTES_DA_ANONIMIZACAO = 50;

export interface ResultadoDaTarefaDeAnonimizacao {
  anonimizadas: number;
  /** Já anonimizada, conta ativa ou inexistente: nada a fazer. */
  ignoradas: number;
  /** Um anonimizador falhou: a exclusão fica `pendente` para a próxima execução. */
  falhas: number;
  /** Exclusões pendentes há mais de 25 dias da desativação (S5, CA-11). */
  alertas: number;
}

@Injectable()
export class AnonimizarContasTarefa {
  constructor(
    private readonly relogio: Relogio,
    private readonly contas: RepositorioDeContas,
    private readonly solicitacoes: RepositorioDeSolicitacoes,
    private readonly anonimizar: AnonimizarContaCasoDeUso,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(AnonimizarContasTarefa.name);
  }

  async executar(): Promise<ResultadoDaTarefaDeAnonimizacao> {
    const agora = this.relogio.agora();
    const resultado: ResultadoDaTarefaDeAnonimizacao = {
      anonimizadas: 0,
      ignoradas: 0,
      falhas: 0,
      alertas: 0,
    };
    // Paginação por cursor (S105): a que falhou continua pendente, mas a página
    // seguinte começa depois dela. Uma tentativa por execução, e 100 falhas
    // seguidas não escondem a 101ª.
    let cursor: CursorDeSolicitacao | null = null;
    for (let lote = 0; lote < MAXIMO_DE_LOTES_DA_ANONIMIZACAO; lote += 1) {
      const pendentes = await this.solicitacoes.listarPorStatus(
        'exclusao',
        'pendente',
        LOTE_DA_ANONIMIZACAO,
        cursor,
      );
      for (const { contaId } of pendentes) await this.#processar(contaId, agora, resultado);
      const ultima = pendentes.at(-1);
      if (pendentes.length < LOTE_DA_ANONIMIZACAO || ultima === undefined) break;
      cursor = { solicitadaEm: ultima.solicitadaEm, id: ultima.id };
    }
    this.logger.info({ ...resultado }, 'anonimização das exclusões concluída');
    return resultado;
  }

  async #processar(
    contaId: string,
    agora: Date,
    resultado: ResultadoDaTarefaDeAnonimizacao,
  ): Promise<void> {
    const conta = await this.contas.buscarPorId(contaId);
    if (conta?.deveAlertarAnonimizacao(agora) === true) {
      resultado.alertas += 1;
      this.logger.warn(
        { contaId, prazoDeAnonimizacao: conta.prazoDeAnonimizacao?.toISOString() },
        'exclusão pendente há mais de 25 dias da desativação: o prazo de 30 dias está perto',
      );
    }
    try {
      const { tipo } = await this.anonimizar.executar({ contaId });
      if (tipo === 'anonimizada') resultado.anonimizadas += 1;
      else resultado.ignoradas += 1;
    } catch (erro) {
      resultado.falhas += 1;
      // `FalhaNaAnonimizacao` leva só módulo, tipo e código; o logger não registra mensagem.
      this.logger.error({ err: erro, contaId }, 'anonimização falhou; volta na próxima execução');
    }
  }
}
