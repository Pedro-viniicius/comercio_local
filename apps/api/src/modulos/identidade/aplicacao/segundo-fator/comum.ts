// Peças comuns ao 2FA do admin (plano 01b, etapa 10; S1, "Respostas do 2FA"):
// o token do desafio, a chave do freio de segundo fator e a sessão do painel
// aberta depois do segundo fator. Usadas pelos casos de uso desta pasta e pelo
// `entrar` (etapa 9), que emite o desafio depois da senha certa no painel.
//
// Token do desafio (revisão do grupo B): `<id do desafio>.<segredo>`. O id
// localiza a linha (`buscarPorIdParaAtualizar`, com trava); o segredo só existe
// no cliente, e o banco guarda o HMAC dele ligado à conta e à etapa
// (`finalidadeDoDesafio`). Token sem `.`, id inexistente e HMAC que não confere
// dão o mesmo `null`: quem chama responde `desafio_invalido` sem distinguir.
//
// Ordem das travas (R8 e `dominio/repositorios.ts`): nas tentativas de
// código desta pasta, o freio por e-mail da conta do desafio
// (`travarFreioPorEmailDoDesafio`, S104: a falha pode apagar a senha), o
// desafio, o freio de segundo fator da conta e só então a leitura do
// `segundo_fator` e dos códigos de recuperação. O freio de segundo fator é por
// conta e sempre tem linha a travar, então serializa dois desafios diferentes da
// mesma conta: o "sem reuso de passo" do TOTP, o uso único do código de
// recuperação e a troca do segredo na configuração valem sem mudar porta. A
// emissão do desafio (`entrar`) lê só o `confirmado_em`, sem a trava: um
// desafio `configurar` emitido para conta que acabou de confirmar é recusado
// depois, porque a configuração confere o `confirmado_em` de novo, já travada.
import type { EtapaDoDesafio } from '@bairrin/contratos/validadores';
import type { RepositorioDeAuditoria } from '../../../../compartilhado/auditoria/repositorio-de-auditoria.ts';
import type { PublicadorDeEventos } from '../../../../compartilhado/eventos/publicador.ts';
import { type BloqueioDeLogin, ESPERAS_EM_MS } from '../../dominio/bloqueio-de-login.ts';
import type { Conta } from '../../dominio/conta.ts';
import {
  DesafioDeSegundoFator,
  etapaDoDesafio,
  finalidadeDoDesafio,
  JANELA_DO_LIMITE_DE_ERROS_DE_SEGUNDO_FATOR_EM_MS,
  passouDoLimiteDiarioDeSegundoFator,
} from '../../dominio/desafio-de-segundo-fator.ts';
import type {
  RepositorioDeBloqueios,
  RepositorioDeContas,
  RepositorioDeDesafios,
  RepositorioDeSegundoFator,
  RepositorioDeSessoes,
} from '../../dominio/repositorios.ts';
import { podeUsarOPainel, reivindicacoesDoToken, Sessao } from '../../dominio/sessao.ts';
import { chaveDoFreioPorEmail, hashDoTokenDeRenovacao } from '../comum/chaves.ts';
import type { SessaoEmitida } from '../comum/sessao-emitida.ts';
import { eventoDeIdentidade } from '../eventos.ts';
import type { Cifrador } from '../portas/cifrador.ts';
import type { EmissorDeJwt } from '../portas/emissor-de-jwt.ts';
import type { GeradorDeSegredos } from '../portas/gerador-de-segredos.ts';

/** Separador entre o id e o segredo no token do desafio. */
const SEPARADOR_DO_TOKEN = '.';
/** O id do desafio é o UUID da linha em `codigos_verificacao`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resultado único para desafio inexistente, vencido, usado, de outra etapa ou esgotado. */
export const DESAFIO_INVALIDO = { tipo: 'desafio_invalido' } as const;

// ---------------------------------------------------------------------------
// Token do desafio

/** O que `POST /v1/sessoes` devolve ao painel depois da senha certa de um admin. */
export interface DesafioEmitido {
  readonly etapa: EtapaDoDesafio;
  /** `<id>.<segredo>`: mostrado uma vez, nunca guardado em claro. */
  readonly desafio: string;
}

/**
 * Id e segredo do token, ou `null` se o formato não é `<uuid>.<segredo>`. O id
 * é conferido antes da consulta: no banco a coluna é UUID, e um texto qualquer
 * faria o Postgres recusar a consulta (500) em vez de dar `desafio_invalido`.
 */
export function lerTokenDoDesafio(token: string): { id: string; segredo: string } | null {
  const partes = token.split(SEPARADOR_DO_TOKEN);
  if (partes.length !== 2) return null;
  const [id = '', segredo = ''] = partes;
  if (!UUID.test(id) || segredo.length === 0) return null;
  return { id, segredo };
}

/**
 * Emite o desafio pós-senha da conta (S1): `configurar` se o segundo fator
 * ainda não foi confirmado, senão `verificar`; vale 5 min, uma vez e 5
 * tentativas (`DesafioDeSegundoFator`). Os desafios ainda válidos da conta, das
 * duas etapas, deixam de valer: só o último login no painel tem desafio vivo.
 * Chamado dentro da unidade de trabalho, só para conta com `admin` e senha
 * certa no painel.
 */
export async function emitirDesafioDeSegundoFator(
  portas: {
    desafios: RepositorioDeDesafios;
    segundoFator: RepositorioDeSegundoFator;
    cifrador: Cifrador;
    gerador: GeradorDeSegredos;
  },
  contaId: string,
  agora: Date,
): Promise<DesafioEmitido> {
  const segundoFator = await portas.segundoFator.buscar(contaId);
  const etapa = etapaDoDesafio(segundoFator !== null && segundoFator.confirmadoEm !== null);
  await portas.desafios.invalidarVigentes(contaId, 'configurar', agora);
  await portas.desafios.invalidarVigentes(contaId, 'verificar', agora);
  const id = portas.gerador.novoId();
  const segredo = portas.gerador.tokenOpaco();
  const desafio = DesafioDeSegundoFator.emitir({
    id,
    contaId,
    etapa,
    tokenHmac: portas.cifrador.hmac(finalidadeDoDesafio(etapa), [contaId, segredo]),
    agora,
  });
  await portas.desafios.inserir(desafio);
  return { etapa, desafio: `${id}${SEPARADOR_DO_TOKEN}${segredo}` };
}

/**
 * O desafio do token, lido com trava, ou `null` se o token é mal formado, o id
 * não existe ou o HMAC do segredo não confere com a conta e a etapa da linha
 * (comparação em tempo constante no `Cifrador`). Validade, uso e tentativas
 * ficam com quem chama (`estaValidoPara`, `avaliarCodigo`). Chamado dentro da
 * unidade de trabalho; nas tentativas de código, logo depois de
 * `travarFreioPorEmailDoDesafio`.
 */
export async function lerDesafio(
  portas: { desafios: RepositorioDeDesafios; cifrador: Cifrador },
  token: string,
): Promise<DesafioDeSegundoFator | null> {
  const lido = lerTokenDoDesafio(token);
  if (lido === null) return null;
  const desafio = await portas.desafios.buscarPorIdParaAtualizar(lido.id);
  return desafio !== null && segredoConfere(portas.cifrador, desafio, lido.segredo)
    ? desafio
    : null;
}

/** O HMAC do segredo confere com a conta e a etapa da linha (tempo constante no `Cifrador`). */
function segredoConfere(cifrador: Cifrador, desafio: DesafioDeSegundoFator, segredo: string) {
  return cifrador.hmacConfere(
    finalidadeDoDesafio(desafio.etapa),
    [desafio.contaId, segredo],
    desafio.tokenHmac,
  );
}

/**
 * A primeira trava de uma tentativa de código do 2FA (S104, A-R13): acha a
 * conta do desafio sem trava (`buscarPorId`) e trava o freio por e-mail dela,
 * antes do desafio, na ordem do cabeçalho de `dominio/repositorios.ts`. Assim a
 * falha que apaga a senha (P16, S103) já está serializada com o login, sem
 * refazer a tentativa. Devolve a conta do desafio, ou `null` (nada travado) se
 * o token é mal formado, o id não existe ou o HMAC não confere. Quem chama
 * trava o desafio em seguida (`lerDesafio`) e confere que a conta é a mesma.
 * Chamado dentro da unidade de trabalho, antes de qualquer outra trava.
 */
export async function travarFreioPorEmailDoDesafio(
  portas: {
    desafios: RepositorioDeDesafios;
    contas: RepositorioDeContas;
    bloqueios: RepositorioDeBloqueios;
    cifrador: Cifrador;
  },
  token: string,
  agora: Date,
): Promise<string | null> {
  const lido = lerTokenDoDesafio(token);
  if (lido === null) return null;
  const desafio = await portas.desafios.buscarPorId(lido.id);
  if (desafio === null || !segredoConfere(portas.cifrador, desafio, lido.segredo)) return null;
  await travarFreioPorEmailDaConta(portas, desafio.contaId, agora);
  return desafio.contaId;
}

/**
 * A conta do desafio ainda pode concluir o segundo fator: existe, está ativa,
 * tem senha e o perfil `admin`. Uma conta desativada ou sem o perfil entre a
 * senha e o código dá `desafio_invalido`, sem sessão.
 */
export function podeConcluirSegundoFator(conta: Conta | null): conta is Conta {
  return conta !== null && conta.podeEntrar && podeUsarOPainel(conta);
}

// ---------------------------------------------------------------------------
// Freio de segundo fator

/** Chave do freio `segundo_fator` da conta (o banco guarda só o HMAC). */
export function chaveDoFreioDeSegundoFator(cifrador: Cifrador, contaId: string): string {
  return cifrador.hmac('bloqueio_segundo_fator', [contaId]);
}

/** Nível da espera de 15 min, a maior (`ESPERAS_EM_MS`): dele o freio não sobe mais. */
export const NIVEL_MAXIMO_DO_FREIO = ESPERAS_EM_MS.length;

/**
 * O que uma falha de segundo fator fez (S92, P16, S103):
 * - `nenhuma`: o freio não entrou em espera e o teto diário não passou;
 * - `espera`: o freio entrou numa espera de 1, 5 ou 15 min;
 * - `senha_removida`: a senha da conta é apagada, por uma de duas causas:
 *   - `nivel_maximo`: o freio foi acionado de novo já no nível máximo (15 min)
 *     sem o segundo fator concluído (P16);
 *   - `limite_diario`: os erros das últimas 24 h passaram de
 *     `LIMITE_DE_ERROS_DE_SEGUNDO_FATOR_POR_DIA` (S103), mesmo sem espera.
 * `nivelAntes` é o nível lido antes da falha, com o freio fora de espera (quem
 * chama já devolveu `freado` se ele estava ativo). Se a calma de 15 min tivesse
 * zerado o nível nessa falha, a espera aplicada seria a do nível 1, nunca a do
 * máximo: por isso "máximo antes e máximo depois" só acontece no reacionamento.
 */
export type ConsequenciaDaFalhaDeSegundoFator =
  | { readonly tipo: 'nenhuma' }
  | { readonly tipo: 'espera' }
  | { readonly tipo: 'senha_removida'; readonly causa: 'nivel_maximo' | 'limite_diario' };

export function consequenciaDaFalhaDeSegundoFator(
  nivelAntes: number,
  freio: BloqueioDeLogin,
  agora: Date,
  errosNasUltimas24h: number,
): ConsequenciaDaFalhaDeSegundoFator {
  const emEspera = freio.estaBloqueado(agora);
  const reacionadoNoMaximo =
    emEspera && nivelAntes >= NIVEL_MAXIMO_DO_FREIO && freio.nivel >= NIVEL_MAXIMO_DO_FREIO;
  if (reacionadoNoMaximo) return { tipo: 'senha_removida', causa: 'nivel_maximo' };
  if (passouDoLimiteDiarioDeSegundoFator(errosNasUltimas24h)) {
    return { tipo: 'senha_removida', causa: 'limite_diario' };
  }
  return emEspera ? { tipo: 'espera' } : { tipo: 'nenhuma' };
}

/**
 * A consequência da tentativa já gravada (desafio e freio): sem erro, `nenhuma`;
 * com erro, soma os erros de segundo fator da conta nas últimas 24 h
 * (`somarTentativasDesde`, que já conta este) e aplica
 * `consequenciaDaFalhaDeSegundoFator`. Chamado dentro da unidade de trabalho,
 * com o freio de segundo fator travado e depois de `desafios.atualizar`.
 */
export async function avaliarFalhaDeSegundoFator(
  portas: { desafios: RepositorioDeDesafios },
  tentativa: {
    readonly contaId: string;
    readonly codigoConfere: boolean;
    readonly nivelAntes: number;
    readonly freio: BloqueioDeLogin;
    readonly agora: Date;
  },
): Promise<ConsequenciaDaFalhaDeSegundoFator> {
  if (tentativa.codigoConfere) return { tipo: 'nenhuma' };
  const desde = new Date(
    tentativa.agora.getTime() - JANELA_DO_LIMITE_DE_ERROS_DE_SEGUNDO_FATOR_EM_MS,
  );
  const erros = await portas.desafios.somarTentativasDesde(tentativa.contaId, desde);
  return consequenciaDaFalhaDeSegundoFator(
    tentativa.nivelAntes,
    tentativa.freio,
    tentativa.agora,
    erros,
  );
}

/**
 * Trava o freio por e-mail da conta (A-R13, S104), a primeira trava da ordem
 * do cabeçalho de `dominio/repositorios.ts`, antes do desafio. É ele que
 * serializa com o login: um login que já conferiu a senha e está na conclusão
 * segura esse freio até abrir a sessão, então a remoção da senha espera e
 * revoga também essa sessão; e o login que chega depois relê a conta já sem
 * senha. O freio não muda: `salvar` só apaga a linha zerada que a trava criou.
 * A conta é lida sem trava só para a chave (o e-mail não muda); conta que não
 * existe mais não trava nada (a tentativa dá `desafio_invalido` adiante).
 * Chamado dentro da unidade de trabalho, antes de qualquer outra trava.
 */
async function travarFreioPorEmailDaConta(
  portas: { contas: RepositorioDeContas; bloqueios: RepositorioDeBloqueios; cifrador: Cifrador },
  contaId: string,
  agora: Date,
): Promise<void> {
  const conta = await portas.contas.buscarPorId(contaId);
  if (conta === null) return;
  const freio = await portas.bloqueios.buscarParaAtualizar(
    chaveDoFreioPorEmail(portas.cifrador, conta.email),
    'email',
    agora,
  );
  await portas.bloqueios.salvar(freio);
}

/**
 * Reage à falha de segundo fator (S92, P16, S103, S104). Em toda espera e na
 * senha apagada, publica `SegundoFatorFreado` (só o id), para o dono receber o
 * aviso por e-mail; o assinante lê da conta se a senha foi apagada e, nesse
 * caso, manda recuperar a senha. Quem chega ao segundo fator já passou da
 * senha: apagá-la tira o acesso de quem a roubou, e o admin legítimo volta pelo
 * e-mail.
 *
 * Na senha apagada, na mesma transação: `gravarSenhaRemovida` (só em conta
 * ativa), a revogação de todas as sessões da conta (`segundo_fator_freado`:
 * quem tinha a senha não segue com a sessão do app aberta antes) e a auditoria
 * `senha_removida_pelo_freio` (ator `sistema`, só ids e a causa), como a CLI de
 * reconfiguração. Exige o freio por e-mail da conta travado no começo da
 * unidade (`travarFreioPorEmailDoDesafio`).
 *
 * Chamado dentro da unidade de trabalho, depois de gravar o desafio e o freio
 * de segundo fator: a conta e as sessões vêm depois deles na ordem das travas.
 */
export async function reagirAoFreioDeSegundoFator(
  portas: {
    contas: RepositorioDeContas;
    sessoes: RepositorioDeSessoes;
    auditoria: RepositorioDeAuditoria;
    publicador: PublicadorDeEventos;
  },
  reacao: {
    readonly contaId: string;
    readonly consequencia: ConsequenciaDaFalhaDeSegundoFator;
    readonly agora: Date;
  },
): Promise<void> {
  const { contaId, consequencia, agora } = reacao;
  if (consequencia.tipo === 'nenhuma') return;
  if (consequencia.tipo === 'senha_removida') {
    if (await portas.contas.gravarSenhaRemovida(contaId)) {
      const sessoesRevogadas = await portas.sessoes.revogarDaConta(
        contaId,
        'segundo_fator_freado',
        agora,
      );
      await portas.auditoria.registrar({
        atorTipo: 'sistema',
        atorId: null,
        acao: 'senha_removida_pelo_freio',
        recurso: 'conta',
        recursoId: contaId,
        depois: { causa: consequencia.causa, sessoesRevogadas, senhaRemovida: true },
        origem: 'painel',
      });
    }
  }
  await portas.publicador.publicar(eventoDeIdentidade('SegundoFatorFreado', { contaId }));
}

/** Segredo TOTP em claro; lança se o texto cifrado não decifra (chave ou conta diferentes). */
export function segredoTotp(cifrador: Cifrador, contaId: string, segredoCifrado: string): string {
  const segredo = cifrador.decifrar('segredo_totp', segredoCifrado, contaId);
  if (segredo === null) {
    throw new Error('O segredo do segundo fator não decifra com a chave e a conta atuais.');
  }
  return segredo;
}

// ---------------------------------------------------------------------------
// Sessão do painel depois do segundo fator

/**
 * Abre a sessão do painel com `mfa` (S1): senha e segundo fator concluídos, o
 * único caminho em que `admin` entra no token. Família nova. O token de
 * renovação é guardado só como HMAC (`hashDoTokenDeRenovacao`, o mesmo que a
 * renovação usa para achar a sessão por `buscarPorTokenHash`).
 *
 * Antes da sessão, grava o login (`gravarUltimoLogin`, só em conta ativa): a
 * conta vem antes das sessões dela na ordem das travas, e o UPDATE espera uma
 * exclusão em andamento. Conta desativada no meio dá `null`, sem sessão.
 * Chamado dentro da unidade de trabalho.
 */
export async function abrirSessaoComSegundoFator(
  portas: {
    contas: RepositorioDeContas;
    sessoes: RepositorioDeSessoes;
    cifrador: Cifrador;
    gerador: GeradorDeSegredos;
    emissor: EmissorDeJwt;
  },
  conta: Conta,
  agora: Date,
): Promise<SessaoEmitida | null> {
  if (!(await portas.contas.gravarUltimoLogin(conta.id, agora))) return null;
  const tokenRenovacao = portas.gerador.tokenOpaco();
  const sessao = Sessao.criar({
    id: portas.gerador.novoId(),
    contaId: conta.id,
    cliente: 'painel',
    tokenHash: hashDoTokenDeRenovacao(portas.cifrador, tokenRenovacao),
    mfa: true,
    agora,
  });
  await portas.sessoes.inserir(sessao);
  const acesso = await portas.emissor.emitir(reivindicacoesDoToken(conta, sessao), agora);
  return {
    tokenAcesso: acesso.token,
    expiraEm: acesso.expiraEm,
    emailVerificado: conta.emailVerificado,
    tokenRenovacao,
  };
}
