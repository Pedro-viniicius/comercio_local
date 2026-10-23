// Assinante de `SegundoFatorFreado` (S92, P16; plano 01b, etapa 13): avisa o
// dono da conta que o freio de segundo fator entrou em espera por tentativas
// erradas do código do app autenticador. Se a senha foi apagada por isso (o
// freio acionado de novo no nível máximo, ou mais de 20 erros em 24 h, S103;
// `reagirAoFreioDeSegundoFator`), o aviso manda recuperar a senha pelo e-mail.
// O nome só vai na saudação se o e-mail da conta já foi verificado (S102).
//
// O evento leva só o id: a senha apagada é lida da conta na entrega
// (`senha_hash` nulo). Conta que não existe mais ou saiu de `ativa` não recebe
// nada. Um aviso por espera: o freio não entra em outra espera enquanto a
// atual dura.
import { Injectable } from '@nestjs/common';
import { EnviadorDeEmail } from '../../../../compartilhado/email/enviador-de-email.ts';
import type { Assinante, EventoPublicado } from '../../../../compartilhado/eventos/assinantes.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import { RepositorioDeContas } from '../../dominio/repositorios.ts';
import { lerPayload, nomeNaSaudacao, tipoDoEvento } from './comum.ts';
import { ModelosDeEmailDaIdentidade } from './modelos-de-email.ts';

@Injectable()
export class AvisarSegundoFatorFreadoAssinante implements Assinante {
  readonly nome = 'identidade.avisar-segundo-fator-freado';
  readonly eventos = [tipoDoEvento('SegundoFatorFreado')];

  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly contas: RepositorioDeContas,
    private readonly modelos: ModelosDeEmailDaIdentidade,
    private readonly enviador: EnviadorDeEmail,
  ) {}

  async tratar(evento: EventoPublicado): Promise<void> {
    const { contaId } = lerPayload('SegundoFatorFreado', evento);
    await this.unidade.executar(async () => {
      const conta = await this.contas.buscarPorId(contaId);
      if (conta?.status !== 'ativa') return;
      await this.enviador.enviar({
        para: conta.email.valor,
        ...this.modelos.segundoFatorFreado({
          nome: nomeNaSaudacao(conta),
          senhaRemovida: conta.senhaHash === null,
        }),
      });
    });
  }
}
