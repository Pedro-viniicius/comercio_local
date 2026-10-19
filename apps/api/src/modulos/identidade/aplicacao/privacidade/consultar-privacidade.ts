// Tela de Privacidade (CA-10; `GET /v1/privacidade`, etapa 19): a política
// vigente com a versão e o texto, a versão vigente dos termos, a data em que a
// conta aceitou a política vigente e até quando a cópia dos dados pronta pode
// ser baixada.
//
// Só leitura, da conta da sessão (a guarda já conferiu que ela está ativa).
// O aceite mostrado é o da versão vigente: quem aceitou só uma versão antiga
// vê `aceitoEm: null`, porque não aceitou o texto que a tela mostra.
import type { Privacidade } from '@bairrin/contratos';
import { Injectable } from '@nestjs/common';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import type { TipoDeDocumentoLegal } from '../../dominio/conta.ts';
import {
  type DocumentoLegal,
  RepositorioDeDocumentosLegais,
  RepositorioDeExportacoes,
} from '../../dominio/repositorios.ts';

/**
 * Não há documento vigente do tipo: o seed (dev) ou a migração (produção) não
 * gravou a versão. Erro de configuração, não de quem pede; a mensagem só traz
 * o tipo do documento.
 */
export class DocumentoLegalAusente extends Error {
  constructor(readonly tipo: TipoDeDocumentoLegal) {
    super(`Não há documento legal vigente do tipo ${tipo}.`);
    this.name = 'DocumentoLegalAusente';
  }
}

export interface EntradaDaConsultaDePrivacidade {
  /** Conta da sessão. */
  contaId: string;
}

@Injectable()
export class ConsultarPrivacidadeCasoDeUso {
  constructor(
    private readonly documentos: RepositorioDeDocumentosLegais,
    private readonly exportacoes: RepositorioDeExportacoes,
    private readonly relogio: Relogio,
  ) {}

  /** A resposta já na forma do contrato (`privacidadeSchema`), com datas ISO em UTC. */
  async executar({ contaId }: EntradaDaConsultaDePrivacidade): Promise<Privacidade> {
    const agora = this.relogio.agora();
    const politica = await this.#vigente('privacidade', agora);
    const termos = await this.#vigente('termos', agora);
    const aceitoEm = await this.documentos.buscarAceite(contaId, politica.id);
    const exportacao = await this.exportacoes.buscarDisponivel(contaId, agora);
    return {
      politica: { versao: politica.versao, conteudo: politica.conteudo },
      termos: { versao: termos.versao },
      aceitoEm: aceitoEm?.toISOString() ?? null,
      exportacaoDisponivelAte: exportacao?.expiraEm.toISOString() ?? null,
    };
  }

  async #vigente(tipo: TipoDeDocumentoLegal, agora: Date): Promise<DocumentoLegal> {
    const documento = await this.documentos.buscarVigente(tipo, agora);
    if (documento === null) throw new DocumentoLegalAusente(tipo);
    return documento;
  }
}
