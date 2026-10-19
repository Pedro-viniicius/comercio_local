// Adaptador do `VerificadorTotp` com o `otpauth` (S1): SHA1, 6 dígitos, passo
// de 30 s (RFC 6238, o padrão dos apps autenticadores), janela de ±1 passo e
// sem reuso: um passo igual ou anterior ao último usado não confere.
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { HOTP, Secret, TOTP } from 'otpauth';
import { type ConfiguracaoTotp, VerificadorTotp } from '../../aplicacao/portas/verificador-totp.ts';

export const EMISSOR_DO_TOTP = 'Bairrin';
export const ALGORITMO_DO_TOTP = 'SHA1';
export const DIGITOS_DO_TOTP = 6;
export const SEGUNDOS_DO_PASSO = 30;
/** Passos aceitos antes e depois do atual (relógio do celular adiantado ou atrasado). */
export const JANELA_EM_PASSOS = 1;

/** Segredo novo: 160 bits, o tamanho recomendado pela RFC 4226. */
const BYTES_DO_SEGREDO = 20;
/** Menor segredo aceito na verificação: 128 bits (mínimo da RFC 4226). */
const BYTES_MINIMOS_DO_SEGREDO = 16;

const FORMATO_DO_CODIGO = /^\d{6}$/;

/** O segredo guardado, ou erro sem nenhum trecho dele na mensagem. */
function lerSegredo(segredoBase32: string): Secret {
  let segredo: Secret;
  try {
    segredo = Secret.fromBase32(segredoBase32);
  } catch {
    // A mensagem do `otpauth` cita o caractere inválido, que é parte do segredo.
    throw new Error('Segredo TOTP guardado não está em base32.');
  }
  if (segredo.bytes.length < BYTES_MINIMOS_DO_SEGREDO) {
    throw new Error('Segredo TOTP guardado é curto demais.');
  }
  return segredo;
}

@Injectable()
export class VerificadorTotpOtpauth extends VerificadorTotp {
  override gerarConfiguracao(rotulo: string): ConfiguracaoTotp {
    if (rotulo.trim().length === 0) throw new Error('O rótulo do TOTP não pode ser vazio.');
    // Cópia num ArrayBuffer de 20 bytes: o `.buffer` de um `Buffer` do Node
    // pode ser o bloco compartilhado inteiro, não só os bytes sorteados.
    const bytes = new Uint8Array(randomBytes(BYTES_DO_SEGREDO));
    const segredo = new Secret({ buffer: bytes.buffer });
    const totp = new TOTP({
      issuer: EMISSOR_DO_TOTP,
      label: rotulo,
      issuerInLabel: true,
      secret: segredo,
      algorithm: ALGORITMO_DO_TOTP,
      digits: DIGITOS_DO_TOTP,
      period: SEGUNDOS_DO_PASSO,
    });
    return { segredoBase32: segredo.base32, otpauthUri: totp.toString() };
  }

  override verificar(
    segredoBase32: string,
    codigo: string,
    agora: Date,
    ultimoPassoUsado: number | null,
  ): number | null {
    const segredo = lerSegredo(segredoBase32);
    if (!FORMATO_DO_CODIGO.test(codigo)) return null;
    const atual = TOTP.counter({ period: SEGUNDOS_DO_PASSO, timestamp: agora.getTime() });
    let aceito: number | null = null;
    // Confere todos os passos da janela (sem parar no primeiro) e fica com o
    // mais recente que confere: numa coincidência rara entre dois passos, o
    // reuso fica barrado até o maior deles.
    for (let passo = atual - JANELA_EM_PASSOS; passo <= atual + JANELA_EM_PASSOS; passo++) {
      const confere =
        HOTP.validate({
          token: codigo,
          secret: segredo,
          algorithm: ALGORITMO_DO_TOTP,
          digits: DIGITOS_DO_TOTP,
          counter: passo,
          window: 0,
        }) !== null;
      if (confere && (ultimoPassoUsado === null || passo > ultimoPassoUsado)) aceito = passo;
    }
    return aceito;
  }
}
