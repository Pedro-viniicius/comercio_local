// Verificação de e-mail (`POST /v1/conta/verificacao-email`, com sessão;
// CA-01; P1-dono, S1; plano 01b, etapa 8).
//
// - Vale só para a conta da sessão: o código procurado é o vigente desta conta,
//   e o HMAC cobre a conta (`[contaId, codigo]`, finalidade
//   `verificacao_email`), então o código emitido para outra conta não confere.
// - Código errado, vencido, já usado ou esgotado: sempre `codigo_invalido`
//   (400 com `campos[codigo].invalido`), também na quinta tentativa (spec 01,
//   A3). A tentativa errada fica gravada: a transação confirma.
// - Freio por e-mail (S93, grupo C): cada código que não serve soma uma falha
//   no freio por e-mail da conta (`chaveDoFreioPorEmail`, o mesmo do login, da
//   redefinição e da exclusão). Com o freio ativo, `freado` (429 com
//   `Retry-After`), sem conferir o código nem gastar tentativa. O código certo
//   não zera o freio: ele não é a senha, e o freio também protege o login.
// - Código certo: e-mail verificado e a sessão trocada por uma nova da mesma
//   família (a antiga é revogada com `substituida`), com o mesmo cliente e sem
//   `mfa`, então o token novo nunca leva `admin` (S1). No painel, a nova herda
//   o teto de 12 h da antiga (`expira_absoluto_em`, S9, S101): verificar o
//   e-mail não estica a sessão. Devolve o par novo.
// - Sessão revogada, vencida ou de outra conta, ou conta fora de `ativa`:
//   `sessao_invalida`, sem gastar tentativa do código. A guarda das rotas comuns
//   confere só `contas.status` (S8), então um token de acesso de sessão já
//   encerrada ainda chega aqui; sem esta conferência, a verificação
//   ressuscitaria uma sessão encerrada com um token de renovação novo.
//
// Ordem das travas, na mesma transação: o freio por e-mail (antes de tudo, como
// no cabeçalho de `dominio/repositorios.ts`) → o código (`buscarVigenteParaAtualizar`)
// → a conta (`gravarEmailVerificado`, um UPDATE só de `email_verificado_em`
// condicionado a `status = 'ativa'`) → as sessões da família
// (`revogarDaFamilia`, um UPDATE condicionado a `revogada_em IS NULL`), a mesma
// ordem conta → sessões do cabeçalho de `dominio/repositorios.ts` e da
// exclusão. A conta nunca é gravada inteira a partir de uma leitura velha. Se
// uma exclusão desativou a conta, ou um logout, uma exclusão ou uma
// redefinição de senha revogou a sessão depois da primeira leitura, um dos dois
// UPDATEs não muda nada e tudo é desfeito, inclusive o uso do código.
import { Injectable } from '@nestjs/common';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import {
  RepositorioDeBloqueios,
  RepositorioDeCodigosDeVerificacao,
  RepositorioDeContas,
  RepositorioDeSessoes,
} from '../../dominio/repositorios.ts';
import { reivindicacoesDoToken, Sessao } from '../../dominio/sessao.ts';
import { chaveDoFreioPorEmail, hashDoTokenDeRenovacao } from '../comum/chaves.ts';
import type { SessaoEmitida } from '../comum/sessao-emitida.ts';
import { Cifrador } from '../portas/cifrador.ts';
import { EmissorDeJwt } from '../portas/emissor-de-jwt.ts';
import { GeradorDeSegredos } from '../portas/gerador-de-segredos.ts';

export interface EntradaDeVerificarEmail {
  /** Conta do token de acesso (`sub`). */
  readonly contaId: string;
  /** Sessão do token de acesso (`sid`). */
  readonly sid: string;
  /** Código de 6 dígitos, já normalizado por `verificarEmailSchema`. */
  readonly codigo: string;
}

export type ResultadoDeVerificarEmail =
  | { readonly tipo: 'verificado'; readonly sessao: SessaoEmitida }
  | { readonly tipo: 'codigo_invalido' }
  | { readonly tipo: 'sessao_invalida' }
  /** Freio por e-mail da conta ativo (429 com `Retry-After` = `segundosDeEspera`; S93). */
  | { readonly tipo: 'freado'; readonly segundosDeEspera: number };

const CODIGO_INVALIDO: ResultadoDeVerificarEmail = { tipo: 'codigo_invalido' };
const SESSAO_INVALIDA: ResultadoDeVerificarEmail = { tipo: 'sessao_invalida' };

/** Sessão ou conta mudou no meio da transação: desfaz tudo e responde `sessao_invalida`. */
class SessaoEncerradaNoMeio extends Error {
  constructor() {
    super('Sessão ou conta encerrada durante a verificação de e-mail.');
    this.name = 'SessaoEncerradaNoMeio';
  }
}

@Injectable()
export class VerificarEmailCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly relogio: Relogio,
    private readonly contas: RepositorioDeContas,
    private readonly sessoes: RepositorioDeSessoes,
    private readonly codigos: RepositorioDeCodigosDeVerificacao,
    private readonly bloqueios: RepositorioDeBloqueios,
    private readonly cifrador: Cifrador,
    private readonly gerador: GeradorDeSegredos,
    private readonly emissor: EmissorDeJwt,
  ) {}

  async executar(entrada: EntradaDeVerificarEmail): Promise<ResultadoDeVerificarEmail> {
    const agora = this.relogio.agora();
    try {
      return await this.unidade.executar(() => this.#verificar(entrada, agora));
    } catch (erro) {
      if (erro instanceof SessaoEncerradaNoMeio) return SESSAO_INVALIDA;
      throw erro;
    }
  }

  async #verificar(
    { contaId, sid, codigo }: EntradaDeVerificarEmail,
    agora: Date,
  ): Promise<ResultadoDeVerificarEmail> {
    const sessao = await this.sessoes.buscarPorId(sid);
    if (sessao === null || sessao.contaId !== contaId || !sessao.estaAtiva(agora)) {
      return SESSAO_INVALIDA;
    }

    // Sem trava: só para a chave do freio (o e-mail da conta não muda).
    const lida = await this.contas.buscarPorId(contaId);
    if (lida?.status !== 'ativa') return SESSAO_INVALIDA;
    const freio = await this.bloqueios.buscarParaAtualizar(
      chaveDoFreioPorEmail(this.cifrador, lida.email),
      'email',
      agora,
    );
    if (freio.estaBloqueado(agora)) {
      await this.bloqueios.salvar(freio);
      return { tipo: 'freado', segundosDeEspera: freio.segundosDeEspera(agora) };
    }

    const registro = await this.codigos.buscarVigenteParaAtualizar(
      contaId,
      'verificacao_email',
      agora,
    );
    const resultado =
      registro === null
        ? 'invalido'
        : registro.conferir(
            this.cifrador.hmacConfere('verificacao_email', [contaId, codigo], registro.codigoHmac),
            agora,
          );
    if (registro !== null) await this.codigos.atualizar(registro);
    if (resultado !== 'aceito') freio.registrarFalha(agora);
    // Grava a falha, ou apaga a linha zerada que `buscarParaAtualizar` criou.
    await this.bloqueios.salvar(freio);
    if (resultado !== 'aceito') return CODIGO_INVALIDO;

    // Só `email_verificado_em`, e só com a conta ainda ativa; `false` é exclusão no meio.
    if (!(await this.contas.gravarEmailVerificado(contaId, agora))) {
      throw new SessaoEncerradaNoMeio();
    }

    const revogadas = await this.sessoes.revogarDaFamilia(sessao.familiaId, 'substituida', agora);
    if (revogadas === 0) throw new SessaoEncerradaNoMeio();

    // Lida depois do UPDATE, que trava a linha: perfis e verificação como estão agora.
    const conta = await this.contas.buscarPorId(contaId);
    if (conta?.status !== 'ativa') throw new SessaoEncerradaNoMeio();

    const tokenRenovacao = this.gerador.tokenOpaco();
    const nova = Sessao.criar({
      id: this.gerador.novoId(),
      contaId,
      cliente: sessao.cliente,
      tokenHash: hashDoTokenDeRenovacao(this.cifrador, tokenRenovacao),
      // Verificação de e-mail nunca concede segundo fator, nem no painel (S1).
      mfa: false,
      agora,
      familiaId: sessao.familiaId,
      // No painel, a substituta não vive além das 12 h do login (S9, S101).
      tetoHerdado: sessao.dados.expiraAbsolutoEm,
    });
    await this.sessoes.inserir(nova);

    // Dentro da transação: se a assinatura falhar, a sessão antiga continua valendo.
    const acesso = await this.emissor.emitir(reivindicacoesDoToken(conta, nova), agora);
    return {
      tipo: 'verificado',
      sessao: {
        tokenAcesso: acesso.token,
        expiraEm: acesso.expiraEm,
        emailVerificado: conta.emailVerificado,
        tokenRenovacao,
      },
    };
  }
}
