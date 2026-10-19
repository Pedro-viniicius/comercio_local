// Pendências que adiam a exclusão da conta (CA-11): pedido em andamento, saldo
// a repassar... Cada módulo que pode segurar a exclusão entrega uma
// `FonteDePendencias` e a registra no `RegistroDePendencias` (pelo
// `index.ts` da Identidade), no molde do `RegistroDeAnonimizadores`. Neste
// plano nenhum módulo registra nada: o registro vazio responde sem pendências.
//
// Pendência só com o nome do módulo e um tipo fixo, sem dado pessoal: o aviso
// para a pessoa é montado pela apresentação a partir do tipo.

export interface PendenciaDeExclusao {
  /** Módulo que segura a exclusão (ex.: `pedidos`). */
  readonly modulo: string;
  /** Tipo estável em snake_case (ex.: `pedido_em_andamento`, `saldo_a_repassar`). */
  readonly tipo: string;
}

/** Porta da aplicação: o caso de uso de exclusão pergunta e adia se houver pendência. */
export abstract class VerificadorDePendencias {
  abstract pendenciasDaConta(contaId: string): Promise<readonly PendenciaDeExclusao[]>;
}

/** Implementada por cada módulo que pode adiar a exclusão. */
export interface FonteDePendencias {
  /** Nome do módulo, único no registro. */
  readonly modulo: string;
  pendenciasDaConta(contaId: string): Promise<readonly PendenciaDeExclusao[]>;
}

const NOME_DE_MODULO = /^[a-z][a-z0-9-]*$/;
const TIPO = /^[a-z][a-z0-9_]*$/;

/**
 * Junta as pendências de todas as fontes registradas, na ordem de registro.
 * Sem fonte, não há pendência. Uma fonte que falha faz a consulta falhar: na
 * dúvida, a exclusão não segue.
 */
export class RegistroDePendencias extends VerificadorDePendencias {
  readonly #fontes = new Map<string, FonteDePendencias>();

  registrar(fonte: FonteDePendencias): void {
    if (!NOME_DE_MODULO.test(fonte.modulo)) {
      throw new Error(`Nome de módulo inválido para fonte de pendências: "${fonte.modulo}".`);
    }
    if (this.#fontes.has(fonte.modulo)) {
      throw new Error(`O módulo ${fonte.modulo} já registrou uma fonte de pendências.`);
    }
    this.#fontes.set(fonte.modulo, fonte);
  }

  /** Módulos registrados, na ordem de registro. */
  modulos(): string[] {
    return [...this.#fontes.keys()];
  }

  override async pendenciasDaConta(contaId: string): Promise<readonly PendenciaDeExclusao[]> {
    const todas: PendenciaDeExclusao[] = [];
    for (const fonte of this.#fontes.values()) {
      for (const pendencia of await fonte.pendenciasDaConta(contaId)) {
        if (pendencia.modulo !== fonte.modulo || !TIPO.test(pendencia.tipo)) {
          throw new Error(`Pendência mal formada do módulo ${fonte.modulo}.`);
        }
        todas.push({ modulo: pendencia.modulo, tipo: pendencia.tipo });
      }
    }
    return todas;
  }
}
