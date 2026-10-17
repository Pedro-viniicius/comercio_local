// Contratos de recuperação e redefinição de senha (01b, CA-05, CA-06).
import { objetoEstrito, z } from '../zod.ts';
import { codigoSchema, emailSchema, senhaNovaSchema } from './contas.ts';

/**
 * `POST /v1/senha/recuperacao` (público). Resposta: 202 sem corpo, sempre,
 * exista ou não conta com o e-mail (CA-06). O código vale 30 min e uma vez.
 */
export const solicitarRecuperacaoSchema = objetoEstrito({ email: emailSchema });
export type SolicitarRecuperacao = z.infer<typeof solicitarRecuperacaoSchema>;

/**
 * `POST /v1/senha/redefinicao` (público). A senha nova segue a mesma regra do
 * cadastro (S22). Resposta: 204; a redefinição verifica o e-mail e revoga
 * todas as sessões da conta (CA-05, P1-dono).
 */
export const redefinirSenhaSchema = objetoEstrito({
  email: emailSchema,
  codigo: codigoSchema,
  novaSenha: senhaNovaSchema,
});
export type RedefinirSenha = z.infer<typeof redefinirSenhaSchema>;
