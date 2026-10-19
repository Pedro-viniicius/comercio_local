// `PublicadorDeEventos` em memória para os testes de unidade dos casos de uso.
// Valida como o da outbox (`validarEvento`), recusa publicar fora da unidade de
// trabalho e descarta os eventos da unidade que falhar.
//
// Fica em `test/fakes/` (fora do build): código de produção não importa daqui
// (regra `producao-nao-importa-test`).
import {
  type EventoDeDominio,
  PublicacaoForaDeTransacao,
  PublicadorDeEventos,
  validarEvento,
} from '../../../src/compartilhado/eventos/publicador.ts';
import { comoPromessa } from './como-promessa.ts';
import type { UnidadeDeTrabalhoFalsa } from './unidade-de-trabalho-falsa.ts';

export class PublicadorDeEventosFalso extends PublicadorDeEventos {
  readonly #unidade: UnidadeDeTrabalhoFalsa;
  #publicados: EventoDeDominio[] = [];

  constructor(unidade: UnidadeDeTrabalhoFalsa) {
    super();
    this.#unidade = unidade;
  }

  /** Cópias dos eventos publicados, na ordem. */
  get publicados(): readonly EventoDeDominio[] {
    return structuredClone(this.#publicados);
  }

  /** Só os tipos, na ordem (`identidade.ContaCriada`...). */
  get tipos(): string[] {
    return this.#publicados.map((evento) => evento.tipo);
  }

  override publicar(...eventos: readonly EventoDeDominio[]): Promise<void> {
    return comoPromessa(() => {
      if (!this.#unidade.emTransacao) throw new PublicacaoForaDeTransacao();
      eventos.forEach(validarEvento);
      const copias = eventos.map((evento) => structuredClone(evento));
      this.#publicados.push(...copias);
      this.#unidade.registrarDesfazer(() => {
        this.#publicados = this.#publicados.filter((evento) => !copias.includes(evento));
      });
    });
  }
}
