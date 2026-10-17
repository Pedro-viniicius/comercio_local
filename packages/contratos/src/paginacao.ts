// Paginação por cursor (`?cursor=&limite=`, máximo 20, CA-39).
import { CAMPO_OBRIGATORIO, ehTextoPreenchido, objetoEstrito, z } from './zod.ts';

export const LIMITE_MAXIMO_DA_PAGINA = 20;
export const LIMITE_PADRAO_DA_PAGINA = 20;
const TAMANHO_MAXIMO_DO_CURSOR = 512;
export const MOTIVO_CURSOR_INVALIDO = 'Cursor inválido';

/**
 * Campos de consulta da paginação. Uma rota que também filtra compõe:
 * `objetoEstrito({ ...formaDaPaginacao, status: z.enum([...]).optional() })`.
 * Query string chega como texto, por isso `limite` usa coerção; acima do máximo
 * é recusado (400), não cortado em silêncio.
 */
export const formaDaPaginacao = {
  // `refine`, não `.min`/`.max`: um erro só se vier lista no lugar do texto (Q14, `zod.ts`).
  cursor: z
    .string()
    .refine(ehTextoPreenchido, CAMPO_OBRIGATORIO)
    .refine((cursor) => cursor.length <= TAMANHO_MAXIMO_DO_CURSOR, {
      error: MOTIVO_CURSOR_INVALIDO,
    })
    .optional(),
  limite: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITE_MAXIMO_DA_PAGINA)
    .default(LIMITE_PADRAO_DA_PAGINA),
};

export const consultaPaginadaSchema = objetoEstrito(formaDaPaginacao);
export type ConsultaPaginada = z.infer<typeof consultaPaginadaSchema>;

/**
 * Resposta paginada. `proximoCursor` é `null` na última página. O cursor é
 * opaco para o cliente: ele só o devolve, sem interpretar.
 */
export function paginaSchema<Item extends z.ZodType>(itemSchema: Item) {
  return z.object({
    itens: z.array(itemSchema).max(LIMITE_MAXIMO_DA_PAGINA),
    proximoCursor: z.string().nullable(),
  });
}
export type Pagina<Item> = { itens: Item[]; proximoCursor: string | null };
