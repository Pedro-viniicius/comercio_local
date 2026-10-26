// Sentry ligado com um transport falso, para os testes conferirem o que sairia do processo
// (plano 01b, etapa 19; CA-12, S10). Não é um teste.
//
// Liga o SDK pelas mesmas opções da produção (`iniciarSentry` → `opcoesDoSentry`: redator,
// coleta de dados desligada, só evento e relatório do cliente no transport) e guarda cada
// envelope que seria enviado, em texto. Nada sai da máquina: o DSN é fictício e o transport
// não abre conexão. O interceptador (`InterceptadorDoSentry`) entra na aplicação de teste
// como no `main.ts`, antes do `init`.
import * as Sentry from '@sentry/nestjs';
import { iniciarSentry } from '../../src/compartilhado/observabilidade/sentry.ts';

/** DSN fictício: o transport falso não envia nada. */
export const DSN_FALSO = 'https://chavepublica@o0.ingest.sentry.io/0';

export interface SentryFalso {
  /** Os envelopes que sairiam do processo, em texto, na ordem. */
  readonly envelopes: readonly string[];
  /** Os eventos de erro dos envelopes (item `event`). */
  eventos(): Sentry.ErrorEvent[];
  /** Espera o SDK entregar ao transport o que tem na fila. */
  esvaziar(): Promise<void>;
  /** Fecha o SDK (no `afterAll`). */
  desligar(): Promise<void>;
}

/** Itens de um envelope: cabeçalho do envelope e, depois, pares (cabeçalho do item, carga). */
function itensDoEnvelope(envelope: string): { tipo: string; carga: unknown }[] {
  const linhas = envelope.split('\n').filter((linha) => linha !== '');
  const itens: { tipo: string; carga: unknown }[] = [];
  for (let i = 1; i + 1 < linhas.length; i += 2) {
    const { type } = JSON.parse(linhas[i] ?? '{}') as { type: string };
    itens.push({ tipo: type, carga: JSON.parse(linhas[i + 1] ?? 'null') });
  }
  return itens;
}

/** Liga o Sentry com o transport falso. Um por arquivo de teste (o SDK é global no processo). */
export function ligarSentryFalso(): SentryFalso {
  const envelopes: string[] = [];
  const decodificador = new TextDecoder();
  const ligado = iniciarSentry(
    { SENTRY_DSN: DSN_FALSO },
    {
      transport: (opcoes) =>
        Sentry.createTransport(opcoes, (requisicao) => {
          const corpo = requisicao.body;
          envelopes.push(typeof corpo === 'string' ? corpo : decodificador.decode(corpo));
          return Promise.resolve({ statusCode: 200 });
        }),
    },
  );
  if (!ligado) throw new Error('o Sentry de teste não ligou');
  return {
    envelopes,
    eventos: () =>
      envelopes
        .flatMap(itensDoEnvelope)
        .filter((item) => item.tipo === 'event')
        .map((item) => item.carga as Sentry.ErrorEvent),
    esvaziar: async () => {
      await Sentry.flush(2_000);
    },
    desligar: async () => {
      await Sentry.close(1_000);
    },
  };
}
