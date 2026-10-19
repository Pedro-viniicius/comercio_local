// Freio de tentativas (`identidade.bloqueios_login`; CA-04, S1, S14).
//
// Três freios, cada um com a sua chave (a aplicação guarda só o HMAC dela,
// `chave_hmac`):
// - `email`: 5 falhas em 15 min pelo e-mail normalizado, exista ou não a
//   conta; a senha da exclusão e o código da redefinição somam aqui;
// - `ip`: 50 falhas em 15 min pela origem, com IPv6 agrupado por /64
//   (`valorDaChaveDeOrigem`), para não travar quem divide IP na operadora;
// - `segundo_fator`: 5 falhas de TOTP ou código de recuperação pela conta, que
//   só zera com o segundo fator concluído (a senha certa não zera; S1).
//
// Ao atingir o limiar, a espera cresce: 1, 5 e 15 min, e fica em 15 min
// (nunca bloqueio definitivo). Depois de cada espera, outras `limiar` falhas
// levam ao nível seguinte. O nível volta a zero quando uma janela nova começa
// 15 min ou mais depois do fim da última espera.
//
// A janela é fixa a partir da primeira falha (`janela_inicio`): 5 falhas nos
// 15 min seguintes a ela. Com `falhas = 0` não há janela aberta: a próxima
// falha abre uma nova (a coluna é NOT NULL e guarda a última). Falha durante a espera não conta: quem chama nem
// confere a senha enquanto o freio está ativo, e responde com a mesma
// mensagem da senha errada (CA-04).

export type TipoDeBloqueio = 'email' | 'ip' | 'segundo_fator';

/** O que deu certo: a senha ou o segundo fator. */
export type Conclusao = 'senha' | 'segundo_fator';

/** Falhas na janela que acionam a espera, por freio (CA-04, S14, S1). */
export const LIMIAR_DE_FALHAS: Readonly<Record<TipoDeBloqueio, number>> = {
  email: 5,
  ip: 50,
  segundo_fator: 5,
};

const UM_MINUTO_EM_MS = 60 * 1000;

/** Janela de contagem das falhas (15 min). */
export const JANELA_DE_FALHAS_EM_MS = 15 * UM_MINUTO_EM_MS;
/** Esperas por nível: 1, 5 e 15 min; do terceiro em diante, 15 min. */
export const ESPERAS_EM_MS: readonly number[] = [
  1 * UM_MINUTO_EM_MS,
  5 * UM_MINUTO_EM_MS,
  15 * UM_MINUTO_EM_MS,
];
/** Tempo sem espera depois do qual o nível volta a zero. */
export const CALMA_PARA_ZERAR_O_NIVEL_EM_MS = 15 * UM_MINUTO_EM_MS;

/** Forma persistida do freio, coluna a coluna (pk: `chave_hmac`, `tipo`). */
export interface DadosDoBloqueioDeLogin {
  readonly chaveHmac: string;
  readonly tipo: TipoDeBloqueio;
  /** Falhas na janela atual. */
  readonly falhas: number;
  /** Esperas já aplicadas desde a última calma (0 a 3). */
  readonly nivel: number;
  /** Primeira falha da janela atual (com `falhas = 0`, a da última janela). */
  readonly janelaInicio: Date;
  /** Fim da última espera; `null` se nunca houve. */
  readonly bloqueadoAte: Date | null;
}

export class BloqueioDeLogin {
  readonly #chaveHmac: string;
  readonly #tipo: TipoDeBloqueio;
  #falhas: number;
  #nivel: number;
  #janelaInicio: Date;
  #bloqueadoAte: Date | null;

  private constructor(dados: DadosDoBloqueioDeLogin) {
    if (dados.chaveHmac.length === 0) throw new Error('A chave do bloqueio não pode ser vazia.');
    const contadorValido = (valor: number) => Number.isInteger(valor) && valor >= 0;
    if (!contadorValido(dados.falhas) || !contadorValido(dados.nivel)) {
      throw new Error('Falhas e nível do bloqueio devem ser inteiros não negativos.');
    }
    this.#chaveHmac = dados.chaveHmac;
    this.#tipo = dados.tipo;
    this.#falhas = dados.falhas;
    this.#nivel = Math.min(dados.nivel, ESPERAS_EM_MS.length);
    this.#janelaInicio = new Date(dados.janelaInicio.getTime());
    this.#bloqueadoAte = copiarData(dados.bloqueadoAte);
  }

  /** Freio sem falha nenhuma (a chave ainda não tem linha no banco). */
  static novo(chaveHmac: string, tipo: TipoDeBloqueio, agora: Date): BloqueioDeLogin {
    return new BloqueioDeLogin({
      chaveHmac,
      tipo,
      falhas: 0,
      nivel: 0,
      janelaInicio: agora,
      bloqueadoAte: null,
    });
  }

  static reconstituir(dados: DadosDoBloqueioDeLogin): BloqueioDeLogin {
    return new BloqueioDeLogin(dados);
  }

  get chaveHmac(): string {
    return this.#chaveHmac;
  }

  get tipo(): TipoDeBloqueio {
    return this.#tipo;
  }

  get nivel(): number {
    return this.#nivel;
  }

  /** Sem falha, sem nível e sem espera: o repositório pode apagar a linha. */
  get estaZerado(): boolean {
    return this.#falhas === 0 && this.#nivel === 0 && this.#bloqueadoAte === null;
  }

  estaBloqueado(agora: Date): boolean {
    return this.#bloqueadoAte !== null && agora.getTime() < this.#bloqueadoAte.getTime();
  }

  /** Segundos até o fim da espera, arredondados para cima (`Retry-After`); 0 sem espera. */
  segundosDeEspera(agora: Date): number {
    if (!this.estaBloqueado(agora) || this.#bloqueadoAte === null) return 0;
    return Math.ceil((this.#bloqueadoAte.getTime() - agora.getTime()) / 1000);
  }

  /** Conta uma falha; ao atingir o limiar, aplica a espera do próximo nível. */
  registrarFalha(agora: Date): void {
    if (this.estaBloqueado(agora)) return;
    const instante = agora.getTime();
    if (this.#falhas === 0 || instante >= this.#janelaInicio.getTime() + JANELA_DE_FALHAS_EM_MS) {
      const calmo =
        this.#bloqueadoAte === null ||
        instante >= this.#bloqueadoAte.getTime() + CALMA_PARA_ZERAR_O_NIVEL_EM_MS;
      if (calmo) this.#nivel = 0;
      this.#falhas = 0;
      this.#janelaInicio = new Date(instante);
    }
    this.#falhas += 1;
    if (this.#falhas < LIMIAR_DE_FALHAS[this.#tipo]) return;
    this.#nivel = Math.min(this.#nivel + 1, ESPERAS_EM_MS.length);
    const espera = ESPERAS_EM_MS[this.#nivel - 1] ?? 0;
    this.#bloqueadoAte = new Date(instante + espera);
    this.#falhas = 0;
  }

  /**
   * Zera o freio depois de um sucesso, conforme o tipo: o de e-mail zera com a
   * senha certa; o de segundo fator só com o segundo fator concluído (S1); o
   * de IP nunca zera por sucesso (senão uma conta própria limparia o freio da
   * origem para atacar outras).
   */
  registrarSucesso(conclusao: Conclusao): void {
    const zera =
      (this.#tipo === 'email' && conclusao === 'senha') ||
      (this.#tipo === 'segundo_fator' && conclusao === 'segundo_fator');
    if (!zera) return;
    this.#falhas = 0;
    this.#nivel = 0;
    this.#bloqueadoAte = null;
  }

  get dados(): DadosDoBloqueioDeLogin {
    return {
      chaveHmac: this.#chaveHmac,
      tipo: this.#tipo,
      falhas: this.#falhas,
      nivel: this.#nivel,
      janelaInicio: new Date(this.#janelaInicio.getTime()),
      bloqueadoAte: copiarData(this.#bloqueadoAte),
    };
  }
}

/**
 * A maior espera entre os freios consultados (login: e-mail e IP), em
 * segundos; 0 se nenhum está ativo.
 */
export function maiorEspera(bloqueios: readonly BloqueioDeLogin[], agora: Date): number {
  return bloqueios.reduce(
    (maior, bloqueio) => Math.max(maior, bloqueio.segundosDeEspera(agora)),
    0,
  );
}

/**
 * Valor que a aplicação passa ao HMAC da chave do freio por origem: o IPv4 como
 * está (`ipv4:203.0.113.5`) ou os primeiros 64 bits do IPv6
 * (`ipv6:2001:db8:0:1::/64`), para que um bloco /64 conte como uma origem só
 * (S14). IPv4 mapeado em IPv6 (`::ffff:203.0.113.5`) conta como o IPv4. Aceita
 * o sufixo de zona (`%eth0`), que é descartado. Devolve `null` se o texto não
 * for um IP.
 */
export function valorDaChaveDeOrigem(ip: string): string | null {
  const texto = ip.trim().toLowerCase();
  const ipv4 = octetosIpv4(texto);
  if (ipv4 !== null) return `ipv4:${ipv4.join('.')}`;
  const grupos = gruposIpv6(texto.replace(/%[0-9a-z._~-]+$/, ''));
  if (grupos === null) return null;
  const mapeadoEmIpv4 = grupos.slice(0, 5).every((grupo) => grupo === 0) && grupos[5] === 0xffff;
  if (mapeadoEmIpv4) {
    const [alto = 0, baixo = 0] = grupos.slice(6);
    return `ipv4:${[alto >> 8, alto & 0xff, baixo >> 8, baixo & 0xff].join('.')}`;
  }
  const prefixo = grupos.slice(0, 4).map((grupo) => grupo.toString(16));
  return `ipv6:${prefixo.join(':')}::/64`;
}

const OCTETO = /^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/;
const GRUPO_IPV6 = /^[0-9a-f]{1,4}$/;

function octetosIpv4(texto: string): number[] | null {
  const partes = texto.split('.');
  if (partes.length !== 4 || !partes.every((parte) => OCTETO.test(parte))) return null;
  return partes.map(Number);
}

/** Os 8 grupos de 16 bits do IPv6, com `::` expandido e IPv4 no fim convertido. */
function gruposIpv6(texto: string): number[] | null {
  if (texto.length === 0 || texto.length > 45) return null;
  const metades = texto.split('::');
  if (metades.length > 2) return null;
  const lerLado = (lado: string): number[] | null => {
    if (lado.length === 0) return [];
    const partes = lado.split(':');
    const grupos: number[] = [];
    for (const [indice, parte] of partes.entries()) {
      const ultimo = indice === partes.length - 1;
      if (ultimo && parte.includes('.')) {
        const ipv4 = octetosIpv4(parte);
        if (ipv4 === null) return null;
        const [a = 0, b = 0, c = 0, d = 0] = ipv4;
        grupos.push((a << 8) | b, (c << 8) | d);
      } else if (GRUPO_IPV6.test(parte)) {
        grupos.push(Number.parseInt(parte, 16));
      } else {
        return null;
      }
    }
    return grupos;
  };
  const esquerda = lerLado(metades[0] ?? '');
  const direita = metades.length === 2 ? lerLado(metades[1] ?? '') : [];
  if (esquerda === null || direita === null) return null;
  // IPv4 embutido só pode vir no fim do endereço.
  if (metades.length === 2 && (metades[0] ?? '').includes('.')) return null;
  const total = esquerda.length + direita.length;
  if (metades.length === 1) return total === 8 ? esquerda : null;
  if (total > 7) return null;
  return [...esquerda, ...new Array<number>(8 - total).fill(0), ...direita];
}

function copiarData(data: Date | null): Date | null {
  return data === null ? null : new Date(data.getTime());
}
