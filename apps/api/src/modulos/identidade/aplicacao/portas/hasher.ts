// Porta do hash de senha (adaptador Argon2id na etapa 6: 19 MiB, t=2, p=1).
//
// A NFKC da senha fica DENTRO do adaptador, igual em `gerarHash`, `verificar`
// e `simularVerificacao` (P2, S75): "café" em NFC e em NFD, ou letras de
// largura cheia, dão a mesma senha. O tamanho (8 a 128) já foi medido na senha
// crua pelo contrato; aqui ela chega como foi digitada.

export abstract class Hasher {
  /** Hash da senha nova (cadastro, redefinição). */
  abstract gerarHash(senha: string): Promise<string>;

  /** A senha confere com o hash guardado. Hash mal formado dá `false`, não erro. */
  abstract verificar(senha: string, hash: string): Promise<boolean>;

  /**
   * Gasta o mesmo tempo de `verificar` contra um hash fictício, para conta
   * inexistente ou sem senha responder no mesmo tempo da senha errada (CA-04,
   * etapa 9).
   */
  abstract simularVerificacao(senha: string): Promise<void>;
}
