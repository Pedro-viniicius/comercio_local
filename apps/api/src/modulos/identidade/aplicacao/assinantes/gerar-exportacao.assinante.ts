// Assinante de `ExportacaoSolicitada` (CA-10, S10; plano 01b, etapa 13): gera a
// cópia dos dados (`GerarExportacaoCasoDeUso`, cifrada no banco por 7 dias) e,
// só quando ela foi gerada agora (`gerada`), avisa por e-mail que está pronta.
// O e-mail não leva a cópia, anexo nem link com segredo: ela sai pela tela de
// Privacidade, com sessão. Reentrega do evento (`ignorada`) e conta excluída
// depois do pedido (`conta_indisponivel`) não mandam nada.
import { Injectable } from '@nestjs/common';
import { EnviadorDeEmail } from '../../../../compartilhado/email/enviador-de-email.ts';
import type { Assinante, EventoPublicado } from '../../../../compartilhado/eventos/assinantes.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import { RepositorioDeContas } from '../../dominio/repositorios.ts';
import { GerarExportacaoCasoDeUso } from '../privacidade/gerar-exportacao.ts';
import { lerPayload, nomeNaSaudacao, tipoDoEvento } from './comum.ts';
import { ModelosDeEmailDaIdentidade } from './modelos-de-email.ts';

@Injectable()
export class GerarExportacaoAssinante implements Assinante {
  readonly nome = 'identidade.gerar-exportacao';
  readonly eventos = [tipoDoEvento('ExportacaoSolicitada')];

  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly contas: RepositorioDeContas,
    private readonly gerar: GerarExportacaoCasoDeUso,
    private readonly modelos: ModelosDeEmailDaIdentidade,
    private readonly enviador: EnviadorDeEmail,
  ) {}

  async tratar(evento: EventoPublicado): Promise<void> {
    const { contaId, solicitacaoId } = lerPayload('ExportacaoSolicitada', evento);
    await this.unidade.executar(async () => {
      const resultado = await this.gerar.executar({ contaId, solicitacaoId });
      if (resultado.tipo !== 'gerada') return;
      // A conta está travada pela geração até o fim da entrega, e estava ativa.
      const conta = await this.contas.buscarPorId(contaId);
      if (conta?.status !== 'ativa') return;
      await this.enviador.enviar({
        para: conta.email.valor,
        ...this.modelos.exportacaoPronta({
          nome: nomeNaSaudacao(conta),
          disponivelAte: resultado.expiraEm,
        }),
      });
    });
  }
}
