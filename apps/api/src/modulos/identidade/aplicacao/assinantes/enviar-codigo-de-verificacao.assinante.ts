// Assinante de `ContaCriada` e `VerificacaoReenviada` (CA-01; P1-dono; plano
// 01b, etapa 13): gera o código de verificação do e-mail na hora do envio e o
// manda para `contas.email_normalizado`, lido pelo id do payload.
//
// Não envia (e não emite) para conta que não existe mais, saiu de `ativa` ou
// já está verificada (o reenvio de uma entrega atrasada), nem depois do teto de
// 10 códigos em 24 h (S93). Cada envio invalida o código anterior da conta:
// só o último vale.
import { Injectable } from '@nestjs/common';
import { EnviadorDeEmail } from '../../../../compartilhado/email/enviador-de-email.ts';
import type { Assinante, EventoPublicado } from '../../../../compartilhado/eventos/assinantes.ts';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import {
  RepositorioDeCodigosDeVerificacao,
  RepositorioDeContas,
} from '../../dominio/repositorios.ts';
import { Cifrador } from '../portas/cifrador.ts';
import { GeradorDeSegredos } from '../portas/gerador-de-segredos.ts';
import { emitirEEnviarCodigo, lerPayload, nomeDoEvento, tipoDoEvento } from './comum.ts';
import { ModelosDeEmailDaIdentidade } from './modelos-de-email.ts';

const EVENTOS = ['ContaCriada', 'VerificacaoReenviada'] as const;

@Injectable()
export class EnviarCodigoDeVerificacaoAssinante implements Assinante {
  readonly nome = 'identidade.enviar-codigo-de-verificacao';
  readonly eventos = EVENTOS.map((nome) => tipoDoEvento(nome));

  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly relogio: Relogio,
    private readonly contas: RepositorioDeContas,
    private readonly codigos: RepositorioDeCodigosDeVerificacao,
    private readonly cifrador: Cifrador,
    private readonly gerador: GeradorDeSegredos,
    private readonly modelos: ModelosDeEmailDaIdentidade,
    private readonly enviador: EnviadorDeEmail,
  ) {}

  async tratar(evento: EventoPublicado): Promise<void> {
    const { contaId } = lerPayload(nomeDoEvento(EVENTOS, evento.tipo), evento);
    await this.unidade.executar(async () => {
      const conta = await this.contas.buscarPorId(contaId);
      if (conta?.status !== 'ativa' || conta.emailVerificado) return;
      await emitirEEnviarCodigo(
        {
          codigos: this.codigos,
          cifrador: this.cifrador,
          gerador: this.gerador,
          enviador: this.enviador,
        },
        conta,
        'verificacao_email',
        this.relogio.agora(),
        // Nunca com o nome (S102): o e-mail ainda não foi verificado.
        ({ codigo }) => this.modelos.codigoDeVerificacao({ codigo }),
      );
    });
  }
}
