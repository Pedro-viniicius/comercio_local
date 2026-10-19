// Lista pública de senhas comuns na borda HTTP da Identidade (etapa 5b do plano 01b, S74).
//
// O dado de terceiros (SecLists, nomes do IBGE e palavras do OpenSubtitles, gerado por
// `scripts/gerar-senhas-comuns.mjs`) fica só na API, que é a autoridade: painel e apps
// conferem a regra de forma e as listas escritas à mão do `@bairrin/contratos`, e a API
// confere também esta lista. A etapa 16 aplica `comSenhaForaDaListaPublica` nos dois corpos
// com senha nova: `criarContaSchema` (`senha`) e `redefinirSenhaSchema` (`novaSenha`).
import type { z } from '@bairrin/contratos';
import {
  ehSenhaComum,
  type ListaDeSenhasComuns,
  MOTIVO_SENHA_COMUM,
} from '@bairrin/contratos/validadores';
import {
  NUCLEOS_DA_LISTA_PUBLICA,
  SENHAS_DA_LISTA_PUBLICA,
} from './dados/senhas-comuns-publicas.ts';

/** As entradas de uma lista em texto, separadas por espaço ou quebra de linha. */
function entradas(texto: string): string[] {
  return texto.split(/\s+/u).filter((entrada) => entrada.length > 0);
}

/** A lista pública já na forma comparável, montada uma vez ao carregar o módulo. */
export const LISTA_PUBLICA_DE_SENHAS: ListaDeSenhasComuns = {
  senhas: new Set(entradas(SENHAS_DA_LISTA_PUBLICA)),
  nucleos: new Set(entradas(NUCLEOS_DA_LISTA_PUBLICA)),
};

/**
 * O esquema do corpo com mais uma regra: a senha nova em `campo` não pode estar na lista
 * pública. A recusa sai como uma issue só no campo, com o código `comum` e o mesmo motivo
 * do `senhaNovaSchema`; o cliente mostra o `motivo` da API (sem chave `comum`, de propósito).
 * Não roda se o campo já tem erro (ausente, curta, longa, mal formada ou comum pelas listas
 * à mão), para o campo continuar com um erro só, nem se o valor não é texto. O `when` olha só
 * as issues do campo (R4), então campo desconhecido no corpo não impede a recusa. O zod 4.6.7
 * ainda pula o check quando outro campo tem issue com `abort: true` (e-mail inválido, por
 * exemplo): aí a recusa da lista pública sai no envio seguinte.
 */
export function comSenhaForaDaListaPublica<Esquema extends z.ZodType>(
  esquema: Esquema,
  campo: string,
): Esquema {
  return esquema.refine(
    (corpo: unknown) => {
      if (typeof corpo !== 'object' || corpo === null) return true;
      const senha: unknown = (corpo as Record<string, unknown>)[campo];
      return typeof senha !== 'string' || !ehSenhaComum(senha, LISTA_PUBLICA_DE_SENHAS);
    },
    {
      when: (payload) => !payload.issues.some((issue) => issue.path?.[0] === campo),
      path: [campo],
      error: MOTIVO_SENHA_COMUM,
      params: { codigo: 'comum' },
    },
  );
}
