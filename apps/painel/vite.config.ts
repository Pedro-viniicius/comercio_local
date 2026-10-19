// Configuração do painel (Vite + Vitest).
//
// Tokens como CSS: `src/estilos/tokens.css.ts` gera o texto das variáveis e o plugin abaixo o
// entrega como o módulo `virtual:bairrin-tokens.css`. Por terminar em `.css`, o Vite o trata como
// qualquer folha de estilo: no build vira um arquivo `.css` com hash, ligado por `<link>`; em dev
// é servido como `<style>` pelo próprio Vite (só em dev, fora da CSP de produção). Assim o CSS de
// produção é sempre arquivo, e a CSP da etapa 15 dispensa `unsafe-inline` em `style-src`.
//
// O gerador não é importado aqui em cima de propósito: o Vite carrega este arquivo pelo Node,
// antes de valer `resolve.conditions`, e `@bairrin/tokens` viria de `packages/tokens/dist`
// (que não existe numa cópia limpa e fica velho sem rebuild). O plugin carrega o gerador com o
// `runnerImport` do próprio Vite, já com a condição `@bairrin/fonte`, e lê o código-fonte.
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { runnerImport, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
// Só o tipo: some na compilação e não carrega `@bairrin/tokens` pelo Node.
import type * as GeradorDosTokens from './src/estilos/tokens.css.ts';

const MODULO_DOS_TOKENS = 'virtual:bairrin-tokens.css';
// Prefixo `\0` marca o módulo como virtual para os demais plugins; o sufixo `.css` o mantém CSS.
const ID_RESOLVIDO = `\0${MODULO_DOS_TOKENS}`;

/** Faz `@bairrin/*` resolver para o código-fonte, sem precisar de build prévio dos pacotes. */
const condicoesDoMonorepo = ['@bairrin/fonte'];

const RAIZ_DO_PAINEL = fileURLToPath(new URL('.', import.meta.url));
const GERADOR_DOS_TOKENS = fileURLToPath(new URL('./src/estilos/tokens.css.ts', import.meta.url));

function tokensComoCss(): Plugin {
  return {
    name: 'bairrin:tokens-css',
    resolveId: (id) => (id === MODULO_DOS_TOKENS ? ID_RESOLVIDO : undefined),
    async load(id) {
      if (id !== ID_RESOLVIDO) return undefined;
      const { module, dependencies } = await runnerImport<typeof GeradorDosTokens>(
        GERADOR_DOS_TOKENS,
        {
          root: RAIZ_DO_PAINEL,
          configFile: false,
          logLevel: 'silent',
          environments: {
            inline: {
              resolve: { conditions: condicoesDoMonorepo, noExternal: [/^@bairrin\//] },
            },
          },
        },
      );
      // Em dev, mudar um token recarrega o CSS (o gerador e os fontes do pacote são vigiados).
      for (const arquivo of [GERADOR_DOS_TOKENS, ...dependencies]) this.addWatchFile(arquivo);
      return module.gerarCssDeTokens();
    },
  };
}

export default defineConfig({
  plugins: [react(), tokensComoCss()],
  resolve: { conditions: condicoesDoMonorepo },
  ssr: { resolve: { conditions: condicoesDoMonorepo } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // Deixa o teste ler `pagina.css?raw` e `componentes.css?raw` (por padrão o Vitest esvazia os `.css`).
    css: { include: [/(pagina|componentes)\.css/] },
  },
});
