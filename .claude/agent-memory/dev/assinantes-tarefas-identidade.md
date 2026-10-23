---
name: assinantes-tarefas-identidade
description: Assinantes, tarefas diárias e seed:admin da Identidade (01b/13) — erro do Prisma na trigger, marca do S15, CLI com import dinâmico, DELETE global, freio por e-mail no começo do 2FA, teto zerado na redefinição, advisory locks, operador admin na integração
metadata:
  type: project
---

Feito em 2026-10-21 (etapa 13 do 01b, rodada 1):
- Erro do Postgres levantado por trigger (RAISE ... check_violation) chega pelo Prisma 7 + adapter-pg como `PrismaClientKnownRequestError` com `code` P2039 (`deleteMany`) ou P2010 (`$executeRaw`), e o SQLSTATE em `meta.driverAdapterError.cause.originalCode` ('23514'). A mensagem (`originalMessage`) vem junto: nunca repasse. `contas.repositorio.ts` (`ehRecusaDoExpurgo`) traduz para `ContaForaDoExpurgo`.
- Sondar erro do Prisma sem script avulso: arquivo temporário `test/integracao/sonda-tmp.int.test.ts` com `console.log`, rodado com `pnpm exec vitest run --config vitest.integracao.config.ts --silent=false <arquivo>` (o filtro `-- trecho` esconde o console). Apague depois.
- Dedup do aviso de cadastro repetido (S15) sem migração: linha em `bloqueios_login` tipo `email`, chave `hmac('bloqueio_email', ['aviso_cadastro_repetido', email])` (nunca igual à do login, `[email]`), `bloqueado_ate` = envio + 1 h. A retenção S81 a apaga. Se o seguranca/arquiteto pedir tabela própria, é migração nova.
- Modelos de e-mail ficam em `infra/email/modelos/`; a aplicação usa a porta `aplicacao/assinantes/modelos-de-email.ts` (aplicação não importa infra). Teste da aplicação usa modelos falsos.
- CLI `seed-admin.ts` carrega Nest/AppModule por `await import(...)` só depois de conferir os argumentos: `node src/cli/seed-admin.ts --telefone 123` roda direto (strip-only) no teste de integração por spawn. O `tsc` reescreve `.ts`→`.js` também em import dinâmico literal. Desde a etapa 16 (2026-10-23) o `IdentidadeModule` registra `CriarAdminCasoDeUso`; o teste de ponta a ponta por spawn está em `test/integracao/identidade/seed-admin.int.test.ts` (ver [[http-identidade-etapa16]]).
- Teste de integração de tarefa que faz DELETE na tabela inteira (retenção): ponha o `agora` da tarefa em 2001 e as linhas em volta dele, para não apagar o que outros arquivos gravaram (todos usam T0 = 2026-10-19).
- Expurgo e trigger (S78) na integração: contas gravadas como dono com `criada_em = now() - interval`, e o relógio da pilha = `SELECT now()` (+1 h para criar a fronteira). Filtre `listarParaExpurgo` por spy aos ids do teste, senão a tarefa apaga contas velhas de outros arquivos.
- Dois eventos do mesmo tipo com o mesmo `ocorrido_em` (RelogioFixo parado) ficam sem ordem na outbox: avance o relógio entre eles antes de ler "o mais recente".
- `array_agg(perfil ORDER BY perfil)` ordena pela ordem do enum (consumidor, lojista, admin); use `perfil::text`.
- Sessão rotacionada estende `expira_em` (30 dias deslizantes): no teste de retenção, rotacione logo ao criar para ela continuar vencida.
- S93 mudou comportamento testado antes: depois de 5 códigos errados a verificação de e-mail devolve `freado` (freio por e-mail), e a redefinição exige `ip` na entrada. Na integração, passe `ipNovo()` (e ponha a chave do freio de origem na limpeza): `ip: null` soma no freio `origem:desconhecida`, compartilhado entre arquivos e execuções (R5).

Rodada 1 de correção (2026-10-21):
- Caso de uso que apaga a senha a partir do 2FA não pode travar o freio por e-mail depois do desafio (inverteria a ordem do cabeçalho). Desde a rodada 3 (2026-10-22), toda tentativa trava primeiro: `travarFreioPorEmailDoDesafio` (comum.ts) lê o desafio SEM trava (`RepositorioDeDesafios.buscarPorId`), confere o HMAC, trava o freio por e-mail da conta; depois `lerDesafio` trava e o caso de uso confere `contaId`. O antigo "desfaz e refaz" (`SenhaARemoverSemTravaDoEmail`) foi removido: deixava uma janela em que um login invalidava o desafio entre as passadas e o erro não contava. Testes de ordem: spies em `buscarParaAtualizar` filtrando pelo `tipo` (`['email', 'segundo_fator']`).
- Teto diário (Q29): a redefinição APAGA os desafios da conta (`RepositorioDeDesafios.apagarDaConta`, só finalidades de desafio) para zerar `somarTentativasDesde`. Nunca use `usado_em` do código de recuperação como marco (a rota pública grava `usado_em` ao emitir outro).
- Primeiro admin em corrida (S106): `travarCriacaoDeAdmin` = advisory lock fixo `identidade.criar_admin`. Na integração, para simular "sem admin ativo" com o banco sujo de outros arquivos, `vi.spyOn(p.repos.contas, 'existeAdminAtivo')` com a mesma consulta Prisma pela `p.unidade.cliente()`, filtrada aos e-mails do teste (mockRestore no finally). Prova da espera: `pausarDepois(..., 'travarCriacaoDeAdmin')` + `esperarAlguemNaTrava`. Mutação sem a trava deixa contas admin no banco de teste (o globalSetup recria na próxima execução).
- Trava por recurso lógico (emissão de código por conta e finalidade): `pg_advisory_xact_lock(hashtextextended(<texto>, 0))` por `$executeRaw` (a função devolve `void`; evitei o `$queryRaw`). Aparece em `pg_locks` como não concedida, então `esperarAlguemNaTrava` serve para provar a espera. Trancar a conta ali daria deadlock com a verificação de e-mail (código → conta).
- Banco de integração pode ter admin ativo deixado por outros arquivos: teste que chama `CriarAdminCasoDeUso` passa `operadorId` de `operadorAdmin(pilha, docs)` (pilha-de-casos-de-uso.ts); o caminho do primeiro admin (ator `sistema`) só é testável nos fakes.
- Lint `no-useless-assignment`: `let x: T | null = null` reatribuído só no `catch` reprova; declare `let x: T;` sem valor (o TS aceita depois de try que retorna).
- Paginação por cursor no fake: compare UUID em minúsculas como string (mesma ordem do Postgres).

**How to apply:** etapas 16, 19 e 20a do 01b (registro dos assinantes e tarefas no módulo e no worker, README com os prazos) e qualquer assinante ou tarefa nova. Ver [[repositorios-prisma-identidade]], [[identidade-privacidade]] e [[pgboss-eventos-email]].
