// Porta da autenticação das rotas (plano 01b, etapa 16; S7, S8). A guarda
// global `Autenticado` (`compartilhado/http/autenticacao/`) não pode importar
// `modulos/` (o núcleo não depende de contexto), então pergunta a esta porta,
// implementada pela Identidade (`modulos/identidade/infra/`), quem é o dono do
// token de acesso. Classe abstrata, para o Nest usá-la como token de injeção.
//
// O token chega como veio no cabeçalho `Authorization: Bearer`, já conferido
// quanto ao tamanho e ao formato pela guarda. Nenhum método lança por token
// ruim: recusa é `null`, sem motivo, para a guarda responder 401 igual em todos
// os casos.
import type { Perfil } from '@bairrin/contratos/validadores';

/** Quem fez a requisição, como as rotas autenticadas o recebem (`@ContaAtual()`). */
export interface ContaAutenticada {
  /** `sub` do token. */
  readonly contaId: string;
  /** Sessão do token (`sid`). */
  readonly sid: string;
  /**
   * Perfis do token que a conta ainda tem. `admin` só aparece em sessão do
   * painel com segundo fator (S1).
   */
  readonly perfis: readonly Perfil[];
  /** A sessão passou pelo segundo fator (só no painel). */
  readonly mfa: boolean;
  /** Só para a interface (P1-dono): quem exige verificação confere no banco. */
  readonly emailVerificado: boolean;
}

export interface OpcoesDaVerificacao {
  /**
   * Confere também a sessão do `sid` (não revogada nem vencida). Vale para
   * `/v1/admin` (S8): nas outras rotas, só `contas.status`, e o token de
   * acesso de uma sessão encerrada segue valendo até o fim dos 15 min.
   */
  readonly conferirSessao: boolean;
}

export abstract class VerificadorDeAcesso {
  /**
   * A conta do token, ou `null` quando o token não vale (assinatura, prazo,
   * emissor ou forma), a conta não está `ativa` ou, com `conferirSessao`, a
   * sessão foi revogada, venceu ou é de outra conta.
   */
  abstract verificar(token: string, opcoes: OpcoesDaVerificacao): Promise<ContaAutenticada | null>;
}
