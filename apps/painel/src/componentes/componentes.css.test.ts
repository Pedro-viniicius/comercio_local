// A folha de estilo dos componentes só pode usar tokens: variável que não existe vira estilo
// descartado em silêncio, e cor ou espaço solto foge do design system.
import { describe, expect, it } from 'vitest';
import { gerarCssDeTokens } from '../estilos/tokens.css.ts';
import css from './componentes.css?raw';

const variaveisDefinidas = new Set(
  [...gerarCssDeTokens().matchAll(/^\s+(--[\w-]+):/gm)].map(([, nome]) => nome),
);
const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('componentes.css', () => {
  it('todo var(--x) usado está definido nos tokens', () => {
    const usadas = [...semComentarios.matchAll(/var\((--[\w-]+)\)/g)].map(([, nome]) => nome);
    expect(usadas.length).toBeGreaterThan(0);
    expect(usadas.filter((nome) => nome && !variaveisDefinidas.has(nome))).toEqual([]);
  });

  it('não tem cor solta (hex, rgb, hsl): só a camada semântica dos tokens', () => {
    expect(semComentarios).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(semComentarios).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
  });

  it('não esconde nem remove o contorno de foco', () => {
    expect(semComentarios).not.toMatch(/outline:\s*(none|0)\b/);
  });

  it('não tem url() nem @import (a CSP não libera origem externa)', () => {
    expect(semComentarios).not.toContain('url(');
    expect(semComentarios).not.toContain('@import');
  });
});
