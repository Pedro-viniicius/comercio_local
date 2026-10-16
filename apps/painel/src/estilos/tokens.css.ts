// Gera o CSS das variáveis de `@bairrin/tokens`. Fonte única dos valores: o pacote de tokens.
// O texto gerado é servido como arquivo `.css` pelo Vite (ver `vite.config.ts`): sem `<style>`
// nem atributo `style` em tempo de execução, para caber numa CSP sem `unsafe-inline` (etapa 15).
// Só a camada semântica vira variável: a paleta bruta não é para componente usar direto.
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
  tamanho,
  temaClaro,
  type CorComOpacidade,
} from '@bairrin/tokens';

/** `primaryPressed` -> `primary-pressed`, `bodySm` -> `body-sm`. */
const paraKebab = (nome: string): string =>
  nome.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const ehCorComOpacidade = (valor: unknown): valor is CorComOpacidade =>
  typeof valor === 'object' && valor !== null && 'cor' in valor && 'opacidade' in valor;

/** `#151920` com opacidade 0,48 -> `rgb(21 25 32 / 0.48)`. */
export function corComOpacidadeParaCss({ cor, opacidade }: CorComOpacidade): string {
  const canais = [1, 3, 5].map((inicio) => Number.parseInt(cor.slice(inicio, inicio + 2), 16));
  return `rgb(${canais.join(' ')} / ${opacidade})`;
}

type Variaveis = [nome: string, valor: string][];

/** Percorre o tema semântico: cada folha vira `--cor-<caminho>`. */
function variaveisDeCor(no: object, caminho: string[] = []): Variaveis {
  return Object.entries(no).flatMap(([chave, valor]): Variaveis => {
    const proximo = [...caminho, paraKebab(chave)];
    if (typeof valor === 'string') return [[`--cor-${proximo.join('-')}`, valor]];
    if (ehCorComOpacidade(valor)) {
      return [[`--cor-${proximo.join('-')}`, corComOpacidadeParaCss(valor)]];
    }
    return variaveisDeCor(valor as object, proximo);
  });
}

const px = (valor: number): string => `${valor}px`;

function variaveisDoTema(): Variaveis {
  const espacos = Object.entries(espaco).map(([chave, valor]): [string, string] => [
    `--espaco-${chave}`,
    px(valor),
  ]);
  const raios = Object.entries(raio).map(([chave, valor]): [string, string] => [
    `--raio-${chave}`,
    px(valor),
  ]);
  const elevacoes = Object.entries(elevacao).map(([chave, { sombra }]): [string, string] => [
    `--elevacao-${chave}`,
    sombra === null
      ? 'none'
      : `${sombra.x}px ${sombra.y}px ${sombra.blur}px ${corComOpacidadeParaCss(sombra.cor)}`,
  ]);
  const fontes = Object.entries(fonte).flatMap(
    ([chave, { tamanho: corpo, alturaLinha }]): Variaveis => [
      [`--fonte-${paraKebab(chave)}-tamanho`, px(corpo)],
      [`--fonte-${paraKebab(chave)}-altura-linha`, px(alturaLinha)],
    ],
  );
  const pesos = Object.entries(pesoDaFonte).map(([chave, valor]): [string, string] => [
    `--peso-${chave}`,
    String(valor),
  ]);
  const duracoes = Object.entries(duracao).map(([chave, valor]): [string, string] => [
    `--duracao-${chave}`,
    `${valor}ms`,
  ]);
  const curvas = Object.entries(easing).map(([chave, curva]): [string, string] => [
    `--easing-${chave}`,
    easingParaCss(curva),
  ]);

  return [
    ...variaveisDeCor(temaClaro),
    ...espacos,
    ...raios,
    ...elevacoes,
    ['--fonte-familia-base', familiaDaFonte.base.web],
    ...fontes,
    ...pesos,
    ['--tamanho-alvo-web', px(tamanho.touch.web)],
    ['--tamanho-controle-web', px(tamanho.control.height.web)],
    ...duracoes,
    ...curvas,
  ];
}

/**
 * Bloco `:root` com todas as variáveis, uma por linha e em ordem estável.
 * Breakpoints não entram: `var()` não vale em `@media`.
 */
export function gerarCssDeTokens(): string {
  const linhas = variaveisDoTema().map(([nome, valor]) => `  ${nome}: ${valor};`);
  // Movimento reduzido: toda transição que usa `var(--duracao-*)` herda 0 ms sem código extra.
  const zeradas = Object.keys(duracao)
    .filter((chave) => chave !== 'reduced')
    .map((chave) => `    --duracao-${chave}: ${duracao.reduced}ms;`);
  const reduzido = `@media (prefers-reduced-motion: reduce) {\n  :root {\n${zeradas.join('\n')}\n  }\n}\n`;
  return `:root {\n${linhas.join('\n')}\n}\n\n${reduzido}`;
}
