// Redator de logs: tira dado pessoal e segredo do que vai para o log (pino) e
// do que vai para o Sentry (`beforeSend` e `beforeBreadcrumb`). Só depende da
// linguagem, para servir aos dois.
import { ehChaveProtegida } from '../titular/dado-pessoal.ts';

/** Valor que substitui o conteúdo de uma chave sensível. */
export const VALOR_REDIGIDO = '[REDIGIDO]';

/**
 * Trechos que, além das chaves de `ehChaveProtegida` (a mesma regra da
 * auditoria e da outbox), tornam uma chave sensível no log. Comparados sem
 * diferenciar maiúsculas e ignorando tudo o que não é letra ou dígito, por
 * trecho e não por palavra, para pegar `CnPj`, `numeroCpf` ou `mailContato`.
 * Redigir demais num log é aceitável; vazar um dado pessoal, não.
 */
const TRECHOS_SENSIVEIS = [
  'authorization',
  'cookie',
  'senha',
  'password',
  'token',
  'segredo',
  'secret',
  'mail',
  'telefone',
  'cpf',
  'cnpj',
] as const;

/**
 * Chaves de texto livre, comparadas inteiras (depois da mesma normalização):
 * a mensagem de um erro costuma ir para elas (`{ message: erro.message }`), e
 * o redator não sabe o que há no texto. A pilha também (`{ stack: erro.stack }`):
 * ela começa pela mensagem. Inteiras para não pegar `messageId` nem
 * `mensagemId`; pela normalização, `errormessage` cobre `errorMessage` e
 * `error_message`. O `err` do primeiro nível do log não passa por aqui: vai
 * para `resumirErro`, que guarda só os quadros da pilha.
 */
const CHAVES_DE_TEXTO_LIVRE = [
  'message',
  'msg',
  'mensagem',
  'errormessage',
  'stack',
  'pilha',
] as const;

/** Profundidade máxima percorrida; abaixo dela o valor é descartado. */
const PROFUNDIDADE_MAXIMA = 8;
const VALOR_PROFUNDO = '[PROFUNDO]';
const VALOR_CICLICO = '[CICLO]';
/** Objeto que não pôde ser lido (getter que lança, proxy revogado). */
const VALOR_ILEGIVEL = '[ILEGIVEL]';
/** Buffer e afins: o conteúdo binário nunca vai para o log. */
const VALOR_BINARIO = '[BINARIO]';

export function ehChaveSensivel(chave: string): boolean {
  if (ehChaveProtegida(chave)) return true;
  const normalizada = chave.toLowerCase().replace(/[^a-z0-9]/g, '');
  if ((CHAVES_DE_TEXTO_LIVRE as readonly string[]).includes(normalizada)) return true;
  return TRECHOS_SENSIVEIS.some((trecho) => normalizada.includes(trecho));
}

/** Erro como aparece no log e no Sentry: tipo, código e quadros da pilha. */
export interface ResumoDeErro {
  tipo: string;
  codigo?: string | number;
  pilha?: string;
}

/**
 * Linhas de pilha (`    at ...`) depois da mensagem. O cabeçalho da pilha
 * (`Tipo: mensagem`) repete a mensagem, que pode ter várias linhas, inclusive
 * uma parecida com quadro (`    at fulano@...`, Q9): só conta o que vem depois
 * da mensagem. Pilha trocada à mão, sem a mensagem, é lida inteira.
 */
function quadrosDaPilha(pilha: unknown, mensagem: unknown): string | undefined {
  if (typeof pilha !== 'string') return undefined;
  const inicio = typeof mensagem === 'string' && mensagem !== '' ? pilha.indexOf(mensagem) : -1;
  const depoisDaMensagem =
    inicio === -1 ? pilha : pilha.slice(inicio + (mensagem as string).length);
  const quadros = depoisDaMensagem.split('\n').filter((linha) => /^\s+at\s/.test(linha));
  return quadros.length > 0 ? quadros.join('\n') : undefined;
}

/**
 * Lista fechada de campos de um erro. A mensagem e as demais propriedades
 * ficam de fora de propósito: a de biblioteca de banco costuma trazer os
 * parâmetros da query (o `detail` do pg traz o valor que violou a chave, o
 * `meta` do Prisma, a mensagem do driver) e a do `JSON.parse`, trecho da entrada.
 */
export function resumirErro(erro: unknown): ResumoDeErro {
  if (!(erro instanceof Error)) return { tipo: typeof erro };
  const codigo: unknown = (erro as Error & { code?: unknown }).code;
  const pilha = quadrosDaPilha(erro.stack, erro.message);
  return {
    tipo: erro.name || erro.constructor.name,
    ...(typeof codigo === 'string' || typeof codigo === 'number' ? { codigo } : {}),
    ...(pilha ? { pilha } : {}),
  };
}

/**
 * Objetos que seguem como estão. `Date` sai como data ISO; `Map`, `Set` e
 * afins saem como `{}` no JSON, sem o conteúdo.
 */
function ehMantido(valor: object): boolean {
  return (
    valor instanceof Date ||
    valor instanceof Map ||
    valor instanceof Set ||
    valor instanceof WeakMap ||
    valor instanceof WeakSet ||
    valor instanceof RegExp ||
    valor instanceof Promise
  );
}

function redigirObjeto(
  valor: object,
  profundidade: number,
  vistos: WeakSet<object>,
  chavesIntactas: readonly string[],
): unknown {
  if (Array.isArray(valor)) {
    return valor.map((item: unknown) => redigirEm(item, profundidade + 1, vistos, []));
  }
  if (valor instanceof Error) return resumirErro(valor);
  if (ArrayBuffer.isView(valor) || valor instanceof ArrayBuffer) return VALOR_BINARIO;
  if (valor instanceof URL) return urlSemQuery(valor.href);
  // Instância com `toJSON` (Decimal do Prisma, por exemplo): o JSON dela é o
  // que iria para a linha, então é ele que passa pelo redator.
  const comToJson = valor as { toJSON?: unknown };
  if (typeof comToJson.toJSON === 'function') {
    const json: unknown = (comToJson.toJSON as () => unknown).call(valor);
    return json === valor ? {} : redigirEm(json, profundidade + 1, vistos, []);
  }
  // Objeto literal ou instância de classe: as propriedades próprias
  // enumeráveis, as mesmas que o `JSON.stringify` levaria.
  const copia: Record<string, unknown> = {};
  for (const [chave, item] of Object.entries(valor)) {
    if (chavesIntactas.includes(chave)) copia[chave] = item;
    else if (ehChaveSensivel(chave)) copia[chave] = VALOR_REDIGIDO;
    else copia[chave] = redigirEm(item, profundidade + 1, vistos, []);
  }
  return copia;
}

function redigirEm(
  valor: unknown,
  profundidade: number,
  vistos: WeakSet<object>,
  chavesIntactas: readonly string[],
): unknown {
  if (valor === null || typeof valor !== 'object' || ehMantido(valor)) return valor;
  if (vistos.has(valor)) return VALOR_CICLICO;
  if (profundidade >= PROFUNDIDADE_MAXIMA) return VALOR_PROFUNDO;
  vistos.add(valor);
  try {
    return redigirObjeto(valor, profundidade, vistos, chavesIntactas);
  } catch {
    return VALOR_ILEGIVEL;
  } finally {
    vistos.delete(valor);
  }
}

export interface OpcoesDoRedator {
  /**
   * Chaves do primeiro nível que passam sem redação, para um serializador de
   * lista fechada tratar depois (no log: `req`, `res` e `err`).
   */
  chavesIntactas?: readonly string[];
}

/**
 * Devolve uma cópia em que toda chave sensível, em qualquer nível, tem o valor
 * trocado por `[REDIGIDO]`. Percorre objetos literais, arrays e instâncias de
 * classe (pelas propriedades próprias enumeráveis); um `Error` vira o resumo de
 * `resumirErro`; `Date`, `Map` e `Set` seguem como estão; binário vira
 * `[BINARIO]`; `URL` perde a query. Não altera o valor recebido.
 */
export function redigir<T>(valor: T, opcoes: OpcoesDoRedator = {}): T {
  return redigirEm(valor, 0, new WeakSet(), opcoes.chavesIntactas ?? []) as T;
}

/**
 * Tira a query string e o fragmento de uma URL, absoluta ou só caminho (S20):
 * dado pessoal e token nunca vão para log nem para o Sentry pela URL.
 */
export function urlSemQuery(url: string): string {
  const fim = url.search(/[?#]/);
  return fim === -1 ? url : url.slice(0, fim);
}
