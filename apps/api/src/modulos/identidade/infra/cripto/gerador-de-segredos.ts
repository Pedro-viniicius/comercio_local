// Adaptador do `GeradorDeSegredos` com o CSPRNG do `node:crypto` (S17).
// `randomInt` sorteia sem viés de módulo, então cada dígito e cada caractere
// base32 sai com a mesma chance.
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { GeradorDeSegredos } from '../../aplicacao/portas/gerador-de-segredos.ts';

/** Bytes aleatórios do token opaco (256 bits). */
export const BYTES_DO_TOKEN_OPACO = 32;

/** Dígitos do código numérico (verificação de e-mail, recuperação de senha). */
export const DIGITOS_DO_CODIGO = 6;

/** Caracteres do código de recuperação do 2FA (50 bits). */
export const CARACTERES_DO_CODIGO_DE_RECUPERACAO = 10;

/** Alfabeto base32 da RFC 4648, sem `0`, `1`, `8` e `9`. */
export const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

@Injectable()
export class GeradorDeSegredosCripto extends GeradorDeSegredos {
  override novoId(): string {
    return randomUUID();
  }

  override tokenOpaco(): string {
    return randomBytes(BYTES_DO_TOKEN_OPACO).toString('base64url');
  }

  override codigoNumerico(): string {
    return randomInt(0, 10 ** DIGITOS_DO_CODIGO)
      .toString()
      .padStart(DIGITOS_DO_CODIGO, '0');
  }

  override codigoDeRecuperacao(): string {
    let codigo = '';
    for (let i = 0; i < CARACTERES_DO_CODIGO_DE_RECUPERACAO; i++) {
      codigo += ALFABETO_BASE32.charAt(randomInt(0, ALFABETO_BASE32.length));
    }
    return codigo;
  }
}
