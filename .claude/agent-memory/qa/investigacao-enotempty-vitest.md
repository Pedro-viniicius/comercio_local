---
name: investigacao-enotempty-vitest
description: Causa do "Startup Error ENOTEMPTY rmdir node_modules/.vitest-cache" no pnpm test, como reproduzir, e o EDQUOT do /tmp que derruba o instalacao-limpa
metadata:
  type: project
---

Causa (2026-10-27): vitest 5 guarda o cache de módulos em `<raiz do workspace>/node_modules/.vitest-cache`, UM diretório para todos os pacotes. O `_metadata.json` dele guarda o hash do `pnpm-lock.yaml`. Depois de qualquer mudança no lockfile, o primeiro vitest apaga o diretório inteiro (`clearCache`, rm recursivo) enquanto os outros pacotes do `pnpm -r` (tokens, contratos, cliente-api, painel, api) ainda gravam nele: `ENOTEMPTY ... rmdir`. É Startup Error, acontece 1 vez e a rodada seguinte passa (o cache se refaz).
- Reproduz: `echo '{"lockfileHash":"obsoleto"}' > node_modules/.vitest-cache/_metadata.json` e `pnpm test` (1 de 3 falhou, mensagem idêntica à do lead). Isolado: dois `vitest run --fsModuleCachePath=<dir>` em tokens e contratos ao mesmo tempo, com `cp -a` do cache base e metadado obsoleto: 7 falhas em 45 (15%); cache quente 0/30, frio (sem diretório) 0/30, `--fsModuleCachePath` por pacote 0/30, `--no-fsModuleCache` 0/30.
- CI não é afetado: só o store do pnpm é cacheado, `node_modules` é novo, sem metadado não há limpeza. Afeta máquina de dev depois de `git pull`/`pnpm install` que mexe no lockfile (cada agente que muda o lockfile "queima" a próxima rodada).
- Correção sugerida (não aplicada): `--fsModuleCachePath=node_modules/.vitest-cache` no script `test` de cada pacote (relativo ao pacote, funciona) ou `fsModuleCachePath` no config; ou `--no-fsModuleCache`. Rascunho de teste estrutural e sonda: scratchpad `enotempty/`.
- /tmp (tmpfs com `usrquota`) enche: `/tmp/jest_rs` (cache do jest) passou de 2,7 GB porque o `instalacao-limpa.test.mjs` roda jest numa cópia em caminho novo a cada vez, e outros projetos (cortex, trampo-ja) também usam /tmp. Resultado: `Unknown system error -122` (EDQUOT) dentro do jest do `instalacao-limpa`, e até o Bash do harness falha ao gravar a saída. `df` mostra espaço livre porque a cota é por usuário. Contorno: `TMPDIR=<pasta em /home> pnpm test`. Limpar `/tmp/jest_rs` foi negado pelo classificador: peça ao dono.
