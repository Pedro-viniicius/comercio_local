// Renovação da sessão (`POST /v1/sessoes/renovacao`, público; CA-03, CA-05;
// S1, S8, S16, S77, R1, R7; plano 01b, etapa 9).
//
// O token de renovação é procurado pelo HMAC na sessão (`buscarPorTokenHash`,
// atual ou anterior imediato) e, se não estiver lá, no histórico da família
// (`buscarTokenUsado`, S77):
// - token atual, sessão válida e mesmo `cliente` → rotação: token novo, par
//   novo (acesso + renovação) cifrado por 60 s, prazo deslizante (apps: 30
//   dias; painel: 30 min até o teto de 12 h) e `mfa` herdado da sessão;
// - token anterior imediato, dentro dos 60 s e do mesmo `cliente` → devolve o
//   par já emitido (tolerância, S16);
// - token anterior fora da tolerância, ou qualquer token do histórico → reuso:
//   revoga a família inteira (`reuso_detectado`) e responde inválido;
// - o resto (desconhecido, sessão revogada ou vencida, `cliente` trocado,
//   conta fora de `ativa`) → inválido, sem revogar nada.
// O `cliente` comparado é o da requisição, nunca o da sessão: `painel` pelo
// cookie com `X-Cliente: painel`, ou o `cliente` do corpo nos apps (etapa 5c).
//
// Rotação, na ordem das travas (conta → sessões, `dominio/repositorios.ts`):
// grava `ultimo_login_em` só em conta ativa (a renovação conta como login para
// o expurgo de 7 dias, P1-dono) e depois `gravarRotacao`, condicionada ao token
// antigo e à sessão não revogada. Com `false` (outra renovação com o mesmo
// token rotacionou antes, ou um logout, uma exclusão ou uma redefinição
// revogou no meio), relê pelo HMAC e avalia de novo uma vez: tolerância
// devolve o par da outra renovação; reuso ou inválido desfaz a transação, para
// não gravar o login de uma renovação recusada, e o reuso revoga a família
// numa transação nova.
//
// Nenhum resultado traz dado da conta além da sessão emitida.
import type { Cliente } from '@bairrin/contratos/validadores';
import { Injectable } from '@nestjs/common';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import { RepositorioDeContas, RepositorioDeSessoes } from '../../dominio/repositorios.ts';
import { avaliarTokenJaUsado, reivindicacoesDoToken, type Sessao } from '../../dominio/sessao.ts';
import { hashDoTokenDeRenovacao } from '../comum/chaves.ts';
import type { SessaoEmitida } from '../comum/sessao-emitida.ts';
import { Cifrador } from '../portas/cifrador.ts';
import { EmissorDeJwt } from '../portas/emissor-de-jwt.ts';
import { GeradorDeSegredos } from '../portas/gerador-de-segredos.ts';

/**
 * Nos apps, o corpo validado por `renovarSessaoSchema` (`tokenRenovacao` e
 * `cliente`); no painel, o token do cookie e `cliente = 'painel'` pelo
 * cabeçalho `X-Cliente` (etapa 16).
 */
export interface EntradaDeRenovarSessao {
  readonly tokenRenovacao: string;
  readonly cliente: Cliente;
}

/**
 * - `renovada`: o par novo, ou o da tolerância (200 com a sessão);
 * - `invalida`: 401, o mesmo para todos os motivos (inclusive o reuso).
 */
export type ResultadoDeRenovarSessao =
  { readonly tipo: 'renovada'; readonly sessao: SessaoEmitida } | { readonly tipo: 'invalida' };

const INVALIDA = { tipo: 'invalida' } as const;

/** O que fazer com o token, lido sem trava. */
type Avaliacao =
  | { readonly tipo: 'rotacionar'; readonly sessao: Sessao }
  | { readonly tipo: 'tolerancia'; readonly contaId: string; readonly parNovoCifrado: string }
  | { readonly tipo: 'reuso'; readonly familiaId: string }
  | { readonly tipo: 'invalida' };

/**
 * A renovação terminou recusada depois de gravar o login: desfaz a transação e,
 * no reuso, a família é revogada numa transação nova.
 */
class RenovacaoRecusadaNoMeio extends Error {
  constructor(readonly familiaParaRevogar: string | null) {
    super('Renovação recusada depois de gravar o login.');
    this.name = 'RenovacaoRecusadaNoMeio';
  }
}

@Injectable()
export class RenovarSessaoCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly relogio: Relogio,
    private readonly contas: RepositorioDeContas,
    private readonly sessoes: RepositorioDeSessoes,
    private readonly cifrador: Cifrador,
    private readonly gerador: GeradorDeSegredos,
    private readonly emissor: EmissorDeJwt,
  ) {}

  async executar(entrada: EntradaDeRenovarSessao): Promise<ResultadoDeRenovarSessao> {
    const agora = this.relogio.agora();
    const tokenHash = hashDoTokenDeRenovacao(this.cifrador, entrada.tokenRenovacao);
    try {
      return await this.unidade.executar(() => this.#renovar(tokenHash, entrada.cliente, agora));
    } catch (erro) {
      if (!(erro instanceof RenovacaoRecusadaNoMeio)) throw erro;
      const familia = erro.familiaParaRevogar;
      if (familia !== null) {
        await this.unidade.executar(() =>
          this.sessoes.revogarDaFamilia(familia, 'reuso_detectado', agora),
        );
      }
      return INVALIDA;
    }
  }

  async #renovar(
    tokenHash: string,
    cliente: Cliente,
    agora: Date,
  ): Promise<ResultadoDeRenovarSessao> {
    const avaliacao = await this.#avaliar(tokenHash, cliente, agora);
    switch (avaliacao.tipo) {
      case 'invalida':
        return INVALIDA;
      case 'reuso':
        await this.sessoes.revogarDaFamilia(avaliacao.familiaId, 'reuso_detectado', agora);
        return INVALIDA;
      case 'tolerancia':
        return this.#parDaTolerancia(avaliacao) ?? INVALIDA;
      case 'rotacionar':
        break;
    }

    const sessao = avaliacao.sessao;
    const conta = await this.contas.buscarPorId(sessao.contaId);
    if (conta?.status !== 'ativa') return INVALIDA;
    // Só `ultimo_login_em`, e só com a conta ainda ativa; `false` é exclusão no meio.
    if (!(await this.contas.gravarUltimoLogin(conta.id, agora))) return INVALIDA;

    const tokenRenovacao = this.gerador.tokenOpaco();
    // O `sid` e o `mfa` são os da sessão: o token novo leva os mesmos perfis.
    const acesso = await this.emissor.emitir(reivindicacoesDoToken(conta, sessao), agora);
    const emitida: SessaoEmitida = {
      tokenAcesso: acesso.token,
      expiraEm: acesso.expiraEm,
      emailVerificado: conta.emailVerificado,
      tokenRenovacao,
    };
    sessao.rotacionar(
      hashDoTokenDeRenovacao(this.cifrador, tokenRenovacao),
      cifrarPar(this.cifrador, conta.id, emitida),
      agora,
    );
    if (await this.sessoes.gravarRotacao(sessao)) return { tipo: 'renovada', sessao: emitida };

    // Outra transação mudou a sessão entre a leitura e o UPDATE (R1, R7).
    const relida = await this.#avaliar(tokenHash, cliente, agora);
    if (relida.tipo === 'tolerancia') {
      const par = this.#parDaTolerancia(relida);
      if (par !== null) return par;
    }
    throw new RenovacaoRecusadaNoMeio(relida.tipo === 'reuso' ? relida.familiaId : null);
  }

  async #avaliar(tokenHash: string, cliente: Cliente, agora: Date): Promise<Avaliacao> {
    const sessao = await this.sessoes.buscarPorTokenHash(tokenHash);
    if (sessao === null) {
      const usado = await this.sessoes.buscarTokenUsado(tokenHash);
      return usado !== null && avaliarTokenJaUsado(usado).tipo === 'reuso'
        ? { tipo: 'reuso', familiaId: usado.familiaId }
        : INVALIDA;
    }
    const avaliacao = sessao.avaliarRenovacao(tokenHash, cliente, agora);
    switch (avaliacao.tipo) {
      case 'rotacionar':
        return { tipo: 'rotacionar', sessao };
      case 'tolerancia':
        return {
          tipo: 'tolerancia',
          contaId: sessao.contaId,
          parNovoCifrado: avaliacao.parNovoCifrado,
        };
      case 'reuso':
        return { tipo: 'reuso', familiaId: sessao.familiaId };
      case 'invalida':
        return INVALIDA;
    }
  }

  /** O par da tolerância, ou `null` se não decifra (chave trocada ou texto alterado). */
  #parDaTolerancia(avaliacao: {
    readonly contaId: string;
    readonly parNovoCifrado: string;
  }): ResultadoDeRenovarSessao | null {
    const par = decifrarPar(this.cifrador, avaliacao.contaId, avaliacao.parNovoCifrado);
    return par === null ? null : { tipo: 'renovada', sessao: par };
  }
}

/** Forma do par novo dentro do texto cifrado (`par_novo_cifrado`). */
interface ParSerializado {
  readonly tokenAcesso: string;
  readonly expiraEm: string;
  readonly emailVerificado: boolean;
  readonly tokenRenovacao: string;
}

/** Cifra o par novo com a conta como AAD (S16): só decifra para a mesma conta. */
function cifrarPar(cifrador: Cifrador, contaId: string, par: SessaoEmitida): string {
  const serializado: ParSerializado = {
    tokenAcesso: par.tokenAcesso,
    expiraEm: par.expiraEm.toISOString(),
    emailVerificado: par.emailVerificado,
    tokenRenovacao: par.tokenRenovacao,
  };
  return cifrador.cifrar('par_novo_da_sessao', JSON.stringify(serializado), contaId);
}

function decifrarPar(cifrador: Cifrador, contaId: string, cifrado: string): SessaoEmitida | null {
  const texto = cifrador.decifrar('par_novo_da_sessao', cifrado, contaId);
  if (texto === null) return null;
  let lido: unknown;
  try {
    lido = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!ehParSerializado(lido)) return null;
  const expiraEm = new Date(lido.expiraEm);
  if (Number.isNaN(expiraEm.getTime())) return null;
  return {
    tokenAcesso: lido.tokenAcesso,
    expiraEm,
    emailVerificado: lido.emailVerificado,
    tokenRenovacao: lido.tokenRenovacao,
  };
}

function ehParSerializado(valor: unknown): valor is ParSerializado {
  if (typeof valor !== 'object' || valor === null) return false;
  const par = valor as Record<string, unknown>;
  return (
    typeof par['tokenAcesso'] === 'string' &&
    typeof par['expiraEm'] === 'string' &&
    typeof par['emailVerificado'] === 'boolean' &&
    typeof par['tokenRenovacao'] === 'string'
  );
}
