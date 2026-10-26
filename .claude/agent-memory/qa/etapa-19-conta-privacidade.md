---
name: etapa-19-conta-privacidade
description: Grupo F do 01b (etapa 19, conta, privacidade, admin/conta), rodada 1 em 2026-10-23: testes do qa, Q31/Q32, mutação, causa do MaxListeners, estabilidade do painel
metadata:
  type: project
---

Rodada 1 (2026-10-23): sem bug alto/médio. Q31 (baixo): `HEAD /v1/privacidade/exportacao/arquivo` cai no handler do GET (Express), baixa e marca a cópia; o GET seguinte dá 404. Teste `it.fails` em `conta-e-privacidade-bordas.int.test.ts` (trocar por `it` quando o dev corrigir). Q32 (baixo, fora da 19): sob carga extrema (32 laços de CPU em 14 núcleos, load 60) `instalacao-limpa` falha 3/3 em outros testes do painel (findBy de 1 s: entre-abas, passo3, RecuperarSenha.bordas); o P1b (foco) passou 13/13, e `instalacao-limpa` passa 3/3 ocioso e 4/4 com 1 laço por núcleo.

Testes criados pelo qa (além dos 6 arquivos do dev): `conta-e-privacidade-bordas.int.test.ts` (38, herdado de um qa anterior que caiu e ampliado), `exportacao-ponta-a-ponta.int.test.ts` (5: rota -> outbox -> assinante real -> Mailpit -> download; corrida de verdade com `pausarDepois(repositorio,'buscarDisponivel')`), `sem-dado-pessoal-segundo-fator.int.test.ts` (S114: log, outbox INTEIRA, Sentry, desafio, segredo, códigos de recuperação), `src/compartilhado/http/limite-por-rota.guard.test.ts` (6, ordem conta->IP->e-mail).

Achados de método:
- O teste "dois downloads simultâneos" do dev NÃO é corrida: mutante que ignora o retorno de `marcarBaixada` ou tira `AND baixada_em IS NULL` só morre com o teste de pausa do qa. Para provar corrida use pausa dentro da requisição, não `Promise.all`.
- `MaxListenersExceededWarning [Server]`: vem do `http-bordas` (14-15 pedidos simultâneos por supertest sem `listen`), não da 19; `setMaxListeners(40)` no `beforeAll` do describe de concorrência resolve (conferido: sem a linha aparecem 8 avisos; com ela, 0 em 6 rodadas completas). O vitest não esconde esse aviso.
- Renovação: token anterior tem 60 s de tolerância; reuso só revoga a família depois disso (adiantar o relógio > 60 s).
- Log do pino tem `level` como texto (`'error'`, `'warn'`), não número.
- `docker compose up -d --wait` falha no `postgres` de dev se outro projeto (trampo_ja) ocupa a 5432; o `postgres-teste` (5433) e o mailpit sobem mesmo assim. Os containers pararam sozinhos no meio (reinício do Docker): confira `docker ps`.
- Arquivo `*.int.test.ts` criado durante uma rodada completa em andamento entra na rodada seguinte: não crie teste novo enquanto a suíte roda em segundo plano.
- Mutante que quebra a subida do app (assinante sem eventos, `ContaDesativada` no lugar) causa "Hook timed out" e derruba o arquivo seguinte por trava presa: leia só o primeiro vermelho.
- Mutação: cópia só de `apps/api` (rsync sem node_modules/dist) + symlinks de `node_modules`, `packages`, root; `mutar.py` no scratchpad (se existir) troca 1 trecho e roda `./node_modules/.bin/vitest run --config vitest.integracao.config.ts --no-fsModuleCache --reporter=json --outputFile=...`. 11 de 11 mutantes mortos (guarda sem ConfereSessao, ordem dos limites, senha errada 401, Retry-After floor, log com mensagem, download sem condição, GET /v1/conta e download sem `@ConfereSessao`, decifra sem AAD).

Totais: api 1507, integração 790 + 1 esperado (3x verde seguidas, 0 avisos), painel 478, scripts 421, deps ok (433 módulos). Sobra no banco após a suíte: 3 linhas em `bloqueios_login` e 1 em `outbox` (constante, benigna). Falha "não identificada" do dev: não reproduziu em 6 rodadas completas; hipótese é carga da máquina (ver instabilidade S104 da etapa 16).

Rodada 2 (2026-10-23): Q31 e S113 provados, S112 e R3 conferidos. Testes novos do qa: `exclusao-de-admin-e-head.int.test.ts` (8: token com `mfa` sem `admin`, 12 recusas sem 429, admin com `mfa` segue o freio comum, 403 com freio ativo, 401 sem token, HEAD sem chamar `BaixarExportacaoCasoDeUso.executar` por spy, varredura CA-12 do 403 e do 405); +2 unitários no S113 (freio ativo; 12 repetições) e +1 no `limite-por-rota.guard.test.ts` (sort estável dentro do tipo). Mutação 10/10 (N1 só admin, N2 só mfa, N3 `||`, N4 regra depois do freio, N5 regra depois do hash, N6 padrão `true`, N7-N9 HEAD, N10 sort).
- Armadilha: o freio por e-mail é o MESMO do login: depois de 5 senhas erradas na exclusão nem o `entrarNoApp` do admin passa (429). Abra a sessão do app ANTES de gastar o freio no teste.
- `supertest.head` não traz corpo: o 405 só se prova por status e `Allow`; o "não decifrou" se prova com `vi.spyOn(app.get(BaixarExportacaoCasoDeUso), 'executar')`.
- `sem-dado-pessoal.int.test.ts` do dev varre o 409, mas NÃO o 403 do S113 nem o 405: a varredura deles está no meu arquivo novo.
- Mutação: o mutante que só ACRESCENTA a regra depois do hash sobrevive falsamente se a original continua; remova a original no mesmo mutante.
- Totais da r2: api 1514, integração 803 (2x verde, 0 avisos), contratos 625, painel 478, scripts 421, deps ok (434 módulos).
