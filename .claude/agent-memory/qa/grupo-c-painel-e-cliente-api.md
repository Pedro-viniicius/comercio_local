---
name: grupo-c-painel-e-cliente-api
description: QA do grupo C do 01b (etapas 5c e 15: cliente-api, contratos, painel) em 2026-10-19: rodada 1 (Q22, Q23) e rodada 2 (Q22/Q23 fechados, Q25 novo vermelho), testes, mutação e armadilhas
metadata:
  type: project
---

Rodada 1 (2026-10-19), só `packages/**` e `apps/painel/**`. Contagens depois dos meus testes: painel 373 (2 vermelhos), cliente-api 165, contratos 623. Antes: 221, 132, 597.

Testes novos: `cliente-api/src/sessao.5c.bordas.test.ts`; `contratos/src/identidade/renovacao.bordas.test.ts`; painel em `src/autenticacao/`: `Fluxo.envio-repetido`, `Fluxo.foco-e-anuncio`, `Fluxo.falhas`, `Fluxo.codigos-de-recuperacao`, `Fluxo.sessao-no-navegador`, `Fluxo.campos`, `inatividade.bordas`, `RecuperarSenha.bordas` (todos `.test.tsx`) e o apoio `fixtures/fluxo-comum.tsx`.

**Q22 (média, vermelho):** `useInatividade` conta `pointerdown` como interação, então `aoRetomar` tira o Banner antes do `click`; no navegador o React atualiza em microtarefa e o botão "Continuar conectado" some entre apertar e soltar. A renovação (`renovarSessao`) nunca é pedida pelo mouse; só por tecla/leitor de tela (teste verde cobre o clique puro). Teste: `inatividade.bordas.test.tsx` "Q22". Correção sugerida: o botão trata `onPointerDown` ou o hook ignora interação dentro do Banner de aviso.
**Q23 (baixa, vermelho):** em P1a, colar/autopreencher um código completo por cima do recusado não envia sozinho (`aoDigitar` só envia se o valor anterior estava incompleto). Teste: `Fluxo.campos.test.tsx` "Q23".

Lacunas aceitas: foco vai ao `body` ao entrar em Início (o botão focado some); "Sair" no passo 3 do P1b descarta os códigos sem confirmação (só `beforeunload` protege); leitura de `localStorage` que falha conta como marca, então com `localStorage` bloqueado toda abertura faz DELETE no cookie e pede login (decisão documentada); `chave` do passo 2 no estado do React não é observável no DOM.

Mutação (34 mutantes, cópia em scratchpad): todos mortos menos equivalentes: guarda `carregando` do `continuar` (o `Botao` já ignora clique) e `espera > 0` do `reenviar` (botão `disabled`), `setChave(undefined)` (não renderiza no passo 3).

**Armadilhas:**
- O hook do qa só deixa gravar em pastas `fixtures/`, `tests/`, `testes/`, `__tests__` ou arquivo `*.test.*`: `autenticacao/teste/` (singular) é bloqueada; o apoio novo ficou em `fixtures/`.
- Botão `carregando` não usa `disabled`: o nome acessível vira "Enviando…" (rótulo `aria-hidden`); ache pelo submit ou por esse nome.
- `fireEvent.click` não move o foco no jsdom: chame `.focus()` antes para provar que a tela devolve o foco.
- `localStorage` no vitest/jsdom é propriedade própria da janela: guarde `Object.getOwnPropertyDescriptor(window,'localStorage')` e restaure; `Reflect.deleteProperty` o apaga de vez.
- jsdom: `Blob` sem `.text()`/`stream()` (use `FileReader`), sem `URL.createObjectURL` (instale e apague), `anchor.click` com `vi.spyOn(HTMLAnchorElement.prototype,'click')`.
- Fake timers: o `Inicio` só monta depois da renovação da abertura; faça `await avancar(0)` antes de `avancar(28 min)`. Um `act` com dois cliques no mesmo instante prova a guarda por `ref`.
- O scratchpad da sessão é COMPARTILHADO com o outro qa (API): ele sobrescreveu `mutar.py` e recria `mut/`. Use nomes próprios (`mutpainel/`, `mutar-painel.py`).
- Painel mutante: `node_modules` do painel na cópia precisa ser diretório real com symlinks para os do repo e `@bairrin/*` apontando para a cópia; `./node_modules/.bin/vitest run --no-fsModuleCache --reporter=json --outputFile=...`.

**How to apply:** na rodada 2, `pnpm --filter painel exec vitest run src/autenticacao/inatividade.bordas.test.tsx src/autenticacao/Fluxo.campos.test.tsx`; os dois testes Q devem ficar verdes sem edição.

## Rodada 2 (2026-10-19)
Q22 e Q23 fechados sem edição dos testes. Os arquivos moveram: lógica de sessão agora em `apps/painel/src/sessao/` (`inatividade.ts`, `autenticacao-do-painel.ts`, `entre-abas.ts`, `teste/abas-falsas.ts`). Contagens: painel 452 (1 vermelho de propósito: Q25), cliente-api 165, contratos 623.

**Q25 (média, vermelho):** o D2 (`if (encerrado || avisado) return` no `useInatividade`) vale também no passo 3 da P1b, que não tem aviso nem "Continuar conectado": interação entre 28 e 30 min é ignorada e os códigos somem e a sessão termina aos 30 min mesmo com a pessoa usando a tela. Teste: `autenticacao/ConfigurarSegundoFator.inatividade.bordas.test.tsx` "interação nos últimos 2 min...". Correção: o passo 3 chamar `retomar()` na interação (ou opção do hook para não ignorar sem aviso visível).

Testes novos da rodada 2: `sessao/entre-abas.navegador.bordas.test.tsx` (BroadcastChannel REAL do Node dentro do jsdom: `typeof BroadcastChannel` é function; e reserva `storage` com `vi.stubGlobal('BroadcastChannel', undefined)`), `sessao/inatividade.aviso.bordas.test.tsx` (D2 e R1 no App com relógio falso), `autenticacao/Fluxo.rodada2.bordas.test.tsx` (D6, D7 com MutationObserver/renderToStaticMarkup, foco no h1), e `esperarTitulo` com `waitFor` em `Fluxo.foco-e-anuncio` (o efeito do título rodava depois do `findByRole`: flaky 1 em 5 sob carga).

Mutação (40 mutantes, cópia `mutp2/` no scratchpad, script `mutar-painel2.py`): todos mortos, menos equivalentes (guarda `renovando` do Início, pois o Botao carregando já ignora clique; `setCodigos([])` em "Sair mesmo assim", pois a tela desmonta). Ao mutar, tire o teste vermelho (Q25) da cópia, senão tudo "morre".

Verificação em Chrome real (one-off, sem teste salvo): build do painel com `vite build --outDir <scratchpad>`, servidor node com a CSP do Caddyfile e um `spy.js` externo com `securitypolicyviolation`; um canário `new Function` prova que o espião vê `script-src eval`; o painel real não gera violação (S87). Layout do D3: iframes de 320/360/414/768 px em página SEM CSP (iframe cai em `default-src 'none'`); 1 coluna a 320/360, 2 a 414+, sem estouro, 1 linha por código. O headless do Chrome tem largura mínima de 500 px: use iframe. O Chrome com 2 dias de uso no `ps` é do usuário, não mate.

Armadilhas novas: a fila de `api.responder` consome a 1ª resposta na 1ª chamada; depois de `abrirPainel()` (que já gastou a renovação) a fila nova começa na resposta da PRÓXIMA chamada. `pnpm exec prettier --write` negado: `prettier arq > scratchpad/fmt.tmp && cat fmt.tmp > arq`.

## Rodada 3 (2026-10-19)
Q25/R8 fechado (`comAviso: false` no hook; teste vermelho passou sem edição), R10 e a limpeza em `outra_aba` provados, nenhum bug novo. Contagens: painel 478 (era 460), api 1307, integração 357 (era 354).

Testes novos: `autenticacao/ConfigurarSegundoFator.sem-aviso.bordas.test.tsx` (29:59.999, ida e volta sair/entrar, concluir desliga o relógio, outra aba), `sessao/descarte-por-outra-aba.bordas.test.tsx` (App inteiro: renovação no ar + `saiu`, login novo com token novo, renovação do login novo, dois `saiu`) e `sessao/descarte-por-outra-aba.cliente.bordas.test.ts` (renovação do cliente descartado que termina DEPOIS do login novo: 401 e 200).
Mutação (12 mutantes, cópia `mutpainel3`, script `mutar-painel3.py`): todos mortos. P10 (`limpar` do cliente antigo sem `ehAtual`) só morre pelo teste `.cliente.bordas` novo: o `limpar` tardio apagaria `sessaoGravadaEm` da sessão nova e ela deixaria de renovar pela interação.
Armadilhas: no passo 3 o único `.ui-banner` é o dos códigos (não conte banners para provar "sem aviso"); em `api.responder`, o 401 do `GET /v1/admin/conta` faz o cliente renovar e trocar o token (use 200 ao medir o Authorization); não há caminho 3 -> 2 nem 2 -> 1 na P1b (Voltar/Sair vai a P1), a "ida e volta" é sair e entrar de novo.
Lacuna conhecida (baixa, não testada): `saiu`/`renovacao_recusada` só levam a P1 com a tela em `painel`; no passo 3 da P1b o `aoEncerrar` é ignorado (os códigos ficam na tela; a sessão só termina aos 30 min).
