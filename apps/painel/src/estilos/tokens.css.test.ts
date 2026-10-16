import {
  duracao,
  easing,
  easingParaCss,
  elevacao,
  espaco,
  familiaDaFonte,
  fonte,
  pesoDaFonte,
  raio,
  temaClaro,
} from '@bairrin/tokens';
import { describe, expect, it } from 'vitest';
import pagina from './pagina.css?raw';
import { corComOpacidadeParaCss, gerarCssDeTokens } from './tokens.css.ts';

/** Lê o bloco `:root` principal (antes do `@media`) como mapa `--nome` -> valor. */
function lerVariaveis(css: string): Map<string, string> {
  const mapa = new Map<string, string>();
  const principal = css.slice(0, css.indexOf('@media'));
  for (const [, nome, valor] of principal.matchAll(/^\s+(--[\w-]+): (.+);$/gm)) {
    if (nome && valor) mapa.set(nome, valor);
  }
  return mapa;
}

const css = gerarCssDeTokens();
const variaveis = lerVariaveis(css);

describe('gerarCssDeTokens', () => {
  it('gera o bloco :root (mais o de movimento reduzido), sem estilo em linha nem @import', () => {
    expect(css.startsWith(':root {\n')).toBe(true);
    expect(css.trimEnd().endsWith('}')).toBe(true);
    expect(css.match(/:root/g)).toHaveLength(2);
    expect(css).not.toContain('@import');
    expect(css).not.toContain('url(');
  });

  it('é determinístico', () => {
    expect(gerarCssDeTokens()).toBe(css);
  });

  it('traz as cores semânticas do tema claro', () => {
    expect(variaveis.get('--cor-bg-canvas')).toBe(temaClaro.bg.canvas);
    expect(variaveis.get('--cor-bg-surface')).toBe(temaClaro.bg.surface);
    expect(variaveis.get('--cor-text-primary')).toBe(temaClaro.text.primary);
    expect(variaveis.get('--cor-text-on-action')).toBe(temaClaro.text.onAction);
    expect(variaveis.get('--cor-border-control')).toBe(temaClaro.border.control);
    expect(variaveis.get('--cor-action-primary')).toBe(temaClaro.action.primary);
    expect(variaveis.get('--cor-action-primary-pressed')).toBe(temaClaro.action.primaryPressed);
    expect(variaveis.get('--cor-focus-ring')).toBe(temaClaro.focus.ring);
    expect(variaveis.get('--cor-status-success-fg')).toBe(temaClaro.status.success.fg);
    expect(variaveis.get('--cor-status-warning-bg')).toBe(temaClaro.status.warning.bg);
    expect(variaveis.get('--cor-status-danger-solid')).toBe(temaClaro.status.danger.solid);
    expect(variaveis.get('--cor-status-neutral-fg')).toBe(temaClaro.status.neutral.fg);
    expect(variaveis.get('--cor-banner-offline')).toBe(temaClaro.banner.offline);
  });

  it('cobre toda folha do tema claro, sem sobrar nem faltar cor', () => {
    const esperadas = new Set<string>();
    const percorrer = (no: object, caminho: string[]) => {
      for (const [chave, valor] of Object.entries(no)) {
        const proximo = [...caminho, chave.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()];
        if (typeof valor === 'string' || 'opacidade' in (valor as object)) {
          esperadas.add(`--cor-${proximo.join('-')}`);
        } else {
          percorrer(valor as object, proximo);
        }
      }
    };
    percorrer(temaClaro, []);

    const geradas = [...variaveis.keys()].filter((nome) => nome.startsWith('--cor-'));
    expect(new Set(geradas)).toEqual(esperadas);
  });

  it('converte cor com opacidade para rgb()', () => {
    const { scrim } = temaClaro.overlay;
    expect(corComOpacidadeParaCss(scrim)).toBe('rgb(21 25 32 / 0.48)');
    expect(variaveis.get('--cor-overlay-scrim')).toBe('rgb(21 25 32 / 0.48)');
  });

  it('não expõe a paleta bruta', () => {
    expect(
      [...variaveis.keys()].filter((nome) => /^--cor-.*(blue|green|amber|red)-\d/.test(nome)),
    ).toEqual([]);
  });

  it('traz espaço, raio e fonte em px', () => {
    for (const [chave, valor] of Object.entries(espaco)) {
      expect(variaveis.get(`--espaco-${chave}`)).toBe(`${valor}px`);
    }
    for (const [chave, valor] of Object.entries(raio)) {
      expect(variaveis.get(`--raio-${chave}`)).toBe(`${valor}px`);
    }
    expect(variaveis.get('--fonte-body-tamanho')).toBe(`${fonte.body.tamanho}px`);
    expect(variaveis.get('--fonte-body-sm-altura-linha')).toBe(`${fonte.bodySm.alturaLinha}px`);
    expect(variaveis.get('--fonte-title-sm-tamanho')).toBe(`${fonte.titleSm.tamanho}px`);
    expect(variaveis.get('--fonte-familia-base')).toBe(familiaDaFonte.base.web);
    expect(variaveis.get('--peso-regular')).toBe(String(pesoDaFonte.regular));
    expect(variaveis.get('--peso-semibold')).toBe(String(pesoDaFonte.semibold));
  });

  it('traz elevação, duração e curva de movimento', () => {
    expect(elevacao[0].sombra).toBeNull();
    expect(variaveis.get('--elevacao-0')).toBe('none');
    expect(variaveis.get('--elevacao-1')).toBe('0px 1px 2px rgb(21 25 32 / 0.08)');
    expect(variaveis.get('--elevacao-3')).toBe('0px 8px 24px rgb(21 25 32 / 0.16)');
    expect(variaveis.get('--duracao-fast')).toBe(`${duracao.fast}ms`);
    expect(variaveis.get('--easing-standard')).toBe(easingParaCss(easing.standard));
    expect(variaveis.get('--easing-standard')).toBe('cubic-bezier(0.2, 0, 0, 1)');
  });

  it('zera as durações com prefers-reduced-motion', () => {
    const bloco = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(bloco).toContain('@media (prefers-reduced-motion: reduce) {\n  :root {');
    for (const chave of ['fast', 'base', 'slow']) {
      expect(bloco).toContain(`--duracao-${chave}: 0ms;`);
    }
    expect(variaveis.get('--duracao-reduced')).toBe('0ms');
    expect(bloco).not.toContain('--duracao-reduced');
  });

  it('traz os tokens semânticos de toast, seleção, navegação e aviso sólido', () => {
    expect(variaveis.get('--cor-toast-bg')).toBe(temaClaro.toast.bg);
    expect(variaveis.get('--cor-text-on-selected')).toBe(temaClaro.text.onSelected);
    expect(variaveis.get('--cor-nav-indicator')).toBe(temaClaro.nav.indicator);
    expect(variaveis.get('--cor-status-warning-on-solid')).toBe(temaClaro.status.warning.onSolid);
  });

  it('todo var(--x) usado em pagina.css está definido nos tokens', () => {
    const usadas = [...pagina.matchAll(/var\((--[\w-]+)\)/g)].map(([, nome]) => nome);
    expect(usadas.length).toBeGreaterThan(0);
    const faltando = usadas.filter((nome) => nome && !variaveis.has(nome));
    expect(faltando).toEqual([]);
  });
});
