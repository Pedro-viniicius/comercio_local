// Peças comuns aos assinantes da Identidade (plano 01b, etapa 13; ADR-011).
//
// - `lerPayload`: o assinante lê o payload com o mesmo esquema estrito do
//   contrato que a aplicação usou para publicar (P4), e confere o tipo, a versão
//   e o `agregadoId`. Evento fora do contrato é defeito: lança `EventoInvalido`
//   só com o caminho e o código de cada problema, nunca o valor, e o pg-boss
//   desiste depois das retentativas.
// - `emitirEEnviarCodigo`: o código de uso único nasce aqui, na hora do envio,
//   e nunca passa pela outbox; o banco guarda só o HMAC ligado à conta e à
//   finalidade (`cifrador.hmac(<finalidade>, [contaId, codigo])`). O destinatário é
//   sempre `contas.email_normalizado`, lido pelo id do payload.
//
// Os assinantes rodam dentro da transação da entrega (`EntregadorDeEventos`): se
// o envio falhar, o código emitido some com o resto e o pg-boss tenta de novo.
// O e-mail é o último passo, depois de tudo o que grava no banco.
import {
  EVENTOS_DE_IDENTIDADE,
  type NomeDoEventoDeIdentidade,
  type PayloadDoEventoDeIdentidade,
} from '@bairrin/contratos';
import type { EnviadorDeEmail } from '../../../../compartilhado/email/enviador-de-email.ts';
import type { EventoPublicado } from '../../../../compartilhado/eventos/assinantes.ts';
import { EventoInvalido } from '../../../../compartilhado/eventos/publicador.ts';
import {
  CodigoDeVerificacao,
  type FinalidadeDoCodigo,
} from '../../dominio/codigo-de-verificacao.ts';
import type { Conta } from '../../dominio/conta.ts';
import type { RepositorioDeCodigosDeVerificacao } from '../../dominio/repositorios.ts';
import type { Cifrador } from '../portas/cifrador.ts';
import type { GeradorDeSegredos } from '../portas/gerador-de-segredos.ts';
import type { ConteudoDoEmail, DadosDoCodigo, NomeNaSaudacao } from './modelos-de-email.ts';

/** Teto de códigos por conta e finalidade (S93, P16). */
export const TETO_DE_CODIGOS_POR_DIA = 10;
/** Janela do teto: as últimas 24 h. */
export const JANELA_DO_TETO_EM_MS = 24 * 60 * 60 * 1000;

/**
 * O nome da conta para a saudação do e-mail, ou `null` se o e-mail dela ainda
 * não foi verificado (S102). O nome é texto livre do cadastro: sem a
 * verificação, quem o escolheu pode não ser o dono da caixa, e o nome viraria
 * uma mensagem dele ("Acesse ...") num e-mail com a marca do Bairrin.
 */
export function nomeNaSaudacao(conta: Conta): NomeNaSaudacao {
  return conta.emailVerificado ? conta.nome : null;
}

/** O tipo (`identidade.<Nome>`) de um evento do contrato. */
export function tipoDoEvento(nome: NomeDoEventoDeIdentidade): string {
  return EVENTOS_DE_IDENTIDADE[nome].tipo;
}

/**
 * O payload do evento, validado pelo esquema do contrato do evento `nome`.
 * Lança `EventoInvalido` se o tipo ou a versão não forem os do contrato, se o
 * payload não passar no esquema ou se o `agregadoId` não for o `contaId`.
 */
export function lerPayload<Nome extends NomeDoEventoDeIdentidade>(
  nome: Nome,
  evento: EventoPublicado,
): PayloadDoEventoDeIdentidade<Nome> {
  const contrato = EVENTOS_DE_IDENTIDADE[nome];
  if (evento.tipo !== contrato.tipo || evento.versao !== contrato.versao) {
    throw new EventoInvalido(`evento entregue a quem espera ${contrato.tipo} v${contrato.versao}`);
  }
  const resultado = contrato.payload.safeParse(evento.payload);
  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((problema) => `${problema.path.join('.') || '(payload)'}: ${problema.code}`)
      .join(', ');
    throw new EventoInvalido(`payload de ${contrato.tipo} fora do contrato (${problemas})`);
  }
  const payload = resultado.data as PayloadDoEventoDeIdentidade<Nome>;
  if (payload.contaId !== evento.agregadoId) {
    throw new EventoInvalido(`${contrato.tipo} com agregadoId diferente do contaId`);
  }
  return payload;
}

/**
 * O nome do evento do contrato cujo tipo é `tipo`, entre os que o assinante
 * assina; lança `EventoInvalido` se não for nenhum deles.
 */
export function nomeDoEvento<Nome extends NomeDoEventoDeIdentidade>(
  nomes: readonly Nome[],
  tipo: string,
): Nome {
  const nome = nomes.find((candidato) => EVENTOS_DE_IDENTIDADE[candidato].tipo === tipo);
  if (nome === undefined) throw new EventoInvalido('evento que o assinante não assina');
  return nome;
}

/**
 * - `enviado`: código novo emitido (os anteriores da conta e finalidade deixam
 *   de valer) e e-mail entregue ao SMTP;
 * - `teto_atingido`: a conta já recebeu 10 códigos desta finalidade nas
 *   últimas 24 h (S93): nada é emitido nem enviado, e o último código continua
 *   valendo.
 */
export type ResultadoDoEnvioDeCodigo = 'enviado' | 'teto_atingido';

/**
 * Emite e envia o código da finalidade para a conta (ativa, já conferida por
 * quem chama). Ordem: trava da emissão da conta e da finalidade
 * (`travarEmissao`, Q27, S107), teto do dia (`contarEmitidosDesde`),
 * invalidação dos vigentes (só o último vale), HMAC com conta e finalidade,
 * gravação e, por último, o envio. Chamado dentro da unidade de trabalho da
 * entrega.
 *
 * A trava serializa duas entregas simultâneas para a mesma conta (mais de uma
 * máquina de worker): a segunda espera a primeira terminar, conta o código
 * dela no teto e o invalida, e fica um código só valendo.
 */
export async function emitirEEnviarCodigo(
  portas: {
    codigos: RepositorioDeCodigosDeVerificacao;
    cifrador: Cifrador;
    gerador: GeradorDeSegredos;
    enviador: EnviadorDeEmail;
  },
  conta: Conta,
  finalidade: FinalidadeDoCodigo,
  agora: Date,
  modelo: (dados: DadosDoCodigo) => ConteudoDoEmail,
): Promise<ResultadoDoEnvioDeCodigo> {
  await portas.codigos.travarEmissao(conta.id, finalidade);
  const desde = new Date(agora.getTime() - JANELA_DO_TETO_EM_MS);
  const emitidos = await portas.codigos.contarEmitidosDesde(conta.id, finalidade, desde);
  if (emitidos >= TETO_DE_CODIGOS_POR_DIA) return 'teto_atingido';

  const codigo = portas.gerador.codigoNumerico();
  await portas.codigos.invalidarVigentes(conta.id, finalidade, agora);
  await portas.codigos.inserir(
    CodigoDeVerificacao.emitir({
      id: portas.gerador.novoId(),
      contaId: conta.id,
      finalidade,
      codigoHmac: portas.cifrador.hmac(finalidade, [conta.id, codigo]),
      agora,
    }),
  );
  await portas.enviador.enviar({
    para: conta.email.valor,
    ...modelo({ nome: nomeNaSaudacao(conta), codigo }),
  });
  return 'enviado';
}
