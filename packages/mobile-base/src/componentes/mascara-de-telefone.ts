// Máscara `(99) 99999-9999` aplicada enquanto a pessoa digita (design system, "Campos").
// Função pura. Aceita colar com ou sem máscara, com `+55`, `55` ou o zero de discagem na frente;
// a validação de verdade (DDD existente, nono dígito) é do contrato (`normalizarCelular`).

const TAMANHO_MAXIMO = 11;

/** Só os algarismos do celular (DDD + número), sem código do país nem zero de discagem. */
export function digitosDoCelular(entrada: string): string {
  const texto = entrada.trim();
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

/** Texto digitado ou colado → `(35) 99999-1234`, aos poucos. Sem dígito, texto vazio. */
export function mascararTelefone(entrada: string): string {
  const digitos = digitosDoCelular(entrada);
  if (digitos.length === 0) return '';
  if (digitos.length <= 2) return `(${digitos}`;
  const ddd = digitos.slice(0, 2);
  const numero = digitos.slice(2);
  if (numero.length <= 5) return `(${ddd}) ${numero}`;
  return `(${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
}
