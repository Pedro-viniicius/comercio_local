// Nome como a pessoa quer ser chamada: normalização e regra. Função pura, sem
// zod: o domínio da API a usa pelo subcaminho `@bairrin/contratos/validadores`
// (ADR-003), e o `nomeSchema` usa as mesmas funções.

export const TAMANHO_MAXIMO_DO_NOME = 80;

export const MOTIVO_NOME_LONGO = 'Use até 80 caracteres';
export const MOTIVO_NOME_COM_CARACTERE_INVALIDO =
  'Confira o nome: tem caractere que não pode ser usado';

export type ProblemaDoNome = 'vazio' | 'longo' | 'caractere_proibido';

/**
 * Controle (quebra de linha, tabulação...), formatação invisível, separador de
 * linha e de parágrafo, metade de par substituto solta, uso privado, ponto de
 * código não atribuído (R31, S73), o Braille em branco (U+2800) e caractere
 * ignorável por padrão, que não aparece na tela: o preenchimento Hangul
 * (U+3164, U+115F), o CGJ (U+034F) e os seletores de variante. U+FE0E e
 * U+FE0F, que escolhem entre emoji e texto (`❤️`), ficam de fora daqui e são
 * conferidos por `SELETOR_SEM_BASE`.
 */
const CARACTERE_PROIBIDO_NO_NOME =
  /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Cn}\u2800]|(?![\uFE0E\uFE0F])\p{Default_Ignorable_Code_Point}/u;

/**
 * Seletor de apresentação sem caractere visível antes: no começo, depois de
 * espaço ou depois de outro seletor (S84). Logo depois de uma letra, número ou
 * emoji (`❤️`, `1️⃣`, `☺︎`), ele é aceito.
 */
const SELETOR_SEM_BASE = /(?:^|[\s\uFE0E\uFE0F])[\uFE0E\uFE0F]/u;

/**
 * O nome precisa ter algo que se veja e identifique: letra, número, emoji ou
 * bandeira (S84). Um nome só de símbolos invisíveis ou de seletores é recusado.
 */
const CARACTERE_VISIVEL = /[\p{L}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator}]/u;

/** NFC e sem espaço nas pontas: é a forma guardada e comparada. */
export function normalizarNome(texto: string): string {
  return texto.normalize('NFC').trim();
}

/**
 * O que impede o nome já normalizado (`normalizarNome`), ou `null` se ele é
 * aceito. Até 80 pontos de código: um emoji conta como um. Nome sem letra,
 * número nem emoji visível é `caractere_proibido`.
 */
export function problemaDoNome(nome: string): ProblemaDoNome | null {
  if (nome.length === 0) return 'vazio';
  if ([...nome].length > TAMANHO_MAXIMO_DO_NOME) return 'longo';
  const proibido =
    CARACTERE_PROIBIDO_NO_NOME.test(nome) ||
    SELETOR_SEM_BASE.test(nome) ||
    !CARACTERE_VISIVEL.test(nome);
  return proibido ? 'caractere_proibido' : null;
}
