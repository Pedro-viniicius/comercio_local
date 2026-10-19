// Download da cópia dos dados (CA-10, S10; `GET
// /v1/privacidade/exportacao/arquivo`, etapa 19): só a conta da sessão, só a
// exportação mais recente ainda não baixada e não vencida (7 dias), e uma vez
// só: o caso de uso marca a exportação como baixada na mesma transação em que
// a decifra. A marcação é um UPDATE condicionado a `baixada_em IS NULL`: de dois
// downloads simultâneos, só o que marcou recebe o arquivo; o outro recebe
// `indisponivel` e a unidade dele é desfeita. Se a resposta se perder no
// caminho, a pessoa pede outra cópia depois do intervalo de 24 h.
//
// O conteúdo decifrado só sai no resultado, para a resposta HTTP; nunca em
// log, evento ou erro.
import { Injectable } from '@nestjs/common';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import { RepositorioDeExportacoes } from '../../dominio/repositorios.ts';
import { Cifrador } from '../portas/cifrador.ts';

/**
 * A exportação guardada não decifra com a conta dela (alterada, de outra
 * chave ou de outra conta). Erro de dado: a exportação não é marcada como
 * baixada, e a mensagem não traz conteúdo nem id.
 */
export class ExportacaoIlegivel extends Error {
  constructor() {
    super('A exportação guardada não pôde ser decifrada.');
    this.name = 'ExportacaoIlegivel';
  }
}

/** Outro download marcou antes: desfaz a unidade e vira `indisponivel` fora dela. */
class JaBaixadaNoMeio extends Error {
  constructor() {
    super('A exportação foi baixada por outra requisição.');
    this.name = 'JaBaixadaNoMeio';
  }
}

export interface EntradaDoDownloadDeExportacao {
  /** Conta da sessão. */
  contaId: string;
}

/**
 * - `disponivel`: `json` é o arquivo (`ArquivoDeExportacao`) em texto, para a
 *   resposta 200; a exportação já foi marcada como baixada;
 * - `indisponivel`: não há cópia pronta, ou ela venceu ou já foi baixada (404).
 */
export type ResultadoDoDownloadDeExportacao =
  { tipo: 'disponivel'; json: string } | { tipo: 'indisponivel' };

@Injectable()
export class BaixarExportacaoCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly exportacoes: RepositorioDeExportacoes,
    private readonly cifrador: Cifrador,
    private readonly relogio: Relogio,
  ) {}

  async executar({
    contaId,
  }: EntradaDoDownloadDeExportacao): Promise<ResultadoDoDownloadDeExportacao> {
    try {
      return await this.#baixar(contaId);
    } catch (erro) {
      if (erro instanceof JaBaixadaNoMeio) return { tipo: 'indisponivel' };
      throw erro;
    }
  }

  #baixar(contaId: string): Promise<ResultadoDoDownloadDeExportacao> {
    return this.unidade.executar(async () => {
      const agora = this.relogio.agora();
      const exportacao = await this.exportacoes.buscarDisponivel(contaId, agora);
      if (exportacao === null) return { tipo: 'indisponivel' };
      const json = this.cifrador.decifrar(
        'exportacao_titular',
        exportacao.conteudoCifrado,
        contaId,
      );
      if (json === null) throw new ExportacaoIlegivel();
      if (!(await this.exportacoes.marcarBaixada(exportacao.id, agora))) {
        throw new JaBaixadaNoMeio();
      }
      return { tipo: 'disponivel', json };
    });
  }
}
