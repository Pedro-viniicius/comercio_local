// Porta de HMAC e cifragem (adaptador na etapa 6): HMAC-SHA256 e AES-256-GCM
// (IV de 96 bits, AAD com o id da conta), com subchave por finalidade via HKDF
// e prefixo de versão de chave no texto cifrado (S17). A finalidade separa as
// chaves: um HMAC calculado para uma finalidade nunca confere em outra.
import type { TipoDeBloqueio } from '../../dominio/bloqueio-de-login.ts';
import type { FinalidadeDoCodigo } from '../../dominio/codigo-de-verificacao.ts';
import type { FinalidadeDoDesafio } from '../../dominio/desafio-de-segundo-fator.ts';

/**
 * Finalidades de HMAC. Os códigos e desafios usam a finalidade gravada em
 * `codigos_verificacao`; as partes incluem o id da conta, para o código só
 * conferir na conta e na finalidade que o emitiram.
 */
export type FinalidadeDeHmac =
  | FinalidadeDoCodigo
  | FinalidadeDoDesafio
  | 'token_renovacao'
  | 'codigo_recuperacao_segundo_fator'
  | `bloqueio_${TipoDeBloqueio}`;

export type FinalidadeDeCifragem = 'par_novo_da_sessao' | 'segredo_totp' | 'exportacao_titular';

export abstract class Cifrador {
  /**
   * HMAC das partes, em texto (base64url). As partes são codificadas sem
   * ambiguidade (`['ab', 'c']` e `['a', 'bc']` dão HMACs diferentes).
   */
  abstract hmac(finalidade: FinalidadeDeHmac, partes: readonly string[]): string;

  /** O HMAC das partes é igual ao esperado, comparado em tempo constante. */
  abstract hmacConfere(
    finalidade: FinalidadeDeHmac,
    partes: readonly string[],
    esperado: string,
  ): boolean;

  /** Cifra o texto com a conta como AAD: só decifra informando a mesma conta. */
  abstract cifrar(finalidade: FinalidadeDeCifragem, textoClaro: string, contaId: string): string;

  /**
   * O texto claro, ou `null` se o cifrado foi alterado, é de outra finalidade
   * ou conta, ou usa versão de chave desconhecida.
   */
  abstract decifrar(
    finalidade: FinalidadeDeCifragem,
    textoCifrado: string,
    contaId: string,
  ): string | null;
}
