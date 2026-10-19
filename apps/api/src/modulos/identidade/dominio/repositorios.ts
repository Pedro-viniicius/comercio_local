// Portas de persistência da Identidade (ADR-003): classes abstratas, para o
// Nest usá-las como token de injeção sem o domínio depender dele. Os
// adaptadores Prisma ficam em `infra/prisma/` (etapa 7) e os fakes em memória
// em `apps/api/test/fakes/identidade/`.
//
// Todo método roda na transação da `UnidadeDeTrabalho` em andamento, se houver.
// Erro do banco chega à aplicação como erro de domínio (`EmailJaCadastrado`)
// ou como o erro original, que nunca é registrado com a mensagem (ela traz os
// parâmetros da consulta). Nomes de campo seguem as colunas do plano 01b,
// "Esquema e contratos".
//
// Leitura para alterar (R1). O banco roda em READ COMMITTED: ler sem trava,
// mudar a entidade e gravar perde atualização quando duas requisições leem a
// mesma linha ao mesmo tempo (as duas leem `falhas = 0` e as duas gravam 1;
// duas renovações com o mesmo token rotacionam as duas). Por isso, o estado que
// conta tentativas ou troca o token só é alterado depois de lido por um método
// com trava, e os casos de uso das etapas 8 a 11 chamam esses métodos DENTRO da
// `UnidadeDeTrabalho` em que gravam (fora dela, a trava acaba no fim do comando
// e não protege nada; os fakes recusam):
// - freio: `RepositorioDeBloqueios.buscarParaAtualizar` (`SELECT ... FOR
//   UPDATE`, depois de `INSERT ... ON CONFLICT DO NOTHING` para a chave nova
//   também ter linha a travar), e então `salvar`;
// - código por e-mail: `RepositorioDeCodigosDeVerificacao.buscarVigenteParaAtualizar`,
//   e então `atualizar`;
// - desafio do 2FA: `RepositorioDeDesafios.buscarPorIdParaAtualizar`, e então
//   `atualizar`;
// - rotação da sessão: `RepositorioDeSessoes.gravarRotacao`, um UPDATE
//   condicionado ao token antigo e à sessão não revogada que confere 1 linha
//   alterada e muda só as colunas da rotação; a revogação, por `atualizar`,
//   muda só as colunas da revogação e nunca a desfaz (R7).
// A segunda requisição espera a primeira terminar e lê o que ela gravou. Para
// não haver deadlock, trave sempre na mesma ordem: o desafio antes do freio de
// segundo fator, e o freio de e-mail antes do de IP.
import type { EtapaDoDesafio } from '@bairrin/contratos/validadores';
import type { BloqueioDeLogin, TipoDeBloqueio } from './bloqueio-de-login.ts';
import type { CodigoDeVerificacao, FinalidadeDoCodigo } from './codigo-de-verificacao.ts';
import type { Conta, TipoDeDocumentoLegal } from './conta.ts';
import type { DesafioDeSegundoFator } from './desafio-de-segundo-fator.ts';
import type { Email } from './email.ts';
import type { MotivoDeRevogacao, Sessao, TokenDeRenovacaoUsado } from './sessao.ts';

// ---------------------------------------------------------------------------
// Contas e perfis (`contas`, `perfis_conta`)

export abstract class RepositorioDeContas {
  abstract buscarPorId(id: string): Promise<Conta | null>;
  /** Pelo e-mail normalizado, em qualquer status. */
  abstract buscarPorEmail(email: Email): Promise<Conta | null>;
  /** Grava a conta e os perfis. Lança `EmailJaCadastrado` se o e-mail já tem conta. */
  abstract inserir(conta: Conta): Promise<void>;
  /** Grava o estado atual da conta, inclusive perfis novos. */
  abstract atualizar(conta: Conta): Promise<void>;
  /**
   * Ids de contas que `Conta.deveSerExpurgada` apagaria: ativas, sem e-mail
   * verificado, sem perfil `admin` nem `lojista` e com o último login (ou, sem
   * login, o cadastro) antes de `limite` (`limiteDoExpurgo`). No máximo
   * `quantidade`, das mais antigas para as mais novas.
   */
  abstract listarParaExpurgo(limite: Date, quantidade: number): Promise<string[]>;
  /**
   * Apaga a conta não verificada e o que depende dela no schema (perfis,
   * sessões, códigos, consentimentos, segundo fator, solicitações e
   * exportações), na transação em andamento (P1-dono, S8).
   */
  abstract apagar(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Sessões (`sessoes`)

export abstract class RepositorioDeSessoes {
  /** Pelo `sid` do token de acesso. */
  abstract buscarPorId(id: string): Promise<Sessao | null>;
  /** A sessão cujo `token_hash` ou `token_anterior_hash` é este HMAC (sem trava). */
  abstract buscarPorTokenHash(tokenHash: string): Promise<Sessao | null>;
  /**
   * O token já trocado com este HMAC, do histórico da família
   * (`tokens_de_renovacao_usados`, S77); `null` se nunca foi usado. Consultado
   * quando `buscarPorTokenHash` dá `null`: achado aqui é reuso
   * (`avaliarTokenJaUsado`) e revoga a família.
   */
  abstract buscarTokenUsado(tokenHash: string): Promise<TokenDeRenovacaoUsado | null>;
  abstract inserir(sessao: Sessao): Promise<void>;
  /**
   * Grava só a revogação feita por `Sessao.revogar` (logout, por exemplo), nada
   * mais (R7). A sessão pode ter sido lida antes de outra requisição a
   * rotacionar ou revogar; gravar o estado inteiro rebaixaria `expira_em` e o
   * par novo de uma rotação recente, ou trocaria a data e o motivo da primeira
   * revogação. Por isso o adaptador faz só:
   *
   *     UPDATE identidade.sessoes
   *        SET revogada_em = coalesce(revogada_em, $2),
   *            motivo_revogacao = coalesce(motivo_revogacao, $3),
   *            par_novo_cifrado = NULL, par_novo_expira_em = NULL
   *      WHERE id = $1
   *
   * A primeira revogação gravada fica (nunca volta a `NULL`). Sessão não
   * revogada é erro de quem chama: a rotação vai por `gravarRotacao`, e não há
   * outra mudança de sessão que se grave (o fake recusa).
   */
  abstract atualizar(sessao: Sessao): Promise<void>;
  /**
   * Grava a rotação feita por `Sessao.rotacionar`, só se ninguém rotacionou nem
   * revogou antes (R1, R7):
   *
   *     UPDATE identidade.sessoes
   *        SET token_hash = $3, token_anterior_hash = $2, par_novo_cifrado = $4,
   *            par_novo_expira_em = $5, trocado_em = $6, ultimo_uso_em = $7, expira_em = $8
   *      WHERE id = $1 AND token_hash = $2 AND revogada_em IS NULL
   *
   * (`$2` é o token trocado, `sessao.ultimoTokenTrocado.tokenHash`). O SET leva
   * só as colunas da rotação: nunca `revogada_em` nem `motivo_revogacao`, que
   * a entidade lida sem trava traria velhos. Com 1 linha alterada, inclui o
   * token trocado no histórico da família (S77), na mesma transação, e devolve
   * `true`. Com 0 linhas, devolve `false` sem gravar nada: outra renovação com o
   * mesmo token rotacionou antes, ou a sessão foi revogada (logout, reuso,
   * senha redefinida) enquanto esta lia; em READ COMMITTED o UPDATE espera a
   * outra transação e reavalia o WHERE com o valor confirmado. O caso de uso
   * relê por `buscarPorTokenHash` e avalia de novo, o que cai na tolerância, no
   * reuso ou em `invalida`. Chamado dentro da unidade de trabalho.
   */
  abstract gravarRotacao(sessao: Sessao): Promise<boolean>;
  /** Revoga as sessões ainda não revogadas da família; devolve quantas. */
  abstract revogarDaFamilia(
    familiaId: string,
    motivo: MotivoDeRevogacao,
    agora: Date,
  ): Promise<number>;
  /** Revoga as sessões ainda não revogadas da conta; devolve quantas. */
  abstract revogarDaConta(contaId: string, motivo: MotivoDeRevogacao, agora: Date): Promise<number>;
  /** Apaga as sessões da conta e, em cascata, o histórico de tokens delas (anonimização). */
  abstract apagarDaConta(contaId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Códigos por e-mail e desafios do 2FA (`codigos_verificacao`)

export abstract class RepositorioDeCodigosDeVerificacao {
  abstract inserir(codigo: CodigoDeVerificacao): Promise<void>;
  abstract atualizar(codigo: CodigoDeVerificacao): Promise<void>;
  /**
   * O código mais recente (`criado_em`) da conta e finalidade que ainda vale em
   * `agora`, travado até o fim da unidade de trabalho (`FOR UPDATE`; R1), para
   * duas tentativas simultâneas não contarem como uma. Se outra unidade o
   * alterou enquanto esta esperava, a validade é conferida de novo com o valor
   * gravado. Chamado dentro da unidade de trabalho.
   */
  abstract buscarVigenteParaAtualizar(
    contaId: string,
    finalidade: FinalidadeDoCodigo,
    agora: Date,
  ): Promise<CodigoDeVerificacao | null>;
  /** Marca como usados os códigos que ainda valem (antes de emitir um novo). */
  abstract invalidarVigentes(
    contaId: string,
    finalidade: FinalidadeDoCodigo,
    agora: Date,
  ): Promise<void>;
  /** Apaga os códigos e os desafios da conta (anonimização). */
  abstract apagarDaConta(contaId: string): Promise<void>;
}

export abstract class RepositorioDeDesafios {
  abstract inserir(desafio: DesafioDeSegundoFator): Promise<void>;
  abstract atualizar(desafio: DesafioDeSegundoFator): Promise<void>;
  /**
   * O desafio, travado até o fim da unidade de trabalho (`FOR UPDATE`; R1), para
   * duas tentativas simultâneas não contarem como uma. Chamado dentro da
   * unidade de trabalho, antes de travar o freio de segundo fator.
   */
  abstract buscarPorIdParaAtualizar(id: string): Promise<DesafioDeSegundoFator | null>;
  /** Marca como usados os desafios da conta e etapa que ainda valem (antes de emitir um novo). */
  abstract invalidarVigentes(contaId: string, etapa: EtapaDoDesafio, agora: Date): Promise<void>;
}

// ---------------------------------------------------------------------------
// Freio de tentativas (`bloqueios_login`)

export abstract class RepositorioDeBloqueios {
  /**
   * O freio da chave, sem trava; `null` se ainda não há falha registrada. Só
   * para conferir se está freado: para alterar, `buscarParaAtualizar`.
   */
  abstract buscar(chaveHmac: string, tipo: TipoDeBloqueio): Promise<BloqueioDeLogin | null>;
  /**
   * O freio da chave, travado até o fim da unidade de trabalho (R1): o
   * adaptador faz `INSERT ... ON CONFLICT DO NOTHING` com o freio zerado
   * (`BloqueioDeLogin.novo(chaveHmac, tipo, agora)`) e depois `SELECT ... FOR
   * UPDATE`, então a chave sem falha também tem linha a travar e duas falhas
   * simultâneas viram duas. Chamado dentro da unidade de trabalho; quem chama
   * grava com `salvar` (uma linha zerada que não for salva não freia ninguém).
   */
  abstract buscarParaAtualizar(
    chaveHmac: string,
    tipo: TipoDeBloqueio,
    agora: Date,
  ): Promise<BloqueioDeLogin>;
  /**
   * Grava o estado do freio lido por `buscarParaAtualizar` (insere ou
   * atualiza). Apaga a linha se o freio está zerado.
   */
  abstract salvar(bloqueio: BloqueioDeLogin): Promise<void>;
}

// ---------------------------------------------------------------------------
// Documentos legais e consentimentos (`documentos_legais`, `consentimentos`)

export interface DocumentoLegal {
  readonly id: string;
  readonly tipo: TipoDeDocumentoLegal;
  readonly versao: string;
  readonly conteudo: string;
  readonly vigenteDesde: Date;
}

export interface Consentimento {
  readonly id: string;
  readonly contaId: string;
  readonly documentoId: string;
  readonly aceitoEm: Date;
}

export abstract class RepositorioDeDocumentosLegais {
  /** O documento do tipo com o maior `vigente_desde` até `agora`; `null` se não há. */
  abstract buscarVigente(tipo: TipoDeDocumentoLegal, agora: Date): Promise<DocumentoLegal | null>;
  /**
   * Registra o aceite (CA-01). Um por conta e documento (índice único): aceitar
   * de novo a mesma versão é erro de quem chama. Fica depois da anonimização:
   * só tem ids e a data.
   */
  abstract registrarConsentimento(consentimento: Consentimento): Promise<void>;
  /** Data do aceite do documento pela conta; `null` se não aceitou (CA-10). */
  abstract buscarAceite(contaId: string, documentoId: string): Promise<Date | null>;
}

// ---------------------------------------------------------------------------
// Segundo fator do admin (`segundo_fator`, `codigos_recuperacao`)

export interface SegundoFator {
  readonly contaId: string;
  /** Segredo TOTP cifrado (AES-GCM, AAD com a conta). */
  readonly segredoCifrado: string;
  /** `null` enquanto a configuração não foi confirmada com um código. */
  readonly confirmadoEm: Date | null;
  /** Último passo de 30 s aceito, para não aceitar o mesmo código duas vezes. */
  readonly ultimoPassoUsado: number | null;
}

export interface CodigoDeRecuperacao {
  readonly id: string;
  readonly contaId: string;
  readonly codigoHmac: string;
  readonly usadoEm: Date | null;
}

export abstract class RepositorioDeSegundoFator {
  abstract buscar(contaId: string): Promise<SegundoFator | null>;
  /** Insere ou atualiza o segundo fator da conta. */
  abstract salvar(segundoFator: SegundoFator): Promise<void>;
  /** Apaga o segundo fator e os códigos de recuperação (CLI de reconfiguração, anonimização). */
  abstract apagar(contaId: string): Promise<void>;
  /** Troca todos os códigos de recuperação da conta pelos novos. */
  abstract substituirCodigosDeRecuperacao(
    contaId: string,
    codigos: readonly CodigoDeRecuperacao[],
  ): Promise<void>;
  abstract listarCodigosDeRecuperacaoNaoUsados(
    contaId: string,
  ): Promise<readonly CodigoDeRecuperacao[]>;
  abstract marcarCodigoDeRecuperacaoUsado(id: string, agora: Date): Promise<void>;
}

// ---------------------------------------------------------------------------
// Pedidos do titular (`solicitacoes_titular`, `exportacoes_titular`)

export type TipoDeSolicitacao = 'exportacao' | 'exclusao';
export type StatusDaSolicitacao = 'pendente' | 'aguardando_pendencias' | 'concluida';

export interface SolicitacaoDoTitular {
  readonly id: string;
  readonly contaId: string;
  readonly tipo: TipoDeSolicitacao;
  readonly status: StatusDaSolicitacao;
  readonly solicitadaEm: Date;
  /** Obrigatória quando `status = concluida` (CHECK do banco). */
  readonly concluidaEm: Date | null;
}

export abstract class RepositorioDeSolicitacoes {
  abstract inserir(solicitacao: SolicitacaoDoTitular): Promise<void>;
  abstract atualizar(solicitacao: SolicitacaoDoTitular): Promise<void>;
  abstract buscarPorId(id: string): Promise<SolicitacaoDoTitular | null>;
  /** A solicitação mais recente da conta e do tipo; `null` se não há. */
  abstract buscarUltima(
    contaId: string,
    tipo: TipoDeSolicitacao,
  ): Promise<SolicitacaoDoTitular | null>;
  /** Até `quantidade`, das mais antigas para as mais novas. */
  abstract listarPorStatus(
    tipo: TipoDeSolicitacao,
    status: StatusDaSolicitacao,
    quantidade: number,
  ): Promise<readonly SolicitacaoDoTitular[]>;
}

export interface ExportacaoDoTitular {
  readonly id: string;
  readonly contaId: string;
  /** JSON dos dados, cifrado (AES-GCM, AAD com a conta; S10). */
  readonly conteudoCifrado: string;
  readonly criadaEm: Date;
  /** 7 dias depois de gerada. */
  readonly expiraEm: Date;
  /** Uso único: depois do download não vale mais. */
  readonly baixadaEm: Date | null;
}

export abstract class RepositorioDeExportacoes {
  abstract inserir(exportacao: ExportacaoDoTitular): Promise<void>;
  /** A exportação mais recente não baixada e não vencida em `agora`; `null` se não há. */
  abstract buscarDisponivel(contaId: string, agora: Date): Promise<ExportacaoDoTitular | null>;
  abstract marcarBaixada(id: string, agora: Date): Promise<void>;
  /** Apaga as vencidas e as já baixadas; devolve quantas. */
  abstract apagarVencidas(agora: Date): Promise<number>;
  /** Apaga as exportações da conta (anonimização). */
  abstract apagarDaConta(contaId: string): Promise<void>;
}
