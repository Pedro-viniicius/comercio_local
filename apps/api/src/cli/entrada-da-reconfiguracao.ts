// Entrada da CLI `reconfigurar-segundo-fator` (S99): argumentos e e-mail da
// entrada padrão, separados do programa para o teste não precisar rodá-lo.
//
// O e-mail nunca vem por argumento: ficaria no histórico do shell, na lista de
// processos (`ps`) e no log do `fly ssh console`. Ou a conta vem pelo id
// (`--conta <uuid>`), ou o e-mail é lido da entrada padrão (digitado ou por
// pipe). `--operador <uuid>` é obrigatório: o id da conta admin de quem roda,
// gravado na auditoria como ator.
import type { Readable } from 'node:stream';
import { parseArgs } from 'node:util';

/** O e-mail mais longo aceito na entrada padrão (o limite do endereço é 254). */
const TAMANHO_MAXIMO_DO_EMAIL = 320;

export interface ArgumentosDaReconfiguracao {
  /** Id da conta, se veio `--conta`; `null` manda ler o e-mail da entrada padrão. */
  readonly contaId: string | null;
  readonly operadorId: string;
}

/**
 * Os argumentos, ou `null` se não são exatamente `--operador <id>` e,
 * opcionalmente, `--conta <id>` (qualquer outro, como `--email`, recusa).
 */
export function lerArgumentos(argumentos: readonly string[]): ArgumentosDaReconfiguracao | null {
  try {
    const { values } = parseArgs({
      args: [...argumentos],
      options: { conta: { type: 'string' }, operador: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    });
    const operadorId = values.operador?.trim() ?? '';
    if (operadorId === '') return null;
    if (values.conta === undefined) return { contaId: null, operadorId };
    const contaId = values.conta.trim();
    return contaId === '' ? null : { contaId, operadorId };
  } catch {
    return null;
  }
}

/**
 * A primeira linha da entrada, sem espaços nas pontas; `null` se a entrada
 * acabou sem linha, a linha está vazia ou passa do tamanho de um e-mail.
 */
export async function lerEmailDaEntrada(entrada: Readable): Promise<string | null> {
  entrada.setEncoding('utf8');
  let lido = '';
  for await (const pedaco of entrada) {
    lido += String(pedaco);
    const fim = lido.indexOf('\n');
    if (fim !== -1) {
      lido = lido.slice(0, fim);
      break;
    }
    if (lido.length > TAMANHO_MAXIMO_DO_EMAIL) return null;
  }
  const email = lido.trim();
  return email === '' || email.length > TAMANHO_MAXIMO_DO_EMAIL ? null : email;
}
