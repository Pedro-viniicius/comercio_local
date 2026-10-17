// Códigos digitados pela pessoa: o de 6 dígitos (verificação de e-mail,
// recuperação de senha e TOTP) e o de recuperação do 2FA (10 caracteres em
// base32). Funções puras, sem zod (ADR-003).

export const TAMANHO_DO_CODIGO = 6;
export const TAMANHO_DO_CODIGO_DE_RECUPERACAO = 10;

/** Mensagem única para código errado, expirado, usado ou mal digitado (spec 01, A3). */
export const MOTIVO_CODIGO_INVALIDO = 'Código inválido ou expirado. Confira ou peça um novo.';
/** Código do app autenticador (TOTP) que não confere ou mal digitado (spec 01, P1a). */
export const MOTIVO_CODIGO_DO_AUTENTICADOR_INVALIDO =
  'Código inválido ou expirado. Confira o horário do celular e tente de novo.';
export const MOTIVO_CODIGO_DE_RECUPERACAO_INVALIDO =
  'Código de recuperação inválido. Confira e tente de novo.';

/** Entrada maior que isto nem é examinada. */
const TAMANHO_MAXIMO_DA_ENTRADA = 32;
const CODIGO = /^[0-9]{6}$/;
const CODIGO_DE_RECUPERACAO = /^[A-Z2-7]{10}$/;

/**
 * Código de 6 dígitos sem espaços (`123 456`, colado do e-mail, vira `123456`).
 * Só algarismos ASCII. Devolve `null` se não tiver exatamente 6 dígitos.
 */
export function normalizarCodigo(texto: string): string | null {
  if (texto.length > TAMANHO_MAXIMO_DA_ENTRADA) return null;
  const codigo = texto.replaceAll(/\s/g, '');
  return CODIGO.test(codigo) ? codigo : null;
}

/**
 * Código de recuperação do 2FA em maiúsculas, sem espaços nem hífens
 * (`abcde-fghij` vira `ABCDEFGHIJ`). Alfabeto base32 (RFC 4648: `A-Z` e `2-7`).
 * Devolve `null` se não tiver exatamente 10 caracteres desse alfabeto.
 */
export function normalizarCodigoDeRecuperacao(texto: string): string | null {
  if (texto.length > TAMANHO_MAXIMO_DA_ENTRADA) return null;
  const codigo = texto.replaceAll(/[\s-]/g, '').toUpperCase();
  return CODIGO_DE_RECUPERACAO.test(codigo) ? codigo : null;
}
