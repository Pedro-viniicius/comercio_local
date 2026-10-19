// Logout (CA-05, S8, S80; plano 01b, etapa 9), por um de dois caminhos:
// - apps: `DELETE /v1/sessoes/atual`, com o `sid` e a conta do token de acesso
//   que a guarda já conferiu;
// - painel: `DELETE /v1/sessoes/renovacao`, com o token de renovação do cookie
//   (o painel guarda o token de acesso só em memória e, depois de recarregar,
//   não tem Bearer).
//
// Revoga a sessão com `logout`, na hora e no servidor: o token de renovação
// deixa de valer, e a guarda das rotas de admin recusa o `sid` (S8).
// Idempotente e sem erro: sessão já revogada fica com a primeira revogação
// (`RepositorioDeSessoes.atualizar` usa `coalesce`), e `sid` de outra conta ou
// token desconhecido não fazem nada (a rota responde 204 sempre). Token antigo
// achado só no histórico da família (S77) revoga o que ainda vive da família:
// quem pede para sair com um cookie velho sai do mesmo jeito.
import { Injectable } from '@nestjs/common';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import { RepositorioDeSessoes } from '../../dominio/repositorios.ts';
import type { Sessao } from '../../dominio/sessao.ts';
import { hashDoTokenDeRenovacao } from '../comum/chaves.ts';
import { Cifrador } from '../portas/cifrador.ts';

/** Pelo token de acesso (`sub` e `sid`) ou pelo token de renovação do cookie. */
export type EntradaDeEncerrarSessao =
  { readonly contaId: string; readonly sid: string } | { readonly tokenRenovacao: string };

@Injectable()
export class EncerrarSessaoCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly relogio: Relogio,
    private readonly sessoes: RepositorioDeSessoes,
    private readonly cifrador: Cifrador,
  ) {}

  /** Resolve igual em todos os casos: sessão revogada, já revogada ou inexistente. */
  async executar(entrada: EntradaDeEncerrarSessao): Promise<void> {
    const agora = this.relogio.agora();
    await this.unidade.executar(async () => {
      if ('sid' in entrada) {
        const sessao = await this.sessoes.buscarPorId(entrada.sid);
        if (sessao?.contaId === entrada.contaId) await this.#revogar(sessao, agora);
        return;
      }
      const tokenHash = hashDoTokenDeRenovacao(this.cifrador, entrada.tokenRenovacao);
      const sessao = await this.sessoes.buscarPorTokenHash(tokenHash);
      if (sessao !== null) {
        await this.#revogar(sessao, agora);
        return;
      }
      const usado = await this.sessoes.buscarTokenUsado(tokenHash);
      if (usado !== null) await this.sessoes.revogarDaFamilia(usado.familiaId, 'logout', agora);
    });
  }

  async #revogar(sessao: Sessao, agora: Date): Promise<void> {
    if (sessao.revogada) return;
    sessao.revogar('logout', agora);
    await this.sessoes.atualizar(sessao);
  }
}
