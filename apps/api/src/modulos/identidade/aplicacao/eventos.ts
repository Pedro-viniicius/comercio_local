// Monta os eventos de domínio da Identidade a partir do contrato (P4): o
// `tipo` e a `versao` vêm de `EVENTOS_DE_IDENTIDADE` (`@bairrin/contratos`),
// o payload passa pelo esquema estrito do evento e o `agregadoId` é o
// `contaId`. O domínio não conhece o contrato (ADR-003); só a aplicação monta
// o evento, e o assinante (etapa 13) lê o payload com o mesmo esquema.
//
// Payload só com ids (ADR-015). Campo a mais ou id mal formado lança
// `EventoInvalido` antes de chegar ao publicador, com só o caminho e o código
// de cada problema na mensagem, nunca o valor.
import {
  EVENTOS_DE_IDENTIDADE,
  type NomeDoEventoDeIdentidade,
  type PayloadDoEventoDeIdentidade,
} from '@bairrin/contratos';
import {
  type EventoDeDominio,
  EventoInvalido,
  validarEvento,
} from '../../../compartilhado/eventos/publicador.ts';

export function eventoDeIdentidade<Nome extends NomeDoEventoDeIdentidade>(
  nome: Nome,
  payload: PayloadDoEventoDeIdentidade<Nome>,
): EventoDeDominio {
  const contrato = EVENTOS_DE_IDENTIDADE[nome];
  const resultado = contrato.payload.safeParse(payload);
  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((problema) => `${problema.path.join('.') || '(payload)'}: ${problema.code}`)
      .join(', ');
    throw new EventoInvalido(`payload de ${contrato.tipo} fora do contrato (${problemas})`);
  }
  const lido = resultado.data;
  const evento: EventoDeDominio = {
    tipo: contrato.tipo,
    versao: contrato.versao,
    agregadoId: lido.contaId,
    payload: { ...lido },
  };
  validarEvento(evento);
  return evento;
}
