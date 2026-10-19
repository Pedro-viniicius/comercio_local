// A sessão que os casos de uso entregam à camada HTTP (A-R4: uma definição só,
// usada pelo cadastro, pelo login, pela renovação e pelo segundo fator).

/**
 * Sessão emitida, na forma de `sessaoSchema` (`@bairrin/contratos`). A camada
 * HTTP (etapa 16) devolve `tokenAcesso`, `expiraEm` e `emailVerificado` no
 * corpo; o `tokenRenovacao` vai no corpo nos apps e só no cookie `HttpOnly` no
 * painel.
 */
export interface SessaoEmitida {
  readonly tokenAcesso: string;
  /** Fim do token de acesso (15 min). */
  readonly expiraEm: Date;
  readonly emailVerificado: boolean;
  readonly tokenRenovacao: string;
}
