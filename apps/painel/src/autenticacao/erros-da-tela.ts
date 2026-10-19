// Como as telas de autenticação leem um erro: o status decide o destino (campo, banner ou volta a
// P1), e o texto de campo sai sempre de `mensagemDoCampo` (CA-13). Nada aqui guarda ou registra o
// erro: o `ErroDeApi` só traz status, código e campos, sem corpo nem URL.
import { ehErroDeApi } from '@bairrin/cliente-api';
import { camposDoErroZod, type CampoDoProblema, type z } from '@bairrin/contratos';
import { mensagemDoCampo } from '../textos/mensagem-do-campo.ts';

export type Falha =
  /** 400 com `campos`: fica na tela, com o erro em cada campo. */
  | { tipo: 'campos'; campos: readonly CampoDoProblema[] }
  /** 401: credencial errada (P1) ou desafio vencido, usado ou esgotado (P1a, P1b). */
  | { tipo: 'nao_autenticado' }
  /** 403 `sem_acesso_painel` (S23): senha certa, conta sem perfil admin. */
  | { tipo: 'sem_acesso_painel' }
  /** Outro 403. */
  | { tipo: 'sem_permissao' }
  /** 429: freio (CA-04). A tela nunca mostra o `Retry-After`. */
  | { tipo: 'limite' }
  /** Rede, tempo esgotado, 5xx, resposta fora do contrato ou status inesperado. */
  | { tipo: 'servidor' };

export function classificarFalha(erro: unknown): Falha {
  if (!ehErroDeApi(erro)) return { tipo: 'servidor' };
  if (erro.status === 400 && erro.campos.length > 0) return { tipo: 'campos', campos: erro.campos };
  if (erro.status === 401) return { tipo: 'nao_autenticado' };
  if (erro.status === 403) {
    return erro.codigo === 'sem_acesso_painel'
      ? { tipo: 'sem_acesso_painel' }
      : { tipo: 'sem_permissao' };
  }
  if (erro.status === 429) return { tipo: 'limite' };
  return { tipo: 'servidor' };
}

export type ErrosDosCampos<Campo extends string> = Partial<Record<Campo, string>>;

export interface ErrosParaATela<Campo extends string> {
  erros: ErrosDosCampos<Campo>;
  /** Na ordem da tela: o primeiro recebe o foco. */
  ordem: Campo[];
  /** Veio erro de um campo que a tela não mostra (o desafio, por exemplo). */
  foraDaTela: boolean;
}

/**
 * Texto de cada campo que a tela mostra (o primeiro erro de cada um). `tela` escolhe o texto
 * próprio dela em `textos.erroPorTela` (P1b passo 2, P1c).
 */
export function errosParaATela<Campo extends string>(
  campos: readonly CampoDoProblema[],
  visiveis: readonly Campo[],
  tela?: string,
): ErrosParaATela<Campo> {
  const erros: ErrosDosCampos<Campo> = {};
  let foraDaTela = false;
  for (const { campo, codigo, motivo } of campos) {
    const visivel = visiveis.find((nome) => nome === campo);
    if (visivel === undefined) {
      foraDaTela = true;
      continue;
    }
    erros[visivel] ??= mensagemDoCampo(campo, codigo, motivo, tela);
  }
  return { erros, ordem: visiveis.filter((nome) => erros[nome] !== undefined), foraDaTela };
}

export type Validacao<T> = { ok: true; dados: T } | { ok: false; campos: CampoDoProblema[] };

/** Validação local com o mesmo esquema da API (CA-13), no formato de `campos` do Problema. */
export function validarLocal<T>(esquema: z.ZodType<T>, valor: unknown): Validacao<T> {
  const resultado = esquema.safeParse(valor);
  return resultado.success
    ? { ok: true, dados: resultado.data }
    : { ok: false, campos: camposDoErroZod(resultado.error) };
}
