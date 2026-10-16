---
name: problemas-recorrentes
description: Falhas que já apareceram nas revisões do Bairrin e devem ser procuradas sempre (planos e código)
metadata:
  type: feedback
---

Lista do que apareceu nas revisões (01a e grupo 0 do 01b, 2026-10-16). Procurar de novo em cada plano e no código.

- Fluxo de 2FA sem limite de tentativas e sem amarrar o desafio à etapa (configurar x verificar). **Why:** permite trocar o TOTP do admin só com a senha. **How to apply:** em todo fluxo de várias etapas, conferir estado amarrado no servidor e contador de falhas.
- "Imutável" só por trigger e verificador estático. Depois do grupo 0 do 01b, o `scripts/verificar-migracoes.mjs` fecha o `$tag$` como o Postgres e recusa `$tag$` como texto, aninhado ou atravessando; barra também ALTER POLICY, AUTHORIZATION, REASSIGN, GRANT CREATE, GRANT OPTION, CREATE RULE e `format` com `%s`. **Ainda passam no verificador (sondado em 2026-10-16, rodada 2):** `%I` que vira palavra-chave (`'disable'`, `'role'`, `'public'` em `GRANT ... TO %I`); `E'\x..'` em `EXECUTE` e até em `DO E'...'` no topo; `U&"..."` escondendo o nome da tabela (`GRANT UPDATE ON compartilhado.U&"\0061uditoria"`); `set_config` com nome não literal; GRANT para `postgres`/`supabase_*`; `CREATE OR REPLACE` da função `compartilhado.impedir_alteracao_da_auditoria` (a trigger fica ligada e vazia). O catálogo do release e o teste de integração pegam o efeito de trigger, RLS, dono e política; não pegam GRANT de tabela fora de `bairrin_app` nem o corpo da função. **How to apply:** em migração nova, procurar esses padrões à mão; cobrar o fechamento antes do release (lista na rodada 2 do grupo 0 do 01b).
- Anonimização feita só no contexto Identidade; cópias em outros módulos, `idempotencia`, jobs, Sentry e auditoria ficam esquecidas.
- Fallback ou configuração que joga tabelas no schema `public` do Supabase. `REVOKE` em objeto de outro dono é no-op silencioso (só WARNING): no Supabase o `public` é do `postgres`.
- Sentry/observabilidade tratados como "não é log" e fora do teste de dado pessoal.
- Lista de chaves pessoais: o redator usa `ehChaveProtegida`. **How to apply:** campo pessoal novo (01b em diante) entra em `titular/dado-pessoal.ts` e ganha teste nos dois destinos.
- Texto livre do log: o `hooks.logMethod` fecha `error(erro)`, `{err}` sem texto, interpolação, chave própria `msg` e `context` com pilha. A regra ESLint de `apps/api/src` barra template string com expressão e `.message` em chamada de log. **Ainda escapam (2026-10-16):** concatenação (`'falha ' + x`), `Logger.log('texto', email)` (o e-mail vira `context`: curto e de uma linha passa), texto montado em variável antes da chamada, chave `mensagem`. **How to apply:** procurar `+`, `e.message` e segundo argumento de `Logger.*` em chamadas de log nos handlers com dado pessoal.
- Dado pessoal ou token em query string (logado pelo pino-http por padrão).
- Cache persistido e fila offline no app sem limpeza no logout.
- Pipeline de CI sem audit de dependências.
- Verificação de e-mail que não amarra o código a quem definiu a senha: o recadastro que substitui a senha de conta pendente abre uma corrida.
- Freio por IP que confia em `X-Forwarded-For` além do proxy real (no Fly: 2 saltos; confirmar em homologação).
- CA de plano escrito de forma impossível de cumprir (ex.: `Logger.error(email, 'pilha')` sem e-mail na linha: string é o texto por contrato). **How to apply:** conferir se o dev reinterpretou o CA e dizer qual leitura vale.

Relacionado: [[areas-sensiveis]]
