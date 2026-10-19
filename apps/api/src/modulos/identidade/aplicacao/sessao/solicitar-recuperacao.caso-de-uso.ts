// Pedido de recuperação de senha (`POST /v1/senha/recuperacao`, público;
// CA-06; plano 01b, etapa 9).
//
// Responde sempre igual (202), exista ou não conta com o e-mail. Só publica
// `RecuperacaoSolicitada` para conta ativa, inclusive a do admin criada pela
// CLI sem senha, que define a primeira senha por aqui (etapa 13). O assinante
// (etapa 13) invalida os códigos de recuperação vigentes, gera o novo no envio
// (30 min, uso único, 5 tentativas) e o manda para `contas.email_normalizado`,
// lido pelo id do evento. Nenhum código nem e-mail passa por aqui, e o evento
// leva só o id. Os limites (3/h por e-mail, 10/h por IP) são da rota (etapa 16).
import { Injectable } from '@nestjs/common';
import { PublicadorDeEventos } from '../../../../compartilhado/eventos/publicador.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import { Email } from '../../dominio/email.ts';
import { RepositorioDeContas } from '../../dominio/repositorios.ts';
import { eventoDeIdentidade } from '../eventos.ts';

/** Corpo já validado por `solicitarRecuperacaoSchema`: e-mail normalizado. */
export interface EntradaDeSolicitarRecuperacao {
  readonly email: string;
}

@Injectable()
export class SolicitarRecuperacaoCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly publicador: PublicadorDeEventos,
    private readonly contas: RepositorioDeContas,
  ) {}

  /** Resolve igual com ou sem envio: e-mail sem conta, ou conta fora de `ativa`, não recebe nada. */
  async executar(entrada: EntradaDeSolicitarRecuperacao): Promise<void> {
    // O contrato já normalizou; um e-mail inválido aqui é rota sem validação.
    const email = Email.criar(entrada.email);
    await this.unidade.executar(async () => {
      const conta = await this.contas.buscarPorEmail(email);
      if (conta?.status !== 'ativa') return;
      await this.publicador.publicar(
        eventoDeIdentidade('RecuperacaoSolicitada', { contaId: conta.id }),
      );
    });
  }
}
