// Contratos de sessão (01b, ADR-012): entrar, renovar e o formato da sessão.
// `CLIENTES` e `ETAPAS_DO_DESAFIO` ficam em `validadores/identidade.ts`, onde o
// domínio da API também os importa.
import { CLIENTES, ETAPAS_DO_DESAFIO } from '../validadores/index.ts';
import { CAMPO_OBRIGATORIO, ehTextoPreenchido, objetoEstrito, z } from '../zod.ts';
import { emailSchema, senhaAtualSchema } from './contas.ts';

/** Cabeçalho que o painel manda na renovação por cookie (`X-Cliente: painel`). */
export const CABECALHO_DO_CLIENTE = 'X-Cliente';

const TAMANHO_MAXIMO_DO_TOKEN = 512;
/** base64url, com `.` para o JWT e para um prefixo de versão. */
const FORMATO_DO_TOKEN = /^[A-Za-z0-9._-]+$/;
export const MOTIVO_TOKEN_INVALIDO = 'Token inválido';

/**
 * Token opaco recebido do cliente (renovação e desafio do 2FA). Só o formato;
 * quem decide se vale é a API. O motivo nunca repete o valor.
 */
export const tokenSchema = z
  .string()
  .refine(ehTextoPreenchido, CAMPO_OBRIGATORIO)
  .refine((token) => token.length <= TAMANHO_MAXIMO_DO_TOKEN, {
    error: MOTIVO_TOKEN_INVALIDO,
    abort: true,
  })
  .regex(FORMATO_DO_TOKEN, { error: MOTIVO_TOKEN_INVALIDO });

/**
 * `POST /v1/sessoes` (público). Aceita conta com e-mail não verificado
 * (P1-dono). Respostas: 200 com `respostaDeEntrarSchema`; 403
 * `sem_acesso_painel` (S23); 401 com mensagem única e 429 com `Retry-After`
 * (CA-04).
 */
export const entrarSchema = objetoEstrito({
  email: emailSchema,
  senha: senhaAtualSchema,
  cliente: z.enum(CLIENTES),
});
export type Entrar = z.infer<typeof entrarSchema>;

/**
 * Sessão devolvida ao cliente. `expiraEm` é o fim do token de acesso (15 min),
 * em ISO 8601: a API manda em UTC (`Z`), e o cliente também aceita data com
 * deslocamento (`-03:00`), para não recusar a sessão se o servidor mudar o
 * formato (R32). `emailVerificado` serve só para a interface (P1-dono): o
 * que exige verificação confere no servidor. `tokenRenovacao` não vem para o
 * painel, que o recebe em cookie `HttpOnly`. Respostas com `Cache-Control:
 * no-store` (S17).
 */
export const sessaoSchema = z.object({
  tokenAcesso: z.string(),
  expiraEm: z.iso.datetime({ offset: true }),
  emailVerificado: z.boolean(),
  tokenRenovacao: z.string().optional(),
});
export type Sessao = z.infer<typeof sessaoSchema>;

/** Desafio pós-senha do admin no painel (S1): vale 5 min e 5 tentativas. */
export const desafioDeSegundoFatorSchema = z.object({
  etapa: z.enum(ETAPAS_DO_DESAFIO),
  desafio: z.string(),
});
export type DesafioDeSegundoFator = z.infer<typeof desafioDeSegundoFatorSchema>;

/** Resposta de `POST /v1/sessoes`: a sessão ou, no painel, o desafio do 2FA. */
export const respostaDeEntrarSchema = z.union([sessaoSchema, desafioDeSegundoFatorSchema]);
export type RespostaDeEntrar = z.infer<typeof respostaDeEntrarSchema>;

/**
 * Cliente que renova pelo corpo: só os apps. O painel renova pelo cookie, então
 * `painel` no corpo é recusado.
 */
export const clienteDoAppSchema = z.enum(CLIENTES).exclude(['painel']);
export type ClienteDoApp = z.infer<typeof clienteDoAppSchema>;

/**
 * `POST /v1/sessoes/renovacao` (público) nos apps, com o token de renovação e o
 * `cliente` do app. A API compara o `cliente` desta requisição, nunca o da
 * sessão, para devolver o par da tolerância de 60 s (S16); entre os dois apps
 * ele só recusa engano. O painel manda o cookie e o cabeçalho `X-Cliente:
 * painel`, com corpo vazio (`corpoVazioSchema`). Respostas: 200 com
 * `sessaoSchema`; 400 com o corpo fora do contrato; 401 com a credencial
 * inválida, vencida, revogada ou reusada (nunca 5xx).
 *
 * Logout, sem corpo nos dois sentidos. Apps: `DELETE /v1/sessoes/atual` com
 * o Bearer revoga a sessão inteira e responde 204, também se ela já estava
 * revogada (401 só da guarda, com o Bearer inválido). Painel: `DELETE
 * /v1/sessoes/renovacao` (público), com o cookie e `X-Cliente: painel`,
 * revoga a sessão do cookie, se houver, apaga o cookie e responde 204 sempre
 * (S80).
 */
export const renovarSessaoSchema = objetoEstrito({
  tokenRenovacao: tokenSchema,
  cliente: clienteDoAppSchema,
});
export type RenovarSessao = z.infer<typeof renovarSessaoSchema>;
