// Porta do TOTP do admin (adaptador na etapa 6, com `otpauth`): SHA1, 6
// dígitos, passo de 30 s, janela de ±1 passo e sem reuso de passo (S1).

export interface ConfiguracaoTotp {
  /** Segredo novo em base32: a aplicação o guarda cifrado e o mostra uma vez. */
  readonly segredoBase32: string;
  /** URI `otpauth://` para o QR code, com emissor `Bairrin` e o rótulo pedido. */
  readonly otpauthUri: string;
}

export abstract class VerificadorTotp {
  /**
   * Gera um segredo e a URI. O `rotulo` é `<emailMascarado>` (o adaptador
   * monta `Bairrin:<rotulo>`); nunca o e-mail inteiro (P10).
   */
  abstract gerarConfiguracao(rotulo: string): ConfiguracaoTotp;

  /**
   * O passo de 30 s em que o código confere, dentro da janela de ±1 em volta
   * de `agora`, ou `null`. Um passo igual ou anterior a `ultimoPassoUsado` não
   * confere (o mesmo código não vale duas vezes).
   */
  abstract verificar(
    segredoBase32: string,
    codigo: string,
    agora: Date,
    ultimoPassoUsado: number | null,
  ): number | null;
}
