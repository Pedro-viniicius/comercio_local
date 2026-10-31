// Estilos comuns dos componentes base. Só tokens semânticos de `@bairrin/tokens`, nunca hex solto.
import { elevacao, fonte, pesoDaFonte, temaClaro, type CorComOpacidade } from '@bairrin/tokens';
import type { TextStyle, ViewStyle } from 'react-native';

/**
 * Anel de foco: 2 px `focus.ring` com 2 px de respiro por fora (design system, "Foco"). Nunca é
 * removido de um controle que recebe foco.
 */
export const anelDeFoco = {
  outlineWidth: 2,
  outlineColor: temaClaro.focus.ring,
  outlineOffset: 2,
  outlineStyle: 'solid',
} as const satisfies ViewStyle;

/**
 * Anel de foco sobre fundo escuro (toast e faixa offline): o azul de `focus.ring` não passa de 3:1
 * sobre `neutral.700` e `neutral.800`, então o anel usa o branco de `text.onAction`.
 */
export const anelDeFocoSobreEscuro = {
  ...anelDeFoco,
  outlineColor: temaClaro.text.onAction,
} as const satisfies ViewStyle;

type TokenDeFonte = keyof typeof fonte;

/** Tamanho e altura de linha do token de tipografia, no peso pedido. */
export function estiloDeTexto(
  token: TokenDeFonte,
  peso: keyof typeof pesoDaFonte = 'regular',
): TextStyle {
  return {
    fontSize: fonte[token].tamanho,
    lineHeight: fonte[token].alturaLinha,
    fontWeight: `${pesoDaFonte[peso]}`,
  };
}

/** `rgba(...)` de uma cor `#RRGGBB` com opacidade (o scrim do modal). */
export function corComOpacidade({ cor, opacidade }: CorComOpacidade): string {
  const [vermelho, verde, azul] = [1, 3, 5].map((inicio) =>
    Number.parseInt(cor.slice(inicio, inicio + 2), 16),
  );
  return `rgba(${vermelho}, ${verde}, ${azul}, ${opacidade})`;
}

/** Sombra do nível de elevação 1, 2 ou 3 (o nível 0 é só borda e não passa por aqui). */
export function sombraDeElevacao(nivel: 1 | 2 | 3): ViewStyle {
  const { sombra } = elevacao[nivel];
  return {
    boxShadow: `${sombra.x}px ${sombra.y}px ${sombra.blur}px ${corComOpacidade(sombra.cor)}`,
  };
}
