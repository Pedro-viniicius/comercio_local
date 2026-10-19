// Adaptador Prisma de `RepositorioDeSegundoFator` (`identidade.segundo_fator` e
// `codigos_recuperacao`; S1; plano 01b, etapa 7). Guarda só o segredo TOTP
// cifrado e o HMAC dos códigos de recuperação. As operações com mais de um
// comando rodam numa unidade de trabalho (a aberta, ou uma nova).
import { Injectable } from '@nestjs/common';
import type {
  CodigoDeRecuperacao as CodigoDeRecuperacaoPrisma,
  SegundoFator as SegundoFatorPrisma,
} from '../../../../compartilhado/infra/gerado/prisma/client.ts';
import { UnidadeDeTrabalhoPrisma } from '../../../../compartilhado/infra/unidade-de-trabalho-prisma.ts';
import {
  type CodigoDeRecuperacao,
  RepositorioDeSegundoFator,
  type SegundoFator,
} from '../../dominio/repositorios.ts';
import { ehUuid } from './comum.ts';

/** Código de recuperação inexistente ou de outra conta: erro de programação de quem chama. */
export class CodigoDeRecuperacaoInvalido extends Error {
  constructor(motivo: string) {
    super(`Código de recuperação inválido: ${motivo}.`);
    this.name = 'CodigoDeRecuperacaoInvalido';
  }
}

@Injectable()
export class RepositorioDeSegundoFatorPrisma extends RepositorioDeSegundoFator {
  constructor(private readonly unidade: UnidadeDeTrabalhoPrisma) {
    super();
  }

  override async buscar(contaId: string): Promise<SegundoFator | null> {
    if (!ehUuid(contaId)) return null;
    const linha = await this.unidade.cliente().segundoFator.findUnique({ where: { contaId } });
    return linha === null ? null : paraSegundoFator(linha);
  }

  override async salvar(segundoFator: SegundoFator): Promise<void> {
    const { contaId, segredoCifrado, confirmadoEm, ultimoPassoUsado } = segundoFator;
    await this.unidade.cliente().segundoFator.upsert({
      where: { contaId },
      create: { contaId, segredoCifrado, confirmadoEm, ultimoPassoUsado },
      update: { segredoCifrado, confirmadoEm, ultimoPassoUsado },
      select: { contaId: true },
    });
  }

  override async apagar(contaId: string): Promise<void> {
    if (!ehUuid(contaId)) return;
    await this.unidade.executar(async () => {
      const cliente = this.unidade.cliente();
      await cliente.codigoDeRecuperacao.deleteMany({ where: { contaId } });
      await cliente.segundoFator.deleteMany({ where: { contaId } });
    });
  }

  override async substituirCodigosDeRecuperacao(
    contaId: string,
    codigos: readonly CodigoDeRecuperacao[],
  ): Promise<void> {
    if (codigos.some((codigo) => codigo.contaId !== contaId)) {
      throw new CodigoDeRecuperacaoInvalido('de outra conta');
    }
    await this.unidade.executar(async () => {
      const cliente = this.unidade.cliente();
      await cliente.codigoDeRecuperacao.deleteMany({ where: { contaId } });
      await cliente.codigoDeRecuperacao.createMany({
        data: codigos.map(({ id, codigoHmac, usadoEm }) => ({ id, contaId, codigoHmac, usadoEm })),
      });
    });
  }

  override async listarCodigosDeRecuperacaoNaoUsados(
    contaId: string,
  ): Promise<readonly CodigoDeRecuperacao[]> {
    if (!ehUuid(contaId)) return [];
    const linhas = await this.unidade.cliente().codigoDeRecuperacao.findMany({
      where: { contaId, usadoEm: null },
      orderBy: { id: 'asc' },
    });
    return linhas.map(paraCodigoDeRecuperacao);
  }

  override async marcarCodigoDeRecuperacaoUsado(id: string, agora: Date): Promise<void> {
    if (!ehUuid(id)) throw new CodigoDeRecuperacaoInvalido('inexistente');
    // A primeira data de uso fica (como o fake).
    const alteradas = await this.unidade.cliente().$executeRaw`
      UPDATE identidade.codigos_recuperacao SET usado_em = coalesce(usado_em, ${agora})
       WHERE id = ${id}::uuid`;
    if (alteradas !== 1) throw new CodigoDeRecuperacaoInvalido('inexistente');
  }
}

function paraSegundoFator(linha: SegundoFatorPrisma): SegundoFator {
  return {
    contaId: linha.contaId,
    segredoCifrado: linha.segredoCifrado,
    confirmadoEm: linha.confirmadoEm,
    ultimoPassoUsado: linha.ultimoPassoUsado,
  };
}

function paraCodigoDeRecuperacao(linha: CodigoDeRecuperacaoPrisma): CodigoDeRecuperacao {
  return {
    id: linha.id,
    contaId: linha.contaId,
    codigoHmac: linha.codigoHmac,
    usadoEm: linha.usadoEm,
  };
}
