---
name: painel-vite-vitest
description: Painel (Vite 8 + Vitest 5 + jsdom) — tokens como CSS de arquivo, CSP sem data: (?no-inline, QR em SVG), fake timers com RTL, regras do react-hooks 7, captura com CSP
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

- Etapa 15 do 01b (2026-10-19): a CSP do Caddy tem `img-src 'self'`, e o Vite 8 embute SVG pequeno como `data:` (bloqueado): importe com `?no-inline` (tipado no `vite/client`). QR do TOTP: `create()` do `qrcode` 1.5.4 dá a matriz (`modules.size/data`) e a tela desenha um `<path>` de SVG com `fill` por classe CSS (sem `data:`, sem canvas, testável no jsdom). `test.css.include` agora inclui `autenticacao`.
- Vitest com `vi.useFakeTimers()` + RTL: `waitFor/findBy` travam (RTL só detecta `jest`); use `await act(() => vi.advanceTimersByTimeAsync(ms))` e `getBy`. Contagem feita com `setTimeout` re-armado por efeito avança só 1 passo por `act`: use `setInterval` com prazo (`Date.now()`), que também acerta em aba em segundo plano.
- eslint-plugin-react-hooks 7 (`recommended-latest`, regras do compilador): `ref={refs.email}` num objeto de refs dá `react-hooks/refs`; use uma `useRef` por campo. Função do pai usada em efeito: padrão "ref da última função" no lugar de `eslint-disable`.
- Captura de fluxo com interação sem puppeteer: `main.tsx` temporário que monta o `App` com `fetch` falso e dirige a tela pelo DOM (setter nativo de `value` + evento `input`, `button.click()`), `vite build --outDir <scratch>`, servidor Python no scratchpad que manda o cabeçalho CSP do Caddyfile, e `google-chrome --headless=new --virtual-time-budget=6000 --screenshot`. Controle negativo da CSP numa página com `<style>` (o log mostra 2 violações).
- `eslint .` na raiz entra em `apps/painel/.vercel/output` (fora do git, não está nos `globalIgnores`): 1344 erros que não são do código; para o painel rode `npx eslint apps/painel --ignore-pattern 'apps/painel/.vercel/**'`.
- `git mv` grava no índice (stage); desfaça com `git reset -q -- <caminhos>` para não deixar nada preparado.

- Correção do grupo C (2026-10-19): Chrome 152 headless (`--headless=new`) NÃO escreve o console no `--enable-logging=stderr` (nem com `--v=1`). Para contar violação de CSP: módulo temporário `src/zz-sonda-csp.ts` importado como PRIMEIRA linha do `main.tsx` temporário (ESM avalia na ordem dos imports, antes do zod), com `securitypolicyviolation` gravando num `<pre>` e `--dump-dom`. Controle negativo: o mesmo build sem o `jitless` do zod dá `violacoes=1 script-src eval`. `--virtual-time-budget=1700000` avança 28 min de timers (aviso de inatividade) sem esperar.
- O ambiente jsdom do Vitest 5 expõe o `BroadcastChannel` do Node (instâncias do mesmo processo se falam). Para teste de abas, injete um barramento falso (`sessao/teste/abas-falsas.ts`); o padrão do app só abre o canal enquanto há ouvinte e fecha no `cleanup`.
- Botão com `carregando` muda o nome acessível para "Enviando…": guarde o elemento antes do 1º clique para clicar de novo.

**How to apply:** etapas 12b (componentes do painel), 15 (CSP sem unsafe-inline) e qualquer tela nova do painel.
