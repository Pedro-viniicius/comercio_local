// Ajudas comuns dos repositórios Prisma da Identidade (plano 01b, etapa 7).
//
// - `exigirTransacao`: as leituras com trava e o `gravarRotacao` só valem dentro
//   da unidade de trabalho (R1). Fora dela, o `FOR UPDATE` acabaria no fim do
//   comando e não protegeria nada, então o adaptador recusa, como os fakes.
// - `ehUuid`: ids que chegam de fora (o id do token do desafio, o `sid`) são
//   conferidos antes da consulta. Um texto que não é UUID faria o Postgres
//   lançar erro de sintaxe (22P02) em vez de "não achei".
// - `ehErroDoPrisma`: erro do banco vira erro de domínio só pelo código do
//   Prisma, nunca pela mensagem, que pode trazer os parâmetros da consulta.
import { Prisma } from '../../../../compartilhado/infra/gerado/prisma/client.ts';
import type {
  TransacaoDoBanco,
  UnidadeDeTrabalhoPrisma,
} from '../../../../compartilhado/infra/unidade-de-trabalho-prisma.ts';

/** Leitura com trava ou gravação condicionada chamada fora da unidade de trabalho. */
export class ForaDaUnidadeDeTrabalhoPrisma extends Error {
  constructor(operacao: string) {
    super(
      `${operacao} fora da unidade de trabalho: a trava do banco acabaria no fim do comando ` +
        'e não protegeria nada.',
    );
    this.name = 'ForaDaUnidadeDeTrabalhoPrisma';
  }
}

/** A transação aberta pela unidade de trabalho; lança se não houver. */
export function exigirTransacao(
  unidade: UnidadeDeTrabalhoPrisma,
  operacao: string,
): TransacaoDoBanco {
  const transacao = unidade.transacaoAtual();
  if (transacao === undefined) throw new ForaDaUnidadeDeTrabalhoPrisma(operacao);
  return transacao;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O texto tem a forma de um UUID (qualquer versão), como a coluna `uuid` aceita. */
export function ehUuid(valor: string): boolean {
  return UUID.test(valor);
}

/** Erro conhecido do Prisma com o código dado (`P2002`: valor único repetido). */
export function ehErroDoPrisma(erro: unknown, codigo: string): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === codigo;
}
