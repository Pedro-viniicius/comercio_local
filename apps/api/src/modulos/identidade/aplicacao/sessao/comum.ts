// Peça comum aos casos de uso de sessão (plano 01b, etapa 9): a chave do freio
// por origem do login (CA-04, S14). A chave por e-mail e o HMAC do token de
// renovação ficam em `aplicacao/comum/chaves.ts`, com os outros casos de uso
// que os usam (A-R4).
//
// O banco guarda só o HMAC da chave (`bloqueios_login.chave_hmac`); o IP em
// claro não sai daqui.
import { valorDaChaveDeOrigem } from '../../dominio/bloqueio-de-login.ts';
import type { Cifrador } from '../portas/cifrador.ts';

/**
 * Valor da chave do freio por origem quando a requisição não traz IP, ou traz
 * um texto que não é IP (S14, revisão do grupo B). Falha fechada: todas essas
 * requisições dividem um freio só, em vez de pular o freio. Não colide com um
 * IP, que sempre vira `ipv4:...` ou `ipv6:...` (`valorDaChaveDeOrigem`).
 */
export const ORIGEM_DESCONHECIDA = 'origem:desconhecida';

/**
 * Chave do freio por origem: o IPv4, ou o /64 do IPv6 (`valorDaChaveDeOrigem`);
 * sem IP válido, `ORIGEM_DESCONHECIDA`.
 */
export function chaveDoFreioPorOrigem(cifrador: Cifrador, ip: string | null | undefined): string {
  const valor = typeof ip === 'string' ? valorDaChaveDeOrigem(ip) : null;
  return cifrador.hmac('bloqueio_ip', [valor ?? ORIGEM_DESCONHECIDA]);
}
