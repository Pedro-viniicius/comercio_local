---
name: http-identidade-etapa19
description: Testes transversais da Identidade (01b/19) — cenario-http e catálogo de rotas, roteador do Express 5, contas de teste com dados iguais, JWT de 15 min ao avançar o relógio, foco por useEffect flaky (setImmediate do Scheduler)
metadata:
  type: project
---

Conferido em 2026-10-23 (etapa 19 do 01b, Nest 12.1.3, Express 5.2.1, React 19, Vitest 5):
- `test/integracao/identidade/cenario-http.ts` (`usarCenarioHttp()`) monta API + pilha + dono e limpa no `afterAll`; `PEDIDOS_DAS_ROTAS` cataloga TODA rota (acesso e corpo válido) e `rotas-protegidas` reprova rota nova sem entrada. Rota nova: acrescente lá, senão `rotas-protegidas`/`validacao` falham. `test/helpers/autorizacao.ts` tem `rotasDaAplicacao(app)` (inventário com `@Publico/@Perfis/@ExigeMfa/@ConfereSessao`).
- A sonda de prontidão é `GET /v1/saude/pronto` (não `/v1/pronto`, como a lista do `http-bordas` sugere).
- Roteador do Express 5: `app.getHttpAdapter().getInstance().router.stack`; os middlewares de módulo do Nest (pino-http) aparecem como ROTA de todos os métodos em `{/*splat}` (2 camadas), não como `app.use`.
- `cadastrar()` da pilha usa `NOME_PADRAO`, `TELEFONE_PADRAO` e `SENHA` iguais para toda conta: teste de isolamento ou varredura de dado pessoal precisa de nome, celular e senha únicos (a senha da "dona" excluía a "outra").
- Avançar o `RelogioFixo` da API mais de 15 min vence o JWT: entre de novo antes do pedido (senão 401 em vez do status esperado).
- Freio por e-mail: depois da 5ª falha a coluna `falhas` volta a 0 (sobe o nível); não conte falhas depois do bloqueio.
- Foco/título vindos de `useEffect` no painel: o Scheduler do React usa `setImmediate` no Node e o `findBy*` resolve no commit, antes do efeito; sob carga o `setTimeout(0)` do RTL passa na frente. Reproduz de forma determinística com um módulo importado PRIMEIRO no teste que troca `globalThis.setImmediate` por `setTimeout(fn, 25)`; correção no teste: `waitFor(() => expect(document.activeElement).toBe(x))`. Foco por `autoFocus` (commit) não tem a corrida.
- Rodada 1 do grupo F (2026-10-23): o Express 5 entrega `HEAD` ao handler do `@Get` (efeito colateral roda!). Rota GET com efeito (uso único) confere `req.method === 'HEAD'` e lança `ErroComCodigo('metodo_nao_permitido')` (405, `Allow: GET`). `HttpException(405)` cru viraria 400 `validacao` no filtro: status novo precisa de código em `ERROS`.
- Token "painel sem mfa" não sai de rota nenhuma (o painel sempre passa pelo 2FA): nos testes, `app.get(EmissorDeJwt).verificar(token)` e `.emitir({ ...claims, mfa: false })` com a chave da própria API.
- S113: exclusão de conta `admin` exige sessão `admin`+`mfa` (`sessaoDeAdminComMfa`, opcional = false, falha fechada), antes do freio e da senha.
- Uma execução de `pnpm --filter api test:integracao` falhou uma vez sem log guardado e 7 seguintes passaram: guarde a saída em arquivo (`> scratchpad/x.log`) já na primeira rodada completa.

**How to apply:** rotas novas da API (plano 02 em diante), testes de foco do painel e qualquer teste HTTP que mexa no relógio. Ver [[http-identidade-etapa16]], [[painel-vite-vitest]].
