// Regra comum à auditoria (S4) e à outbox (payload só com ids e dados não
// pessoais): JSON simples, sem chave conhecida de dado pessoal ou de segredo.
//
// Um campo pessoal ou secreto só aparece como marca de alteração,
// `{ "alterado": true }` (00-arquitetura, "Auditoria sem dado pessoal"):
// registra que o campo mudou sem guardar o valor. Booleano e `null` também
// passam (`emailVerificado: true`, `telefone: null`): dizem que o dado existe,
// foi conferido ou foi apagado, nunca qual é. Texto, número, lista e objeto
// continuam recusados.
//
// É uma rede de proteção por nome de chave, não um detector de conteúdo: quem
// grava continua responsável por não pôr dado pessoal em chave de nome neutro.
// Pegar demais aqui é aceitável; deixar passar, não.

/** Valor JSON aceito na auditoria e no payload dos eventos. */
export type ValorJson = string | number | boolean | null | readonly ValorJson[] | ObjetoJson;
export interface ObjetoJson {
  readonly [chave: string]: ValorJson;
}

/** Valor aceito numa chave de dado pessoal ou de segredo, além de booleano e `null`. */
export const MARCA_DE_ALTERACAO = Object.freeze({ alterado: true } as const);

/**
 * Trechos que, em qualquer parte da chave (sem diferenciar maiúsculas, sem
 * acento e ignorando separadores), a tornam pessoal ou secreta. Só trechos
 * longos o bastante para não casar por acaso (`tipo` contém `ip`).
 */
const TRECHOS = [
  // Contato e identificação
  'email',
  'telefone',
  'celular',
  'whatsapp',
  'sobrenome',
  'apelido',
  'nascimento',
  // Endereço e localização
  'endereco',
  'logradouro',
  'complemento',
  'latitude',
  'longitude',
  'localizacao',
  // Dados bancários
  'bancari',
  'agencia',
  // Segredos
  'senha',
  'password',
  'token',
  'segredo',
  'secret',
  'cookie',
  'authorization',
  'totp',
] as const;

/** Palavras curtas que só contam como palavra inteira (`nomeCompleto`, `cpf_titular`). */
const PALAVRAS = [
  'nome',
  'cpf',
  'cnpj',
  'rg',
  'cep',
  'ip',
  'pix',
  'codigo',
  'hash',
  'hmac',
] as const;

const PROFUNDIDADE_MAXIMA = 10;

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** `nomeCompleto` → `['nome', 'completo']`; `x-access-token` → `['x', 'access', 'token']`. */
function palavrasDaChave(chave: string): string[] {
  return semAcento(chave)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((palavra) => palavra.length > 0);
}

/** A chave nomeia um dado pessoal ou um segredo? */
export function ehChaveProtegida(chave: string): boolean {
  const palavras = palavrasDaChave(chave);
  const junta = palavras.join('');
  return (
    TRECHOS.some((trecho) => junta.includes(trecho)) ||
    palavras.some((palavra) => (PALAVRAS as readonly string[]).includes(palavra))
  );
}

function ehObjetoSimples(valor: unknown): valor is Record<string, unknown> {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const prototipo: unknown = Object.getPrototypeOf(valor);
  return prototipo === Object.prototype || prototipo === null;
}

function ehMarcaDeAlteracao(valor: unknown): boolean {
  if (!ehObjetoSimples(valor)) return false;
  const chaves = Object.keys(valor);
  return chaves.length === 1 && chaves[0] === 'alterado' && valor['alterado'] === true;
}

/** Booleano, `null` ou a marca de alteração: nenhum deles revela o dado. */
function ehValorAceitoEmChaveProtegida(valor: unknown): boolean {
  return valor === null || typeof valor === 'boolean' || ehMarcaDeAlteracao(valor);
}

/** Problema achado num valor: caminho do campo (só nomes de chave) e motivo. */
export interface ProblemaDeDadoPessoal {
  caminho: string;
  motivo: 'chave-protegida' | 'valor-nao-json' | 'profundo-demais';
}

function percorrer(
  valor: unknown,
  caminho: string,
  profundidade: number,
  problemas: ProblemaDeDadoPessoal[],
): void {
  if (valor === null || typeof valor === 'string' || typeof valor === 'boolean') return;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) problemas.push({ caminho, motivo: 'valor-nao-json' });
    return;
  }
  if (profundidade >= PROFUNDIDADE_MAXIMA) {
    problemas.push({ caminho, motivo: 'profundo-demais' });
    return;
  }
  if (Array.isArray(valor)) {
    valor.forEach((item: unknown, indice) =>
      percorrer(item, `${caminho}[${indice}]`, profundidade + 1, problemas),
    );
    return;
  }
  if (!ehObjetoSimples(valor)) {
    // Date, Map, instância de classe, função, undefined, bigint, symbol.
    problemas.push({ caminho, motivo: 'valor-nao-json' });
    return;
  }
  for (const [chave, item] of Object.entries(valor)) {
    const caminhoDaChave = `${caminho}.${chave}`;
    if (ehChaveProtegida(chave)) {
      if (!ehValorAceitoEmChaveProtegida(item)) {
        problemas.push({ caminho: caminhoDaChave, motivo: 'chave-protegida' });
      }
      continue;
    }
    percorrer(item, caminhoDaChave, profundidade + 1, problemas);
  }
}

/**
 * Problemas de um valor que vai para a auditoria ou para a outbox. Lista
 * vazia: pode gravar. `raiz` prefixa os caminhos (ex.: `depois.contato.email`).
 * Os caminhos levam só nomes de chave, nunca valores.
 */
export function problemasDeDadoPessoal(valor: unknown, raiz: string): ProblemaDeDadoPessoal[] {
  const problemas: ProblemaDeDadoPessoal[] = [];
  percorrer(valor, raiz, 0, problemas);
  return problemas;
}

/** Valor recusado pela regra de dado pessoal. A mensagem cita só caminhos de chave. */
export class DadoPessoalRecusado extends Error {
  constructor(
    readonly destino: 'auditoria' | 'outbox',
    readonly problemas: readonly ProblemaDeDadoPessoal[],
  ) {
    super(
      `Valor recusado na ${destino} (dado pessoal, segredo ou valor fora de JSON): ` +
        problemas.map(({ caminho, motivo }) => `${caminho} (${motivo})`).join(', '),
    );
    this.name = 'DadoPessoalRecusado';
  }
}
