// Erros tipados do cliente. O cliente não registra nada em log: URL, corpo e
// cabeçalhos podem carregar dado pessoal, então nenhuma mensagem os inclui.
import type { CampoDoProblema, Problema } from '@bairrin/contratos';

/** Código usado quando o erro HTTP não veio como Problem Details. */
export const CODIGO_ERRO_GENERICO = 'erro_generico';

/**
 * A API respondeu com erro HTTP. Com Problem Details, traz `codigo`, `campos` e
 * `idRequisicao` do servidor; sem ele (corpo não JSON, HTML de proxy, JSON de
 * outro formato), `codigo` é `CODIGO_ERRO_GENERICO` e `problema` é `undefined`.
 * `campos[].codigo` pode ser um código que este app não conhece (API mais nova):
 * sem texto para `erro.<campo>.<codigo>`, mostre o `motivo`.
 */
export class ErroDeApi extends Error {
  readonly tipo = 'api';
  readonly status: number;
  readonly codigo: string;
  readonly campos: readonly CampoDoProblema[];
  readonly idRequisicao: string | undefined;
  readonly problema: Problema | undefined;

  constructor(entrada: { status: number; problema?: Problema }) {
    const { status, problema } = entrada;
    const codigo = problema?.codigo ?? CODIGO_ERRO_GENERICO;
    super(`Erro da API (${status}, ${codigo})`);
    this.name = 'ErroDeApi';
    this.status = status;
    this.codigo = codigo;
    this.campos = problema?.campos ?? [];
    this.idRequisicao = problema?.idRequisicao;
    this.problema = problema;
  }
}

/**
 * Não houve resposta: falha de rede (`rede`) ou o tempo limite estourou
 * (`tempo_esgotado`). Os dois são "Sem conexão" para quem usa o app, e a
 * tentativa de novo é a mesma; por isso um só tipo, com o motivo à parte.
 *
 * Sem resposta não quer dizer que a API não recebeu o pedido: com
 * `tempo_esgotado` (e às vezes com `rede`) a escrita pode já ter sido aplicada.
 * Repetir uma leitura (`GET`) é sempre seguro; repetir uma escrita (`POST`,
 * `PUT`, `PATCH`, `DELETE`) só é seguro se ela foi enviada com cabeçalho
 * `Idempotency-Key` e a nova tentativa reusa a mesma chave (ADR-009).
 */
export class ErroSemConexao extends Error {
  readonly tipo = 'sem_conexao';
  readonly motivo: 'rede' | 'tempo_esgotado';

  constructor(motivo: 'rede' | 'tempo_esgotado', opcoes?: { cause?: unknown }) {
    super(
      motivo === 'rede' ? 'Sem conexão com a API' : 'Tempo esgotado ao falar com a API',
      opcoes,
    );
    this.name = 'ErroSemConexao';
    this.motivo = motivo;
  }
}

/**
 * A API respondeu 2xx, mas o corpo não bate com o esquema esperado (por
 * exemplo, app antigo diante de API nova). Não carrega o corpo recebido.
 */
export class ErroRespostaInvalida extends Error {
  readonly tipo = 'resposta_invalida';
  readonly status: number;

  constructor(status: number) {
    super(`Resposta da API fora do contrato (${status})`);
    this.name = 'ErroRespostaInvalida';
    this.status = status;
  }
}

/** O chamador cancelou a requisição pelo próprio sinal. Não é falha de rede. */
export class ErroCancelado extends Error {
  readonly tipo = 'cancelado';

  constructor() {
    super('Requisição cancelada');
    this.name = 'ErroCancelado';
  }
}

export type ErroDoCliente = ErroDeApi | ErroSemConexao | ErroRespostaInvalida | ErroCancelado;

export function ehErroSemConexao(erro: unknown): erro is ErroSemConexao {
  return erro instanceof ErroSemConexao;
}

export function ehErroDeApi(erro: unknown): erro is ErroDeApi {
  return erro instanceof ErroDeApi;
}
