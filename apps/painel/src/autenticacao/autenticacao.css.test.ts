// A folha das telas de autenticação segue as regras de `componentes.css`: só tokens, nada de cor
// solta, foco sempre visível e nenhuma origem externa (a CSP do painel não libera).
import { describe, expect, it } from 'vitest';
import { gerarCssDeTokens } from '../estilos/tokens.css.ts';
import css from './autenticacao.css?raw';

const variaveisDefinidas = new Set(
  [...gerarCssDeTokens().matchAll(/^\s+(--[\w-]+):/gm)].map(([, nome]) => nome),
);
const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('autenticacao.css', () => {
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

  it('não tem url() nem @import', () => {
    expect(semComentarios).not.toContain('url(');
    expect(semComentarios).not.toContain('@import');
  });

  it('o QR tem 200 px e cor dos tokens', () => {
    expect(semComentarios).toMatch(/\.aut-qr \{[^}]*width: 200px;[^}]*height: 200px;/);
    expect(semComentarios).toMatch(/\.aut-qr__modulos \{\s*fill: var\(--cor-text-primary\);/);
  });

  it('os códigos de recuperação não quebram: nowrap e colunas que se adaptam (D3)', () => {
    expect(semComentarios).toMatch(/\.aut-codigos li \{\s*white-space: nowrap;/);
    expect(semComentarios).toMatch(
      /grid-template-columns: repeat\(auto-fit, minmax\(13ch, 1fr\)\)/,
    );
  });
});
