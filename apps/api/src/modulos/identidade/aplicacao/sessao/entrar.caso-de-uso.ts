// Login (`POST /v1/sessoes`, público; CA-03, CA-04, CA-07; P1-dono, S1, S14,
// S23, S91; plano 01b, etapa 9).
//
// Três passos, e a senha é conferida entre duas transações curtas, sem conexão
// aberta nem trava (S91: o Argon2id, com os freios travados, seguraria uma
// conexão por login e esgotaria o pool com várias pessoas atrás do mesmo IP):
// 1. reserva da tentativa, numa transação: trava o freio por e-mail e depois o
//    por origem (a ordem das travas de `dominio/repositorios.ts`). O e-mail sem
//    conta também tem freio (S14). Sem IP válido, a origem é
//    `ORIGEM_DESCONHECIDA` (falha fechada). Freio ativo devolve `freado` sem
//    conferir a senha (CA-04). Senão, já conta uma falha nos dois freios, grava
//    e lê a conta. Como a falha é contada antes de conferir a senha, logins
//    simultâneos do mesmo e-mail não passam do limiar: nenhum confere a senha
//    depois da quinta falha;
// 2. fora da transação, confere a senha. Conta inexistente, fora de `ativa` ou
//    sem senha (admin antes da primeira redefinição) gasta o mesmo tempo contra
//    um hash fictício (`simularVerificacao`) e não confere. Senha errada: a
//    falha reservada fica e a resposta é `credenciais_invalidas`, a mesma para
//    todos os motivos (401 com mensagem única, CA-04);
// 3. senha certa, noutra transação: trava os freios na mesma ordem e relê a
//    conta. Se ela saiu de `ativa` ou trocou de senha no meio (exclusão,
//    redefinição), a falha reservada fica e a resposta é
//    `credenciais_invalidas`: a senha conferida era a de antes. Senão, zera o
//    freio por e-mail (`registrarSucesso`) e devolve a falha reservada ao de
//    origem (`estornarFalha`; o de origem não zera por sucesso). Então:
//    - painel sem perfil `admin` → `sem_acesso_painel` (403, S23), sem sessão;
//    - painel com `admin` → desafio do segundo fator (S1), sem sessão nem
//      login gravado: o login só termina no segundo fator
//      (`abrirSessaoComSegundoFator`);
//    - apps → grava `ultimo_login_em` (só em conta ativa; antes da sessão, na
//      ordem conta → sessões) e abre uma sessão de família nova, sem `mfa`.
//      Conta admin nos apps entra sem poderes de admin (`reivindicacoesDoToken`).
//      Conta não verificada entra, e a sessão leva `emailVerificado` (P1-dono).
//
// Nenhum resultado traz e-mail, senha ou nome; `sem_acesso_painel` traz só o
// id da conta, para o log (S23).
import type { Cliente } from '@bairrin/contratos/validadores';
import { Injectable } from '@nestjs/common';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import { type BloqueioDeLogin, maiorEspera } from '../../dominio/bloqueio-de-login.ts';
import type { Conta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import {
  RepositorioDeBloqueios,
  RepositorioDeContas,
  RepositorioDeDesafios,
  RepositorioDeSegundoFator,
  RepositorioDeSessoes,
} from '../../dominio/repositorios.ts';
import { podeUsarOPainel, reivindicacoesDoToken, Sessao } from '../../dominio/sessao.ts';
import { chaveDoFreioPorEmail, hashDoTokenDeRenovacao } from '../comum/chaves.ts';
import type { SessaoEmitida } from '../comum/sessao-emitida.ts';
import { Cifrador } from '../portas/cifrador.ts';
import { EmissorDeJwt } from '../portas/emissor-de-jwt.ts';
import { GeradorDeSegredos } from '../portas/gerador-de-segredos.ts';
import { Hasher } from '../portas/hasher.ts';
import { type DesafioEmitido, emitirDesafioDeSegundoFator } from '../segundo-fator/comum.ts';
import { chaveDoFreioPorOrigem } from './comum.ts';

/**
 * Corpo já validado por `entrarSchema` (`@bairrin/contratos`): e-mail
 * normalizado e senha como foi digitada. O `ip` vem do cabeçalho confiável do
 * proxy (etapa 16); ausente ou inválido, conta como `ORIGEM_DESCONHECIDA`.
 */
export interface EntradaDeEntrar {
  readonly email: string;
  readonly senha: string;
  readonly cliente: Cliente;
  readonly ip: string | null | undefined;
}

/**
 * - `sessao`: login nos apps (200 com a sessão);
 * - `desafio`: admin no painel com a senha certa (200 com `etapa` e `desafio`);
 * - `sem_acesso_painel`: senha certa no painel sem perfil `admin` (403, S23);
 * - `credenciais_invalidas`: e-mail sem conta, senha errada, conta que não
 *   pode entrar (401, mensagem única, CA-04);
 * - `freado`: freio por e-mail ou por origem ativo (429 com `Retry-After` =
 *   `segundosDeEspera`), senha não conferida.
 */
export type ResultadoDeEntrar =
  | { readonly tipo: 'sessao'; readonly sessao: SessaoEmitida }
  | { readonly tipo: 'desafio'; readonly desafio: DesafioEmitido }
  | { readonly tipo: 'sem_acesso_painel'; readonly contaId: string }
  | { readonly tipo: 'credenciais_invalidas' }
  | { readonly tipo: 'freado'; readonly segundosDeEspera: number };

const CREDENCIAIS_INVALIDAS = { tipo: 'credenciais_invalidas' } as const;

/** As chaves dos dois freios do login (só os HMACs). */
interface ChavesDosFreios {
  readonly email: string;
  readonly origem: string;
}

/** O que a reserva da tentativa devolve: o freio, ou a conta lida com a falha já contada. */
type Reserva =
  | { readonly tipo: 'freado'; readonly segundosDeEspera: number }
  | { readonly tipo: 'reservada'; readonly conta: Conta | null };

@Injectable()
export class EntrarCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly relogio: Relogio,
    private readonly contas: RepositorioDeContas,
    private readonly sessoes: RepositorioDeSessoes,
    private readonly bloqueios: RepositorioDeBloqueios,
    private readonly desafios: RepositorioDeDesafios,
    private readonly segundoFator: RepositorioDeSegundoFator,
    private readonly hasher: Hasher,
    private readonly cifrador: Cifrador,
    private readonly gerador: GeradorDeSegredos,
    private readonly emissor: EmissorDeJwt,
  ) {}

  async executar(entrada: EntradaDeEntrar): Promise<ResultadoDeEntrar> {
    // O contrato já normalizou; um e-mail inválido aqui é rota sem validação.
    const email = Email.criar(entrada.email);
    const agora = this.relogio.agora();
    const chaves: ChavesDosFreios = {
      email: chaveDoFreioPorEmail(this.cifrador, email),
      origem: chaveDoFreioPorOrigem(this.cifrador, entrada.ip),
    };

    const reserva = await this.unidade.executar(() => this.#reservar(chaves, email, agora));
    if (reserva.tipo === 'freado') return reserva;

    // Fora de transação: o Argon2id não segura conexão nem trava (S91).
    const { conta } = reserva;
    if (!(await this.#senhaConfere(conta, entrada.senha)) || conta === null) {
      return CREDENCIAIS_INVALIDAS;
    }

    return await this.unidade.executar(() => this.#concluir(chaves, conta, entrada.cliente, agora));
  }

  /**
   * Passo 1: trava os freios (e-mail, depois origem); freado devolve a espera;
   * senão conta a falha da tentativa nos dois, grava e lê a conta.
   */
  async #reservar(chaves: ChavesDosFreios, email: Email, agora: Date): Promise<Reserva> {
    const freios = await this.#travarFreios(chaves, agora);
    if (freios.some((freio) => freio.estaBloqueado(agora))) {
      const segundosDeEspera = maiorEspera(freios, agora);
      await this.#salvar(freios);
      return { tipo: 'freado', segundosDeEspera };
    }
    for (const freio of freios) freio.registrarFalha(agora);
    await this.#salvar(freios);
    return { tipo: 'reservada', conta: await this.contas.buscarPorEmail(email) };
  }

  /**
   * Passo 3, com a senha certa: trava os freios na mesma ordem e relê a conta;
   * conta que mudou no meio fica com a falha reservada. Senão, zera o freio por
   * e-mail, estorna a falha reservada na origem e segue para o painel ou os
   * apps.
   */
  async #concluir(
    chaves: ChavesDosFreios,
    conferida: Conta,
    cliente: Cliente,
    agora: Date,
  ): Promise<ResultadoDeEntrar> {
    const [freioDoEmail, freioDaOrigem] = await this.#travarFreios(chaves, agora);
    const conta = await this.contas.buscarPorId(conferida.id);
    // A senha conferida era a de antes: exclusão ou redefinição confirmada no meio.
    if (conta === null || !conta.podeEntrar || conta.senhaHash !== conferida.senhaHash) {
      await this.#salvar([freioDoEmail, freioDaOrigem]);
      return CREDENCIAIS_INVALIDAS;
    }
    freioDoEmail.registrarSucesso('senha');
    freioDaOrigem.estornarFalha(agora);
    await this.#salvar([freioDoEmail, freioDaOrigem]);

    if (cliente === 'painel') {
      if (!podeUsarOPainel(conta)) return { tipo: 'sem_acesso_painel', contaId: conta.id };
      const desafio = await emitirDesafioDeSegundoFator(
        {
          desafios: this.desafios,
          segundoFator: this.segundoFator,
          cifrador: this.cifrador,
          gerador: this.gerador,
        },
        conta.id,
        agora,
      );
      return { tipo: 'desafio', desafio };
    }

    // Só `ultimo_login_em`, e só com a conta ainda ativa; `false` é exclusão no meio.
    if (!(await this.contas.gravarUltimoLogin(conta.id, agora))) return CREDENCIAIS_INVALIDAS;
    const sessao = await this.#abrirSessao(conta, cliente, agora);
    return { tipo: 'sessao', sessao };
  }

  /** O freio por e-mail e depois o por origem, os dois travados (`[email, origem]`). */
  async #travarFreios(
    chaves: ChavesDosFreios,
    agora: Date,
  ): Promise<[BloqueioDeLogin, BloqueioDeLogin]> {
    const doEmail = await this.bloqueios.buscarParaAtualizar(chaves.email, 'email', agora);
    const daOrigem = await this.bloqueios.buscarParaAtualizar(chaves.origem, 'ip', agora);
    return [doEmail, daOrigem];
  }

  /**
   * A senha confere com a conta que pode entrar. Sem conta, ou com conta que
   * não pode entrar, gasta o tempo de um hash e devolve `false` (CA-04).
   */
  async #senhaConfere(conta: Conta | null, senha: string): Promise<boolean> {
    if (conta === null || !conta.podeEntrar || conta.senhaHash === null) {
      await this.hasher.simularVerificacao(senha);
      return false;
    }
    return this.hasher.verificar(senha, conta.senhaHash);
  }

  async #salvar(freios: readonly BloqueioDeLogin[]): Promise<void> {
    for (const freio of freios) await this.bloqueios.salvar(freio);
  }

  /**
   * Sessão nova nos apps (família nova, sem `mfa`): token de acesso de 15 min
   * e token de renovação de 30 dias deslizantes (CA-03), guardado só como
   * HMAC. O token é assinado dentro da transação: se a assinatura falhar, nada
   * fica gravado.
   */
  async #abrirSessao(
    conta: Conta,
    cliente: Exclude<Cliente, 'painel'>,
    agora: Date,
  ): Promise<SessaoEmitida> {
    const tokenRenovacao = this.gerador.tokenOpaco();
    const sessao = Sessao.criar({
      id: this.gerador.novoId(),
      contaId: conta.id,
      cliente,
      tokenHash: hashDoTokenDeRenovacao(this.cifrador, tokenRenovacao),
      mfa: false,
      agora,
    });
    await this.sessoes.inserir(sessao);
    const acesso = await this.emissor.emitir(reivindicacoesDoToken(conta, sessao), agora);
    return {
      tokenAcesso: acesso.token,
      expiraEm: acesso.expiraEm,
      emailVerificado: conta.emailVerificado,
      tokenRenovacao,
    };
  }
}
