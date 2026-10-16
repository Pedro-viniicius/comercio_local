// Tipografia. Fonte: docs/produto/specs/00-design-system.md (Tokens > Tipografia)
// e docs/produto/specs/00-nome-e-identidade.md (2.4).

/** Escala: tamanho e altura de linha em px (iguais ao `fontSize` e `lineHeight` de React Native e ao CSS em px). */
export const fonte = {
  caption: { tamanho: 12, alturaLinha: 16 },
  bodySm: { tamanho: 14, alturaLinha: 20 },
  body: { tamanho: 16, alturaLinha: 24 },
  titleSm: { tamanho: 18, alturaLinha: 24 },
  title: { tamanho: 22, alturaLinha: 28 },
  display: { tamanho: 28, alturaLinha: 36 },
} as const;

export const pesoDaFonte = {
  regular: 400,
  semibold: 600,
} as const;

/**
 * Família `font.family.base` = fonte do sistema.
 * `web` vai para `font-family`; no nativo `null` significa "não definir": o React Native usa a fonte do sistema.
 */
export const familiaDaFonte = {
  base: { web: 'system-ui, sans-serif', nativo: null },
} as const;

/** Mínimo para texto essencial, em px (`caption` nunca é texto essencial sozinho). */
export const tamanhoMinimoDeTextoEssencial = 14;
