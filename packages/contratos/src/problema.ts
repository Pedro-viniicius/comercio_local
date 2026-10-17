// Problem Details (RFC 9457) e a conversão de erro do zod em `campos`.
import { MOTIVO_DESCONHECIDO, MOTIVO_OBRIGATORIO, z } from './zod.ts';

/**
 * Códigos estáveis de erro de campo. O app e o painel escolhem o texto por
 * `erro.<campo>.<codigo>` e só usam o `motivo` se a chave não existir (01b).
 */
export const CODIGOS_DE_CAMPO = ['obrigatorio', 'invalido', 'comum', 'desconhecido'] as const;
export type CodigoDeCampo = (typeof CODIGOS_DE_CAMPO)[number];

/** Campo na raiz do valor (corpo que não é objeto, por exemplo). */
export const CAMPO_RAIZ = 'corpo';
const TAMANHO_MAXIMO_DO_CAMPO = 100;

/**
 * Erro de campo que a API produz. `codigo` é obrigatório e restrito a
 * `CODIGOS_DE_CAMPO`: o conversor sempre o produz e o compilador acusa quem
 * montar `campos` à mão sem ele ou com código fora da lista. O 01b, etapa 2,
 * consolida; não há cliente em produção que dependa de resposta sem `codigo`.
 */
export const campoComErroSchema = z.object({
  campo: z.string(),
  codigo: z.enum(CODIGOS_DE_CAMPO),
  motivo: z.string(),
});
export type CampoComErro = z.infer<typeof campoComErroSchema>;

/**
 * Erro de campo como o cliente o lê: `codigo` é texto livre (ADR-010). Um app
 * antigo recebe de uma API mais nova código que ele não conhece; sem chave
 * `erro.<campo>.<codigo>` para ele, mostra o `motivo`. Com `z.enum` aqui, o
 * Problema inteiro seria recusado e o app perderia `campos` e `idRequisicao`.
 */
export const campoDoProblemaSchema = z.object({
  campo: z.string(),
  codigo: z.string(),
  motivo: z.string(),
});
export type CampoDoProblema = z.infer<typeof campoDoProblemaSchema>;

/**
 * Códigos de erro da API e o que cada um significa em HTTP. Planos seguintes
 * acrescentam códigos aqui. O texto mostrado ao usuário é do app ou do painel
 * (`textos/pt-BR.ts`); o `title` é a descrição técnica do código.
 */
export const ERROS = {
  validacao: { status: 400, title: 'Dados inválidos' },
  nao_autenticado: { status: 401, title: 'Autenticação necessária' },
  sem_permissao: { status: 403, title: 'Sem permissão para esta ação' },
  /** Login no painel com senha certa e conta sem perfil `admin` (01b, S23). */
  sem_acesso_painel: { status: 403, title: 'Esta conta não tem acesso ao painel' },
  nao_encontrado: { status: 404, title: 'Recurso não encontrado' },
  conflito: { status: 409, title: 'Conflito com o estado atual do recurso' },
  /** Exclusão de conta com pedido em andamento ou valor a receber (01b, CA-11). */
  exclusao_com_pendencias: {
    status: 409,
    title: 'A conta tem pendências que adiam a exclusão',
  },
  corpo_grande_demais: { status: 413, title: 'Corpo da requisição grande demais' },
  limite_excedido: { status: 429, title: 'Muitas requisições, tente de novo em instantes' },
  erro_interno: { status: 500, title: 'Erro interno' },
  indisponivel: { status: 503, title: 'Serviço indisponível' },
} as const;
export type CodigoDeErro = keyof typeof ERROS;

/**
 * Esquema do Problema lido pelos clientes. `codigo` (do erro e de cada campo)
 * é texto livre e os objetos não são estritos de propósito: um app antigo
 * precisa entender o erro de uma API mais nova, com código ou campo que ele não
 * conhece. O que a API produz é mais restrito (`criarProblema`, `CampoComErro`).
 */
export const problemaSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  codigo: z.string(),
  campos: z.array(campoDoProblemaSchema).optional(),
  idRequisicao: z.string(),
});
export type Problema = z.infer<typeof problemaSchema>;

export const TIPO_DE_CONTEUDO_PROBLEMA = 'application/problem+json';

/** Monta o Problema de um código conhecido. Nunca recebe mensagem de exceção. */
export function criarProblema(entrada: {
  codigo: CodigoDeErro;
  idRequisicao: string;
  campos?: CampoComErro[];
}): Problema {
  const { status, title } = ERROS[entrada.codigo];
  return {
    // URN até o domínio ser registrado; vira URL de documentação depois.
    type: `urn:bairrin:erro:${entrada.codigo}`,
    title,
    status,
    codigo: entrada.codigo,
    ...(entrada.campos ? { campos: entrada.campos } : {}),
    idRequisicao: entrada.idRequisicao,
  };
}

function ehCodigoDeCampo(valor: unknown): valor is CodigoDeCampo {
  return CODIGOS_DE_CAMPO.some((codigo) => codigo === valor);
}

function nomeDoCampo(caminho: readonly PropertyKey[]): string {
  if (caminho.length === 0) return CAMPO_RAIZ;
  return caminho
    .map((parte) => String(parte))
    .join('.')
    .slice(0, TAMANHO_MAXIMO_DO_CAMPO);
}

function codigoDaIssue(issue: z.core.$ZodIssue): CodigoDeCampo {
  if (issue.code === 'unrecognized_keys') return 'desconhecido';
  // Validador próprio escolhe o código: `.refine(fn, { params: { codigo: 'comum' } })`.
  if (issue.code === 'custom' && ehCodigoDeCampo(issue.params?.['codigo'])) {
    return issue.params['codigo'];
  }
  // Ausente ou texto vazio: o locale (zod.ts) devolve o motivo-marcador.
  if (issue.message === MOTIVO_OBRIGATORIO) return 'obrigatorio';
  return 'invalido';
}

/**
 * Converte o erro do zod em `campos` do Problema. O `motivo` é a mensagem do
 * zod em português (ou do validador). Não devolve o valor recebido, só o nome
 * do campo (limitado a 100 caracteres, porque a chave desconhecida vem do cliente).
 */
export function camposDoErroZod(erro: { issues: readonly z.core.$ZodIssue[] }): CampoComErro[] {
  return erro.issues.flatMap((issue): CampoComErro[] => {
    if (issue.code === 'unrecognized_keys') {
      // Um campo por chave desconhecida, no caminho do objeto que a recebeu.
      return issue.keys.map((chave) => ({
        campo: nomeDoCampo([...issue.path, chave]),
        codigo: 'desconhecido',
        motivo: MOTIVO_DESCONHECIDO,
      }));
    }
    return [
      { campo: nomeDoCampo(issue.path), codigo: codigoDaIssue(issue), motivo: issue.message },
    ];
  });
}
