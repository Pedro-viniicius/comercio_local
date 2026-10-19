---
name: repositorios-prisma-identidade
description: Repositórios Prisma da Identidade (01b/7) — erro do PG aborta a transação, ON CONFLICT espera, pg_locks nos testes de corrida, limpeza contra a trigger S78, ordem dos arquivos de integração
metadata:
  type: project
---

Conferido em 2026-10-18 (etapa 7 do 01b; Prisma 7.10.1 + adapter-pg, PG 17):
- Erro do Postgres dentro da transação interativa do Prisma a deixa abortada (25P02) para o resto do caso de uso. Conflito esperado (e-mail repetido no cadastro) vai por `INSERT ... ON CONFLICT (coluna) DO NOTHING` + contagem de linhas, não por captura do P2002. P2002 só onde o conflito é erro de quem chama.
- `INSERT ... ON CONFLICT DO NOTHING` espera a transação em andamento que inseriu, alterou ou APAGOU a linha em conflito, mas não quem só a segura com `FOR UPDATE` (xmax só de trava é ignorado). Por isso o par antigo do freio (DO NOTHING + `SELECT ... FOR UPDATE`) dava P2025 só quando a segunda já esperava no FOR UPDATE e a primeira apagava a linha zerada (A-R1, 2026-10-19). Hoje o freio é um comando só: `INSERT ... ON CONFLICT DO UPDATE SET chave_hmac = EXCLUDED.chave_hmac RETURNING`, que trava e sempre devolve linha. Teste que prova trava precisa pausar ENTRE a leitura com trava e a gravação (`corridaComPausaNoMeio` em `concorrencia.int.test.ts`); pausar depois da escrita não prova nada.
- Travar a conta depois de inserir uma filha (FK põe `KEY SHARE` na conta): use `FOR NO KEY UPDATE`. Com `FOR UPDATE`, duas transações que inseriram filha e depois travam a conta entram em deadlock (40P01). `buscarPorIdParaAtualizar` das contas segue isso.
- Teste de corrida: duas `PrismaService` (pools separados); a segunda transação começa e o teste espera `SELECT count(*) FROM pg_locks WHERE NOT granted` > 0 (dá para ler sem superusuário) antes de liberar a primeira. Sem isso, o teste pode passar sem a espera ter acontecido.
- `$executeRaw` devolve a contagem de linhas. Parâmetro `Date` em SQL cru volta igual (timestamptz). `include` com `as const` (arrays readonly) não passa no tipo do Prisma.
- Id vindo de fora (token do desafio, `sid`) passa por `ehUuid` antes da consulta: texto que não é UUID dá 22P02 em vez de "não achei".
- Arquivos `migracao*.int.test.ts` leem tabelas inteiras (`tokens_de_renovacao_usados`, `perfis_conta`, contagem de anonimizadas). Teste que confirma dado em `identidade` apaga no `afterAll`. Como a trigger S78 vale para o dono, a limpeza devolve a conta à forma do expurgo (`UPDATE` para ativa, não verificada, sem admin/lojista, `criada_em = now() - 8 days`) e então dá `DELETE`, que leva as filhas em cascata. Para não deixar dado, o resto roda numa unidade desfeita (lança um erro-sentinela no fim).
- `pausarAntes(alvo, metodo)` do qa num método que o caso de uso deixou de chamar não só estoura o tempo do teste: o stub fica instalado e trava os testes seguintes do arquivo que chamam o método (e a sujeira derruba contagens de `migracao.int.test.ts`). Ao trocar a porta usada, troque a pausa.
- A ordem dos arquivos de integração varia entre execuções (cache de duração do Vitest): falha que depende da ordem aparece só às vezes. Rode a suíte inteira várias vezes e veja a ordem com `pnpm exec vitest run --config vitest.integracao.config.ts --reporter=verbose`.
- Fake (R11): `SessoesEmMemoria.atualizar`/`revogarDa*` rodam em `unidade.executar` (fora de uma unidade, abrem a sua), então somam em `UnidadeDeTrabalhoFalsa.execucoes`.

**How to apply:** repositórios Prisma novos, casos de uso que pegam erro do repositório dentro da unidade e testes de integração que confirmam dado. Ver [[identidade-dominio]] e [[prisma7-banco]].
