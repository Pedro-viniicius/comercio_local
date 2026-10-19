---
name: painel-vite-vitest
description: Como o painel (Vite 8 + Vitest 5 + jsdom) serve tokens como CSS de arquivo e as armadilhas de teste de CSS e de import.meta.env
metadata:
  type: project
---

Conferido em 2026-10-16 (etapa 10 do plano 01a, apps/painel, Vite 8.3.4, Vitest 5.0.4, jsdom 30):
- Um só `vite.config.ts` com `defineConfig` de `vitest/config` serve build e testes (sem `vitest.config.ts`). O config importa `./src/estilos/tokens.css.ts` (que importa `@bairrin/tokens`) sem problema: `resolve.conditions: ['@bairrin/fonte']` basta, e o `tsconfig.node.json` herda `customConditions` do base.
- Tokens como CSS de arquivo: plugin inline com `resolveId`/`load` para o módulo virtual `virtual:bairrin-tokens.css` (id resolvido com prefixo `\0`, sufixo `.css` mantém o tratamento de CSS). No build vira `dist/assets/index-*.css` ligado por `<link>`; em dev o Vite injeta `<style>` (só dev). `*.css` do `vite/client` já tipa o import.
- Vitest esvazia qualquer `.css`, inclusive `?raw`: para o teste ler `pagina.css?raw` é preciso `test.css: { include: [/pagina\.css/] }`.
- `import.meta.env.VITE_API_URL` é `any` sem declaração; `src/env.d.ts` declara `ImportMetaEnv` para o lint de tipos não reclamar.
- RTL sem `globals`: chame `cleanup` no `afterEach`. Não há `jest-dom`: use `textContent`/`getByRole`.
- `react-hooks/set-state-in-effect`: faça `setState` só depois do `await`/`then`, e o reset de "verificando" no handler do botão.
- O `vite.config.ts` é empacotado pelo rolldown e todo import bare vira externo carregado pelo Node SEM `resolve.conditions` (plugin `externalize-deps`, conditions só `node`/`module-sync`): `@bairrin/*` importado no config vem do `dist`. Resolvido em 2026-10-16 (Q1): o config só faz `import type` do gerador e o plugin chama `runnerImport` do Vite (`@experimental`) com `environments.inline.resolve: { conditions: ['@bairrin/fonte'], noExternal: [/^@bairrin\//] }` no `load`; ~100 ms, `dependencies` alimenta `addWatchFile` (dev atualiza o CSS ao mudar token, conferido). Ver [[painel-caddy-docker]].
- `console.log` dentro de teste do Vitest aqui não apareceu na saída; para inspecionar valor use `expect(...).toBe(-1)` de propósito.

- Etapa 12b (2026-10-17): `test.css.include` agora é `/(pagina|componentes)\.css/`; sem isso `componentes.css?raw` vem vazio. Componente que faz `import './componentes.css'` entra no CSS do build só quando alguém o importa (o `build` atual não mostra o CSS dos componentes). Para ver o visual: trocar `main.tsx` por um demo temporário, `pnpm exec vite build --outDir <scratch>` e `google-chrome --headless=new --no-sandbox --screenshot` (restaurar o main depois).
- jsdom 30: `input.spellcheck` é `undefined` (use `getAttribute('spellcheck')`); `inputMode`, `autocomplete` e `maxLength` funcionam como propriedade. Em lookup de texto por chave vinda da rede (`campo`/`codigo`), use `Object.hasOwn`: `constructor`/`toString` achariam função do `Object`.

**How to apply:** etapas 12b (componentes do painel), 15 (CSP sem unsafe-inline) e qualquer tela nova do painel.
