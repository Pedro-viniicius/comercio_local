// Assinante de `RecuperacaoSolicitada` (CA-06; plano 01b, etapa 13): gera o
// código de redefinição de senha (30 min, uso único, 5 tentativas) na hora do
// envio e o manda para `contas.email_normalizado`, lido pelo id do payload.
//
// Também é o caminho da primeira senha do admin criado pela CLI `seed:admin`
// (sem senha) e da conta cuja senha foi apagada (CLI de reconfiguração do 2FA,
// freio de segundo fator no nível máximo, P16). Não envia para conta que não
// existe mais ou saiu de `ativa`, nem depois do teto de 10 códigos em 24 h
// (S93). Cada envio invalida o código anterior da conta: só o último vale.
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
import { emitirEEnviarCodigo, lerPayload, tipoDoEvento } from './comum.ts';
import { ModelosDeEmailDaIdentidade } from './modelos-de-email.ts';

@Injectable()
export class EnviarCodigoDeRecuperacaoAssinante implements Assinante {
  readonly nome = 'identidade.enviar-codigo-de-recuperacao';
  readonly eventos = [tipoDoEvento('RecuperacaoSolicitada')];

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
    const { contaId } = lerPayload('RecuperacaoSolicitada', evento);
    await this.unidade.executar(async () => {
      const conta = await this.contas.buscarPorId(contaId);
      if (conta?.status !== 'ativa') return;
      await emitirEEnviarCodigo(
        {
          codigos: this.codigos,
          cifrador: this.cifrador,
          gerador: this.gerador,
          enviador: this.enviador,
        },
        conta,
        'recuperacao_senha',
        this.relogio.agora(),
        (dados) => this.modelos.codigoDeRecuperacao(dados),
      );
    });
  }
}
