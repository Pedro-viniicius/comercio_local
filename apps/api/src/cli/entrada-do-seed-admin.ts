// Entrada da CLI `seed:admin` (CA-07; plano 01b, etapa 13): os argumentos e as
// linhas da entrada padrão, separados do programa para o teste não precisar
// subir o Nest.
//
// Nenhum dado pessoal vem por argumento (S99, S108): ficaria no histórico do
// shell, na lista de processos (`ps`) e no log do `fly ssh console`. O único
// argumento é `--operador <id>` (S106), a conta admin de quem roda, exigida
// depois do primeiro admin. Da entrada padrão (digitada ou por pipe), uma linha
// para cada: o e-mail, o e-mail de novo (S106: os dois precisam ser iguais), o
// nome e o celular com DDD.
//
// O telefone é conferido aqui, antes de qualquer conexão (`Telefone`, a mesma
// regra do cadastro): inválido encerra com erro sem criar nada.
import type { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { Email } from '../modulos/identidade/dominio/email.ts';
import { Telefone } from '../modulos/identidade/dominio/telefone.ts';

/** A linha mais longa aceita na entrada padrão (o limite do endereço de e-mail é 254). */
const TAMANHO_MAXIMO_DA_LINHA = 320;

/** O que é pedido, em ordem, uma linha cada (o texto aparece só no terminal). */
export const PERGUNTAS_DO_SEED_ADMIN = [
  'E-mail da conta admin: ',
  'Repita o e-mail: ',
  'Nome: ',
  'Celular com DDD: ',
] as const;

export type ArgumentosDoSeedAdmin =
  { readonly tipo: 'argumentos'; readonly operadorId: string | null } | { readonly tipo: 'uso' };

/**
 * Os argumentos conferidos: `uso` se vier qualquer coisa além de
 * `--operador <id>` (como `--nome`, `--telefone` ou `--email`, que vêm da
 * entrada padrão) ou se o operador vier vazio.
 */
export function lerArgumentosDoSeedAdmin(argumentos: readonly string[]): ArgumentosDoSeedAdmin {
  try {
    const { values } = parseArgs({
      args: [...argumentos],
      options: { operador: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    });
    if (values.operador === undefined) return { tipo: 'argumentos', operadorId: null };
    const operadorId = values.operador.trim();
    return operadorId === '' ? { tipo: 'uso' } : { tipo: 'argumentos', operadorId };
  } catch {
    return { tipo: 'uso' };
  }
}

export type DadosDoSeedAdmin =
  | {
      readonly tipo: 'dados';
      readonly email: string;
      readonly nome: string;
      /** Em E.164. */
      readonly telefone: string;
    }
  /** A entrada acabou antes das quatro linhas, ou alguma veio vazia ou longa demais. */
  | { readonly tipo: 'entrada_incompleta' }
  | { readonly tipo: 'emails_diferentes' }
  | { readonly tipo: 'telefone_invalido' };

/**
 * Lê as quatro linhas da entrada (`PERGUNTAS_DO_SEED_ADMIN`), sem espaços nas
 * pontas. Com `perguntar` (terminal), escreve cada pergunta antes de ler a
 * linha. Os dois e-mails são comparados depois da normalização (`Email`), e o
 * telefone sai em E.164. Nenhum resultado traz o valor lido.
 */
export async function lerDadosDoSeedAdmin(
  entrada: Readable,
  perguntar?: (texto: string) => void,
): Promise<DadosDoSeedAdmin> {
  const linhas = await lerLinhas(entrada, PERGUNTAS_DO_SEED_ADMIN, perguntar);
  if (linhas === null) return { tipo: 'entrada_incompleta' };
  const [email = '', confirmacao = '', nome = '', telefone = ''] = linhas;
  const normalizado = (texto: string) => Email.tentarCriar(texto)?.valor ?? texto;
  if (normalizado(email) !== normalizado(confirmacao)) return { tipo: 'emails_diferentes' };
  const celular = Telefone.tentarCriar(telefone);
  if (celular === null) return { tipo: 'telefone_invalido' };
  return { tipo: 'dados', email, nome, telefone: celular.valor };
}

/** Uma linha por pergunta; `null` se faltar linha ou alguma vier vazia ou longa demais. */
async function lerLinhas(
  entrada: Readable,
  perguntas: readonly string[],
  perguntar: ((texto: string) => void) | undefined,
): Promise<string[] | null> {
  const leitor = createInterface({ input: entrada, crlfDelay: Infinity, terminal: false });
  const proximas = leitor[Symbol.asyncIterator]();
  try {
    const linhas: string[] = [];
    for (const pergunta of perguntas) {
      perguntar?.(pergunta);
      const lida = await proximas.next();
      if (lida.done === true) return null;
      const linha = String(lida.value).trim();
      if (linha === '' || linha.length > TAMANHO_MAXIMO_DA_LINHA) return null;
      linhas.push(linha);
    }
    return linhas;
  } finally {
    leitor.close();
  }
}
