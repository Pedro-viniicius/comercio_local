// Pedido de cópia dos dados (CA-10, S10; `POST /v1/privacidade/exportacao`,
// etapa 19): grava a solicitação e publica `ExportacaoSolicitada` na mesma
// transação. O assinante (etapa 13) gera o arquivo cifrado com
// `GerarExportacaoCasoDeUso` e manda o e-mail que só avisa que está pronto; o prazo de
// 48 h do CA-10 é o da fila do worker, que gera assim que o evento chega.
//
// Um pedido por conta a cada 24 h (plano 01b, "Limites"), contado da última
// solicitação de exportação, em qualquer status.
//
// Dois pedidos simultâneos (Q23, S98): os dois leem "nenhum pedido nas últimas
// 24 h" antes de qualquer um confirmar. Por isso, depois de inserir a
// solicitação, o caso de uso trava a conta (`buscarPorIdParaAtualizar`, `FOR
// NO KEY UPDATE`, que não cruza com a FK da solicitação recém-inserida) e conta
// de novo os pedidos das últimas 24 h, agora com a própria inclusa. Com a conta
// travada, o segundo pedido espera o primeiro confirmar e vê a solicitação
// dele: passa de um, tudo é desfeito e a resposta é `ja_solicitada`. A trava
// vem depois da primeira leitura, e não antes, para o pedido que já passou do
// limite nem chegar a esperar.
import { Injectable } from '@nestjs/common';
import { PublicadorDeEventos } from '../../../../compartilhado/eventos/publicador.ts';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import { RepositorioDeContas, RepositorioDeSolicitacoes } from '../../dominio/repositorios.ts';
import { eventoDeIdentidade } from '../eventos.ts';
import { GeradorDeSegredos } from '../portas/gerador-de-segredos.ts';

/** Intervalo mínimo entre dois pedidos de exportação da mesma conta. */
export const HORAS_ENTRE_EXPORTACOES = 24;

const INTERVALO_EM_MS = HORAS_ENTRE_EXPORTACOES * 60 * 60 * 1000;

export interface EntradaDaSolicitacaoDeExportacao {
  /** Conta da sessão. */
  contaId: string;
}

/**
 * - `solicitada`: pedido gravado e evento publicado (202);
 * - `ja_solicitada`: já houve pedido nas últimas 24 h; `proximaEm` é quando
 *   pode pedir de novo (a etapa 19 decide o status; a tela mostra o aviso da
 *   spec A6).
 */
export type ResultadoDaSolicitacaoDeExportacao =
  { tipo: 'solicitada' } | { tipo: 'ja_solicitada'; proximaEm: Date };

/** Outro pedido confirmou nas últimas 24 h enquanto este gravava: desfaz este. */
class OutroPedidoNoMeio extends Error {
  constructor() {
    super('Outro pedido de exportação da conta confirmou no meio.');
    this.name = 'OutroPedidoNoMeio';
  }
}

@Injectable()
export class SolicitarExportacaoCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly contas: RepositorioDeContas,
    private readonly solicitacoes: RepositorioDeSolicitacoes,
    private readonly publicador: PublicadorDeEventos,
    private readonly gerador: GeradorDeSegredos,
    private readonly relogio: Relogio,
  ) {}

  async executar({
    contaId,
  }: EntradaDaSolicitacaoDeExportacao): Promise<ResultadoDaSolicitacaoDeExportacao> {
    const agora = this.relogio.agora();
    try {
      return await this.unidade.executar(() => this.#solicitar(contaId, agora));
    } catch (erro) {
      if (!(erro instanceof OutroPedidoNoMeio)) throw erro;
      // Fora da unidade desfeita: o pedido que ganhou já confirmou e é o último.
      const ultima = await this.solicitacoes.buscarUltima(contaId, 'exportacao');
      return { tipo: 'ja_solicitada', proximaEm: proximaDepois(ultima?.solicitadaEm ?? agora) };
    }
  }

  async #solicitar(contaId: string, agora: Date): Promise<ResultadoDaSolicitacaoDeExportacao> {
    const ultima = await this.solicitacoes.buscarUltima(contaId, 'exportacao');
    if (ultima !== null) {
      const proximaEm = proximaDepois(ultima.solicitadaEm);
      if (agora.getTime() < proximaEm.getTime()) return { tipo: 'ja_solicitada', proximaEm };
    }
    const solicitacaoId = this.gerador.novoId();
    await this.solicitacoes.inserir({
      id: solicitacaoId,
      contaId,
      tipo: 'exportacao',
      status: 'pendente',
      solicitadaEm: agora,
      concluidaEm: null,
    });
    // Com a conta travada, conta de novo: a própria e as que confirmaram no meio.
    await this.contas.buscarPorIdParaAtualizar(contaId);
    const desde = new Date(agora.getTime() - INTERVALO_EM_MS);
    if ((await this.solicitacoes.contarDesde(contaId, 'exportacao', desde)) > 1) {
      throw new OutroPedidoNoMeio();
    }
    await this.publicador.publicar(
      eventoDeIdentidade('ExportacaoSolicitada', { contaId, solicitacaoId }),
    );
    return { tipo: 'solicitada' };
  }
}

function proximaDepois(solicitadaEm: Date): Date {
  return new Date(solicitadaEm.getTime() + INTERVALO_EM_MS);
}
