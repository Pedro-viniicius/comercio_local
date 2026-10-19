// Adaptador Prisma de `RepositorioDeDocumentosLegais` (`identidade.documentos_legais`
// e `consentimentos`; CA-01, CA-10, S24; plano 01b, etapa 7). A aplicação só lê
// os documentos (S79) e só inclui consentimentos: nenhum método altera ou apaga.
import { Injectable } from '@nestjs/common';
import type { DocumentoLegal as DocumentoLegalPrisma } from '../../../../compartilhado/infra/gerado/prisma/client.ts';
import { UnidadeDeTrabalhoPrisma } from '../../../../compartilhado/infra/unidade-de-trabalho-prisma.ts';
import type { TipoDeDocumentoLegal } from '../../dominio/conta.ts';
import {
  type Consentimento,
  type ConsentimentoComDocumento,
  type DocumentoLegal,
  RepositorioDeDocumentosLegais,
} from '../../dominio/repositorios.ts';
import { ehUuid } from './comum.ts';

@Injectable()
export class RepositorioDeDocumentosLegaisPrisma extends RepositorioDeDocumentosLegais {
  constructor(private readonly unidade: UnidadeDeTrabalhoPrisma) {
    super();
  }

  override async buscarVigente(
    tipo: TipoDeDocumentoLegal,
    agora: Date,
  ): Promise<DocumentoLegal | null> {
    const linha = await this.unidade.cliente().documentoLegal.findFirst({
      where: { tipo, vigenteDesde: { lte: agora } },
      orderBy: [{ vigenteDesde: 'desc' }, { id: 'asc' }],
    });
    return linha === null ? null : paraDocumento(linha);
  }

  override async registrarConsentimento(consentimento: Consentimento): Promise<void> {
    await this.unidade.cliente().consentimento.create({
      data: {
        id: consentimento.id,
        contaId: consentimento.contaId,
        documentoId: consentimento.documentoId,
        aceitoEm: consentimento.aceitoEm,
      },
      select: { id: true },
    });
  }

  override async buscarAceite(contaId: string, documentoId: string): Promise<Date | null> {
    if (!ehUuid(contaId) || !ehUuid(documentoId)) return null;
    const linha = await this.unidade.cliente().consentimento.findUnique({
      where: { contaId_documentoId: { contaId, documentoId } },
      select: { aceitoEm: true },
    });
    return linha?.aceitoEm ?? null;
  }

  override async listarConsentimentos(
    contaId: string,
  ): Promise<readonly ConsentimentoComDocumento[]> {
    if (!ehUuid(contaId)) return [];
    const linhas = await this.unidade.cliente().consentimento.findMany({
      where: { contaId },
      orderBy: [{ aceitoEm: 'asc' }, { id: 'asc' }],
      include: { documento: { select: { tipo: true, versao: true } } },
    });
    return linhas.map((linha) => ({
      id: linha.id,
      contaId: linha.contaId,
      documentoId: linha.documentoId,
      aceitoEm: linha.aceitoEm,
      tipo: linha.documento.tipo,
      versao: linha.documento.versao,
    }));
  }
}

function paraDocumento(linha: DocumentoLegalPrisma): DocumentoLegal {
  return {
    id: linha.id,
    tipo: linha.tipo,
    versao: linha.versao,
    conteudo: linha.conteudo,
    vigenteDesde: linha.vigenteDesde,
  };
}
