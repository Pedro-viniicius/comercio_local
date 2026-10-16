// Porta de envio de e-mail (sem Nest nem SMTP; o adaptador é
// `infra/smtp.adaptador.ts`). Em desenvolvimento e nos testes o adaptador SMTP
// fala com o Mailpit local; em produção, com o SMTP do provedor (SMTP_URL).
// Os testes de unidade usam o `EnviadorDeEmailFalso`.
//
// Conteúdo (S10): só o necessário para o destinatário, sem dado de terceiros.
// O endereço do destinatário é dado pessoal: nunca vai para log, erro ou
// evento (o assinante lê o e-mail pelo id da conta na hora do envio).

export interface MensagemDeEmail {
  /** Um único destinatário. */
  para: string;
  assunto: string;
  texto: string;
  html?: string;
}

export abstract class EnviadorDeEmail {
  /** Entrega a mensagem ao servidor SMTP. Rejeita com `FalhaNoEnvioDeEmail`. */
  abstract enviar(mensagem: MensagemDeEmail): Promise<void>;
}

/**
 * O envio falhou. Leva só o código do erro (ex.: `ECONNECTION`, `EAUTH`) e o
 * código de resposta SMTP, nunca a mensagem original: a do nodemailer pode
 * citar o destinatário, o remetente ou o usuário da autenticação.
 */
export class FalhaNoEnvioDeEmail extends Error {
  constructor(
    readonly codigo: string,
    readonly codigoSmtp?: number,
  ) {
    super(`O envio de e-mail falhou (${codigo}${codigoSmtp ? `/${codigoSmtp}` : ''}).`);
    this.name = 'FalhaNoEnvioDeEmail';
  }
}
