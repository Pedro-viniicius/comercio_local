// Tarefa diária do expurgo (P1-dono, S6, S8, S78; plano 01b, etapa 13): apaga
// as contas não verificadas, sem perfil `admin` nem `lojista` e sem login nem
// renovação de sessão há mais de 7 dias (`Conta.deveSerExpurgada`). As sessões
// delas (e o histórico de tokens), os códigos, os aceites e o resto do schema
// saem na mesma transação, pela FK em cascata: um token de acesso ou de
// renovação da conta apagada não acha mais conta nem sessão, e a guarda e a
// renovação respondem 401, não erro interno.
//
// Cada conta numa transação própria:
// 1. trava a conta (`buscarPorIdParaAtualizar`) e confere `deveSerExpurgada`
//    de novo com o `agora` da aplicação: quem entrou ou renovou entre a
//    listagem e a exclusão gravou `ultimo_login_em` e fica;
// 2. apaga. A trigger `contas_so_expurgo` (S78) confere a mesma regra com o
//    `now()` do banco e recusa com 23514 (`ContaForaDoExpurgo`) a conta que, na
//    fronteira dos 7 dias, passou no relógio da aplicação e não no do banco. O
//    23514 aborta a transação, então é tratado fora dela, como "não apagou",
//    sem derrubar o lote; a conta volta na próxima execução.
// Qualquer outro erro para a tarefa, para o pg-boss tentar de novo.
//
// Uma correção de dados futura que precise apagar conta fora desta regra
// remove a trigger na mesma migração (S78).
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import { ContaForaDoExpurgo, limiteDoExpurgo } from '../../dominio/conta.ts';
import { RepositorioDeContas } from '../../dominio/repositorios.ts';

/** Contas lidas por vez (`listarParaExpurgo`). */
export const LOTE_DO_EXPURGO = 100;
/** Teto de lotes por execução: o que sobrar fica para o dia seguinte. */
export const MAXIMO_DE_LOTES_DO_EXPURGO = 50;

export interface ResultadoDoExpurgo {
  /** Apagadas, com tudo o que era delas. */
  apagadas: number;
  /** Listadas, mas que não cumpriam mais a regra com a conta travada (login ou renovação no meio). */
  mantidas: number;
  /** Recusadas pela trigger do banco (fronteira dos 7 dias pelo `now()` do banco). */
  recusadas: number;
}

type Desfecho = 'apagada' | 'mantida' | 'recusada';

@Injectable()
export class ApagarContasNaoVerificadasTarefa {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly relogio: Relogio,
    private readonly contas: RepositorioDeContas,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(ApagarContasNaoVerificadasTarefa.name);
  }

  async executar(): Promise<ResultadoDoExpurgo> {
    const agora = this.relogio.agora();
    const resultado: ResultadoDoExpurgo = { apagadas: 0, mantidas: 0, recusadas: 0 };
    // Paginação por cursor (S105): a recusada pela trigger continua na regra,
    // mas a página seguinte começa depois dela (ids maiores). Uma tentativa por
    // execução, e 100 recusas seguidas não escondem a 101ª.
    let cursor: string | null = null;
    for (let lote = 0; lote < MAXIMO_DE_LOTES_DO_EXPURGO; lote += 1) {
      const ids = await this.contas.listarParaExpurgo(
        limiteDoExpurgo(agora),
        LOTE_DO_EXPURGO,
        cursor,
      );
      for (const id of ids) {
        const desfecho = await this.#apagar(id, agora);
        if (desfecho === 'apagada') resultado.apagadas += 1;
        else if (desfecho === 'mantida') resultado.mantidas += 1;
        else resultado.recusadas += 1;
      }
      const ultimo = ids.at(-1);
      if (ids.length < LOTE_DO_EXPURGO || ultimo === undefined) break;
      cursor = ultimo;
    }
    this.logger.info({ ...resultado }, 'expurgo de contas não verificadas concluído');
    return resultado;
  }

  async #apagar(id: string, agora: Date): Promise<Desfecho> {
    try {
      return await this.unidade.executar(async (): Promise<Desfecho> => {
        const conta = await this.contas.buscarPorIdParaAtualizar(id);
        if (conta === null || !conta.deveSerExpurgada(agora)) return 'mantida';
        await this.contas.apagar(id);
        return 'apagada';
      });
    } catch (erro) {
      if (erro instanceof ContaForaDoExpurgo) return 'recusada';
      throw erro;
    }
  }
}
