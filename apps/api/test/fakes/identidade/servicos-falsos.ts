// Falsos das portas de serviço da Identidade, para os testes de unidade das
// etapas 8 a 13. Determinísticos: ids, tokens e códigos saem em sequência, e o
// tempo vem sempre de quem chama (`RelogioFixo` do núcleo). As portas do núcleo
// (unidade de trabalho, publicador e e-mail) têm os falsos em
// `test/fakes/compartilhado`.
//
// Ficam em `test/fakes/` (fora do build): código de produção não importa daqui
// (regra `producao-nao-importa-test`).
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type FinalidadeDeCifragem,
  type FinalidadeDeHmac,
  Cifrador,
} from '../../../src/modulos/identidade/aplicacao/portas/cifrador.ts';
import {
  EmissorDeJwt,
  type TokenDeAcesso,
} from '../../../src/modulos/identidade/aplicacao/portas/emissor-de-jwt.ts';
import { GeradorDeSegredos } from '../../../src/modulos/identidade/aplicacao/portas/gerador-de-segredos.ts';
import { Hasher } from '../../../src/modulos/identidade/aplicacao/portas/hasher.ts';
import {
  type PendenciaDeExclusao,
  VerificadorDePendencias,
} from '../../../src/modulos/identidade/aplicacao/portas/verificador-de-pendencias.ts';
import {
  type ConfiguracaoTotp,
  VerificadorTotp,
} from '../../../src/modulos/identidade/aplicacao/portas/verificador-totp.ts';
import {
  type ReivindicacoesDoToken,
  SEGUNDOS_DO_TOKEN_DE_ACESSO,
} from '../../../src/modulos/identidade/dominio/sessao.ts';

// ---------------------------------------------------------------------------
// Portas da Identidade

/** O `Hasher` foi chamado com uma transação aberta (S91). */
export class HashDentroDaTransacao extends Error {
  constructor(operacao: string) {
    super(
      `Hasher.${operacao} chamado com a unidade de trabalho aberta: o Argon2id seguraria ` +
        'a conexão e as travas durante o hash (S91).',
    );
    this.name = 'HashDentroDaTransacao';
  }
}

/**
 * `Hasher` que não é Argon2: aplica NFKC como o adaptador e conta as
 * chamadas, para o teste conferir que o caminho do e-mail repetido e o da
 * conta inexistente também gastam um hash (CA-02, CA-04). Com a unidade de
 * trabalho falsa, rejeita se for chamado com uma transação aberta (S91): o
 * hash nunca segura conexão nem trava.
 */
export class HasherFalso extends Hasher {
  readonly chamadas = { gerarHash: 0, verificar: 0, simularVerificacao: 0 };
  readonly #unidade: { readonly emTransacao: boolean } | undefined;

  constructor(unidade?: { readonly emTransacao: boolean }) {
    super();
    this.#unidade = unidade;
  }

  static hashDe(senha: string): string {
    return `hash-falso:${Buffer.from(senha.normalize('NFKC')).toString('base64url')}`;
  }

  override gerarHash(senha: string): Promise<string> {
    this.chamadas.gerarHash += 1;
    return this.#foraDaTransacao('gerarHash', () => HasherFalso.hashDe(senha));
  }

  override verificar(senha: string, hash: string): Promise<boolean> {
    this.chamadas.verificar += 1;
    return this.#foraDaTransacao('verificar', () => HasherFalso.hashDe(senha) === hash);
  }

  override simularVerificacao(_senha: string): Promise<void> {
    this.chamadas.simularVerificacao += 1;
    return this.#foraDaTransacao('simularVerificacao', () => undefined);
  }

  #foraDaTransacao<T>(operacao: string, calcular: () => T): Promise<T> {
    if (this.#unidade?.emTransacao === true) {
      return Promise.reject(new HashDentroDaTransacao(operacao));
    }
    return Promise.resolve(calcular());
  }
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** `GeradorDeSegredos` em sequência: `00000000-0000-4000-8000-000000000001`, `token-falso-1`... */
export class GeradorDeSegredosFalso extends GeradorDeSegredos {
  #ids = 0;
  #tokens = 0;
  #codigos = 0;
  #recuperacao = 0;
  readonly #proximosCodigos: string[] = [];

  /** Os próximos `codigoNumerico()` devolvem estes, na ordem; depois, a sequência. */
  definirProximosCodigos(...codigos: string[]): void {
    this.#proximosCodigos.push(...codigos);
  }

  override novoId(): string {
    this.#ids += 1;
    return `00000000-0000-4000-8000-${this.#ids.toString(16).padStart(12, '0')}`;
  }

  override tokenOpaco(): string {
    this.#tokens += 1;
    return `token-falso-${this.#tokens}`;
  }

  override codigoNumerico(): string {
    const definido = this.#proximosCodigos.shift();
    if (definido !== undefined) return definido;
    this.#codigos += 1;
    return String(100000 + this.#codigos);
  }

  override codigoDeRecuperacao(): string {
    this.#recuperacao += 1;
    let numero = this.#recuperacao;
    let codigo = '';
    while (numero > 0) {
      codigo = BASE32.charAt(numero % 32) + codigo;
      numero = Math.floor(numero / 32);
    }
    return codigo.padStart(10, 'A');
  }
}

const PREFIXO_DO_JWT_FALSO = 'jwt-falso.';

/**
 * `EmissorDeJwt` sem assinatura: o token é `jwt-falso.<claims em base64url>`.
 * Recusa token vencido, de outro formato ou alterado para outro prefixo.
 */
export class EmissorDeJwtFalso extends EmissorDeJwt {
  override emitir(reivindicacoes: ReivindicacoesDoToken, agora: Date): Promise<TokenDeAcesso> {
    const expiraEm = new Date(agora.getTime() + SEGUNDOS_DO_TOKEN_DE_ACESSO * 1000);
    const corpo = {
      ...reivindicacoes,
      perfis: [...reivindicacoes.perfis],
      exp: expiraEm.getTime(),
    };
    const token = PREFIXO_DO_JWT_FALSO + Buffer.from(JSON.stringify(corpo)).toString('base64url');
    return Promise.resolve({ token, expiraEm });
  }

  override verificar(token: string, agora: Date): Promise<ReivindicacoesDoToken | null> {
    if (!token.startsWith(PREFIXO_DO_JWT_FALSO)) return Promise.resolve(null);
    try {
      const texto = Buffer.from(token.slice(PREFIXO_DO_JWT_FALSO.length), 'base64url').toString();
      const { exp, ...reivindicacoes } = JSON.parse(texto) as ReivindicacoesDoToken & {
        exp: number;
      };
      return Promise.resolve(agora.getTime() < exp ? reivindicacoes : null);
    } catch {
      return Promise.resolve(null);
    }
  }
}

/**
 * `Cifrador` de teste: HMAC-SHA256 de verdade com chave fixa por finalidade
 * (partes com prefixo de tamanho, sem ambiguidade). A "cifragem" é só
 * base64url com finalidade e conta no texto, e não decifra com outra
 * finalidade ou conta (como a AAD do AES-GCM). Não use fora dos testes.
 */
export class CifradorFalso extends Cifrador {
  override hmac(finalidade: FinalidadeDeHmac, partes: readonly string[]): string {
    const hmac = createHmac('sha256', `chave-falsa-de-teste:${finalidade}`);
    for (const parte of partes) hmac.update(`${Buffer.byteLength(parte)}:${parte};`);
    return hmac.digest('base64url');
  }

  override hmacConfere(
    finalidade: FinalidadeDeHmac,
    partes: readonly string[],
    esperado: string,
  ): boolean {
    const calculado = Buffer.from(this.hmac(finalidade, partes));
    const recebido = Buffer.from(esperado);
    return calculado.length === recebido.length && timingSafeEqual(calculado, recebido);
  }

  override cifrar(finalidade: FinalidadeDeCifragem, textoClaro: string, contaId: string): string {
    return [
      'cifrado-falso',
      'v1',
      finalidade,
      contaId,
      Buffer.from(textoClaro).toString('base64url'),
    ].join(':');
  }

  override decifrar(
    finalidade: FinalidadeDeCifragem,
    textoCifrado: string,
    contaId: string,
  ): string | null {
    const [marca, versao, finalidadeDoTexto, contaDoTexto, conteudo, ...resto] =
      textoCifrado.split(':');
    const confere =
      marca === 'cifrado-falso' &&
      versao === 'v1' &&
      finalidadeDoTexto === finalidade &&
      contaDoTexto === contaId &&
      conteudo !== undefined &&
      resto.length === 0;
    return confere ? Buffer.from(conteudo, 'base64url').toString() : null;
  }
}

/** Passo de 30 s do TOTP. */
export function passoTotp(agora: Date): number {
  return Math.floor(agora.getTime() / 30_000);
}

/**
 * `VerificadorTotp` com segredo e código fixos: o código certo confere no
 * passo de `agora`, uma vez por passo (sem reuso).
 */
export class VerificadorTotpFalso extends VerificadorTotp {
  segredoBase32 = 'JBSWY3DPEHPK3PXP';
  codigoCerto = '123456';
  readonly rotulos: string[] = [];

  override gerarConfiguracao(rotulo: string): ConfiguracaoTotp {
    this.rotulos.push(rotulo);
    const rotuloNaUri = encodeURIComponent(`Bairrin:${rotulo}`);
    return {
      segredoBase32: this.segredoBase32,
      otpauthUri: `otpauth://totp/${rotuloNaUri}?secret=${this.segredoBase32}&issuer=Bairrin`,
    };
  }

  override verificar(
    segredoBase32: string,
    codigo: string,
    agora: Date,
    ultimoPassoUsado: number | null,
  ): number | null {
    const passo = passoTotp(agora);
    const confere = segredoBase32 === this.segredoBase32 && codigo === this.codigoCerto;
    const reuso = ultimoPassoUsado !== null && passo <= ultimoPassoUsado;
    return confere && !reuso ? passo : null;
  }
}

/** `VerificadorDePendencias` com pendências definidas pelo teste, por conta. */
export class VerificadorDePendenciasFalso extends VerificadorDePendencias {
  readonly #porConta = new Map<string, PendenciaDeExclusao[]>();
  #falhar = false;

  definir(contaId: string, pendencias: PendenciaDeExclusao[]): void {
    this.#porConta.set(contaId, [...pendencias]);
  }

  /** A próxima consulta rejeita (o caso de uso não pode seguir com a exclusão). */
  falharNaProxima(): void {
    this.#falhar = true;
  }

  override pendenciasDaConta(contaId: string): Promise<readonly PendenciaDeExclusao[]> {
    if (this.#falhar) {
      this.#falhar = false;
      return Promise.reject(new Error('Falha simulada ao consultar pendências.'));
    }
    return Promise.resolve([...(this.#porConta.get(contaId) ?? [])]);
  }
}
