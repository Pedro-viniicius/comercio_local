// Publicação de eventos de domínio pela outbox (ADR-011): o caso de uso grava o
// evento na tabela `compartilhado.outbox` dentro da mesma transação em que
// grava o agregado. Se a transação for desfeita, o evento some junto; se for
// confirmada, o relay do worker entrega o evento a cada assinante.
//
// Payload só com ids e dados não pessoais (ADR-015): nunca token, senha,
// código de verificação, e-mail, telefone, nome ou endereço. O evento fica na
// outbox por 30 dias e, como job, no pg-boss por até 7 dias depois de
// concluído. Quem precisa de um dado pessoal (o e-mail do destinatário, por
// exemplo) lê na hora, pelo id, dentro do assinante. Um código de uso único é
// gerado pelo assinante no envio, nunca vai no evento (01b).
// O publicador recusa chave conhecida de dado pessoal ou de segredo
// (`titular/dado-pessoal.ts`).
//
// Este arquivo é a porta, sem Nest nem Prisma (ADR-003); o adaptador da outbox
// é `infra/publicador-na-outbox.ts`.
import {
  DadoPessoalRecusado,
  type ObjetoJson,
  problemasDeDadoPessoal,
} from '../titular/dado-pessoal.ts';

/** Evento de domínio a publicar. */
export interface EventoDeDominio<P extends ObjetoJson = ObjetoJson> {
  /** `<contexto>.<FatoNoPassado>`, ex.: `identidade.ContaCriada`. */
  tipo: string;
  /** Versão do contrato do payload (começa em 1). */
  versao: number;
  /** Id (UUID) do agregado que gerou o evento. */
  agregadoId: string;
  payload: P;
}

/** Porta da aplicação. */
export abstract class PublicadorDeEventos {
  /**
   * Grava os eventos na outbox, na transação da `UnidadeDeTrabalho` em
   * andamento. Fora de uma unidade, rejeita com `PublicacaoForaDeTransacao`.
   */
  abstract publicar(...eventos: readonly EventoDeDominio[]): Promise<void>;
}

/** Publicar fora de uma `UnidadeDeTrabalho` perderia a garantia da outbox. */
export class PublicacaoForaDeTransacao extends Error {
  constructor() {
    super('Eventos só podem ser publicados dentro de uma UnidadeDeTrabalho.');
    this.name = 'PublicacaoForaDeTransacao';
  }
}

/** Evento mal formado (sem relação com dado pessoal). */
export class EventoInvalido extends Error {
  constructor(motivo: string) {
    super(`Evento inválido: ${motivo}.`);
    this.name = 'EventoInvalido';
  }
}

/** `contexto.NomeDoEvento`: só letras e dígitos, sem espaço. */
export const FORMATO_DO_TIPO = /^[a-z][a-z0-9]*\.[A-Z][A-Za-z0-9]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Confere o evento antes de gravar; lança se ele não puder ir para a outbox. */
export function validarEvento(evento: EventoDeDominio): void {
  if (!FORMATO_DO_TIPO.test(evento.tipo)) {
    throw new EventoInvalido('tipo deve ser "<contexto>.<NomeDoEvento>"');
  }
  if (!Number.isInteger(evento.versao) || evento.versao < 1) {
    throw new EventoInvalido('versao deve ser um inteiro a partir de 1');
  }
  if (!UUID.test(evento.agregadoId)) throw new EventoInvalido('agregadoId deve ser um UUID');
  const problemas = problemasDeDadoPessoal(evento.payload, 'payload');
  if (problemas.length > 0) throw new DadoPessoalRecusado('outbox', problemas);
}
