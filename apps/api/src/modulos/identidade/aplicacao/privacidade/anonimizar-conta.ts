// Anonimização da conta desativada (CA-11, S5), chamada pela tarefa da etapa
// 13 dentro do prazo de 30 dias (`DIAS_PARA_ANONIMIZAR`). Numa transação só:
// passa por todos os `AnonimizadorDeTitular` registrados (o da Identidade e os
// que os outros módulos registrarem), conclui a solicitação de exclusão e
// publica `ContaAnonimizada`. Se um anonimizador falhar, nada fica (o
// registro rejeita com `FalhaNaAnonimizacao`, só com módulo, tipo e código do
// erro) e a tarefa tenta de novo do início.
//
// Só conta desativada: a conta ativa nunca é anonimizada por aqui. A conta é
// lida com trava (`buscarPorIdParaAtualizar`) antes de decidir: duas
// anonimizações simultâneas da mesma conta (a tarefa repetida, Q24) não
// publicam `ContaAnonimizada` duas vezes; a segunda espera a primeira e acha a
// conta já anonimizada.
import { Injectable } from '@nestjs/common';
import { PublicadorDeEventos } from '../../../../compartilhado/eventos/publicador.ts';
import { RegistroDeAnonimizadores } from '../../../../compartilhado/titular/anonimizador-de-titular.ts';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import { RepositorioDeContas, RepositorioDeSolicitacoes } from '../../dominio/repositorios.ts';
import { eventoDeIdentidade } from '../eventos.ts';

export interface EntradaDaAnonimizacao {
  contaId: string;
}

/**
 * - `anonimizada`: todos os módulos anonimizaram e a solicitação foi concluída;
 * - `ja_anonimizada`: nada a fazer (a anonimização anterior foi confirmada
 *   inteira, porque roda numa transação só);
 * - `conta_ativa`: recusada, a conta não passou pela exclusão;
 * - `inexistente`: não há conta com o id.
 */
export type ResultadoDaAnonimizacao =
  | { tipo: 'anonimizada' }
  | { tipo: 'ja_anonimizada' }
  | { tipo: 'conta_ativa' }
  | { tipo: 'inexistente' };

@Injectable()
export class AnonimizarContaCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly contas: RepositorioDeContas,
    private readonly solicitacoes: RepositorioDeSolicitacoes,
    private readonly anonimizadores: RegistroDeAnonimizadores,
    private readonly publicador: PublicadorDeEventos,
    private readonly relogio: Relogio,
  ) {}

  executar({ contaId }: EntradaDaAnonimizacao): Promise<ResultadoDaAnonimizacao> {
    return this.unidade.executar(async () => {
      const conta = await this.contas.buscarPorIdParaAtualizar(contaId);
      if (conta === null) return { tipo: 'inexistente' };
      if (conta.status === 'anonimizada') return { tipo: 'ja_anonimizada' };
      if (conta.status === 'ativa') return { tipo: 'conta_ativa' };

      await this.anonimizadores.anonimizarTitular(contaId);

      const solicitacao = await this.solicitacoes.buscarUltima(contaId, 'exclusao');
      if (solicitacao !== null && solicitacao.status !== 'concluida') {
        await this.solicitacoes.atualizar({
          ...solicitacao,
          status: 'concluida',
          concluidaEm: this.relogio.agora(),
        });
      }
      await this.publicador.publicar(eventoDeIdentidade('ContaAnonimizada', { contaId }));
      return { tipo: 'anonimizada' };
    });
  }
}
