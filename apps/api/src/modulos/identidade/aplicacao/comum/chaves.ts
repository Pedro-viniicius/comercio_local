// HMACs que mais de um caso de uso da Identidade precisa calcular igual (A-R4):
// a chave do freio por e-mail (login, redefinição e exclusão somam no mesmo
// freio, S14) e o hash do token de renovação (cadastro, login, renovação,
// logout e segundo fator acham a mesma sessão).
//
// O banco guarda só o HMAC (`bloqueios_login.chave_hmac`, `sessoes.token_hash`);
// o e-mail e o token em claro não saem daqui.
import type { Email } from '../../dominio/email.ts';
import type { Cifrador } from '../portas/cifrador.ts';

/**
 * Chave do freio por e-mail, do e-mail normalizado. Login e redefinição a
 * calculam antes de ler a conta (o e-mail sem conta também tem freio, S14); a
 * exclusão, com `conta.email`.
 */
export function chaveDoFreioPorEmail(cifrador: Cifrador, email: Email): string {
  return cifrador.hmac('bloqueio_email', [email.valor]);
}

/** HMAC do token de renovação, como o guardam a sessão e o histórico de tokens usados. */
export function hashDoTokenDeRenovacao(cifrador: Cifrador, token: string): string {
  return cifrador.hmac('token_renovacao', [token]);
}
