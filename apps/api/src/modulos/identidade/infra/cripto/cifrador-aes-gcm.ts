// Adaptador do `Cifrador` (S17): HMAC-SHA256 com `CHAVE_HMAC` e AES-256-GCM com
// `CHAVE_CIFRAGEM_DADOS`, cada finalidade com a sua subchave derivada por HKDF.
//
// - HMAC: as partes entram com o tamanho na frente (4 bytes, big-endian) e
//   saem em base64url. Sem prefixo de versão: o HMAC é chave de busca
//   (`token_hash` é único), e trocar a chave invalida os valores guardados.
// - Cifrado: `v1.<base64url(iv | tag | texto cifrado)>`, IV aleatório de 96
//   bits, tag de 128 bits e o id da conta como AAD. O prefixo é a versão da
//   chave: uma rotação acrescenta `v2` aqui e mantém `v1` para decifrar.
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AMBIENTE, type Ambiente } from '../../../../compartilhado/config/ambiente.ts';
import {
  Cifrador,
  type FinalidadeDeCifragem,
  type FinalidadeDeHmac,
} from '../../aplicacao/portas/cifrador.ts';

const BYTES_DA_SUBCHAVE = 32;
const BYTES_DO_IV = 12;
const BYTES_DA_TAG = 16;

/** Versão da chave de cifragem atual, gravada na frente do texto cifrado. */
export const VERSAO_DA_CHAVE = 'v1';

/** `<versão>.<base64url>`; o base64url tem pelo menos IV + tag. */
const FORMATO_DO_CIFRADO = /^(v[1-9][0-9]*)\.([A-Za-z0-9_-]+)$/;

/** Rótulos do HKDF: separam o uso (HMAC ou cifragem) e a finalidade. */
const ROTULO_DO_HMAC = 'bairrin/identidade/hmac/';
const ROTULO_DA_CIFRAGEM = 'bairrin/identidade/cifragem/';

/** Chave de ambiente já validada pelo `carregarAmbiente` (base64, 32+ bytes). */
function decodificarChave(chave: string): Buffer {
  return Buffer.from(chave, 'base64');
}

function subchave(mestra: Buffer, rotulo: string): Buffer {
  return Buffer.from(hkdfSync('sha256', mestra, Buffer.alloc(0), rotulo, BYTES_DA_SUBCHAVE));
}

/** Codificação sem ambiguidade: cada parte com o tamanho em bytes na frente. */
function codificarPartes(partes: readonly string[]): Buffer {
  const blocos: Buffer[] = [];
  for (const parte of partes) {
    const bytes = Buffer.from(parte, 'utf8');
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32BE(bytes.length);
    blocos.push(tamanho, bytes);
  }
  return Buffer.concat(blocos);
}

function exigirConta(contaId: string): void {
  // Sem conta, o AAD não liga o cifrado a ninguém: erro de programação.
  if (contaId.length === 0) throw new Error('Cifragem exige o id da conta.');
}

@Injectable()
export class CifradorAesGcm extends Cifrador {
  readonly #chaveDeHmac: Buffer;
  /** Chaves de cifragem por versão; só a `VERSAO_DA_CHAVE` cifra. */
  readonly #chavesDeCifragem: ReadonlyMap<string, Buffer>;
  readonly #subchaves = new Map<string, Buffer>();

  constructor(@Inject(AMBIENTE) ambiente: Pick<Ambiente, 'CHAVE_HMAC' | 'CHAVE_CIFRAGEM_DADOS'>) {
    super();
    this.#chaveDeHmac = decodificarChave(ambiente.CHAVE_HMAC);
    this.#chavesDeCifragem = new Map([
      [VERSAO_DA_CHAVE, decodificarChave(ambiente.CHAVE_CIFRAGEM_DADOS)],
    ]);
  }

  override hmac(finalidade: FinalidadeDeHmac, partes: readonly string[]): string {
    return this.#hmacEmBytes(finalidade, partes).toString('base64url');
  }

  override hmacConfere(
    finalidade: FinalidadeDeHmac,
    partes: readonly string[],
    esperado: string,
  ): boolean {
    const calculado = Buffer.from(this.hmac(finalidade, partes), 'utf8');
    const recebido = Buffer.from(esperado, 'utf8');
    // O tamanho do HMAC é fixo e público: comparar o tamanho antes não vaza nada.
    return calculado.length === recebido.length && timingSafeEqual(calculado, recebido);
  }

  override cifrar(finalidade: FinalidadeDeCifragem, textoClaro: string, contaId: string): string {
    exigirConta(contaId);
    const chave = this.#subchaveDeCifragem(VERSAO_DA_CHAVE, finalidade);
    const iv = randomBytes(BYTES_DO_IV);
    const cifra = createCipheriv('aes-256-gcm', chave, iv, { authTagLength: BYTES_DA_TAG });
    cifra.setAAD(Buffer.from(contaId, 'utf8'));
    const cifrado = Buffer.concat([cifra.update(textoClaro, 'utf8'), cifra.final()]);
    const corpo = Buffer.concat([iv, cifra.getAuthTag(), cifrado]);
    return `${VERSAO_DA_CHAVE}.${corpo.toString('base64url')}`;
  }

  override decifrar(
    finalidade: FinalidadeDeCifragem,
    textoCifrado: string,
    contaId: string,
  ): string | null {
    exigirConta(contaId);
    const partes = FORMATO_DO_CIFRADO.exec(textoCifrado);
    if (partes === null) return null;
    const [, versao, corpoEmTexto] = partes;
    if (versao === undefined || corpoEmTexto === undefined) return null;
    if (!this.#chavesDeCifragem.has(versao)) return null;
    const corpo = Buffer.from(corpoEmTexto, 'base64url');
    if (corpo.length < BYTES_DO_IV + BYTES_DA_TAG) return null;
    const iv = corpo.subarray(0, BYTES_DO_IV);
    const tag = corpo.subarray(BYTES_DO_IV, BYTES_DO_IV + BYTES_DA_TAG);
    const cifrado = corpo.subarray(BYTES_DO_IV + BYTES_DA_TAG);
    const decifra = createDecipheriv(
      'aes-256-gcm',
      this.#subchaveDeCifragem(versao, finalidade),
      iv,
      { authTagLength: BYTES_DA_TAG },
    );
    decifra.setAAD(Buffer.from(contaId, 'utf8'));
    decifra.setAuthTag(tag);
    try {
      return Buffer.concat([decifra.update(cifrado), decifra.final()]).toString('utf8');
    } catch {
      // Tag não confere: alterado, de outra finalidade, conta ou chave.
      return null;
    }
  }

  #hmacEmBytes(finalidade: FinalidadeDeHmac, partes: readonly string[]): Buffer {
    const chave = this.#subchave(this.#chaveDeHmac, `${ROTULO_DO_HMAC}${finalidade}`);
    return createHmac('sha256', chave).update(codificarPartes(partes)).digest();
  }

  #subchaveDeCifragem(versao: string, finalidade: FinalidadeDeCifragem): Buffer {
    const mestra = this.#chavesDeCifragem.get(versao);
    if (mestra === undefined) throw new Error('Versão de chave de cifragem desconhecida.');
    return this.#subchave(mestra, `${ROTULO_DA_CIFRAGEM}${versao}/${finalidade}`);
  }

  /** Deriva uma vez por rótulo e guarda (as finalidades são poucas e fixas). */
  #subchave(mestra: Buffer, rotulo: string): Buffer {
    let chave = this.#subchaves.get(rotulo);
    if (chave === undefined) {
      chave = subchave(mestra, rotulo);
      this.#subchaves.set(rotulo, chave);
    }
    return chave;
  }
}
