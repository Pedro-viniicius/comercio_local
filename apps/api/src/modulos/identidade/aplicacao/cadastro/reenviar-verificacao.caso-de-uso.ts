// Reenvio do código de verificação (`POST /v1/conta/verificacao-email/reenvio`,
// com sessão; CA-01; P1-dono; plano 01b, etapa 8).
//
// Vale para a conta da sessão e responde sempre igual (202). Só publica
// `VerificacaoReenviada` para conta ativa e ainda não verificada; o assinante
// (etapa 13) invalida os códigos vigentes, gera o novo no envio e o manda para
// `contas.email_normalizado`, lido pelo id. Nenhum código nem e-mail passa por
// aqui. Os limites (3/h por e-mail, 10/h por IP) são da rota (etapa 16).
import { Injectable } from '@nestjs/common';
import { PublicadorDeEventos } from '../../../../compartilhado/eventos/publicador.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import { RepositorioDeContas } from '../../dominio/repositorios.ts';
import { eventoDeIdentidade } from '../eventos.ts';

export interface EntradaDeReenviarVerificacao {
  /** Conta do token de acesso (`sub`). */
  readonly contaId: string;
}

@Injectable()
export class ReenviarVerificacaoCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly publicador: PublicadorDeEventos,
    private readonly contas: RepositorioDeContas,
  ) {}

  /** Resolve igual com ou sem envio: conta verificada, desativada ou apagada não recebe nada. */
  async executar({ contaId }: EntradaDeReenviarVerificacao): Promise<void> {
    await this.unidade.executar(async () => {
      const conta = await this.contas.buscarPorId(contaId);
      if (conta?.status !== 'ativa' || conta.emailVerificado) return;
      await this.publicador.publicar(
        eventoDeIdentidade('VerificacaoReenviada', { contaId: conta.id }),
      );
    });
  }
}
