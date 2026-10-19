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
// Ordem das travas (R8 e `dominio/repositorios.ts`): nos casos de uso desta
// pasta, o desafio, depois o freio de segundo fator da conta e só então a
// leitura do `segundo_fator` e dos códigos de recuperação. O freio é por conta
// e sempre tem linha a travar, então serializa dois desafios diferentes da
// mesma conta: o "sem reuso de passo" do TOTP, o uso único do código de
// recuperação e a troca do segredo na configuração valem sem mudar porta. A
// emissão do desafio (`entrar`) lê só o `confirmado_em`, sem a trava: um
// desafio `configurar` emitido para conta que acabou de confirmar é recusado
// depois, porque a configuração confere o `confirmado_em` de novo, já travada.
import type { EtapaDoDesafio } from '@bairrin/contratos/validadores';
import type { Conta } from '../../dominio/conta.ts';
import {
  DesafioDeSegundoFator,
  etapaDoDesafio,
  finalidadeDoDesafio,
} from '../../dominio/desafio-de-segundo-fator.ts';
import type {
  RepositorioDeContas,
  RepositorioDeDesafios,
  RepositorioDeSegundoFator,
  RepositorioDeSessoes,
} from '../../dominio/repositorios.ts';
import { podeUsarOPainel, reivindicacoesDoToken, Sessao } from '../../dominio/sessao.ts';
import { hashDoTokenDeRenovacao } from '../comum/chaves.ts';
import type { SessaoEmitida } from '../comum/sessao-emitida.ts';
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
 * unidade de trabalho, antes de qualquer outra trava.
 */
export async function lerDesafio(
  portas: { desafios: RepositorioDeDesafios; cifrador: Cifrador },
  token: string,
): Promise<DesafioDeSegundoFator | null> {
  const lido = lerTokenDoDesafio(token);
  if (lido === null) return null;
  const desafio = await portas.desafios.buscarPorIdParaAtualizar(lido.id);
  if (desafio === null) return null;
  const confere = portas.cifrador.hmacConfere(
    finalidadeDoDesafio(desafio.etapa),
    [desafio.contaId, lido.segredo],
    desafio.tokenHmac,
  );
  return confere ? desafio : null;
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
