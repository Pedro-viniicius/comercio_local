// Porta dos modelos de e-mail da Identidade (plano 01b, etapa 13). Os
// assinantes desta pasta montam a mensagem por aqui, sem conhecer o HTML; o
// adaptador fica em `infra/email/modelos/` (a aplicação não importa infra).
//
// Regras de todo modelo (S10, S73, S102):
// - só o necessário para o destinatário, sem dado de terceiros nem anexo;
// - o assunto é fixo e nunca leva o nome;
// - o nome só entra na saudação, e só para e-mail já verificado
//   (`nomeNaSaudacao`): o nome é texto livre do cadastro, e quem cadastra o
//   e-mail de outra pessoa não escolhe o que chega na caixa dela. Sem nome, a
//   saudação é "Olá!". O e-mail de verificação nunca leva o nome;
// - no HTML, o nome e qualquer outro valor interpolado passam por `escaparHtml`
//   (`& < > " '`); no texto puro, saem como estão.
import type { MensagemDeEmail } from '../../../../compartilhado/email/enviador-de-email.ts';

/** A mensagem pronta, sem o destinatário (o assinante o lê da conta pelo id). */
export type ConteudoDoEmail = Required<Omit<MensagemDeEmail, 'para'>>;

/**
 * O nome da conta para a saudação, como foi gravado, ou `null` (saudação sem
 * nome) quando o e-mail da conta ainda não foi verificado (S102).
 */
export type NomeNaSaudacao = string | null;

export interface DadosDoCodigo {
  readonly nome: NomeNaSaudacao;
  /** Código de 6 dígitos em claro: só existe aqui e no e-mail. */
  readonly codigo: string;
}

export abstract class ModelosDeEmailDaIdentidade {
  /**
   * Código de verificação do e-mail (CA-01): vale 30 min. Sem nome (S102): o
   * e-mail ainda não foi verificado.
   */
  abstract codigoDeVerificacao(dados: { readonly codigo: string }): ConteudoDoEmail;

  /**
   * Alguém tentou cadastrar o e-mail que já tem conta (CA-02, P1-dono): as
   * opções de entrar ou recuperar a senha, sem dizer quem tentou.
   */
  abstract cadastroRepetido(dados: { readonly nome: NomeNaSaudacao }): ConteudoDoEmail;

  /** Código para redefinir a senha (CA-06): vale 30 min e uma vez. */
  abstract codigoDeRecuperacao(dados: DadosDoCodigo): ConteudoDoEmail;

  /**
   * A cópia dos dados está pronta (CA-10, S10): só o aviso, sem anexo nem link
   * com segredo; a cópia sai pela tela de Privacidade, com sessão.
   */
  abstract exportacaoPronta(dados: {
    readonly nome: NomeNaSaudacao;
    readonly disponivelAte: Date;
  }): ConteudoDoEmail;

  /**
   * O freio de segundo fator da conta entrou em espera (S92). Com
   * `senhaRemovida` (nível máximo, P16), manda recuperar a senha.
   */
  abstract segundoFatorFreado(dados: {
    readonly nome: NomeNaSaudacao;
    readonly senhaRemovida: boolean;
  }): ConteudoDoEmail;
}
