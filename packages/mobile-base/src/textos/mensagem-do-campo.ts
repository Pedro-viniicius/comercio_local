// Texto de um erro de campo (CA-13). A API devolve `campos[{campo, codigo, motivo}]` e a validação
// local usa os mesmos esquemas: o texto final vem de `textos.erro.<campo>.<codigo>` e, sem essa
// chave, do `motivo` em português que a própria API manda (CLAUDE.md). Mesma regra do painel.
import { textos } from './pt-BR.ts';

/**
 * `campo` e `codigo` vêm da rede: só valem como chave se forem próprios do objeto. Sem isso,
 * `constructor` ou `toString` achariam uma função do `Object` no lugar do texto.
 */
function propriedadeDeTexto(objeto: object, chave: string): unknown {
  return Object.hasOwn(objeto, chave) ? (objeto as Record<string, unknown>)[chave] : undefined;
}

function textoDaChave(raiz: object, campo: string, codigo: string): string | undefined {
  const grupo = propriedadeDeTexto(raiz, campo);
  if (typeof grupo !== 'object' || grupo === null) return undefined;
  const texto = propriedadeDeTexto(grupo, codigo);
  return typeof texto === 'string' && texto.trim() !== '' ? texto : undefined;
}

/** `tela` (opcional) escolhe o texto próprio da tela em `textos.erroPorTela`, antes do geral. */
export function mensagemDoCampo(
  campo: string,
  codigo: string,
  motivo: string,
  tela?: string,
): string {
  if (tela !== undefined) {
    const daTela = propriedadeDeTexto(textos.erroPorTela, tela);
    if (typeof daTela === 'object' && daTela !== null) {
      const texto = textoDaChave(daTela, campo, codigo);
      if (texto !== undefined) return texto;
    }
  }
  const texto = textoDaChave(textos.erro, campo, codigo);
  if (texto !== undefined) return texto;
  return motivo.trim() === '' ? textos.erroDeCampo.semMotivo : motivo;
}
