// Trilha de auditoria (`compartilhado.auditoria`): somente acréscimo. A
// aplicação só tem SELECT e INSERT na tabela e triggers barram UPDATE, DELETE
// e TRUNCATE até para o dono (S3).
//
// `antes` e `depois` nunca levam dado pessoal (S4): ids, nomes de campo e
// valores não pessoais; um campo pessoal que mudou entra como
// `{ "alterado": true }`. O repositório recusa chave conhecida de dado pessoal
// ou de segredo com outro valor (regra em `titular/dado-pessoal.ts`).
//
// Este arquivo é a porta, sem Nest nem Prisma (ADR-003); o adaptador é
// `infra/repositorio-de-auditoria-prisma.ts`.
import {
  DadoPessoalRecusado,
  type ObjetoJson,
  problemasDeDadoPessoal,
} from '../titular/dado-pessoal.ts';

/** Quem fez a ação. `sistema` (worker, tarefa) não tem id. */
export type TipoDeAtor = 'conta' | 'admin' | 'sistema';

/** Por onde a ação entrou. */
export type OrigemDaAuditoria = 'api' | 'painel' | 'worker' | 'cli';

export interface EntradaDeAuditoria {
  atorTipo: TipoDeAtor;
  /** Id (UUID) da conta que agiu; `null` só para `sistema`. */
  atorId: string | null;
  /** Verbo no particípio, em snake_case: `loja_aprovada`, `config_alterada`. */
  acao: string;
  /** Tipo do recurso afetado: `loja`, `conta`, `configuracao`. */
  recurso: string;
  /** Id do recurso afetado (nunca e-mail, telefone ou outro dado pessoal). */
  recursoId: string;
  antes?: ObjetoJson;
  depois?: ObjetoJson;
  origem: OrigemDaAuditoria;
}

/** Porta da aplicação. Dentro de uma `UnidadeDeTrabalho`, grava na mesma transação. */
export abstract class RepositorioDeAuditoria {
  abstract registrar(entrada: EntradaDeAuditoria): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFICADOR = /^[a-z][a-z0-9_]*$/;

/** Entrada mal formada (sem relação com dado pessoal). */
export class EntradaDeAuditoriaInvalida extends Error {
  constructor(motivo: string) {
    super(`Entrada de auditoria inválida: ${motivo}.`);
    this.name = 'EntradaDeAuditoriaInvalida';
  }
}

/** Confere a entrada antes de gravar; lança se ela não puder ir para a trilha. */
export function validarEntradaDeAuditoria(entrada: EntradaDeAuditoria): void {
  if (entrada.atorTipo === 'sistema' ? entrada.atorId !== null : !UUID.test(entrada.atorId ?? '')) {
    throw new EntradaDeAuditoriaInvalida('atorId deve ser um UUID, ou null só para o sistema');
  }
  if (!IDENTIFICADOR.test(entrada.acao)) {
    throw new EntradaDeAuditoriaInvalida('acao deve estar em snake_case');
  }
  if (!IDENTIFICADOR.test(entrada.recurso)) {
    throw new EntradaDeAuditoriaInvalida('recurso deve estar em snake_case');
  }
  if (entrada.recursoId.trim().length === 0 || entrada.recursoId.includes('@')) {
    throw new EntradaDeAuditoriaInvalida('recursoId deve ser um id, nunca um e-mail');
  }
  const problemas = [
    ...problemasDeDadoPessoal(entrada.antes ?? null, 'antes'),
    ...problemasDeDadoPessoal(entrada.depois ?? null, 'depois'),
  ];
  if (problemas.length > 0) throw new DadoPessoalRecusado('auditoria', problemas);
}
