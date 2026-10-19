// Porta dos valores aleatórios da Identidade (adaptador na etapa 6, com
// `node:crypto`: `randomBytes`, `randomInt` e `randomUUID`). Nenhum valor daqui
// vai para log, erro ou evento; só o HMAC dos segredos é guardado.

export abstract class GeradorDeSegredos {
  /** UUID v4 para o id de uma linha nova (conta, sessão, código...). */
  abstract novoId(): string;

  /** Token opaco de 32 bytes em base64url: renovação e desafio do 2FA. */
  abstract tokenOpaco(): string;

  /** Código de 6 dígitos, com zeros à esquerda (`randomInt`). */
  abstract codigoNumerico(): string;

  /** Código de recuperação do 2FA: 10 caracteres base32 (`A-Z`, `2-7`). */
  abstract codigoDeRecuperacao(): string;
}
