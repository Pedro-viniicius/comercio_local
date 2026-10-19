// Regra da senha nova (cadastro e redefinição): 8 a 128 caracteres, texto
// Unicode bem formado e fora da lista local de senhas comuns (S22). Função
// pura, sem zod (ADR-003).
import { ehSenhaComum, ehSenhaSoDeDigitosESimbolos } from './senhas-comuns.ts';

export const TAMANHO_MINIMO_DA_SENHA = 8;
export const TAMANHO_MAXIMO_DA_SENHA = 128;

export const MOTIVO_SENHA_CURTA = 'Use 8 caracteres ou mais';
export const MOTIVO_SENHA_LONGA = 'Use até 128 caracteres';
export const MOTIVO_SENHA_COMUM =
  'Essa senha é muito comum. Escolha outra, mais difícil de adivinhar';
/**
 * Motivo da senha só de dígitos e símbolos (R34). Sai com o mesmo código
 * `comum`: muda só o texto, que diz o que fazer.
 */
export const MOTIVO_SENHA_SO_DE_DIGITOS_E_SIMBOLOS =
  'Use letras também: senha só com números e símbolos é fácil de adivinhar';
export const MOTIVO_SENHA_COM_CARACTERE_INVALIDO =
  'Confira a senha: tem caractere que não pode ser usado';

export type ProblemaDaSenha = 'curta' | 'longa' | 'mal_formada' | 'comum';

/** Metade de par substituto (surrogate) sem a outra metade. */
const SUBSTITUTO_SOLTO = /\p{Cs}/u;

/**
 * Caracteres como a pessoa os vê (pontos de código Unicode, não unidades
 * UTF-16): um emoji conta como um. Vale para o mínimo e o máximo.
 */
export function tamanhoDaSenha(senha: string): number {
  return [...senha].length;
}

/**
 * O texto não tem metade de par substituto solta (S75). Mesmo resultado de
 * `String.prototype.isWellFormed`, que é do ES2024 e fica fora do `lib` do
 * monorepo (ES2023); a expressão regular roda igual em qualquer motor.
 */
export function ehSenhaBemFormada(senha: string): boolean {
  return !SUBSTITUTO_SOLTO.test(senha);
}

/**
 * O que impede a senha nova, ou `null` se ela é aceita. A ordem é a da
 * mensagem mostrada: primeiro o tamanho, depois o texto mal formado e por fim a
 * lista de comuns. Espaços contam e não são cortados: o tamanho é medido na
 * senha digitada, e o `Hasher` (etapa 6) aplica NFKC no hash e na verificação.
 * A senha só de dígitos e símbolos também é `comum`; quem mostra o motivo usa
 * `motivoDaSenhaComum` para escolher o texto.
 */
export function problemaDaSenha(senha: string): ProblemaDaSenha | null {
  const tamanho = tamanhoDaSenha(senha);
  if (tamanho < TAMANHO_MINIMO_DA_SENHA) return 'curta';
  if (tamanho > TAMANHO_MAXIMO_DA_SENHA) return 'longa';
  if (!ehSenhaBemFormada(senha)) return 'mal_formada';
  return ehSenhaComum(senha) ? 'comum' : null;
}

/**
 * O `motivo` da senha recusada como comum: o próprio para a senha só de
 * dígitos e símbolos (R34) e o geral para as demais.
 */
export function motivoDaSenhaComum(senha: string): string {
  return ehSenhaSoDeDigitosESimbolos(senha)
    ? MOTIVO_SENHA_SO_DE_DIGITOS_E_SIMBOLOS
    : MOTIVO_SENHA_COMUM;
}
