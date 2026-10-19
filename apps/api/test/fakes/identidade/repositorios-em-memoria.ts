// Repositórios da Identidade em memória, para os testes de unidade dos casos
// de uso (etapas 8 a 13). Guardam cópias (`dados`) e remontam a entidade a
// cada leitura, como o banco: mudar o objeto lido não muda o guardado até o
// `atualizar`. Imitam as restrições do esquema que os casos de uso sentem
// (e-mail e `token_hash` únicos, cascata ao apagar a conta, só o expurgo apaga
// conta) e participam da `UnidadeDeTrabalhoFalsa`: cada gravação registra como
// se desfazer, e a unidade que falha desfaz só o que ela gravou.
//
// Leituras com trava (R1): os métodos `...ParaAtualizar` e `gravarRotacao`
// travam a linha na unidade (`UnidadeDeTrabalhoFalsa.travar`) e rejeitam fora
// dela, como pede a porta. A segunda unidade espera a primeira terminar e lê o
// que ela gravou. As revogações de sessão (`atualizar`, `revogarDaFamilia`,
// `revogarDaConta`) também travam as linhas, como o UPDATE no Postgres (R11):
// sem isso, o rollback de uma rotação aberta apagaria a revogação gravada no
// meio. Fora de uma unidade, cada uma roda na própria unidade, como um comando
// avulso (autocommit) no banco. Na conta, travam a linha a leitura
// `buscarPorIdParaAtualizar` e as gravações de uma coluna novas
// (`gravarSenhaRedefinida`, `gravarSenhaRemovida`, `gravarDesativacao`, S95);
// `atualizar`, `gravarUltimoLogin` e `gravarEmailVerificado` não travam no fake.
//
// `criarIdentidadeEmMemoria()` monta tudo ligado: repositórios, auditoria,
// unidade de trabalho e publicador.
import {
  type EntradaDeAuditoria,
  RepositorioDeAuditoria,
  validarEntradaDeAuditoria,
} from '../../../src/compartilhado/auditoria/repositorio-de-auditoria.ts';
import {
  BloqueioDeLogin,
  type DadosDoBloqueioDeLogin,
  type TipoDeBloqueio,
} from '../../../src/modulos/identidade/dominio/bloqueio-de-login.ts';
import {
  CodigoDeVerificacao,
  type DadosDoCodigoDeVerificacao,
  type FinalidadeDoCodigo,
} from '../../../src/modulos/identidade/dominio/codigo-de-verificacao.ts';
import {
  Conta,
  type DadosDaConta,
  EmailJaCadastrado,
  type TipoDeDocumentoLegal,
} from '../../../src/modulos/identidade/dominio/conta.ts';
import {
  type DadosDoDesafioDeSegundoFator,
  DesafioDeSegundoFator,
} from '../../../src/modulos/identidade/dominio/desafio-de-segundo-fator.ts';
import type { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import {
  type CodigoDeRecuperacao,
  type Consentimento,
  type ConsentimentoComDocumento,
  type DocumentoLegal,
  type ExportacaoDoTitular,
  RepositorioDeBloqueios,
  RepositorioDeCodigosDeVerificacao,
  RepositorioDeContas,
  RepositorioDeDesafios,
  RepositorioDeDocumentosLegais,
  RepositorioDeExportacoes,
  RepositorioDeSegundoFator,
  RepositorioDeSessoes,
  RepositorioDeSolicitacoes,
  type SegundoFator,
  type SolicitacaoDoTitular,
  type StatusDaSolicitacao,
  type TipoDeSolicitacao,
} from '../../../src/modulos/identidade/dominio/repositorios.ts';
import {
  type DadosDaSessao,
  type MotivoDeRevogacao,
  Sessao,
  type TokenDeRenovacaoUsado,
} from '../../../src/modulos/identidade/dominio/sessao.ts';
import type { EtapaDoDesafio } from '@bairrin/contratos/validadores';
import { comoPromessa } from '../compartilhado/como-promessa.ts';
import { PublicadorDeEventosFalso } from '../compartilhado/publicador-de-eventos-falso.ts';
import { UnidadeDeTrabalhoFalsa } from '../compartilhado/unidade-de-trabalho-falsa.ts';

/**
 * Linhas de uma tabela. Toda alteração registra na unidade de trabalho como se
 * desfazer (o valor anterior da chave), para o rollback da unidade que falhar.
 */
class Tabela<Linha> {
  readonly #linhas = new Map<string, Linha>();
  readonly #unidade: UnidadeDeTrabalhoFalsa;

  constructor(unidade: UnidadeDeTrabalhoFalsa) {
    this.#unidade = unidade;
  }

  tem(chave: string): boolean {
    return this.#linhas.has(chave);
  }

  valores(): Linha[] {
    return [...this.#linhas.values()].map((linha) => structuredClone(linha));
  }

  ler(chave: string): Linha | undefined {
    const linha = this.#linhas.get(chave);
    return linha === undefined ? undefined : structuredClone(linha);
  }

  gravar(chave: string, linha: Linha): void {
    this.#registrarDesfazer(chave);
    this.#linhas.set(chave, structuredClone(linha));
  }

  apagar(chave: string): boolean {
    if (!this.#linhas.has(chave)) return false;
    this.#registrarDesfazer(chave);
    this.#linhas.delete(chave);
    return true;
  }

  apagarOnde(condicao: (linha: Linha) => boolean): number {
    const chaves = [...this.#linhas].filter(([, linha]) => condicao(linha)).map(([chave]) => chave);
    for (const chave of chaves) this.apagar(chave);
    return chaves.length;
  }

  #registrarDesfazer(chave: string): void {
    const antes = this.#linhas.get(chave);
    this.#unidade.registrarDesfazer(() => {
      if (antes === undefined) this.#linhas.delete(chave);
      else this.#linhas.set(chave, antes);
    });
  }
}

/** Erro de uso do falso (id repetido, linha inexistente): falha de programação do teste. */
function erroDoFalso(motivo: string): Error {
  return new Error(`Repositório em memória: ${motivo}.`);
}

// ---------------------------------------------------------------------------

export class ContasEmMemoria extends RepositorioDeContas {
  readonly #unidade: UnidadeDeTrabalhoFalsa;
  readonly #tabela: Tabela<DadosDaConta>;
  readonly #aoApagar: (contaId: string) => void;

  /** `aoApagar` imita o `ON DELETE CASCADE` nas outras tabelas da conta. */
  constructor(
    unidade: UnidadeDeTrabalhoFalsa,
    aoApagar: (contaId: string) => void = () => undefined,
  ) {
    super();
    this.#unidade = unidade;
    this.#tabela = new Tabela(unidade);
    this.#aoApagar = aoApagar;
  }

  /** Cópia do que está guardado, para o teste conferir sem passar pela entidade. */
  dadosDe(id: string): DadosDaConta | undefined {
    return this.#tabela.ler(id);
  }

  todas(): DadosDaConta[] {
    return this.#tabela.valores();
  }

  override buscarPorId(id: string): Promise<Conta | null> {
    return comoPromessa(() => {
      const dados = this.#tabela.ler(id);
      return dados === undefined ? null : Conta.reconstituir(dados);
    });
  }

  /**
   * Trava a conta na unidade (o `SELECT ... FOR NO KEY UPDATE`) e lê o que
   * estiver guardado depois da espera. Rejeita fora da unidade de trabalho.
   */
  override async buscarPorIdParaAtualizar(id: string): Promise<Conta | null> {
    await this.#unidade.travar(chaveDeTravaDaConta(id));
    const dados = this.#tabela.ler(id);
    return dados === undefined ? null : Conta.reconstituir(dados);
  }

  override buscarPorEmail(email: Email): Promise<Conta | null> {
    return comoPromessa(() => {
      const dados = this.#tabela.valores().find((conta) => conta.emailNormalizado === email.valor);
      return dados === undefined ? null : Conta.reconstituir(dados);
    });
  }

  override inserir(conta: Conta): Promise<void> {
    return comoPromessa(() => {
      const dados = conta.dados;
      if (this.#tabela.tem(dados.id)) throw erroDoFalso('id de conta repetido');
      this.#exigirEmailLivre(dados);
      this.#tabela.gravar(dados.id, dados);
    });
  }

  override atualizar(conta: Conta): Promise<void> {
    return comoPromessa(() => {
      const dados = conta.dados;
      if (!this.#tabela.tem(dados.id)) throw erroDoFalso('conta inexistente');
      this.#exigirEmailLivre(dados);
      this.#tabela.gravar(dados.id, dados);
    });
  }

  /** Só `ultimo_login_em`, e só se a conta existe e está ativa (`WHERE id AND status = 'ativa'`). */
  override gravarUltimoLogin(id: string, quando: Date): Promise<boolean> {
    return comoPromessa(() => {
      const dados = this.#tabela.ler(id);
      if (dados === undefined || dados.status !== 'ativa') return false;
      this.#tabela.gravar(id, { ...dados, ultimoLoginEm: new Date(quando.getTime()) });
      return true;
    });
  }

  /** Só `email_verificado_em`, com a primeira data guardada, e só em conta ativa. */
  override gravarEmailVerificado(id: string, quando: Date): Promise<boolean> {
    return comoPromessa(() => {
      const dados = this.#tabela.ler(id);
      if (dados === undefined || dados.status !== 'ativa') return false;
      this.#tabela.gravar(id, {
        ...dados,
        emailVerificadoEm: dados.emailVerificadoEm ?? new Date(quando.getTime()),
      });
      return true;
    });
  }

  /** Só `senha_hash` e `email_verificado_em` (primeira data), e só em conta ativa (S95). */
  override gravarSenhaRedefinida(id: string, senhaHash: string, quando: Date): Promise<boolean> {
    return this.#gravarSeAtiva(id, (dados) => ({
      ...dados,
      senhaHash,
      emailVerificadoEm: dados.emailVerificadoEm ?? new Date(quando.getTime()),
    }));
  }

  /** Só `senha_hash = NULL`, e só em conta ativa (S97). */
  override gravarSenhaRemovida(id: string): Promise<boolean> {
    return this.#gravarSeAtiva(id, (dados) => ({ ...dados, senhaHash: null }));
  }

  /** Só `status` e `desativada_em`, e só em conta ativa (S95). */
  override gravarDesativacao(id: string, quando: Date): Promise<boolean> {
    return this.#gravarSeAtiva(id, (dados) => ({
      ...dados,
      status: 'desativada',
      desativadaEm: new Date(quando.getTime()),
    }));
  }

  override listarParaExpurgo(limite: Date, quantidade: number): Promise<string[]> {
    return comoPromessa(() =>
      this.#tabela
        .valores()
        .filter((conta) => podeSerApagada(conta) && referenciaDoExpurgo(conta) < limite.getTime())
        .sort((a, b) => referenciaDoExpurgo(a) - referenciaDoExpurgo(b))
        .slice(0, quantidade)
        .map((conta) => conta.id),
    );
  }

  /**
   * Imita a trigger `contas_so_expurgo` (S78): recusa a conta verificada, não
   * ativa ou com perfil `admin` ou `lojista`. A parte do tempo (sem login há 7
   * dias) o banco confere com `now()`, e o fake não, porque os testes usam o
   * `RelogioFixo`.
   */
  override apagar(id: string): Promise<void> {
    return comoPromessa(() => {
      const dados = this.#tabela.ler(id);
      if (dados === undefined) return;
      if (!podeSerApagada(dados)) throw erroDoFalso('só o expurgo apaga conta (S78)');
      this.#tabela.apagar(id);
      this.#aoApagar(id);
    });
  }

  /**
   * Como o `UPDATE ... WHERE id = $1 AND status = 'ativa'`: dentro de uma
   * unidade, trava a linha antes (o UPDATE trava até o fim da transação) e
   * confere o status com o valor guardado depois da espera.
   */
  async #gravarSeAtiva(id: string, mudar: (dados: DadosDaConta) => DadosDaConta): Promise<boolean> {
    if (this.#unidade.emTransacao) await this.#unidade.travar(chaveDeTravaDaConta(id));
    const dados = this.#tabela.ler(id);
    if (dados === undefined || dados.status !== 'ativa') return false;
    this.#tabela.gravar(id, mudar(dados));
    return true;
  }

  #exigirEmailLivre(dados: DadosDaConta): void {
    const outra = this.#tabela
      .valores()
      .find((conta) => conta.emailNormalizado === dados.emailNormalizado && conta.id !== dados.id);
    if (outra !== undefined) throw new EmailJaCadastrado();
  }
}

/** A parte da regra do expurgo que não depende do tempo (`Conta.deveSerExpurgada`). */
function podeSerApagada(conta: DadosDaConta): boolean {
  return (
    conta.status === 'ativa' &&
    conta.emailVerificadoEm === null &&
    !conta.perfis.some(({ perfil }) => perfil === 'admin' || perfil === 'lojista')
  );
}

function referenciaDoExpurgo(conta: DadosDaConta): number {
  return (conta.ultimoLoginEm ?? conta.criadaEm).getTime();
}

// ---------------------------------------------------------------------------

export class SessoesEmMemoria extends RepositorioDeSessoes {
  readonly #unidade: UnidadeDeTrabalhoFalsa;
  readonly #tabela: Tabela<DadosDaSessao>;
  /** `tokens_de_renovacao_usados` (S77), pela chave `token_hash`. */
  readonly #usados: Tabela<TokenDeRenovacaoUsado>;

  constructor(unidade: UnidadeDeTrabalhoFalsa) {
    super();
    this.#unidade = unidade;
    this.#tabela = new Tabela(unidade);
    this.#usados = new Tabela(unidade);
  }

  todas(): DadosDaSessao[] {
    return this.#tabela.valores();
  }

  /** O histórico de tokens trocados, para o teste conferir. */
  tokensUsados(): TokenDeRenovacaoUsado[] {
    return this.#usados.valores();
  }

  dadosDe(id: string): DadosDaSessao | undefined {
    return this.#tabela.ler(id);
  }

  override buscarPorId(id: string): Promise<Sessao | null> {
    return comoPromessa(() => {
      const dados = this.#tabela.ler(id);
      return dados === undefined ? null : Sessao.reconstituir(dados);
    });
  }

  override buscarPorTokenHash(tokenHash: string): Promise<Sessao | null> {
    return comoPromessa(() => {
      const sessoes = this.#tabela.valores();
      const dados =
        sessoes.find((sessao) => sessao.tokenHash === tokenHash) ??
        sessoes.find((sessao) => sessao.tokenAnteriorHash === tokenHash);
      return dados === undefined ? null : Sessao.reconstituir(dados);
    });
  }

  override buscarTokenUsado(tokenHash: string): Promise<TokenDeRenovacaoUsado | null> {
    return comoPromessa(() => this.#usados.ler(tokenHash) ?? null);
  }

  override inserir(sessao: Sessao): Promise<void> {
    return comoPromessa(() => {
      const dados = sessao.dados;
      if (this.#tabela.tem(dados.id)) throw erroDoFalso('id de sessão repetido');
      this.#exigirTokenUnico(dados);
      this.#tabela.gravar(dados.id, dados);
    });
  }

  /**
   * Só a revogação, com `coalesce` (R7): a primeira revogação guardada fica, e
   * nada além das colunas da revogação muda, mesmo que a entidade tenha sido
   * lida antes de uma rotação. Recusa sessão não revogada (rotação é por
   * `gravarRotacao`). Trava a linha antes de gravar (R11).
   */
  override async atualizar(sessao: Sessao): Promise<void> {
    const { id, revogadaEm, motivoRevogacao } = sessao.dados;
    if (revogadaEm === null || motivoRevogacao === null) {
      throw erroDoFalso('atualizar só grava a revogação; a rotação vai por gravarRotacao');
    }
    await this.#unidade.executar(async () => {
      await this.#unidade.travar(chaveDeTravaDaSessao(id));
      const guardada = this.#tabela.ler(id);
      if (guardada === undefined) throw erroDoFalso('sessão inexistente');
      this.#tabela.gravar(id, {
        ...guardada,
        revogadaEm: guardada.revogadaEm ?? revogadaEm,
        motivoRevogacao: guardada.motivoRevogacao ?? motivoRevogacao,
        parNovoCifrado: null,
        parNovoExpiraEm: null,
      });
    });
  }

  /**
   * Como o `UPDATE ... WHERE id = $1 AND token_hash = <token trocado> AND
   * revogada_em IS NULL` (R1, R7): trava a linha, grava só se o token guardado
   * ainda é o trocado e a sessão não foi revogada, muda só as colunas da
   * rotação e inclui o trocado no histórico. Rejeita fora da unidade de trabalho.
   */
  override async gravarRotacao(sessao: Sessao): Promise<boolean> {
    const dados = sessao.dados;
    const trocado = sessao.ultimoTokenTrocado;
    if (trocado === null) throw erroDoFalso('gravarRotacao de sessão que não rotacionou');
    await this.#unidade.travar(chaveDeTravaDaSessao(dados.id));
    const guardada = this.#tabela.ler(dados.id);
    if (
      guardada === undefined ||
      guardada.tokenHash !== trocado.tokenHash ||
      guardada.revogadaEm !== null
    ) {
      return false;
    }
    this.#exigirTokenUnico(dados);
    if (this.#usados.tem(trocado.tokenHash)) throw erroDoFalso('token já está no histórico');
    this.#tabela.gravar(dados.id, {
      ...guardada,
      tokenHash: dados.tokenHash,
      tokenAnteriorHash: dados.tokenAnteriorHash,
      parNovoCifrado: dados.parNovoCifrado,
      parNovoExpiraEm: dados.parNovoExpiraEm,
      trocadoEm: dados.trocadoEm,
      ultimoUsoEm: dados.ultimoUsoEm,
      expiraEm: dados.expiraEm,
    });
    this.#usados.gravar(trocado.tokenHash, trocado);
    return true;
  }

  override revogarDaFamilia(
    familiaId: string,
    motivo: MotivoDeRevogacao,
    agora: Date,
  ): Promise<number> {
    return this.#revogarOnde((s) => s.familiaId === familiaId, motivo, agora);
  }

  override revogarDaConta(
    contaId: string,
    motivo: MotivoDeRevogacao,
    agora: Date,
  ): Promise<number> {
    return this.#revogarOnde((s) => s.contaId === contaId, motivo, agora);
  }

  override apagarDaConta(contaId: string): Promise<void> {
    return comoPromessa(() => {
      this.removerDaConta(contaId);
    });
  }

  /** Cascata síncrona, usada por `ContasEmMemoria.apagar`; leva o histórico das sessões. */
  removerDaConta(contaId: string): void {
    const ids = new Set(
      this.todas()
        .filter((s) => s.contaId === contaId)
        .map((s) => s.id),
    );
    this.#tabela.apagarOnde((sessao) => ids.has(sessao.id));
    this.#usados.apagarOnde((usado) => ids.has(usado.sessaoId));
  }

  /**
   * Como o `UPDATE ... WHERE <condição> AND revogada_em IS NULL`: trava cada
   * linha que casa (em ordem de id, para duas revogações não se cruzarem),
   * espera quem a segura e confere de novo a condição com o valor guardado,
   * como o Postgres reavalia o WHERE depois da espera (R11).
   */
  #revogarOnde(
    condicao: (sessao: DadosDaSessao) => boolean,
    motivo: MotivoDeRevogacao,
    agora: Date,
  ): Promise<number> {
    const casa = (dados: DadosDaSessao) => condicao(dados) && dados.revogadaEm === null;
    return this.#unidade.executar(async () => {
      const ids = this.#tabela
        .valores()
        .filter(casa)
        .map((dados) => dados.id)
        .sort();
      let revogadas = 0;
      for (const id of ids) {
        await this.#unidade.travar(chaveDeTravaDaSessao(id));
        const dados = this.#tabela.ler(id);
        if (dados === undefined || !casa(dados)) continue;
        const sessao = Sessao.reconstituir(dados);
        sessao.revogar(motivo, agora);
        this.#tabela.gravar(id, sessao.dados);
        revogadas += 1;
      }
      return revogadas;
    });
  }

  #exigirTokenUnico(dados: DadosDaSessao): void {
    const repetido = this.#tabela
      .valores()
      .some((sessao) => sessao.tokenHash === dados.tokenHash && sessao.id !== dados.id);
    if (repetido) throw erroDoFalso('token_hash repetido');
  }
}

// ---------------------------------------------------------------------------

export class DesafiosEmMemoria extends RepositorioDeDesafios {
  readonly #unidade: UnidadeDeTrabalhoFalsa;
  readonly #tabela: Tabela<DadosDoDesafioDeSegundoFator>;

  constructor(unidade: UnidadeDeTrabalhoFalsa) {
    super();
    this.#unidade = unidade;
    this.#tabela = new Tabela(unidade);
  }

  todos(): DadosDoDesafioDeSegundoFator[] {
    return this.#tabela.valores();
  }

  override inserir(desafio: DesafioDeSegundoFator): Promise<void> {
    return comoPromessa(() => {
      if (this.#tabela.tem(desafio.id)) throw erroDoFalso('id de desafio repetido');
      this.#tabela.gravar(desafio.id, desafio.dados);
    });
  }

  override atualizar(desafio: DesafioDeSegundoFator): Promise<void> {
    return comoPromessa(() => {
      if (!this.#tabela.tem(desafio.id)) throw erroDoFalso('desafio inexistente');
      this.#tabela.gravar(desafio.id, desafio.dados);
    });
  }

  /** Trava a linha (a mesma chave dos códigos: no banco, a tabela é uma só). */
  override async buscarPorIdParaAtualizar(id: string): Promise<DesafioDeSegundoFator | null> {
    await this.#unidade.travar(chaveDeTravaDoCodigo(id));
    const dados = this.#tabela.ler(id);
    return dados === undefined ? null : DesafioDeSegundoFator.reconstituir(dados);
  }

  override invalidarVigentes(contaId: string, etapa: EtapaDoDesafio, agora: Date): Promise<void> {
    return comoPromessa(() => {
      for (const dados of this.#tabela.valores()) {
        const desafio = DesafioDeSegundoFator.reconstituir(dados);
        if (dados.contaId !== contaId || !desafio.estaValidoPara(etapa, agora)) continue;
        this.#tabela.gravar(dados.id, { ...dados, usadoEm: new Date(agora.getTime()) });
      }
    });
  }

  /** Cascata síncrona (mesma tabela dos códigos no banco). */
  removerDaConta(contaId: string): void {
    this.#tabela.apagarOnde((desafio) => desafio.contaId === contaId);
  }
}

function chaveDeTravaDaConta(id: string): string {
  return `contas:${id}`;
}

function chaveDeTravaDaSessao(id: string): string {
  return `sessoes:${id}`;
}

/** Códigos e desafios moram em `codigos_verificacao`: a trava é pela linha dessa tabela. */
function chaveDeTravaDoCodigo(id: string): string {
  return `codigos_verificacao:${id}`;
}

export class CodigosEmMemoria extends RepositorioDeCodigosDeVerificacao {
  readonly #unidade: UnidadeDeTrabalhoFalsa;
  readonly #tabela: Tabela<DadosDoCodigoDeVerificacao>;
  readonly #desafios: DesafiosEmMemoria | undefined;

  /** Com `desafios`, `apagarDaConta` apaga também os desafios (mesma tabela no banco). */
  constructor(unidade: UnidadeDeTrabalhoFalsa, desafios?: DesafiosEmMemoria) {
    super();
    this.#unidade = unidade;
    this.#tabela = new Tabela(unidade);
    this.#desafios = desafios;
  }

  todos(): DadosDoCodigoDeVerificacao[] {
    return this.#tabela.valores();
  }

  override inserir(codigo: CodigoDeVerificacao): Promise<void> {
    return comoPromessa(() => {
      if (this.#tabela.tem(codigo.id)) throw erroDoFalso('id de código repetido');
      this.#tabela.gravar(codigo.id, codigo.dados);
    });
  }

  override atualizar(codigo: CodigoDeVerificacao): Promise<void> {
    return comoPromessa(() => {
      if (!this.#tabela.tem(codigo.id)) throw erroDoFalso('código inexistente');
      this.#tabela.gravar(codigo.id, codigo.dados);
    });
  }

  /**
   * Trava o vigente mais recente e, depois de esperar, confere de novo a
   * validade com o valor gravado (como o Postgres reavalia o WHERE da linha
   * travada que outra transação alterou).
   */
  override async buscarVigenteParaAtualizar(
    contaId: string,
    finalidade: FinalidadeDoCodigo,
    agora: Date,
  ): Promise<CodigoDeVerificacao | null> {
    this.#unidade.exigirTransacao('Leitura com trava');
    const candidato = this.#vigentes(contaId, finalidade, agora).at(-1);
    if (candidato === undefined) return null;
    await this.#unidade.travar(chaveDeTravaDoCodigo(candidato.id));
    const dados = this.#tabela.ler(candidato.id);
    if (dados === undefined) return null;
    const codigo = CodigoDeVerificacao.reconstituir(dados);
    return codigo.estaValido(agora) ? codigo : null;
  }

  override invalidarVigentes(
    contaId: string,
    finalidade: FinalidadeDoCodigo,
    agora: Date,
  ): Promise<void> {
    return comoPromessa(() => {
      for (const codigo of this.#vigentes(contaId, finalidade, agora)) {
        codigo.invalidar(agora);
        this.#tabela.gravar(codigo.id, codigo.dados);
      }
    });
  }

  override apagarDaConta(contaId: string): Promise<void> {
    return comoPromessa(() => {
      this.removerDaConta(contaId);
    });
  }

  /** Cascata síncrona, usada por `ContasEmMemoria.apagar`. */
  removerDaConta(contaId: string): void {
    this.#tabela.apagarOnde((codigo) => codigo.contaId === contaId);
    this.#desafios?.removerDaConta(contaId);
  }

  /** Em ordem de emissão, `criado_em` (o mais recente por último). */
  #vigentes(contaId: string, finalidade: FinalidadeDoCodigo, agora: Date): CodigoDeVerificacao[] {
    return this.#tabela
      .valores()
      .filter((dados) => dados.contaId === contaId && dados.finalidade === finalidade)
      .sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime())
      .map((dados) => CodigoDeVerificacao.reconstituir(dados))
      .filter((codigo) => codigo.estaValido(agora));
  }
}

// ---------------------------------------------------------------------------

export class BloqueiosEmMemoria extends RepositorioDeBloqueios {
  readonly #unidade: UnidadeDeTrabalhoFalsa;
  readonly #tabela: Tabela<DadosDoBloqueioDeLogin>;

  constructor(unidade: UnidadeDeTrabalhoFalsa) {
    super();
    this.#unidade = unidade;
    this.#tabela = new Tabela(unidade);
  }

  todos(): DadosDoBloqueioDeLogin[] {
    return this.#tabela.valores();
  }

  override buscar(chaveHmac: string, tipo: TipoDeBloqueio): Promise<BloqueioDeLogin | null> {
    return comoPromessa(() => {
      const dados = this.#tabela.ler(`${tipo}:${chaveHmac}`);
      return dados === undefined ? null : BloqueioDeLogin.reconstituir(dados);
    });
  }

  /**
   * Trava a chave e, sem linha, grava o freio zerado, como o `INSERT ... ON
   * CONFLICT DO UPDATE ... RETURNING` do adaptador: sempre devolve um freio,
   * inclusive quando a unidade que segurava a trava apagou a linha zerada
   * (`salvar`) enquanto esta esperava (A-R1, S96).
   */
  override async buscarParaAtualizar(
    chaveHmac: string,
    tipo: TipoDeBloqueio,
    agora: Date,
  ): Promise<BloqueioDeLogin> {
    const chave = `${tipo}:${chaveHmac}`;
    await this.#unidade.travar(`bloqueios_login:${chave}`);
    const dados = this.#tabela.ler(chave) ?? BloqueioDeLogin.novo(chaveHmac, tipo, agora).dados;
    if (!this.#tabela.tem(chave)) this.#tabela.gravar(chave, dados);
    return BloqueioDeLogin.reconstituir(dados);
  }

  override salvar(bloqueio: BloqueioDeLogin): Promise<void> {
    return comoPromessa(() => {
      const chave = `${bloqueio.tipo}:${bloqueio.chaveHmac}`;
      if (bloqueio.estaZerado) this.#tabela.apagar(chave);
      else this.#tabela.gravar(chave, bloqueio.dados);
    });
  }
}

// ---------------------------------------------------------------------------

export class DocumentosLegaisEmMemoria extends RepositorioDeDocumentosLegais {
  readonly #documentos: Tabela<DocumentoLegal>;
  readonly #consentimentos: Tabela<Consentimento>;

  constructor(unidade: UnidadeDeTrabalhoFalsa) {
    super();
    this.#documentos = new Tabela(unidade);
    this.#consentimentos = new Tabela(unidade);
  }

  /** Prepara um documento (o seed, nos testes). */
  adicionarDocumento(documento: DocumentoLegal): void {
    this.#documentos.gravar(documento.id, documento);
  }

  consentimentos(): Consentimento[] {
    return this.#consentimentos.valores();
  }

  override buscarVigente(tipo: TipoDeDocumentoLegal, agora: Date): Promise<DocumentoLegal | null> {
    return comoPromessa(() => {
      const vigentes = this.#documentos
        .valores()
        .filter((doc) => doc.tipo === tipo && doc.vigenteDesde.getTime() <= agora.getTime())
        .sort((a, b) => a.vigenteDesde.getTime() - b.vigenteDesde.getTime());
      return vigentes.at(-1) ?? null;
    });
  }

  override registrarConsentimento(consentimento: Consentimento): Promise<void> {
    return comoPromessa(() => {
      if (this.#consentimentos.tem(consentimento.id)) {
        throw erroDoFalso('id de consentimento repetido');
      }
      if (!this.#documentos.tem(consentimento.documentoId)) {
        throw erroDoFalso('consentimento de documento inexistente');
      }
      const repetido = this.#consentimentos
        .valores()
        .some(
          (c) => c.contaId === consentimento.contaId && c.documentoId === consentimento.documentoId,
        );
      if (repetido) throw erroDoFalso('consentimento repetido para a conta e o documento');
      this.#consentimentos.gravar(consentimento.id, consentimento);
    });
  }

  override buscarAceite(contaId: string, documentoId: string): Promise<Date | null> {
    return comoPromessa(() => {
      const aceites = this.#consentimentos
        .valores()
        .filter((c) => c.contaId === contaId && c.documentoId === documentoId)
        .map((c) => c.aceitoEm.getTime());
      return aceites.length === 0 ? null : new Date(Math.max(...aceites));
    });
  }

  /** Os aceites da conta com tipo e versão do documento, do mais antigo para o mais novo. */
  override listarConsentimentos(contaId: string): Promise<readonly ConsentimentoComDocumento[]> {
    return comoPromessa(() =>
      this.#consentimentos
        .valores()
        .filter((c) => c.contaId === contaId)
        .sort((a, b) => a.aceitoEm.getTime() - b.aceitoEm.getTime() || a.id.localeCompare(b.id))
        .map((c) => {
          const documento = this.#documentos.ler(c.documentoId);
          if (documento === undefined) throw erroDoFalso('consentimento de documento inexistente');
          return { ...c, tipo: documento.tipo, versao: documento.versao };
        }),
    );
  }

  /** Cascata síncrona, usada por `ContasEmMemoria.apagar`. */
  removerDaConta(contaId: string): void {
    this.#consentimentos.apagarOnde((consentimento) => consentimento.contaId === contaId);
  }
}

// ---------------------------------------------------------------------------

export class SegundoFatorEmMemoria extends RepositorioDeSegundoFator {
  readonly #fatores: Tabela<SegundoFator>;
  readonly #codigos: Tabela<CodigoDeRecuperacao>;

  constructor(unidade: UnidadeDeTrabalhoFalsa) {
    super();
    this.#fatores = new Tabela(unidade);
    this.#codigos = new Tabela(unidade);
  }

  codigosDeRecuperacao(): CodigoDeRecuperacao[] {
    return this.#codigos.valores();
  }

  override buscar(contaId: string): Promise<SegundoFator | null> {
    return comoPromessa(() => this.#fatores.ler(contaId) ?? null);
  }

  override salvar(segundoFator: SegundoFator): Promise<void> {
    return comoPromessa(() => {
      this.#fatores.gravar(segundoFator.contaId, segundoFator);
    });
  }

  override apagar(contaId: string): Promise<void> {
    return comoPromessa(() => {
      this.removerDaConta(contaId);
    });
  }

  override substituirCodigosDeRecuperacao(
    contaId: string,
    codigos: readonly CodigoDeRecuperacao[],
  ): Promise<void> {
    return comoPromessa(() => {
      if (codigos.some((codigo) => codigo.contaId !== contaId)) {
        throw erroDoFalso('código de recuperação de outra conta');
      }
      this.#codigos.apagarOnde((codigo) => codigo.contaId === contaId);
      for (const codigo of codigos) this.#codigos.gravar(codigo.id, codigo);
    });
  }

  override listarCodigosDeRecuperacaoNaoUsados(
    contaId: string,
  ): Promise<readonly CodigoDeRecuperacao[]> {
    return comoPromessa(() =>
      this.#codigos
        .valores()
        .filter((codigo) => codigo.contaId === contaId && codigo.usadoEm === null),
    );
  }

  override marcarCodigoDeRecuperacaoUsado(id: string, agora: Date): Promise<void> {
    return comoPromessa(() => {
      const codigo = this.#codigos.ler(id);
      if (codigo === undefined) throw erroDoFalso('código de recuperação inexistente');
      this.#codigos.gravar(id, { ...codigo, usadoEm: codigo.usadoEm ?? agora });
    });
  }

  /** Cascata síncrona, usada por `ContasEmMemoria.apagar`. */
  removerDaConta(contaId: string): void {
    this.#fatores.apagar(contaId);
    this.#codigos.apagarOnde((codigo) => codigo.contaId === contaId);
  }
}

// ---------------------------------------------------------------------------

export class SolicitacoesEmMemoria extends RepositorioDeSolicitacoes {
  readonly #tabela: Tabela<SolicitacaoDoTitular>;

  constructor(unidade: UnidadeDeTrabalhoFalsa) {
    super();
    this.#tabela = new Tabela(unidade);
  }

  todas(): SolicitacaoDoTitular[] {
    return this.#tabela.valores();
  }

  override inserir(solicitacao: SolicitacaoDoTitular): Promise<void> {
    return comoPromessa(() => {
      if (this.#tabela.tem(solicitacao.id)) throw erroDoFalso('id de solicitação repetido');
      this.#tabela.gravar(solicitacao.id, solicitacao);
    });
  }

  override atualizar(solicitacao: SolicitacaoDoTitular): Promise<void> {
    return comoPromessa(() => {
      if (!this.#tabela.tem(solicitacao.id)) throw erroDoFalso('solicitação inexistente');
      if (solicitacao.status === 'concluida' && solicitacao.concluidaEm === null) {
        throw erroDoFalso('solicitação concluída sem concluida_em');
      }
      this.#tabela.gravar(solicitacao.id, solicitacao);
    });
  }

  override buscarPorId(id: string): Promise<SolicitacaoDoTitular | null> {
    return comoPromessa(() => this.#tabela.ler(id) ?? null);
  }

  override buscarUltima(
    contaId: string,
    tipo: TipoDeSolicitacao,
  ): Promise<SolicitacaoDoTitular | null> {
    return comoPromessa(() => {
      const daConta = this.#tabela
        .valores()
        .filter((s) => s.contaId === contaId && s.tipo === tipo)
        .sort((a, b) => a.solicitadaEm.getTime() - b.solicitadaEm.getTime());
      return daConta.at(-1) ?? null;
    });
  }

  override contarDesde(contaId: string, tipo: TipoDeSolicitacao, desde: Date): Promise<number> {
    return comoPromessa(
      () =>
        this.#tabela
          .valores()
          .filter(
            (s) =>
              s.contaId === contaId &&
              s.tipo === tipo &&
              s.solicitadaEm.getTime() > desde.getTime(),
          ).length,
    );
  }

  override listarPorStatus(
    tipo: TipoDeSolicitacao,
    status: StatusDaSolicitacao,
    quantidade: number,
  ): Promise<readonly SolicitacaoDoTitular[]> {
    return comoPromessa(() =>
      this.#tabela
        .valores()
        .filter((s) => s.tipo === tipo && s.status === status)
        .sort((a, b) => a.solicitadaEm.getTime() - b.solicitadaEm.getTime())
        .slice(0, quantidade),
    );
  }

  /** Cascata síncrona, usada por `ContasEmMemoria.apagar`. */
  removerDaConta(contaId: string): void {
    this.#tabela.apagarOnde((solicitacao) => solicitacao.contaId === contaId);
  }
}

export class ExportacoesEmMemoria extends RepositorioDeExportacoes {
  readonly #tabela: Tabela<ExportacaoDoTitular>;

  constructor(unidade: UnidadeDeTrabalhoFalsa) {
    super();
    this.#tabela = new Tabela(unidade);
  }

  todas(): ExportacaoDoTitular[] {
    return this.#tabela.valores();
  }

  override inserir(exportacao: ExportacaoDoTitular): Promise<void> {
    return comoPromessa(() => {
      if (this.#tabela.tem(exportacao.id)) throw erroDoFalso('id de exportação repetido');
      this.#tabela.gravar(exportacao.id, exportacao);
    });
  }

  override buscarDisponivel(contaId: string, agora: Date): Promise<ExportacaoDoTitular | null> {
    return comoPromessa(() => {
      const disponiveis = this.#tabela
        .valores()
        .filter(
          (e) =>
            e.contaId === contaId && e.baixadaEm === null && agora.getTime() < e.expiraEm.getTime(),
        )
        .sort((a, b) => a.criadaEm.getTime() - b.criadaEm.getTime());
      return disponiveis.at(-1) ?? null;
    });
  }

  /** Como `UPDATE ... WHERE id AND baixada_em IS NULL`: só o primeiro download marca (S10). */
  override marcarBaixada(id: string, agora: Date): Promise<boolean> {
    return comoPromessa(() => {
      const exportacao = this.#tabela.ler(id);
      if (exportacao === undefined || exportacao.baixadaEm !== null) return false;
      this.#tabela.gravar(id, { ...exportacao, baixadaEm: agora });
      return true;
    });
  }

  override apagarVencidas(agora: Date): Promise<number> {
    return comoPromessa(() =>
      this.#tabela.apagarOnde(
        (e) => e.baixadaEm !== null || agora.getTime() >= e.expiraEm.getTime(),
      ),
    );
  }

  override apagarNaoBaixadas(contaId: string): Promise<number> {
    return comoPromessa(() =>
      this.#tabela.apagarOnde((e) => e.contaId === contaId && e.baixadaEm === null),
    );
  }

  override apagarDaConta(contaId: string): Promise<void> {
    return comoPromessa(() => {
      this.removerDaConta(contaId);
    });
  }

  /** Cascata síncrona, usada por `ContasEmMemoria.apagar`. */
  removerDaConta(contaId: string): void {
    this.#tabela.apagarOnde((exportacao) => exportacao.contaId === contaId);
  }
}

// ---------------------------------------------------------------------------

/** `RepositorioDeAuditoria` em memória, com a mesma validação do adaptador (S4). */
export class AuditoriaEmMemoria extends RepositorioDeAuditoria {
  readonly #unidade: UnidadeDeTrabalhoFalsa;
  #entradas: EntradaDeAuditoria[] = [];

  constructor(unidade: UnidadeDeTrabalhoFalsa) {
    super();
    this.#unidade = unidade;
  }

  get entradas(): readonly EntradaDeAuditoria[] {
    return structuredClone(this.#entradas);
  }

  override registrar(entrada: EntradaDeAuditoria): Promise<void> {
    return comoPromessa(() => {
      validarEntradaDeAuditoria(entrada);
      const copia = structuredClone(entrada);
      this.#entradas.push(copia);
      this.#unidade.registrarDesfazer(() => {
        this.#entradas = this.#entradas.filter((guardada) => guardada !== copia);
      });
    });
  }
}

// ---------------------------------------------------------------------------

export interface IdentidadeEmMemoria {
  unidade: UnidadeDeTrabalhoFalsa;
  publicador: PublicadorDeEventosFalso;
  auditoria: AuditoriaEmMemoria;
  contas: ContasEmMemoria;
  sessoes: SessoesEmMemoria;
  codigos: CodigosEmMemoria;
  desafios: DesafiosEmMemoria;
  bloqueios: BloqueiosEmMemoria;
  documentos: DocumentosLegaisEmMemoria;
  segundoFator: SegundoFatorEmMemoria;
  solicitacoes: SolicitacoesEmMemoria;
  exportacoes: ExportacoesEmMemoria;
}

/**
 * Todos os repositórios ligados a uma `UnidadeDeTrabalhoFalsa` (rollback e
 * travas por unidade) e ao publicador falso. `contas.apagar` apaga em cascata o
 * que é da conta, como o banco.
 */
export function criarIdentidadeEmMemoria(): IdentidadeEmMemoria {
  const unidade = new UnidadeDeTrabalhoFalsa();
  const publicador = new PublicadorDeEventosFalso(unidade);
  const auditoria = new AuditoriaEmMemoria(unidade);
  const sessoes = new SessoesEmMemoria(unidade);
  const desafios = new DesafiosEmMemoria(unidade);
  const codigos = new CodigosEmMemoria(unidade, desafios);
  const bloqueios = new BloqueiosEmMemoria(unidade);
  const documentos = new DocumentosLegaisEmMemoria(unidade);
  const segundoFator = new SegundoFatorEmMemoria(unidade);
  const solicitacoes = new SolicitacoesEmMemoria(unidade);
  const exportacoes = new ExportacoesEmMemoria(unidade);
  const contas = new ContasEmMemoria(unidade, (contaId) => {
    sessoes.removerDaConta(contaId);
    codigos.removerDaConta(contaId);
    documentos.removerDaConta(contaId);
    segundoFator.removerDaConta(contaId);
    solicitacoes.removerDaConta(contaId);
    exportacoes.removerDaConta(contaId);
  });
  return {
    unidade,
    publicador,
    auditoria,
    contas,
    sessoes,
    codigos,
    desafios,
    bloqueios,
    documentos,
    segundoFator,
    solicitacoes,
    exportacoes,
  };
}
