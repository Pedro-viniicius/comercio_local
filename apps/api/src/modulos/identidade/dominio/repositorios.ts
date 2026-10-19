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
// - freio: `RepositorioDeBloqueios.buscarParaAtualizar` (um `INSERT ... ON
//   CONFLICT DO UPDATE ... RETURNING`, que trava a linha, existente ou nova, num
//   comando só), e então `salvar`;
// - conta: `RepositorioDeContas.buscarPorIdParaAtualizar` (`SELECT ... FOR NO
//   KEY UPDATE`), quando o caso de uso decide pelo estado da conta e não pode
//   cruzar com outro que decide o mesmo (anonimização, limite da exportação);
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
// segundo fator, e o freio de e-mail antes do de IP. Todo UPDATE também trava a
// linha até o fim da transação: a conta (`atualizar`, `gravarUltimoLogin`) vem
// antes das sessões dela (`gravarRotacao`, `atualizar`, `revogarDaConta`), como
// na exclusão, que desativa a conta e depois revoga as sessões. A renovação que
// gravasse a rotação antes de `gravarUltimoLogin` cruzaria com a exclusão, e o
// Postgres abortaria uma das duas (40P01). Pelo mesmo motivo, os desafios do
// 2FA vêm antes da conta: o segundo fator trava o desafio e só depois grava o
// login, então a redefinição de senha invalida os desafios (S94) antes de
// gravar a senha nova. Juntando tudo, quem trava o freio por e-mail o trava
// antes de qualquer outra coisa: freio por e-mail → (freio de origem, no login)
// → código ou desafios → freio de segundo fator → segundo fator → conta →
// sessões. É assim no login, na redefinição, na exclusão e na CLI de
// reconfiguração do 2FA (A-R13), que trava o freio por e-mail da conta para
// serializar com o login que já conferiu a senha antiga.
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
  /**
   * A conta, travada até o fim da unidade de trabalho (`SELECT ... FOR NO KEY
   * UPDATE`), ou `null` se não existe. A segunda unidade que pede a mesma conta
   * espera a primeira terminar e lê o que ela gravou: duas anonimizações não
   * publicam duas vezes, e dois pedidos de exportação não passam os dois pelo
   * limite. O nível `NO KEY UPDATE` é o mesmo de um UPDATE de colunas comuns:
   * não espera quem só insere uma linha filha (a FK trava a conta com `KEY
   * SHARE`), então inserir a filha antes de travar a conta não cruza com outra
   * unidade que fez o mesmo. Na ordem das travas, a conta vem antes das
   * sessões. Chamado dentro da unidade de trabalho.
   */
  abstract buscarPorIdParaAtualizar(id: string): Promise<Conta | null>;
  /**
   * Grava o estado inteiro da conta, inclusive perfis novos. Só para quem já
   * tem a conta travada ou não corre com outra requisição: a anonimização
   * (depois de `buscarPorIdParaAtualizar`) e a concessão de perfis. A conta lida
   * sem trava e gravada inteira desfaria uma mudança confirmada no meio; para a
   * senha, a desativação e o último login, use as gravações de uma coluna
   * abaixo (S95).
   */
  abstract atualizar(conta: Conta): Promise<void>;
  /**
   * Grava só `ultimo_login_em` (login ou renovação; P1-dono, base do expurgo),
   * e só se a conta ainda está ativa:
   *
   *     UPDATE identidade.contas SET ultimo_login_em = $2
   *      WHERE id = $1 AND status = 'ativa'
   *
   * Devolve `true` se mudou a linha, e `false` se a conta não existe ou não está
   * mais ativa. Nunca grava o resto da conta: a conta lida antes de uma exclusão
   * confirmada no meio, gravada inteira, desfaria a desativação. Em READ
   * COMMITTED, o UPDATE espera a exclusão em andamento e reavalia o `status` com
   * o valor confirmado. Use no lugar de `Conta.registrarLogin` + `atualizar`.
   */
  abstract gravarUltimoLogin(id: string, quando: Date): Promise<boolean>;
  /**
   * Grava só `email_verificado_em` (código de verificação aceito), e só se a
   * conta ainda está ativa, guardando a primeira data como
   * `Conta.verificarEmail`:
   *
   *     UPDATE identidade.contas
   *        SET email_verificado_em = coalesce(email_verificado_em, $2)
   *      WHERE id = $1 AND status = 'ativa'
   *
   * Devolve `true` se a conta ativa existe (verificada agora ou antes) e
   * `false` se não existe ou não está mais ativa. Mesma razão de
   * `gravarUltimoLogin`: a conta inteira gravada a partir de uma leitura velha
   * desfaria uma exclusão ou outra mudança confirmada no meio.
   */
  abstract gravarEmailVerificado(id: string, quando: Date): Promise<boolean>;
  /**
   * Grava a senha redefinida pelo código do e-mail (CA-06; P1-dono: o código
   * prova o e-mail, que fica verificado, guardando a primeira data), só em
   * conta ativa (S95):
   *
   *     UPDATE identidade.contas
   *        SET senha_hash = $2, email_verificado_em = coalesce(email_verificado_em, $3)
   *      WHERE id = $1 AND status = 'ativa'
   *
   * Devolve `true` se mudou a linha e `false` se a conta não existe ou não está
   * mais ativa. Nada além dessas duas colunas muda.
   */
  abstract gravarSenhaRedefinida(id: string, senhaHash: string, quando: Date): Promise<boolean>;
  /**
   * Apaga a senha da conta ativa (CLI de reconfiguração do 2FA, S97): a conta
   * só volta a entrar depois de redefinir a senha pelo e-mail.
   *
   *     UPDATE identidade.contas SET senha_hash = NULL
   *      WHERE id = $1 AND status = 'ativa'
   *
   * Devolve `true` se mudou a linha e `false` se a conta não existe ou não está
   * mais ativa.
   */
  abstract gravarSenhaRemovida(id: string): Promise<boolean>;
  /**
   * Desativa a conta pedida pela própria pessoa (CA-11), só se ainda está ativa
   * (S95):
   *
   *     UPDATE identidade.contas SET status = 'desativada', desativada_em = $2
   *      WHERE id = $1 AND status = 'ativa'
   *
   * Devolve `true` se mudou a linha e `false` se a conta não existe ou já saiu
   * de `ativa`. Nada além dessas duas colunas muda.
   */
  abstract gravarDesativacao(id: string, quando: Date): Promise<boolean>;
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
   * O freio da chave, travado até o fim da unidade de trabalho (R1), num
   * comando só:
   *
   *     INSERT INTO identidade.bloqueios_login (...) VALUES (<freio zerado>)
   *     ON CONFLICT (chave_hmac, tipo) DO UPDATE SET chave_hmac = EXCLUDED.chave_hmac
   *     RETURNING ...
   *
   * A chave sem falha também ganha linha a travar (`BloqueioDeLogin.novo(chaveHmac,
   * tipo, agora)`), e duas falhas simultâneas viram duas: a segunda espera a
   * primeira e lê o que ela gravou. Sempre devolve uma linha, inclusive quando
   * a primeira apagou o freio zerado enquanto a segunda esperava (A-R1, S96):
   * o comando então insere de novo, em vez de achar zero linhas. Chamado dentro
   * da unidade de trabalho; quem chama grava com `salvar` (uma linha zerada que
   * não for salva não freia ninguém).
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

/** Um aceite com o tipo e a versão do documento aceito (exportação dos dados, S10). */
export interface ConsentimentoComDocumento extends Consentimento {
  readonly tipo: TipoDeDocumentoLegal;
  readonly versao: string;
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
  /**
   * Todos os aceites da conta, inclusive de versões que não estão mais em
   * vigor, do mais antigo para o mais novo (`aceito_em`), para a exportação dos
   * dados do titular. Vazio se a conta não aceitou nada.
   */
  abstract listarConsentimentos(contaId: string): Promise<readonly ConsentimentoComDocumento[]>;
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
  /**
   * Quantas solicitações da conta e do tipo foram feitas depois de `desde`
   * (`solicitada_em > desde`), em qualquer status. Com a conta travada
   * (`RepositorioDeContas.buscarPorIdParaAtualizar`), confere o limite de um
   * pedido de exportação por 24 h contando também a solicitação que a própria
   * unidade acabou de inserir.
   */
  abstract contarDesde(contaId: string, tipo: TipoDeSolicitacao, desde: Date): Promise<number>;
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
  /**
   * Marca o download, só se ainda não foi baixada (uso único, S10):
   *
   *     UPDATE identidade.exportacoes_titular SET baixada_em = $2
   *      WHERE id = $1 AND baixada_em IS NULL
   *
   * Devolve `true` para quem marcou e `false` se outra requisição baixou antes
   * (ou a exportação não existe). Em READ COMMITTED, o segundo UPDATE espera o
   * primeiro e reavalia `baixada_em IS NULL` com o valor confirmado: dois
   * downloads simultâneos não recebem os dois o arquivo.
   */
  abstract marcarBaixada(id: string, agora: Date): Promise<boolean>;
  /** Apaga as vencidas e as já baixadas; devolve quantas. */
  abstract apagarVencidas(agora: Date): Promise<number>;
  /**
   * Apaga as exportações da conta ainda não baixadas, vencidas ou não, antes
   * de gravar uma nova (S98): só a cópia mais recente pode ser baixada, e as
   * anteriores não ficam guardadas à toa. Um download em andamento da cópia
   * antiga espera e não a acha mais (`marcarBaixada` devolve `false`).
   * Devolve quantas.
   */
  abstract apagarNaoBaixadas(contaId: string): Promise<number>;
  /** Apaga as exportações da conta (anonimização). */
  abstract apagarDaConta(contaId: string): Promise<void>;
}
