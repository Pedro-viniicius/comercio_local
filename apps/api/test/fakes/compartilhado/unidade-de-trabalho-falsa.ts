// `UnidadeDeTrabalho` em memória para os testes de unidade dos casos de uso.
// Imita o adaptador real (`UnidadeDeTrabalhoPrisma`) no que o caso de uso sente:
// - a unidade aberta fica num AsyncLocalStorage, então duas `executar`
//   concorrentes são duas transações independentes, e uma `executar` chamada
//   dentro de outra participa da externa (Q17);
// - cada unidade guarda o que desfazer do que ELA gravou: se o trabalho
//   rejeitar, só essas alterações voltam, na ordem inversa (rollback);
// - `travar(chave)` imita o `SELECT ... FOR UPDATE` (R1): a segunda unidade que
//   pede a mesma chave espera a primeira terminar. As travas acabam no fim da
//   unidade, confirmada ou desfeita.
//
// Diferenças do banco, aceitas num fake: uma unidade vê o que a outra gravou
// antes de confirmar, e não há detecção de deadlock (duas unidades que travam
// as mesmas chaves em ordem contrária ficam esperando; o banco abortaria uma
// com 40P01). Trave sempre na mesma ordem, como a porta do repositório pede.
//
// Fica em `test/fakes/` (fora do build): código de produção não importa daqui
// (regra `producao-nao-importa-test`).
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  type OpcoesDaUnidadeDeTrabalho,
  UnidadeDeTrabalho,
} from '../../../src/compartilhado/transacao/unidade-de-trabalho.ts';

/** Leitura com trava ou gravação que exige transação, chamada fora de `executar`. */
export class ForaDaUnidadeDeTrabalho extends Error {
  constructor(operacao: string) {
    super(
      `${operacao} fora da UnidadeDeTrabalho: a trava do banco acabaria no fim do comando ` +
        'e não protegeria nada.',
    );
    this.name = 'ForaDaUnidadeDeTrabalho';
  }
}

interface ContextoDaUnidade {
  /** Ações que desfazem as alterações desta unidade, na ordem em que foram feitas. */
  readonly desfazer: (() => void)[];
  /** Resolve quando a unidade termina (as travas dela ficam livres). */
  readonly fim: Promise<void>;
  readonly terminar: () => void;
}

function novoContexto(): ContextoDaUnidade {
  let terminar: () => void = () => undefined;
  const fim = new Promise<void>((resolver) => {
    terminar = resolver;
  });
  return { desfazer: [], fim, terminar };
}

export class UnidadeDeTrabalhoFalsa extends UnidadeDeTrabalho {
  readonly #atual = new AsyncLocalStorage<ContextoDaUnidade>();
  /** Chave travada → unidade que a segura. */
  readonly #travas = new Map<string, ContextoDaUnidade>();
  #execucoes = 0;

  /** Há uma unidade aberta neste fluxo assíncrono (o publicador só grava dentro dela). */
  get emTransacao(): boolean {
    return this.#atual.getStore() !== undefined;
  }

  /** Quantas unidades externas (não aninhadas) foram abertas. */
  get execucoes(): number {
    return this.#execucoes;
  }

  /** Lança `ForaDaUnidadeDeTrabalho` se não há unidade aberta neste fluxo. */
  exigirTransacao(operacao: string): void {
    if (!this.emTransacao) throw new ForaDaUnidadeDeTrabalho(operacao);
  }

  /**
   * Registra como desfazer uma alteração feita agora. Dentro de uma unidade, a
   * ação roda se ela falhar; fora, a alteração já vale (autocommit) e nada é
   * registrado.
   */
  registrarDesfazer(acao: () => void): void {
    this.#atual.getStore()?.desfazer.push(acao);
  }

  /**
   * Trava `chave` até o fim da unidade atual, esperando a unidade que a segura
   * terminar. Pedir de novo uma chave já travada pela mesma unidade não espera.
   * Rejeita fora de uma unidade.
   */
  async travar(chave: string): Promise<void> {
    const contexto = this.#atual.getStore();
    if (contexto === undefined) throw new ForaDaUnidadeDeTrabalho('Leitura com trava');
    for (;;) {
      const dona = this.#travas.get(chave);
      if (dona === undefined) {
        this.#travas.set(chave, contexto);
        return;
      }
      if (dona === contexto) return;
      await dona.fim;
    }
  }

  override async executar<T>(
    trabalho: () => Promise<T>,
    _opcoes?: OpcoesDaUnidadeDeTrabalho,
  ): Promise<T> {
    if (this.#atual.getStore() !== undefined) return trabalho();
    this.#execucoes += 1;
    const contexto = novoContexto();
    try {
      return await this.#atual.run(contexto, trabalho);
    } catch (erro) {
      for (const acao of [...contexto.desfazer].reverse()) acao();
      throw erro;
    } finally {
      for (const [chave, dona] of this.#travas) {
        if (dona === contexto) this.#travas.delete(chave);
      }
      contexto.terminar();
    }
  }
}
