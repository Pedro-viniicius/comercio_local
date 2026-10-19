// Porta do token de acesso (adaptador na etapa 6): JWT HS256 de 15 min
// (`SEGUNDOS_DO_TOKEN_DE_ACESSO`) com `sid`, `iss` e `aud` fixos
// (`bairrin-api`). O adaptador fixa o algoritmo e a validade em cada chamada,
// sem depender do padrão do módulo, e recusa na verificação qualquer outro
// algoritmo (HS512, `none`), outro emissor ou público e token vencido.
import type { ReivindicacoesDoToken } from '../../dominio/sessao.ts';

export interface TokenDeAcesso {
  readonly token: string;
  /** Fim da validade (`exp`). */
  readonly expiraEm: Date;
}

export abstract class EmissorDeJwt {
  /** Assina as claims com `iat` = `agora` e `exp` = `agora` + 15 min. */
  abstract emitir(reivindicacoes: ReivindicacoesDoToken, agora: Date): Promise<TokenDeAcesso>;

  /** As claims do token válido em `agora`; `null` para qualquer token recusado. */
  abstract verificar(token: string, agora: Date): Promise<ReivindicacoesDoToken | null>;
}
