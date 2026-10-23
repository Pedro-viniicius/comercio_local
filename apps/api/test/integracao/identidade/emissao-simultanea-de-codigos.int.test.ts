// Emissão de códigos simultânea para a mesma conta (plano 01b, etapa 13; Q27, S107): duas
// entregas ao mesmo tempo, em conexões diferentes (duas máquinas de worker), deixam um código
// só valendo. A segunda espera a trava da emissão da conta e da finalidade
// (`pg_advisory_xact_lock`), conta o código da primeira no teto e o invalida.
import type { PinoLogger } from 'nestjs-pino';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  EntregadorDeEventos,
  type EventoPublicado,
} from '../../../src/compartilhado/eventos/assinantes.ts';
import { EnviarCodigoDeVerificacaoAssinante } from '../../../src/modulos/identidade/aplicacao/assinantes/enviar-codigo-de-verificacao.assinante.ts';
import { ModelosDeEmailDaIdentidadeEmHtml } from '../../../src/modulos/identidade/infra/email/modelos/modelos-de-email-da-identidade.ts';
import { EnviadorDeEmailFalso } from '../../fakes/compartilhado/enviador-de-email-falso.ts';
import {
  apagarContasDoTeste,
  cadastrar,
  conectarDono,
  type DocumentosDeTeste,
  emailUnico,
  esperarAlguemNaTrava,
  montarPilha,
  pausarDepois,
  type Pilha,
  semearDocumentos,
} from './pilha-de-casos-de-uso.ts';

const a = montarPilha();
const b = montarPilha();
let dono: pg.Client;
let docs: DocumentosDeTeste;
const contasDoTeste: string[] = [];

const loggerMudo = (): PinoLogger =>
  ({ setContext() {}, info() {}, warn() {}, error() {} }) as unknown as PinoLogger;

beforeAll(async () => {
  dono = await conectarDono();
  docs = await semearDocumentos(dono);
});

afterAll(async () => {
  await dono.query(
    `DELETE FROM compartilhado.eventos_processados WHERE evento_id IN
       (SELECT id FROM compartilhado.outbox WHERE agregado_id = ANY($1::uuid[]))`,
    [contasDoTeste],
  );
  await apagarContasDoTeste(dono, contasDoTeste);
  await docs.remover();
  await dono.end();
  await a.prisma.$disconnect();
  await b.prisma.$disconnect();
});

/** Os eventos de verificação da conta, lidos da outbox como o relay os entrega. */
async function eventosDeVerificacao(contaId: string): Promise<EventoPublicado[]> {
  const { rows } = await dono.query<{
    id: string;
    tipo: string;
    versao: number;
    agregado_id: string;
    payload: EventoPublicado['payload'];
    ocorrido_em: Date;
  }>(
    `SELECT id::text, tipo, versao, agregado_id::text, payload, ocorrido_em
       FROM compartilhado.outbox WHERE agregado_id = $1::uuid ORDER BY ocorrido_em, id`,
    [contaId],
  );
  return rows
    .filter(
      (l) => l.tipo === 'identidade.ContaCriada' || l.tipo === 'identidade.VerificacaoReenviada',
    )
    .map((l) => ({
      id: l.id,
      tipo: l.tipo,
      versao: l.versao,
      agregadoId: l.agregado_id,
      payload: l.payload,
      ocorridoEm: l.ocorrido_em.toISOString(),
    }));
}

it('duas entregas simultâneas para a mesma conta deixam um código só valendo (Q27, S107)', async () => {
  const conta = await cadastrar(a, docs, { email: emailUnico('emissao') });
  contasDoTeste.push(conta.id);
  await a.casos.reenviarVerificacao.executar({ contaId: conta.id });
  const [criada, reenviada] = await eventosDeVerificacao(conta.id);
  if (criada === undefined || reenviada === undefined) throw new Error('faltam eventos');

  const modelos = new ModelosDeEmailDaIdentidadeEmHtml();
  const enviador = new EnviadorDeEmailFalso();
  const assinante = (p: Pilha) =>
    new EnviarCodigoDeVerificacaoAssinante(
      p.unidade,
      p.relogio,
      p.repos.contas,
      p.repos.codigos,
      p.servicos.cifrador,
      p.servicos.gerador,
      modelos,
      enviador,
    );
  // A primeira para depois de invalidar os vigentes, com a trava da emissão já tomada.
  const pausa = pausarDepois(a.repos.codigos, 'invalidarVigentes');
  const primeira = new EntregadorDeEventos(a.unidade, a.relogio, loggerMudo()).entregar(
    assinante(a),
    criada,
  );
  await pausa.chegou;
  const segunda = new EntregadorDeEventos(b.unidade, b.relogio, loggerMudo()).entregar(
    assinante(b),
    reenviada,
  );
  // A segunda espera a trava da emissão (sem ela, emitiria sem esperar).
  await esperarAlguemNaTrava(dono);
  pausa.liberar();
  await Promise.all([primeira, segunda]);

  const { rows } = await dono.query<{ vivos: number; total: number }>(
    `SELECT count(*) FILTER (WHERE usado_em IS NULL)::int AS vivos, count(*)::int AS total
       FROM identidade.codigos_verificacao
      WHERE conta_id = $1::uuid AND finalidade = 'verificacao_email'`,
    [conta.id],
  );
  expect(rows[0]).toEqual({ vivos: 1, total: 2 });
  expect(enviador.enviadas).toHaveLength(2);
});
