// Celular brasileiro com DDD: normalização para E.164 (`+55` + DDD + 9 dígitos).
// Função pura, sem zod (ADR-003). Sem verificação por SMS no MVP (CA-01).

/** DDDs em uso no Brasil (Anatel, 67 códigos). */
// prettier-ignore
export const DDDS_VALIDOS: ReadonlySet<string> = new Set([
  // SP
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  // RJ e ES
  '21', '22', '24', '27', '28',
  // MG
  '31', '32', '33', '34', '35', '37', '38',
  // PR e SC
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  // RS
  '51', '53', '54', '55',
  // Centro-Oeste, TO, AC e RO
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  // BA e SE
  '71', '73', '74', '75', '77', '79',
  // PE, AL, PB, RN, CE e PI
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  // PA, AM, RR, AP e MA
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
]);

export const MOTIVO_CELULAR_INVALIDO =
  'Confira o número: use DDD + 9 dígitos, como (35) 99999-1234';

/** Entrada maior que isto nem é examinada (o maior formato aceito tem 19). */
const TAMANHO_MAXIMO_DA_ENTRADA = 25;
/** Só dígitos e a pontuação usual: espaço, parênteses, hífen e ponto; `+` só no início. */
const FORMATO_DA_ENTRADA = /^\+?[0-9 ().-]+$/;

export function ehDddValido(ddd: string): boolean {
  return DDDS_VALIDOS.has(ddd);
}

/**
 * Aceita `(35) 99999-1234`, `35999991234`, `035 99999-1234`, `+55 35 99999-1234`
 * e `5535999991234` e devolve `+5535999991234`. Recusa fixo (sem o 9 depois do
 * DDD), DDD inexistente, outro país e qualquer outro caractere. Devolve `null`
 * se o texto não for um celular aceito.
 */
export function normalizarCelular(texto: string): string | null {
  const entrada = texto.trim();
  if (entrada.length > TAMANHO_MAXIMO_DA_ENTRADA || !FORMATO_DA_ENTRADA.test(entrada)) {
    return null;
  }
  let digitos = entrada.replaceAll(/[^0-9]/g, '');
  if (entrada.startsWith('+')) {
    if (!digitos.startsWith('55')) return null;
    digitos = digitos.slice(2);
  } else if (digitos.length === 13 && digitos.startsWith('55')) {
    digitos = digitos.slice(2);
  } else if (digitos.length === 12 && digitos.startsWith('0')) {
    // Prefixo de discagem de longa distância: `0 35 99999-1234`.
    digitos = digitos.slice(1);
  }
  if (digitos.length !== 11) return null;
  if (!ehDddValido(digitos.slice(0, 2)) || digitos[2] !== '9') return null;
  return `+55${digitos}`;
}

export function ehCelularValido(texto: string): boolean {
  return normalizarCelular(texto) !== null;
}
