// Cores do Bairrin. Fonte única dos valores: docs/produto/specs/00-nome-e-identidade.md (2.2, paleta)
// e docs/produto/specs/00-design-system.md (Tokens > Cor, camada semântica).
// Sem dependência de React Native nem de DOM: apps e painel transformam estes objetos em tema ou variáveis CSS.

/** Paleta bruta. Componentes não a usam direto: só a camada semântica (`temaClaro`). */
export const paleta = {
  blue: {
    50: '#EFF5FF',
    100: '#DBE7FE',
    200: '#B8D0FC',
    300: '#88B0F8',
    400: '#5A8DF1',
    500: '#3170E6',
    600: '#1F5BD1',
    700: '#1A49AB',
    800: '#1A3D88',
    900: '#18336B',
  },
  green: {
    50: '#ECF8F1',
    100: '#D3EFDF',
    500: '#2E9A62',
    600: '#1F8050',
    700: '#176642',
    800: '#145237',
  },
  neutral: {
    0: '#FFFFFF',
    50: '#F7F8FA',
    100: '#EEF0F3',
    200: '#DFE3E8',
    300: '#C5CBD3',
    400: '#848D9A',
    500: '#646D7B',
    600: '#4F5765',
    700: '#3A414D',
    800: '#262B34',
    900: '#151920',
  },
  // A identidade só define os degraus de aviso e erro usados nas semânticas.
  amber: {
    50: '#FFF6E5',
    500: '#E59A0B',
    700: '#8F4E00',
  },
  red: {
    50: '#FDF0EF',
    600: '#C9302C',
    700: '#A8231F',
  },
} as const;

/** Cor com opacidade separada (formato que serve a React Native e ao CSS `rgb(... / a)`). */
export interface CorComOpacidade {
  readonly cor: string;
  /** De 0 a 1. */
  readonly opacidade: number;
}

/** Tema claro: camada semântica, valores vindos da paleta. */
export const temaClaro = {
  bg: {
    canvas: paleta.neutral[50],
    surface: paleta.neutral[0],
    subtle: paleta.neutral[100],
    selected: paleta.blue[100],
  },
  text: {
    primary: paleta.neutral[900],
    secondary: paleta.neutral[600],
    /** Legenda e placeholder. */
    tertiary: paleta.neutral[500],
    onAction: paleta.neutral[0],
    /** Texto do chip de filtro selecionado, sobre `bg.selected`. */
    onSelected: paleta.blue[800],
    link: paleta.blue[600],
  },
  border: {
    /** Decorativa. */
    subtle: paleta.neutral[200],
    /** Campos e checkbox (3:1). */
    control: paleta.neutral[400],
  },
  action: {
    primary: paleta.blue[600],
    primaryPressed: paleta.blue[700],
    destructive: paleta.red[600],
    destructivePressed: paleta.red[700],
  },
  focus: {
    ring: paleta.blue[600],
  },
  status: {
    success: { bg: paleta.green[50], fg: paleta.green[700], solid: paleta.green[600] },
    warning: {
      bg: paleta.amber[50],
      fg: paleta.amber[700],
      solid: paleta.amber[500],
      /** Único texto que passa sobre `solid` (o branco falha: 2,34:1). */
      onSolid: paleta.neutral[900],
    },
    danger: { bg: paleta.red[50], fg: paleta.red[700], solid: paleta.red[600] },
    info: { bg: paleta.blue[50], fg: paleta.blue[700], solid: paleta.blue[600] },
    neutral: { bg: paleta.neutral[100], fg: paleta.neutral[700] },
  },
  overlay: {
    scrim: { cor: paleta.neutral[900], opacidade: 0.48 } satisfies CorComOpacidade,
  },
  banner: {
    offline: paleta.neutral[800],
  },
  /** Fundo do toast; o texto é `text.onAction`. */
  toast: {
    bg: paleta.neutral[700],
  },
  nav: {
    /** Pílula atrás do ícone da aba ativa (decorativa). */
    indicator: paleta.blue[50],
  },
} as const;

type Largo<T> = T extends string
  ? string
  : T extends number
    ? number
    : { -readonly [K in keyof T]: Largo<T[K]> };

type ParcialProfundo<T> = { [K in keyof T]?: ParcialProfundo<T[K]> };

/** Forma do tema de cores (valores abertos, para o mapa escuro ter o mesmo molde). */
export type TemaDeCores = Largo<typeof temaClaro>;

/**
 * Tema escuro: vazio de propósito. O MVP é só tema claro (spec do design system, "Modo escuro");
 * o mapa escuro é um segundo conjunto de valores sobre os mesmos tokens semânticos.
 */
export const temaEscuro: ParcialProfundo<TemaDeCores> = {};
