// Ponto único de entrada do zod neste pacote.
//
// Locale: o zod 4 registra o inglês como padrão na primeira construção de um
// esquema, mas uma chamada explícita de `z.config` vale em qualquer ordem
// (node_modules/zod/src/v4/classic/schemas.ts). Por isso o `z.config` abaixo
// roda quando este módulo é carregado, e todo arquivo do pacote importa `z`
// DAQUI, nunca de 'zod'. Assim nenhum esquema de `@bairrin/contratos` nasce
// antes da configuração. Como a configuração é global do zod, consumidores que
// importam 'zod' direto herdam o ptBR depois que o pacote é carregado, desde
// que haja uma única cópia do zod no monorepo (catálogo do pnpm).
//
// Este módulo tem efeito colateral e o bundler não pode descartá-lo. Se algum dia o pacote ganhar `"sideEffects": false`, liste este arquivo.
import { z } from 'zod';

/** Motivo para campo ausente ou texto vazio. O `problema.ts` o usa para achar o código `obrigatorio`. */
export const MOTIVO_OBRIGATORIO = 'Campo obrigatório.';
/** Motivo para campo que o esquema estrito não conhece. */
export const MOTIVO_DESCONHECIDO = 'Campo desconhecido.';

const ptBR = z.locales.ptBR();

z.config({
  localeError: (issue) => {
    if (issue.code === 'invalid_type' && issue.input === undefined) {
      return MOTIVO_OBRIGATORIO;
    }
    if (
      issue.code === 'too_small' &&
      issue.origin === 'string' &&
      issue.inclusive &&
      issue.minimum === 1
    ) {
      return MOTIVO_OBRIGATORIO;
    }
    if (issue.code === 'unrecognized_keys') {
      return MOTIVO_DESCONHECIDO;
    }
    return ptBR.localeError(issue);
  },
});

export { z };

/** O texto tem pelo menos um caractere (depois do corte, se o esquema corta). */
export function ehTextoPreenchido(texto: string): boolean {
  return texto.length > 0;
}

/**
 * Opções do check de texto obrigatório: `.refine(ehTextoPreenchido, CAMPO_OBRIGATORIO)`.
 * O campo vazio sai com o código `obrigatorio` e a validação dele para ali.
 *
 * Os esquemas de texto deste pacote usam este `refine`, e não `.min(1)`, nem
 * `.max(n)` ou `.length(n)`: os checks de tamanho do zod rodam também em valor
 * que não é texto mas tem `length` (`[]`, `{"length": 0}`), mesmo depois do
 * erro de tipo, e o campo sairia com dois erros (Q14). Um `refine` não roda
 * depois do erro de tipo.
 */
export const CAMPO_OBRIGATORIO = { error: MOTIVO_OBRIGATORIO, abort: true } as const;

/**
 * Objeto que recusa campo desconhecido (CA-13). Todo esquema de corpo ou de
 * consulta HTTP usa esta função, não `z.object`. Respostas lidas por clientes
 * antigos usam `z.object`, para tolerar campos novos do servidor.
 */
export function objetoEstrito<Forma extends z.core.$ZodShape>(forma: Forma) {
  return z.strictObject(forma);
}
