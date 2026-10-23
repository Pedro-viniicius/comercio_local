// A sessão na borda HTTP da Identidade (plano 01b, etapa 16; ADR-012, S9, S16,
// S80): o corpo da sessão nos apps e o cookie do painel.
//
// - Apps: `tokenRenovacao` vai no corpo, com `tokenAcesso`, `expiraEm` e
//   `emailVerificado` (`sessaoSchema`).
// - Painel: o token de renovação vai só no cookie `HttpOnly; Secure;
//   SameSite=Strict`, com `Path` só da renovação (o logout do painel é `DELETE`
//   no mesmo caminho, S80), e nunca no corpo; o de acesso fica só na memória do
//   painel. A renovação e o logout pelo cookie exigem `X-Cliente: painel` e a
//   origem do painel (`Origin` na lista do CORS), contra CSRF.
// Respostas com `Cache-Control: no-store` (S17, `configurarAplicacao`).
import type { Sessao } from '@bairrin/contratos';
import { CABECALHO_DO_CLIENTE, tokenSchema } from '@bairrin/contratos';
import type { Cliente } from '@bairrin/contratos/validadores';
import type { CookieOptions, Request, Response } from 'express';
import type { SessaoEmitida } from '../aplicacao/comum/sessao-emitida.ts';
import { DURACAO_MAXIMA_NO_PAINEL_EM_MS } from '../dominio/sessao.ts';

/** Nome do cookie com o token de renovação do painel. */
export const COOKIE_DE_RENOVACAO = 'bairrin_renovacao';

/** Único caminho que recebe o cookie: renovação (POST) e logout do painel (DELETE). */
export const CAMINHO_DO_COOKIE = '/v1/sessoes/renovacao';

/** Valor de `X-Cliente` do painel. */
export const CLIENTE_DO_PAINEL = 'painel';

const OPCOES_DO_COOKIE: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: CAMINHO_DO_COOKIE,
};

/**
 * Monta o corpo da sessão. No painel, grava o cookie e tira o token de
 * renovação do corpo. O cookie vive até o teto de 12 h da sessão do painel; a
 * inatividade de 30 min é conferida no servidor (S9).
 */
export function corpoDaSessao(res: Response, sessao: SessaoEmitida, cliente: Cliente): Sessao {
  const corpo = {
    tokenAcesso: sessao.tokenAcesso,
    expiraEm: sessao.expiraEm.toISOString(),
    emailVerificado: sessao.emailVerificado,
  };
  if (cliente !== CLIENTE_DO_PAINEL) return { ...corpo, tokenRenovacao: sessao.tokenRenovacao };
  res.cookie(COOKIE_DE_RENOVACAO, sessao.tokenRenovacao, {
    ...OPCOES_DO_COOKIE,
    maxAge: DURACAO_MAXIMA_NO_PAINEL_EM_MS,
  });
  return corpo;
}

/** Apaga o cookie do painel (mesmo nome, `Path` e atributos). */
export function apagarCookieDeRenovacao(res: Response): void {
  res.clearCookie(COOKIE_DE_RENOVACAO, OPCOES_DO_COOKIE);
}

/** O token do cookie do painel, ou `null` se ausente ou fora do formato de token. */
export function tokenDoCookie(req: Request): string | null {
  const cookies: unknown = req.cookies;
  if (typeof cookies !== 'object' || cookies === null) return null;
  const valor: unknown = (cookies as Record<string, unknown>)[COOKIE_DE_RENOVACAO];
  const lido = tokenSchema.safeParse(valor);
  return lido.success ? lido.data : null;
}

/** A requisição se diz do painel (`X-Cliente: painel`). */
export function dizSerDoPainel(req: Request): boolean {
  return req.get(CABECALHO_DO_CLIENTE) === CLIENTE_DO_PAINEL;
}

/**
 * A requisição do painel veio da origem do painel: `Origin` presente e na
 * lista do CORS. O navegador sempre manda `Origin` no `fetch` entre origens e
 * em `POST`/`DELETE`; um formulário de outro site não consegue pôr `X-Cliente`
 * sem a pré-verificação do CORS, que recusa a origem fora da lista.
 */
export function origemDoPainel(req: Request, origensAceitas: readonly string[]): boolean {
  const origem = req.get('Origin');
  return origem !== undefined && origensAceitas.includes(origem);
}
