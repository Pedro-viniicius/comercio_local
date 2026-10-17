// Contratos de privacidade (01b, CA-10, CA-11, S10).
import { objetoEstrito, z } from '../zod.ts';
import { senhaAtualSchema } from './contas.ts';

/**
 * `GET /v1/privacidade`. `aceitoEm` é a data do aceite da política vigente
 * (`null` se a conta não a aceitou, como o admin criado por CLI);
 * `exportacaoDisponivelAte` é o fim do prazo de 7 dias da cópia pronta e ainda
 * não baixada (`null` se não há). Datas em ISO 8601: a API manda em UTC (`Z`),
 * e o cliente também aceita data com deslocamento (R32).
 */
export const privacidadeSchema = z.object({
  politica: z.object({ versao: z.string(), conteudo: z.string() }),
  termos: z.object({ versao: z.string() }),
  aceitoEm: z.iso.datetime({ offset: true }).nullable(),
  exportacaoDisponivelAte: z.iso.datetime({ offset: true }).nullable(),
});
export type Privacidade = z.infer<typeof privacidadeSchema>;

/**
 * `POST /v1/privacidade/exclusao`, com a senha atual (no freio por e-mail,
 * S14). A exportação (`POST /v1/privacidade/exportacao`) não tem corpo
 * (`corpoVazioSchema`) e responde 202, uma por 24 h; o arquivo sai em `GET
 * /v1/privacidade/exportacao/arquivo` (uso único, 7 dias). Respostas da
 * exclusão: 202, ou 409 `exclusao_com_pendencias` com o aviso de pendências
 * (CA-11).
 */
export const solicitarExclusaoSchema = objetoEstrito({ senha: senhaAtualSchema });
export type SolicitarExclusao = z.infer<typeof solicitarExclusaoSchema>;
