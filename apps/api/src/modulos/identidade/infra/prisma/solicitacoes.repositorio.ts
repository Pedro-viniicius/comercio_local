// Adaptador Prisma de `RepositorioDeSolicitacoes` (`identidade.solicitacoes_titular`;
// CA-10, CA-11; plano 01b, etapa 7). Só ids, tipo, status e datas: nenhum dado
// pessoal nesta tabela.
import { Injectable } from '@nestjs/common';
import type { SolicitacaoDoTitular as SolicitacaoDoTitularPrisma } from '../../../../compartilhado/infra/gerado/prisma/client.ts';
import { UnidadeDeTrabalhoPrisma } from '../../../../compartilhado/infra/unidade-de-trabalho-prisma.ts';
import {
  type CursorDeSolicitacao,
  RepositorioDeSolicitacoes,
  type SolicitacaoDoTitular,
  type StatusDaSolicitacao,
  type TipoDeSolicitacao,
} from '../../dominio/repositorios.ts';
import { ehUuid } from './comum.ts';

@Injectable()
export class RepositorioDeSolicitacoesPrisma extends RepositorioDeSolicitacoes {
  constructor(private readonly unidade: UnidadeDeTrabalhoPrisma) {
    super();
  }

  override async inserir(solicitacao: SolicitacaoDoTitular): Promise<void> {
    await this.unidade.cliente().solicitacaoDoTitular.create({
      data: colunas(solicitacao),
      select: { id: true },
    });
  }

  override async atualizar(solicitacao: SolicitacaoDoTitular): Promise<void> {
    await this.unidade.cliente().solicitacaoDoTitular.update({
      where: { id: solicitacao.id },
      data: { status: solicitacao.status, concluidaEm: solicitacao.concluidaEm },
      select: { id: true },
    });
  }

  override async buscarPorId(id: string): Promise<SolicitacaoDoTitular | null> {
    if (!ehUuid(id)) return null;
    const linha = await this.unidade.cliente().solicitacaoDoTitular.findUnique({ where: { id } });
    return linha === null ? null : paraSolicitacao(linha);
  }

  override async buscarUltima(
    contaId: string,
    tipo: TipoDeSolicitacao,
  ): Promise<SolicitacaoDoTitular | null> {
    if (!ehUuid(contaId)) return null;
    const linha = await this.unidade.cliente().solicitacaoDoTitular.findFirst({
      where: { contaId, tipo },
      orderBy: [{ solicitadaEm: 'desc' }, { id: 'desc' }],
    });
    return linha === null ? null : paraSolicitacao(linha);
  }

  override async contarDesde(
    contaId: string,
    tipo: TipoDeSolicitacao,
    desde: Date,
  ): Promise<number> {
    if (!ehUuid(contaId)) return 0;
    return this.unidade.cliente().solicitacaoDoTitular.count({
      where: { contaId, tipo, solicitadaEm: { gt: desde } },
    });
  }

  override async listarPorStatus(
    tipo: TipoDeSolicitacao,
    status: StatusDaSolicitacao,
    quantidade: number,
    depoisDe: CursorDeSolicitacao | null = null,
  ): Promise<readonly SolicitacaoDoTitular[]> {
    if (!Number.isInteger(quantidade) || quantidade <= 0) return [];
    if (depoisDe !== null && !ehUuid(depoisDe.id)) return [];
    // (solicitada_em, id) > (cursor), na mesma ordem do ORDER BY.
    const depoisDoCursor =
      depoisDe === null
        ? {}
        : {
            OR: [
              { solicitadaEm: { gt: depoisDe.solicitadaEm } },
              { solicitadaEm: depoisDe.solicitadaEm, id: { gt: depoisDe.id } },
            ],
          };
    const linhas = await this.unidade.cliente().solicitacaoDoTitular.findMany({
      where: { tipo, status, ...depoisDoCursor },
      orderBy: [{ solicitadaEm: 'asc' }, { id: 'asc' }],
      take: quantidade,
    });
    return linhas.map(paraSolicitacao);
  }
}

function colunas(solicitacao: SolicitacaoDoTitular): SolicitacaoDoTitular {
  return {
    id: solicitacao.id,
    contaId: solicitacao.contaId,
    tipo: solicitacao.tipo,
    status: solicitacao.status,
    solicitadaEm: solicitacao.solicitadaEm,
    concluidaEm: solicitacao.concluidaEm,
  };
}

function paraSolicitacao(linha: SolicitacaoDoTitularPrisma): SolicitacaoDoTitular {
  return colunas(linha);
}
