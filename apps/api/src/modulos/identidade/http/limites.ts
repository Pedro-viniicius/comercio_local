// Limites de requisições das rotas da Identidade (plano 01b, "Limites" e etapa
// 16; S14, S82, S100). Conferidos pela guarda `LimitePorRotaGuard` antes do
// pipe de validação; o excesso recebe 429 com `Retry-After`, a mesma resposta
// do freio (CA-04). O freio por e-mail e por origem dos casos de uso continua
// valendo por baixo: estes limites só cortam o volume.
//
// O limite por origem é a mitigação aceita pelo dono para o S100 (descobrir se
// um e-mail tem conta cadastrando-o e entrando com a senha escolhida): o
// cadastro fica em 10 por hora por IP. IPv6 conta por /64 (S14).
import type { LimiteDaRota } from '../../../compartilhado/http/limite-por-rota.guard.ts';

const QUINZE_MINUTOS_EM_MS = 15 * 60 * 1000;
const UMA_HORA_EM_MS = 60 * 60 * 1000;

export const LIMITES_DA_IDENTIDADE = {
  /** `POST /v1/contas`: 10 por hora por IP. */
  cadastroPorIp: { nome: 'cadastro-ip', por: 'ip', limite: 10, janelaEmMs: UMA_HORA_EM_MS },
  /**
   * `POST /v1/sessoes`: 100 em 15 min por IP, acima do freio por origem (50
   * falhas em 15 min), para o freio responder primeiro às senhas erradas e
   * sobrar folga para quem divide o IP da operadora (CGNAT).
   */
  entrarPorIp: { nome: 'entrar-ip', por: 'ip', limite: 100, janelaEmMs: QUINZE_MINUTOS_EM_MS },
  /** `POST /v1/conta/verificacao-email/reenvio`: 3 por hora por conta (a rota não recebe e-mail). */
  reenvioPorConta: { nome: 'reenvio-conta', por: 'conta', limite: 3, janelaEmMs: UMA_HORA_EM_MS },
  /** `POST /v1/conta/verificacao-email/reenvio`: 10 por hora por IP. */
  reenvioPorIp: { nome: 'reenvio-ip', por: 'ip', limite: 10, janelaEmMs: UMA_HORA_EM_MS },
  /** `POST /v1/senha/recuperacao`: 3 por hora por e-mail. */
  recuperacaoPorEmail: {
    nome: 'recuperacao-email',
    por: 'email',
    limite: 3,
    janelaEmMs: UMA_HORA_EM_MS,
  },
  /** `POST /v1/senha/recuperacao`: 10 por hora por IP. */
  recuperacaoPorIp: { nome: 'recuperacao-ip', por: 'ip', limite: 10, janelaEmMs: UMA_HORA_EM_MS },
  /**
   * `POST /v1/senha/redefinicao`: 20 em 15 min por IP. O Argon2 da senha nova
   * roda antes do freio (o tempo não separa e-mail com e sem conta); este
   * limite segura o custo.
   */
  redefinicaoPorIp: {
    nome: 'redefinicao-ip',
    por: 'ip',
    limite: 20,
    janelaEmMs: QUINZE_MINUTOS_EM_MS,
  },
} as const satisfies Record<string, LimiteDaRota>;
