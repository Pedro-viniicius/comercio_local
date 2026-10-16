// Espaço, raio, elevação, tamanho, movimento e breakpoints.
// Fonte: docs/produto/specs/00-design-system.md (Tokens). Valores em px, exceto onde indicado.

import { paleta, type CorComOpacidade } from './cores.ts';

/** Escala de 4 px. A chave é o nome do token (`space.4` = 16 px). */
export const espaco = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const raio = {
  /** Chip pequeno, badge. */
  sm: 4,
  /** Campo, botão. */
  md: 8,
  /** Card. */
  lg: 12,
  /** Folha inferior, modal. */
  xl: 16,
  /** Avatar, chip de filtro, pílula. */
  full: 9999,
} as const;

export interface Sombra {
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly cor: CorComOpacidade;
}

export interface Elevacao {
  /** `null`: sem sombra. */
  readonly sombra: Sombra | null;
  /** Desenha a borda `color.border.subtle` no lugar da sombra. */
  readonly comBorda: boolean;
}

const corDaSombra = (opacidade: number): CorComOpacidade => ({
  cor: paleta.neutral[900],
  opacidade,
});

export const elevacao = {
  /** Card em lista (padrão: mais leve para celular fraco). */
  0: { sombra: null, comBorda: true },
  /** Barra superior ao rolar, card em hover (web). */
  1: { sombra: { x: 0, y: 1, blur: 2, cor: corDaSombra(0.08) }, comBorda: false },
  /** Barra fixa de ação, toast, menu. */
  2: { sombra: { x: 0, y: 4, blur: 12, cor: corDaSombra(0.12) }, comBorda: false },
  /** Folha inferior, modal. */
  3: { sombra: { x: 0, y: 8, blur: 24, cor: corDaSombra(0.16) }, comBorda: false },
} as const satisfies Record<number, Elevacao>;

export const tamanho = {
  touch: {
    /** Mobile: nenhum alvo menor. */
    min: 44,
    /** Painel. */
    web: 32,
    /** Mínimo absoluto no painel. */
    webMin: 24,
  },
  icon: { sm: 16, md: 20, lg: 24 },
  control: {
    height: { mobile: 48, web: 40 },
  },
  bottomNav: {
    /** Soma a área segura do aparelho. */
    height: 64,
  },
} as const;

/**
 * Durações em ms. Com movimento reduzido, os componentes usam `reduced` (0 ms) ou só opacidade
 * de até 120 ms. No painel, o CSS gerado já zera as variáveis com `prefers-reduced-motion`.
 */
export const duracao = {
  /** Pressionar, alternar. */
  fast: 120,
  /** Toast, chips. */
  base: 200,
  /** Folha inferior, troca de tela. */
  slow: 300,
  /** Valor com `prefers-reduced-motion` (ou "remover animações" no sistema). */
  reduced: 0,
} as const;

/** Curvas como os 4 números de `cubic-bezier(x1, y1, x2, y2)` (aceitos por `Easing.bezier` e pelo CSS). */
export const easing = {
  standard: [0.2, 0, 0, 1],
  exit: [0.4, 0, 1, 1],
} as const;

/** `cubic-bezier(...)` para CSS a partir de uma curva de `easing`. */
export const easingParaCss = (curva: readonly [number, number, number, number]): string =>
  `cubic-bezier(${curva.join(', ')})`;

/** Faixas de largura do painel, em px. `max: null` = sem limite. */
export const breakpoints = {
  sm: { min: 0, max: 767 },
  md: { min: 768, max: 1023 },
  lg: { min: 1024, max: 1279 },
  xl: { min: 1280, max: null },
} as const;
