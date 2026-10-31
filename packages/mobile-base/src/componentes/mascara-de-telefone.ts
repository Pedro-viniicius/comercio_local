// Máscara `(99) 99999-9999` aplicada enquanto a pessoa digita (design system, "Campos").
// Função pura. Aceita colar com ou sem máscara, com `+55`, `55` ou o zero de discagem na frente;
// a validação de verdade (DDD existente, nono dígito) é do contrato (`normalizarCelular`). Número
// de outro país (`+` seguido de código que não é 55) não vira celular brasileiro (Q37).

const TAMANHO_MAXIMO = 11;
/** `55` + DDD + número: o maior número que a máscara mostra com o `+` de outro país. */
const TAMANHO_MAXIMO_COM_PAIS = 13;

/**
 * Os algarismos de um número com `+` e código de outro país (`+54 9 11...`), ou `null`. Com o
 * `+` e um `5` só, ainda pode ser o começo do `+55`.
 */
function digitosDeOutroPais(texto: string): string | null {
  if (!texto.startsWith('+')) return null;
  const digitos = texto.replaceAll(/\D/g, '');
  return '55'.startsWith(digitos.slice(0, 2)) ? null : digitos;
}

/**
 * Só os algarismos do celular (DDD + número), sem código do país nem zero de discagem. Número de
 * outro país não é celular do Brasil: texto vazio.
 */
export function digitosDoCelular(entrada: string): string {
  const texto = entrada.trim();
  if (digitosDeOutroPais(texto) !== null) return '';
  let digitos = texto.replaceAll(/\D/g, '');
  if (texto.startsWith('+')) {
    // `+55 35 99999-1234`: o `+` mostra que o 55 é o código do país.
    if (digitos.startsWith('55')) digitos = digitos.slice(2);
  } else if (digitos.length >= 12 && digitos.startsWith('55') && digitos.length <= 13) {
    // `5535999991234` colado sem o `+`.
    digitos = digitos.slice(2);
  } else if (digitos.length === 12 && digitos.startsWith('0')) {
    // Prefixo de discagem de longa distância: `0 35 99999-1234`.
    digitos = digitos.slice(1);
  }
  return digitos.slice(0, TAMANHO_MAXIMO);
}

/**
 * Texto digitado ou colado → `(35) 99999-1234`, aos poucos. Sem dígito, texto vazio. Número de
 * outro país fica como `+` e os algarismos, sem máscara nem DDD inventado, para o contrato recusar.
 */
export function mascararTelefone(entrada: string): string {
  const deOutroPais = digitosDeOutroPais(entrada.trim());
  if (deOutroPais !== null) return `+${deOutroPais.slice(0, TAMANHO_MAXIMO_COM_PAIS)}`;
  const digitos = digitosDoCelular(entrada);
  if (digitos.length === 0) return '';
  if (digitos.length <= 2) return `(${digitos}`;
  const ddd = digitos.slice(0, 2);
  const numero = digitos.slice(2);
  if (numero.length <= 5) return `(${ddd}) ${numero}`;
  return `(${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
}
