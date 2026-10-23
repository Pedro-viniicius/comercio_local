// Assinante de `CadastroRepetidoTentado` (CA-02; P1-dono, S15; plano 01b,
// etapa 13): avisa o dono do e-mail que alguém tentou cadastrá-lo, com as
// opções de entrar ou recuperar a senha. Vale também para conta não
// verificada (P1-dono): o recadastro nunca muda a conta, e quem tem o e-mail
// recupera o acesso pela redefinição. Não diz quem tentou nem de onde.
//
// No máximo um aviso por hora por e-mail (S15). A marca do último aviso fica
// em `identidade.bloqueios_login`, sem migração nova: uma linha do tipo
// `email` com chave própria (HMAC `bloqueio_email` de
// `['aviso_cadastro_repetido', <e-mail normalizado>]`, que nunca coincide com a
// chave do freio de login, só `[<e-mail>]`) e `bloqueado_ate` uma hora depois
// do aviso. A linha é lida com trava (`buscarParaAtualizar`): dois avisos
// simultâneos do mesmo e-mail não saem os dois. A retenção (S81) apaga a marca
// 30 min depois de vencida.
//
// Conta que não existe mais ou saiu de `ativa` não recebe nada.
import { Injectable } from '@nestjs/common';
import { EnviadorDeEmail } from '../../../../compartilhado/email/enviador-de-email.ts';
import type { Assinante, EventoPublicado } from '../../../../compartilhado/eventos/assinantes.ts';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import { BloqueioDeLogin } from '../../dominio/bloqueio-de-login.ts';
import type { Email } from '../../dominio/email.ts';
import { RepositorioDeBloqueios, RepositorioDeContas } from '../../dominio/repositorios.ts';
import { Cifrador } from '../portas/cifrador.ts';
import { lerPayload, nomeNaSaudacao, tipoDoEvento } from './comum.ts';
import { ModelosDeEmailDaIdentidade } from './modelos-de-email.ts';

/** Intervalo mínimo entre dois avisos para o mesmo e-mail (S15). */
export const INTERVALO_ENTRE_AVISOS_EM_MS = 60 * 60 * 1000;

/** Separa a chave da marca do aviso da chave do freio de login do mesmo e-mail. */
const PREFIXO_DA_MARCA = 'aviso_cadastro_repetido';

/** Chave (HMAC) da marca do último aviso de cadastro repetido do e-mail. */
export function chaveDoAvisoDeCadastroRepetido(cifrador: Cifrador, email: Email): string {
  return cifrador.hmac('bloqueio_email', [PREFIXO_DA_MARCA, email.valor]);
}

@Injectable()
export class AvisarCadastroRepetidoAssinante implements Assinante {
  readonly nome = 'identidade.avisar-cadastro-repetido';
  readonly eventos = [tipoDoEvento('CadastroRepetidoTentado')];

  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly relogio: Relogio,
    private readonly contas: RepositorioDeContas,
    private readonly bloqueios: RepositorioDeBloqueios,
    private readonly cifrador: Cifrador,
    private readonly modelos: ModelosDeEmailDaIdentidade,
    private readonly enviador: EnviadorDeEmail,
  ) {}

  async tratar(evento: EventoPublicado): Promise<void> {
    const { contaId } = lerPayload('CadastroRepetidoTentado', evento);
    await this.unidade.executar(async () => {
      const conta = await this.contas.buscarPorId(contaId);
      if (conta?.status !== 'ativa') return;
      const agora = this.relogio.agora();
      const chave = chaveDoAvisoDeCadastroRepetido(this.cifrador, conta.email);
      const marca = await this.bloqueios.buscarParaAtualizar(chave, 'email', agora);
      if (marca.estaBloqueado(agora)) {
        // Já houve aviso na última hora: nada sai (a marca fica como está).
        await this.bloqueios.salvar(marca);
        return;
      }
      await this.bloqueios.salvar(
        BloqueioDeLogin.reconstituir({
          chaveHmac: chave,
          tipo: 'email',
          falhas: 0,
          nivel: 0,
          janelaInicio: agora,
          bloqueadoAte: new Date(agora.getTime() + INTERVALO_ENTRE_AVISOS_EM_MS),
        }),
      );
      await this.enviador.enviar({
        para: conta.email.valor,
        ...this.modelos.cadastroRepetido({ nome: nomeNaSaudacao(conta) }),
      });
    });
  }
}
