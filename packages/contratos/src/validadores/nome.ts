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
 * linha e de parágrafo, metade de par substituto solta, uso privado e ponto de
 * código não atribuído (R31, S73).
 */
const CARACTERE_PROIBIDO_NO_NOME = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Cn}]/u;

/** NFC e sem espaço nas pontas: é a forma guardada e comparada. */
export function normalizarNome(texto: string): string {
  return texto.normalize('NFC').trim();
}

/**
 * O que impede o nome já normalizado (`normalizarNome`), ou `null` se ele é
 * aceito. Até 80 pontos de código: um emoji conta como um.
 */
export function problemaDoNome(nome: string): ProblemaDoNome | null {
  if (nome.length === 0) return 'vazio';
  if ([...nome].length > TAMANHO_MAXIMO_DO_NOME) return 'longo';
  return CARACTERE_PROIBIDO_NO_NOME.test(nome) ? 'caractere_proibido' : null;
}
