// Adaptadores Prisma de `RepositorioDeCodigosDeVerificacao` e
// `RepositorioDeDesafios` (plano 01b, etapa 7). Os dois moram em
// `identidade.codigos_verificacao`, separados pela finalidade: os códigos por
// e-mail (`verificacao_email`, `recuperacao_senha`) e os desafios do 2FA
// (`desafio_configurar`, `desafio_verificar`, com o HMAC do token do desafio em
// `codigo_hmac`). Cada repositório só enxerga as suas finalidades.
//
// Leitura com trava (R1): `SELECT ... FOR UPDATE` na transação da unidade de
// trabalho e, depois de obter a trava, a leitura da linha com o valor já
// confirmado por quem a segurava. A validade é conferida de novo pela entidade.
import { Injectable } from '@nestjs/common';
import type {
  CodigoDeVerificacao as CodigoDeVerificacaoPrisma,
  FinalidadeDoCodigo as FinalidadeDoCodigoPrisma,
} from '../../../../compartilhado/infra/gerado/prisma/client.ts';
import { UnidadeDeTrabalhoPrisma } from '../../../../compartilhado/infra/unidade-de-trabalho-prisma.ts';
import type { EtapaDoDesafio } from '@bairrin/contratos/validadores';
import {
  CodigoDeVerificacao,
  type FinalidadeDoCodigo,
  TENTATIVAS_POR_CODIGO,
} from '../../dominio/codigo-de-verificacao.ts';
import {
  DesafioDeSegundoFator,
  finalidadeDoDesafio,
  TENTATIVAS_POR_DESAFIO,
} from '../../dominio/desafio-de-segundo-fator.ts';
import {
  RepositorioDeCodigosDeVerificacao,
  RepositorioDeDesafios,
} from '../../dominio/repositorios.ts';
import { ehUuid, exigirTransacao } from './comum.ts';

const FINALIDADES_DE_CODIGO = [
  'verificacao_email',
  'recuperacao_senha',
] as const satisfies readonly FinalidadeDoCodigo[];

const FINALIDADES_DE_DESAFIO = [
  'desafio_configurar',
  'desafio_verificar',
] as const satisfies readonly FinalidadeDoCodigoPrisma[];

@Injectable()
export class RepositorioDeCodigosDeVerificacaoPrisma extends RepositorioDeCodigosDeVerificacao {
  constructor(private readonly unidade: UnidadeDeTrabalhoPrisma) {
    super();
  }

  override async inserir(codigo: CodigoDeVerificacao): Promise<void> {
    await this.unidade.cliente().codigoDeVerificacao.create({
      data: codigo.dados,
      select: { id: true },
    });
  }

  override async atualizar(codigo: CodigoDeVerificacao): Promise<void> {
    const { id, tentativas, usadoEm } = codigo.dados;
    await this.unidade.cliente().codigoDeVerificacao.update({
      where: { id, finalidade: { in: [...FINALIDADES_DE_CODIGO] } },
      data: { tentativas, usadoEm },
      select: { id: true },
    });
  }

  override async buscarVigenteParaAtualizar(
    contaId: string,
    finalidade: FinalidadeDoCodigo,
    agora: Date,
  ): Promise<CodigoDeVerificacao | null> {
    const transacao = exigirTransacao(this.unidade, 'buscarVigenteParaAtualizar');
    if (!ehUuid(contaId)) return null;
    // Com FOR UPDATE, o Postgres reavalia o WHERE da linha que outra transação
    // alterou enquanto esta esperava, e a descarta se não vale mais.
    const travadas = await transacao.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM identidade.codigos_verificacao
       WHERE conta_id = ${contaId}::uuid
         AND finalidade = ${finalidade}::identidade.finalidade_do_codigo
         AND usado_em IS NULL AND expira_em > ${agora}
         AND tentativas < ${TENTATIVAS_POR_CODIGO}::integer
       ORDER BY criado_em DESC, id
       LIMIT 1
       FOR UPDATE`;
    const id = travadas[0]?.id;
    if (id === undefined) return null;
    const linha = await transacao.codigoDeVerificacao.findUnique({ where: { id } });
    if (linha === null) return null;
    const codigo = paraCodigo(linha);
    return codigo.estaValido(agora) ? codigo : null;
  }

  override async invalidarVigentes(
    contaId: string,
    finalidade: FinalidadeDoCodigo,
    agora: Date,
  ): Promise<void> {
    if (!ehUuid(contaId)) return;
    await this.unidade.cliente().codigoDeVerificacao.updateMany({
      where: {
        contaId,
        finalidade,
        usadoEm: null,
        expiraEm: { gt: agora },
        tentativas: { lt: TENTATIVAS_POR_CODIGO },
      },
      data: { usadoEm: agora },
    });
  }

  override async apagarDaConta(contaId: string): Promise<void> {
    if (!ehUuid(contaId)) return;
    // Todas as finalidades: os desafios da conta vão junto (mesma tabela).
    await this.unidade.cliente().codigoDeVerificacao.deleteMany({ where: { contaId } });
  }
}

@Injectable()
export class RepositorioDeDesafiosPrisma extends RepositorioDeDesafios {
  constructor(private readonly unidade: UnidadeDeTrabalhoPrisma) {
    super();
  }

  override async inserir(desafio: DesafioDeSegundoFator): Promise<void> {
    await this.unidade.cliente().codigoDeVerificacao.create({
      data: colunasDoDesafio(desafio),
      select: { id: true },
    });
  }

  override async atualizar(desafio: DesafioDeSegundoFator): Promise<void> {
    const { id, tentativas, usadoEm } = desafio.dados;
    await this.unidade.cliente().codigoDeVerificacao.update({
      where: { id, finalidade: { in: [...FINALIDADES_DE_DESAFIO] } },
      data: { tentativas, usadoEm },
      select: { id: true },
    });
  }

  override async buscarPorIdParaAtualizar(id: string): Promise<DesafioDeSegundoFator | null> {
    const transacao = exigirTransacao(this.unidade, 'buscarPorIdParaAtualizar');
    if (!ehUuid(id)) return null;
    const travadas = await transacao.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM identidade.codigos_verificacao
       WHERE id = ${id}::uuid
         AND finalidade IN ('desafio_configurar', 'desafio_verificar')
       FOR UPDATE`;
    if (travadas.length === 0) return null;
    const linha = await transacao.codigoDeVerificacao.findUnique({ where: { id } });
    return linha === null ? null : paraDesafio(linha);
  }

  override async invalidarVigentes(
    contaId: string,
    etapa: EtapaDoDesafio,
    agora: Date,
  ): Promise<void> {
    if (!ehUuid(contaId)) return;
    await this.unidade.cliente().codigoDeVerificacao.updateMany({
      where: {
        contaId,
        finalidade: finalidadeDoDesafio(etapa),
        usadoEm: null,
        expiraEm: { gt: agora },
        tentativas: { lt: TENTATIVAS_POR_DESAFIO },
      },
      data: { usadoEm: agora },
    });
  }
}

function paraCodigo(linha: CodigoDeVerificacaoPrisma): CodigoDeVerificacao {
  if (linha.finalidade !== 'verificacao_email' && linha.finalidade !== 'recuperacao_senha') {
    throw new Error('Linha de codigos_verificacao com finalidade de desafio lida como código.');
  }
  return CodigoDeVerificacao.reconstituir({
    id: linha.id,
    contaId: linha.contaId,
    finalidade: linha.finalidade,
    codigoHmac: linha.codigoHmac,
    tentativas: linha.tentativas,
    expiraEm: linha.expiraEm,
    usadoEm: linha.usadoEm,
    criadoEm: linha.criadoEm,
  });
}

function paraDesafio(linha: CodigoDeVerificacaoPrisma): DesafioDeSegundoFator {
  const etapa = etapaDaFinalidade(linha.finalidade);
  return DesafioDeSegundoFator.reconstituir({
    id: linha.id,
    contaId: linha.contaId,
    etapa,
    tokenHmac: linha.codigoHmac,
    tentativas: linha.tentativas,
    expiraEm: linha.expiraEm,
    usadoEm: linha.usadoEm,
    criadoEm: linha.criadoEm,
  });
}

function etapaDaFinalidade(finalidade: FinalidadeDoCodigoPrisma): EtapaDoDesafio {
  if (finalidade === 'desafio_configurar') return 'configurar';
  if (finalidade === 'desafio_verificar') return 'verificar';
  throw new Error('Linha de codigos_verificacao com finalidade de código lida como desafio.');
}

function colunasDoDesafio(desafio: DesafioDeSegundoFator) {
  const { etapa, tokenHmac, ...resto } = desafio.dados;
  return { ...resto, finalidade: finalidadeDoDesafio(etapa), codigoHmac: tokenHmac };
}
