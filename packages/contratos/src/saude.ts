// Contrato das rotas de saúde da fundação.
import { z } from './zod.ts';

/** `GET /v1/saude`. `versao` só aparece fora de produção (S24). */
export const saudeSchema = z.object({
  status: z.literal('ok'),
  versao: z.string().optional(),
});
export type Saude = z.infer<typeof saudeSchema>;

/**
 * `GET /v1/saude/pronto`: 200 com este corpo quando o banco responde; do
 * contrário, 503 com `Problema` (código `indisponivel`).
 */
export const prontidaoSchema = z.object({
  status: z.literal('ok'),
});
export type Prontidao = z.infer<typeof prontidaoSchema>;
