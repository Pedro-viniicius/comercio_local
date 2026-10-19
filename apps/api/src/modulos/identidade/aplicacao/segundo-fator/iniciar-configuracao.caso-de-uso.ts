// `POST /v1/segundo-fator/configuracao` (plano 01b, etapa 10; S1, CA-09): o
// admin sem segundo fator confirmado recebe um segredo TOTP novo para ler no
// app autenticador, antes de qualquer outra coisa no painel.
//
// Regras:
// - só com desafio da etapa `configurar`; das "Respostas do 2FA", só o passo
//   (1): desafio inexistente, vencido, usado, de outra etapa ou esgotado dá
//   `desafio_invalido`. Não gasta tentativa nem consulta o freio;
// - conta com segundo fator já confirmado também dá `desafio_invalido` (S1):
//   reconfigurar só pela CLI;
// - a resposta leva só `otpauthUri` e `segredoBase32`, com o rótulo
//   `Bairrin:<emailMascarado>`, nunca o e-mail inteiro. O QR é gerado no
//   painel (etapa 15); a API não gera imagem;
// - cada chamada troca o segredo ainda não confirmado (a tela recarregada pede
//   outro); o desafio continua valendo para a confirmação;
// - o segredo é guardado cifrado (AES-GCM, AAD com a conta), nunca em claro.
//
// Travas (R8): desafio → freio de segundo fator → `segundo_fator`. O freio
// aqui só serializa com a confirmação da mesma conta: sem ele, uma
// configuração lida antes de outra aba confirmar gravaria por cima um segredo
// não confirmado, e o próximo login voltaria a pedir `configurar`.
import { Injectable } from '@nestjs/common';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import {
  RepositorioDeBloqueios,
  RepositorioDeContas,
  RepositorioDeDesafios,
  RepositorioDeSegundoFator,
} from '../../dominio/repositorios.ts';
import { Cifrador } from '../portas/cifrador.ts';
import { VerificadorTotp } from '../portas/verificador-totp.ts';
import {
  chaveDoFreioDeSegundoFator,
  DESAFIO_INVALIDO,
  lerDesafio,
  podeConcluirSegundoFator,
} from './comum.ts';

export interface EntradaDeIniciarConfiguracao {
  /** Token do desafio, como veio no corpo (`<id>.<segredo>`). */
  readonly desafio: string;
}

export type ResultadoDeIniciarConfiguracao =
  | typeof DESAFIO_INVALIDO
  | { readonly tipo: 'configuracao'; readonly otpauthUri: string; readonly segredoBase32: string };

@Injectable()
export class IniciarConfiguracaoDoSegundoFatorCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly relogio: Relogio,
    private readonly contas: RepositorioDeContas,
    private readonly desafios: RepositorioDeDesafios,
    private readonly bloqueios: RepositorioDeBloqueios,
    private readonly segundoFator: RepositorioDeSegundoFator,
    private readonly cifrador: Cifrador,
    private readonly totp: VerificadorTotp,
  ) {}

  executar(entrada: EntradaDeIniciarConfiguracao): Promise<ResultadoDeIniciarConfiguracao> {
    const agora = this.relogio.agora();
    return this.unidade.executar(async () => {
      const desafio = await lerDesafio(
        { desafios: this.desafios, cifrador: this.cifrador },
        entrada.desafio,
      );
      if (desafio === null || !desafio.estaValidoPara('configurar', agora)) {
        return DESAFIO_INVALIDO;
      }
      const conta = await this.contas.buscarPorId(desafio.contaId);
      if (!podeConcluirSegundoFator(conta)) return DESAFIO_INVALIDO;

      const freio = await this.bloqueios.buscarParaAtualizar(
        chaveDoFreioDeSegundoFator(this.cifrador, conta.id),
        'segundo_fator',
        agora,
      );
      const atual = await this.segundoFator.buscar(conta.id);
      if (atual !== null && atual.confirmadoEm !== null) {
        await this.bloqueios.salvar(freio);
        return DESAFIO_INVALIDO;
      }

      const configuracao = this.totp.gerarConfiguracao(conta.email.mascarado);
      await this.segundoFator.salvar({
        contaId: conta.id,
        segredoCifrado: this.cifrador.cifrar('segredo_totp', configuracao.segredoBase32, conta.id),
        confirmadoEm: null,
        ultimoPassoUsado: null,
      });
      // O freio não muda aqui: `salvar` só apaga a linha zerada que a trava criou.
      await this.bloqueios.salvar(freio);
      return {
        tipo: 'configuracao',
        otpauthUri: configuracao.otpauthUri,
        segredoBase32: configuracao.segredoBase32,
      };
    });
  }
}
