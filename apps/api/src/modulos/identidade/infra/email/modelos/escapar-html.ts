// Escape de texto para o HTML dos e-mails (S73). Todo valor interpolado no
// HTML (o nome da conta, o código, datas) passa por aqui, inclusive dentro de
// atributo: os cinco caracteres que abrem tag, entidade ou atributo viram
// entidades. O texto puro do e-mail não passa por aqui.

const ENTIDADES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** O texto com `& < > " '` trocados pelas entidades; o resto fica igual. */
export function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (caractere) => ENTIDADES[caractere] ?? caractere);
}
