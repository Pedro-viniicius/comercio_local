// Adaptador SMTP (nodemailer) do `EnviadorDeEmail`. Uma conexão por envio
// (sem pool): o volume do MVP é baixo e assim nenhuma conexão fica parada.
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { AMBIENTE, type Ambiente } from '../config/ambiente.ts';
import {
  EnviadorDeEmail,
  FalhaNoEnvioDeEmail,
  type MensagemDeEmail,
} from '../email/enviador-de-email.ts';

/** Prazos do SMTP (os padrões do nodemailer vão até 10 minutos). */
export const PRAZOS_DO_SMTP = {
  conexaoEmMs: 10_000,
  saudacaoEmMs: 10_000,
  inatividadeEmMs: 30_000,
} as const;

/** Código e resposta SMTP de um erro do nodemailer, sem a mensagem. */
export function falhaDoNodemailer(erro: unknown): FalhaNoEnvioDeEmail {
  const { code, responseCode } = (erro ?? {}) as { code?: unknown; responseCode?: unknown };
  return new FalhaNoEnvioDeEmail(
    typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'DESCONHECIDO',
    typeof responseCode === 'number' ? responseCode : undefined,
  );
}

@Injectable()
export class EnviadorDeEmailSmtp extends EnviadorDeEmail implements OnModuleDestroy {
  readonly #transporte: Transporter;
  readonly #remetente: string;

  constructor(
    @Inject(AMBIENTE) ambiente: Pick<Ambiente, 'SMTP_URL' | 'EMAIL_REMETENTE' | 'NODE_ENV'>,
  ) {
    super();
    this.#remetente = ambiente.EMAIL_REMETENTE;
    this.#transporte = nodemailer.createTransport({
      url: ambiente.SMTP_URL,
      // Em produção, `smtp://` só com STARTTLS: a credencial nunca vai em
      // texto aberto. `smtps://` já é TLS desde o início. O Mailpit local não
      // tem TLS.
      requireTLS: ambiente.NODE_ENV === 'production',
      connectionTimeout: PRAZOS_DO_SMTP.conexaoEmMs,
      greetingTimeout: PRAZOS_DO_SMTP.saudacaoEmMs,
      socketTimeout: PRAZOS_DO_SMTP.inatividadeEmMs,
      // A mensagem é montada por nós: nada de anexo lido de arquivo ou URL.
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  override async enviar(mensagem: MensagemDeEmail): Promise<void> {
    try {
      await this.#transporte.sendMail({
        from: this.#remetente,
        to: mensagem.para,
        subject: mensagem.assunto,
        text: mensagem.texto,
        ...(mensagem.html === undefined ? {} : { html: mensagem.html }),
      });
    } catch (erro) {
      throw falhaDoNodemailer(erro);
    }
  }

  onModuleDestroy(): void {
    this.#transporte.close();
  }
}
