// Adaptador Prisma de `RepositorioDeSessoes` (`identidade.sessoes` e
// `tokens_de_renovacao_usados`; plano 01b, etapa 7; ADR-012).
//
// As duas gravações de uma sessão existente são UPDATEs restritos, porque a
// entidade chega lida sem trava e pode estar velha (R1, R7):
// - `gravarRotacao`: só as colunas da rotação, condicionado ao token trocado e
//   à sessão não revogada; com 1 linha, grava o token trocado no histórico
//   (S77) na mesma transação;
// - `atualizar`: só a revogação, com `coalesce`, para a primeira revogação
//   ficar e nada da rotação ser rebaixado.
// As revogações em lote mudam só as sessões ainda não revogadas. A retenção
// (`apagarEncerradasAntes`, S81) apaga as encerradas há 30 dias, e o histórico
// delas sai pela FK em cascata.
import { Injectable } from '@nestjs/common';
import type {
  Sessao as SessaoPrisma,
  TokenDeRenovacaoUsado as TokenDeRenovacaoUsadoPrisma,
} from '../../../../compartilhado/infra/gerado/prisma/client.ts';
import { UnidadeDeTrabalhoPrisma } from '../../../../compartilhado/infra/unidade-de-trabalho-prisma.ts';
import { RepositorioDeSessoes } from '../../dominio/repositorios.ts';
import {
  type MotivoDeRevogacao,
  OperacaoInvalidaNaSessao,
  Sessao,
  type TokenDeRenovacaoUsado,
} from '../../dominio/sessao.ts';
import { ehUuid, exigirTransacao } from './comum.ts';

const MOTIVOS_DE_REVOGACAO: ReadonlySet<string> = new Set<MotivoDeRevogacao>([
  'logout',
  'senha_redefinida',
  'reuso_detectado',
  'conta_desativada',
  'substituida',
  'segundo_fator_reconfigurado',
  'segundo_fator_freado',
]);

@Injectable()
export class RepositorioDeSessoesPrisma extends RepositorioDeSessoes {
  constructor(private readonly unidade: UnidadeDeTrabalhoPrisma) {
    super();
  }

  override async buscarPorId(id: string): Promise<Sessao | null> {
    if (!ehUuid(id)) return null;
    const linha = await this.unidade.cliente().sessao.findUnique({ where: { id } });
    return linha === null ? null : paraSessao(linha);
  }

  override async buscarPorTokenHash(tokenHash: string): Promise<Sessao | null> {
    const cliente = this.unidade.cliente();
    const linha =
      (await cliente.sessao.findUnique({ where: { tokenHash } })) ??
      (await cliente.sessao.findFirst({
        where: { tokenAnteriorHash: tokenHash },
        orderBy: [{ criadaEm: 'desc' }, { id: 'asc' }],
      }));
    return linha === null ? null : paraSessao(linha);
  }

  override async buscarTokenUsado(tokenHash: string): Promise<TokenDeRenovacaoUsado | null> {
    const linha = await this.unidade
      .cliente()
      .tokenDeRenovacaoUsado.findUnique({ where: { tokenHash } });
    return linha === null ? null : paraTokenUsado(linha);
  }

  override async inserir(sessao: Sessao): Promise<void> {
    await this.unidade.cliente().sessao.create({ data: sessao.dados, select: { id: true } });
  }

  override async atualizar(sessao: Sessao): Promise<void> {
    const { id, revogadaEm, motivoRevogacao } = sessao.dados;
    if (revogadaEm === null || motivoRevogacao === null) {
      throw new OperacaoInvalidaNaSessao(
        'atualizar só grava a revogação; a rotação vai por gravarRotacao',
      );
    }
    const alteradas = await this.unidade.cliente().$executeRaw`
      UPDATE identidade.sessoes
         SET revogada_em = coalesce(revogada_em, ${revogadaEm}),
             motivo_revogacao = coalesce(motivo_revogacao, ${motivoRevogacao}),
             par_novo_cifrado = NULL, par_novo_expira_em = NULL
       WHERE id = ${id}::uuid`;
    if (alteradas !== 1) throw new OperacaoInvalidaNaSessao('sessão inexistente');
  }

  override async gravarRotacao(sessao: Sessao): Promise<boolean> {
    const transacao = exigirTransacao(this.unidade, 'gravarRotacao');
    const dados = sessao.dados;
    const trocado = sessao.ultimoTokenTrocado;
    if (trocado === null) {
      throw new OperacaoInvalidaNaSessao('gravarRotacao de sessão que não rotacionou');
    }
    const alteradas = await transacao.$executeRaw`
      UPDATE identidade.sessoes
         SET token_hash = ${dados.tokenHash}, token_anterior_hash = ${trocado.tokenHash},
             par_novo_cifrado = ${dados.parNovoCifrado},
             par_novo_expira_em = ${dados.parNovoExpiraEm}, trocado_em = ${dados.trocadoEm},
             ultimo_uso_em = ${dados.ultimoUsoEm}, expira_em = ${dados.expiraEm}
       WHERE id = ${dados.id}::uuid AND token_hash = ${trocado.tokenHash}
         AND revogada_em IS NULL`;
    if (alteradas !== 1) return false;
    await transacao.tokenDeRenovacaoUsado.create({ data: trocado, select: { tokenHash: true } });
    return true;
  }

  override async revogarDaFamilia(
    familiaId: string,
    motivo: MotivoDeRevogacao,
    agora: Date,
  ): Promise<number> {
    if (!ehUuid(familiaId)) return 0;
    return this.unidade.cliente().$executeRaw`
      UPDATE identidade.sessoes
         SET revogada_em = ${agora}, motivo_revogacao = ${motivo},
             par_novo_cifrado = NULL, par_novo_expira_em = NULL
       WHERE familia_id = ${familiaId}::uuid AND revogada_em IS NULL`;
  }

  override async revogarDaConta(
    contaId: string,
    motivo: MotivoDeRevogacao,
    agora: Date,
  ): Promise<number> {
    if (!ehUuid(contaId)) return 0;
    return this.unidade.cliente().$executeRaw`
      UPDATE identidade.sessoes
         SET revogada_em = ${agora}, motivo_revogacao = ${motivo},
             par_novo_cifrado = NULL, par_novo_expira_em = NULL
       WHERE conta_id = ${contaId}::uuid AND revogada_em IS NULL`;
  }

  override async apagarDaConta(contaId: string): Promise<void> {
    if (!ehUuid(contaId)) return;
    await this.unidade.cliente().sessao.deleteMany({ where: { contaId } });
  }

  override apagarEncerradasAntes(limite: Date): Promise<number> {
    return this.unidade.cliente().$executeRaw`
      DELETE FROM identidade.sessoes WHERE coalesce(revogada_em, expira_em) < ${limite}`;
  }
}

function paraSessao(linha: SessaoPrisma): Sessao {
  return Sessao.reconstituir({
    id: linha.id,
    contaId: linha.contaId,
    familiaId: linha.familiaId,
    cliente: linha.cliente,
    tokenHash: linha.tokenHash,
    tokenAnteriorHash: linha.tokenAnteriorHash,
    parNovoCifrado: linha.parNovoCifrado,
    parNovoExpiraEm: linha.parNovoExpiraEm,
    trocadoEm: linha.trocadoEm,
    expiraEm: linha.expiraEm,
    expiraAbsolutoEm: linha.expiraAbsolutoEm,
    ultimoUsoEm: linha.ultimoUsoEm,
    mfa: linha.mfa,
    revogadaEm: linha.revogadaEm,
    motivoRevogacao: paraMotivo(linha.motivoRevogacao),
    criadaEm: linha.criadaEm,
  });
}

/** A coluna é texto livre no banco: valor fora da lista é dado corrompido, não um motivo novo. */
function paraMotivo(motivo: string | null): MotivoDeRevogacao | null {
  if (motivo === null) return null;
  if (!MOTIVOS_DE_REVOGACAO.has(motivo)) {
    throw new OperacaoInvalidaNaSessao('motivo de revogação desconhecido no banco');
  }
  return motivo as MotivoDeRevogacao;
}

function paraTokenUsado(linha: TokenDeRenovacaoUsadoPrisma): TokenDeRenovacaoUsado {
  return {
    tokenHash: linha.tokenHash,
    familiaId: linha.familiaId,
    sessaoId: linha.sessaoId,
    usadoEm: linha.usadoEm,
  };
}
