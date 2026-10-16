import { describe, expect, it } from 'vitest';
import {
  breakpoints,
  duracao,
  easing,
  easingParaCss,
  elevacao,
  espaco,
  fonte,
  paleta,
  pesoDaFonte,
  raio,
  tamanho,
  tamanhoMinimoDeTextoEssencial,
  temaClaro,
  temaEscuro,
} from './index.ts';

const HEX = /^#[0-9A-F]{6}$/;

function luminancia(hex: string): number {
  const canais = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canais[0]! + 0.7152 * canais[1]! + 0.0722 * canais[2]!;
}

/** Razão de contraste do WCAG 2.2. */
function contraste(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (claro + 0.05) / (escuro + 0.05);
}

function valores(objeto: object): unknown[] {
  return Object.values(objeto).flatMap((v: unknown) =>
    typeof v === 'object' && v !== null ? valores(v) : [v],
  );
}

const { bg, text, border, action, focus, status, banner } = temaClaro;

describe('cores', () => {
  it('toda cor da paleta e do tema claro é hex de 6 dígitos em maiúsculas', () => {
    const hexes = [...valores(paleta), ...valores({ ...temaClaro, overlay: undefined })].filter(
      (v) => typeof v === 'string',
    );
    expect(hexes.length).toBeGreaterThan(60);
    for (const hex of hexes) expect(hex).toMatch(HEX);
  });

  it('a cor da marca é o azul #1F5BD1', () => {
    expect(paleta.blue[600]).toBe('#1F5BD1');
    expect(action.primary).toBe(paleta.blue[600]);
  });

  it('o scrim é neutral.900 com 48% de opacidade, dentro do intervalo válido', () => {
    expect(temaClaro.overlay.scrim.cor).toBe(paleta.neutral[900]);
    expect(temaClaro.overlay.scrim.opacidade).toBe(0.48);
  });

  it('o tema escuro começa vazio (MVP só claro)', () => {
    expect(temaEscuro).toEqual({});
  });

  // Texto normal: 4,5:1 (WCAG 2.2 AA, 1.4.3). Componentes e bordas de controle: 3:1 (1.4.11).
  const textoSobreFundo: [string, string, string][] = [
    ['text.primary / bg.canvas', text.primary, bg.canvas],
    ['text.primary / bg.surface', text.primary, bg.surface],
    ['text.primary / bg.subtle', text.primary, bg.subtle],
    ['text.primary / bg.selected', text.primary, bg.selected],
    ['text.secondary / bg.surface', text.secondary, bg.surface],
    ['text.secondary / bg.canvas', text.secondary, bg.canvas],
    ['text.secondary / bg.subtle', text.secondary, bg.subtle],
    ['text.tertiary / bg.surface', text.tertiary, bg.surface],
    ['text.tertiary / bg.canvas', text.tertiary, bg.canvas],
    ['text.tertiary / bg.subtle (desabilitado)', text.tertiary, bg.subtle],
    ['text.link / bg.surface', text.link, bg.surface],
    ['text.link / bg.canvas', text.link, bg.canvas],
    ['text.link / bg.subtle', text.link, bg.subtle],
    ['text.onAction / action.primary', text.onAction, action.primary],
    ['text.onAction / action.primaryPressed', text.onAction, action.primaryPressed],
    ['text.onAction / action.destructive', text.onAction, action.destructive],
    ['text.onAction / action.destructivePressed', text.onAction, action.destructivePressed],
    ['action.destructive (mensagem de erro) / bg.surface', action.destructive, bg.surface],
    ['text.onAction / status.success.solid', text.onAction, status.success.solid],
    ['text.onAction / status.danger.solid', text.onAction, status.danger.solid],
    ['text.onAction / status.info.solid', text.onAction, status.info.solid],
    // O aviso sólido leva texto escuro, nunca branco (2,34:1).
    ['text.primary / status.warning.solid', text.primary, status.warning.solid],
    ['status.success.fg / .bg', status.success.fg, status.success.bg],
    ['status.warning.fg / .bg', status.warning.fg, status.warning.bg],
    ['status.danger.fg / .bg', status.danger.fg, status.danger.bg],
    ['status.info.fg / .bg', status.info.fg, status.info.bg],
    ['status.neutral.fg / .bg', status.neutral.fg, status.neutral.bg],
    ['status.warning.fg / bg.surface', status.warning.fg, bg.surface],
    ['status.success.solid (texto "Aberta") / bg.surface', status.success.solid, bg.surface],
    ['text.onSelected / bg.selected', text.onSelected, bg.selected],
    ['status.warning.onSolid / .solid', status.warning.onSolid, status.warning.solid],
    ['text.onAction / banner.offline', text.onAction, banner.offline],
    ['text.onAction / toast.bg', text.onAction, temaClaro.toast.bg],
    ['text.onAction / blue.900 (splash)', text.onAction, paleta.blue[900]],
  ];

  it.each(textoSobreFundo)('texto %s atinge 4,5:1', (_nome, fg, fundo) => {
    expect(contraste(fg, fundo)).toBeGreaterThanOrEqual(4.5);
  });

  const componentes: [string, string, string][] = [
    ['border.control / bg.surface', border.control, bg.surface],
    ['border.control / bg.canvas', border.control, bg.canvas],
    ['focus.ring / bg.surface', focus.ring, bg.surface],
    ['focus.ring / bg.canvas', focus.ring, bg.canvas],
    ['ícone da aba ativa (text.link) / nav.indicator', text.link, temaClaro.nav.indicator],
  ];

  it.each(componentes)('componente %s atinge 3:1', (_nome, fg, fundo) => {
    expect(contraste(fg, fundo)).toBeGreaterThanOrEqual(3);
  });

  // Razões que a identidade (2.3) publica, arredondadas em 2 casas: se a paleta mudar, a spec precisa mudar junto.
  const razoesDaSpec: [string, string, number][] = [
    [paleta.neutral[900], paleta.neutral[0], 17.62],
    [paleta.neutral[600], paleta.neutral[0], 7.28],
    [paleta.neutral[500], paleta.neutral[0], 5.23],
    [paleta.neutral[500], paleta.neutral[100], 4.58],
    [paleta.neutral[400], paleta.neutral[0], 3.36],
    [paleta.neutral[0], paleta.blue[600], 6.04],
    [paleta.neutral[0], paleta.blue[700], 8.12],
    [paleta.blue[700], paleta.blue[50], 7.42],
    [paleta.blue[800], paleta.blue[100], 8.16],
    [paleta.green[600], paleta.neutral[0], 4.93],
    [paleta.green[700], paleta.green[50], 6.39],
    [paleta.amber[700], paleta.amber[50], 6.01],
    [paleta.neutral[900], paleta.amber[500], 7.52],
    [paleta.red[700], paleta.red[50], 6.46],
    [paleta.red[600], paleta.neutral[0], 5.33],
    [paleta.neutral[0], paleta.neutral[800], 14.21],
    [paleta.neutral[0], paleta.neutral[700], 10.28],
    [paleta.neutral[0], paleta.blue[900], 12.18],
  ];

  it.each(razoesDaSpec)('%s sobre %s dá %s:1, como na identidade', (fg, fundo, razao) => {
    expect(Math.abs(contraste(fg, fundo) - razao)).toBeLessThan(0.015);
  });

  it('as combinações que a identidade proíbe de fato falham', () => {
    expect(contraste(paleta.neutral[0], paleta.amber[500])).toBeLessThan(4.5);
    expect(contraste(paleta.neutral[400], paleta.neutral[0])).toBeLessThan(4.5);
    expect(contraste(paleta.neutral[300], paleta.neutral[0])).toBeLessThan(3);
    expect(contraste(paleta.neutral[200], paleta.neutral[0])).toBeLessThan(3);
    expect(contraste(paleta.blue[500], paleta.blue[50])).toBeLessThan(4.5);
    expect(contraste(paleta.green[500], paleta.neutral[0])).toBeLessThan(4.5);
  });
});

describe('tipografia', () => {
  const escala = Object.values(fonte);

  it('tem 6 tamanhos crescentes, com altura de linha maior que o tamanho e múltipla de 4', () => {
    expect(escala).toHaveLength(6);
    escala.forEach((item, i) => {
      expect(item.alturaLinha).toBeGreaterThan(item.tamanho);
      expect(item.alturaLinha % 4).toBe(0);
      if (i > 0) expect(item.tamanho).toBeGreaterThan(escala[i - 1]!.tamanho);
    });
  });

  it('usa só os pesos 400 e 600', () => {
    expect(Object.values(pesoDaFonte)).toEqual([400, 600]);
  });

  it('o corpo e acima respeitam o mínimo de 14 px para texto essencial', () => {
    expect(tamanhoMinimoDeTextoEssencial).toBe(14);
    expect(fonte.bodySm.tamanho).toBeGreaterThanOrEqual(tamanhoMinimoDeTextoEssencial);
    expect(fonte.caption.tamanho).toBeLessThan(tamanhoMinimoDeTextoEssencial);
  });
});

describe('espaço, raio, elevação, tamanho, movimento e breakpoints', () => {
  it('a escala de espaço é de 4 px, estritamente crescente, com os 11 degraus da spec', () => {
    const passos = Object.keys(espaco).map(Number);
    expect(passos).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16]);
    for (const [passo, px] of Object.entries(espaco)) expect(px).toBe(Number(passo) * 4);
  });

  it('o raio cresce de sm a xl e full é uma pílula', () => {
    expect(raio.sm).toBeLessThan(raio.md);
    expect(raio.md).toBeLessThan(raio.lg);
    expect(raio.lg).toBeLessThan(raio.xl);
    expect(raio.full).toBeGreaterThanOrEqual(9999);
  });

  it('a elevação 0 usa borda e as demais sombras crescem, na cor neutral.900', () => {
    expect(elevacao[0]).toEqual({ sombra: null, comBorda: true });
    const sombras = [elevacao[1].sombra, elevacao[2].sombra, elevacao[3].sombra];
    sombras.forEach((s, i) => {
      expect(s.cor.cor).toBe(paleta.neutral[900]);
      const anterior = sombras[i - 1];
      if (anterior) {
        expect(s.y).toBeGreaterThan(anterior.y);
        expect(s.blur).toBeGreaterThan(anterior.blur);
        expect(s.cor.opacidade).toBeGreaterThan(anterior.cor.opacidade);
      }
    });
  });

  it('alvos de toque e controles seguem a acessibilidade da spec', () => {
    expect(tamanho.touch.min).toBeGreaterThanOrEqual(44);
    expect(tamanho.touch.webMin).toBe(24);
    expect(tamanho.touch.web).toBeGreaterThanOrEqual(tamanho.touch.webMin);
    expect(tamanho.control.height.mobile).toBeGreaterThanOrEqual(tamanho.touch.min);
    expect(tamanho.control.height.web).toBeGreaterThanOrEqual(tamanho.touch.web);
    expect(tamanho.icon.sm).toBeLessThan(tamanho.icon.md);
    expect(tamanho.icon.md).toBeLessThan(tamanho.icon.lg);
  });

  it('as durações crescem de fast a slow', () => {
    expect(duracao.fast).toBeLessThan(duracao.base);
    expect(duracao.base).toBeLessThan(duracao.slow);
  });

  it('o movimento reduzido tem duração 0 ms', () => {
    expect(duracao.reduced).toBe(0);
  });

  it('as curvas têm x entre 0 e 1 e viram cubic-bezier para CSS', () => {
    for (const curva of [easing.standard, easing.exit]) {
      expect(curva[0]).toBeGreaterThanOrEqual(0);
      expect(curva[0]).toBeLessThanOrEqual(1);
      expect(curva[2]).toBeGreaterThanOrEqual(0);
      expect(curva[2]).toBeLessThanOrEqual(1);
    }
    expect(easingParaCss(easing.standard)).toBe('cubic-bezier(0.2, 0, 0, 1)');
    expect(easingParaCss(easing.exit)).toBe('cubic-bezier(0.4, 0, 1, 1)');
  });

  it('os breakpoints cobrem todas as larguras sem lacuna nem sobreposição', () => {
    const faixas = [breakpoints.sm, breakpoints.md, breakpoints.lg, breakpoints.xl];
    expect(faixas[0]!.min).toBe(0);
    faixas.slice(1).forEach((faixa, i) => {
      expect(faixa.min).toBe((faixas[i]!.max as number) + 1);
    });
    expect(breakpoints.xl.max).toBeNull();
  });
});
