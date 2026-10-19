// Adaptador Prisma de `RepositorioDeExportacoes` (`identidade.exportacoes_titular`;
// S10, CA-10; plano 01b, etapa 7). O conteúdo chega e sai cifrado (AES-GCM, AAD
// com a conta): este adaptador nunca vê os dados em claro.
import { Injectable } from '@nestjs/common';
import type { ExportacaoDoTitular as ExportacaoDoTitularPrisma } from '../../../../compartilhado/infra/gerado/prisma/client.ts';
import { UnidadeDeTrabalhoPrisma } from '../../../../compartilhado/infra/unidade-de-trabalho-prisma.ts';
import { type ExportacaoDoTitular, RepositorioDeExportacoes } from '../../dominio/repositorios.ts';
import { ehUuid } from './comum.ts';

@Injectable()
export class RepositorioDeExportacoesPrisma extends RepositorioDeExportacoes {
  constructor(private readonly unidade: UnidadeDeTrabalhoPrisma) {
    super();
  }

  override async inserir(exportacao: ExportacaoDoTitular): Promise<void> {
    await this.unidade.cliente().exportacaoDoTitular.create({
      data: {
        id: exportacao.id,
        contaId: exportacao.contaId,
        conteudoCifrado: exportacao.conteudoCifrado,
        criadaEm: exportacao.criadaEm,
        expiraEm: exportacao.expiraEm,
        baixadaEm: exportacao.baixadaEm,
      },
      select: { id: true },
    });
  }

  override async buscarDisponivel(
    contaId: string,
    agora: Date,
  ): Promise<ExportacaoDoTitular | null> {
    if (!ehUuid(contaId)) return null;
    const linha = await this.unidade.cliente().exportacaoDoTitular.findFirst({
      where: { contaId, baixadaEm: null, expiraEm: { gt: agora } },
      orderBy: [{ criadaEm: 'desc' }, { id: 'desc' }],
    });
    return linha === null ? null : paraExportacao(linha);
  }

  override async marcarBaixada(id: string, agora: Date): Promise<boolean> {
    if (!ehUuid(id)) return false;
    // Uso único (S10): só quem acha `baixada_em` nulo marca; o segundo download
    // simultâneo espera o primeiro e não acha mais a linha.
    const alteradas = await this.unidade.cliente().$executeRaw`
      UPDATE identidade.exportacoes_titular SET baixada_em = ${agora}
       WHERE id = ${id}::uuid AND baixada_em IS NULL`;
    return alteradas === 1;
  }

  override async apagarVencidas(agora: Date): Promise<number> {
    const { count } = await this.unidade.cliente().exportacaoDoTitular.deleteMany({
      where: { OR: [{ baixadaEm: { not: null } }, { expiraEm: { lte: agora } }] },
    });
    return count;
  }

  override async apagarNaoBaixadas(contaId: string): Promise<number> {
    if (!ehUuid(contaId)) return 0;
    const { count } = await this.unidade.cliente().exportacaoDoTitular.deleteMany({
      where: { contaId, baixadaEm: null },
    });
    return count;
  }

  override async apagarDaConta(contaId: string): Promise<void> {
    if (!ehUuid(contaId)) return;
    await this.unidade.cliente().exportacaoDoTitular.deleteMany({ where: { contaId } });
  }
}

function paraExportacao(linha: ExportacaoDoTitularPrisma): ExportacaoDoTitular {
  return {
    id: linha.id,
    contaId: linha.contaId,
    conteudoCifrado: linha.conteudoCifrado,
    criadaEm: linha.criadaEm,
    expiraEm: linha.expiraEm,
    baixadaEm: linha.baixadaEm,
  };
}
