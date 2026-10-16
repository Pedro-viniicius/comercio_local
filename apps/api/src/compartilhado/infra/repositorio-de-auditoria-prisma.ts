// Adaptador Prisma da porta `RepositorioDeAuditoria`
// (`auditoria/repositorio-de-auditoria.ts`): grava em `compartilhado.auditoria`
// pelo client da unidade de trabalho, na transação aberta quando houver.
import { Injectable } from '@nestjs/common';
import {
  type EntradaDeAuditoria,
  RepositorioDeAuditoria,
  validarEntradaDeAuditoria,
} from '../auditoria/repositorio-de-auditoria.ts';
import { Relogio } from '../tempo/relogio.ts';
import { UnidadeDeTrabalhoPrisma } from './unidade-de-trabalho-prisma.ts';

/** Adaptador Prisma: grava pelo client da unidade de trabalho, com a hora do `Relogio`. */
@Injectable()
export class RepositorioDeAuditoriaPrisma extends RepositorioDeAuditoria {
  constructor(
    private readonly unidade: UnidadeDeTrabalhoPrisma,
    private readonly relogio: Relogio,
  ) {
    super();
  }

  override async registrar(entrada: EntradaDeAuditoria): Promise<void> {
    validarEntradaDeAuditoria(entrada);
    await this.unidade.cliente().auditoria.create({
      data: {
        atorTipo: entrada.atorTipo,
        atorId: entrada.atorId,
        acao: entrada.acao,
        recurso: entrada.recurso,
        recursoId: entrada.recursoId,
        // Sem `antes`/`depois`, a coluna fica NULL (o Prisma não aceita `null` em Json).
        ...(entrada.antes === undefined ? {} : { antes: entrada.antes }),
        ...(entrada.depois === undefined ? {} : { depois: entrada.depois }),
        origem: entrada.origem,
        ocorridoEm: this.relogio.agora(),
      },
      // INSERT sem RETURNING de colunas além do id: nada para ler de volta.
      select: { id: true },
    });
  }
}
