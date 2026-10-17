// E-mail: normalização e formato. Função pura, sem zod: o domínio da API a usa
// pelo subcaminho `@bairrin/contratos/validadores` (ADR-003).

/** Limite do endereço inteiro (RFC 5321). */
export const TAMANHO_MAXIMO_DO_EMAIL = 254;
/** Limite da parte antes do `@` (RFC 5321). */
const TAMANHO_MAXIMO_DA_PARTE_LOCAL = 64;

export const MOTIVO_EMAIL_INVALIDO = 'Confira o e-mail: falta o @ ou o domínio';

// Depois da normalização (minúsculas). Parte local: letras, dígitos e `_'+-`,
// com pontos só entre eles. Domínio: rótulos de até 63 caracteres que não
// começam nem terminam com hífen, e um sufixo de letras (ou `xn--`, IDN em
// punycode). Endereço com acento ou fora do ASCII é recusado.
const PARTE_LOCAL = /^[a-z0-9_'+-]+(\.[a-z0-9_'+-]+)*$/;
const ROTULO = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const SUFIXO = /^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * Forma canônica do e-mail (chave de `contas.email_normalizado`): NFC, sem
 * espaços nas pontas e em minúsculas, inclusive a parte local. Não remove
 * pontos nem o trecho depois de `+`: cada endereço continua sendo uma conta.
 * Devolve `null` se o texto não for um e-mail aceito.
 */
export function normalizarEmail(texto: string): string | null {
  const email = texto.normalize('NFC').trim().toLowerCase();
  if (email.length === 0 || email.length > TAMANHO_MAXIMO_DO_EMAIL) return null;
  const arroba = email.lastIndexOf('@');
  if (arroba <= 0 || email.indexOf('@') !== arroba) return null;
  const local = email.slice(0, arroba);
  const rotulos = email.slice(arroba + 1).split('.');
  if (local.length > TAMANHO_MAXIMO_DA_PARTE_LOCAL || !PARTE_LOCAL.test(local)) return null;
  const sufixo = rotulos.at(-1);
  if (rotulos.length < 2 || sufixo === undefined || !SUFIXO.test(sufixo)) return null;
  return rotulos.every((rotulo) => ROTULO.test(rotulo)) ? email : null;
}

export function ehEmailValido(texto: string): boolean {
  return normalizarEmail(texto) !== null;
}
