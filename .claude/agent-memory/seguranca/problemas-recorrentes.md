---
name: problemas-recorrentes
description: Falhas que já apareceram nas revisões do Bairrin e devem ser procuradas sempre (planos e código)
metadata:
  type: feedback
---

Lista do que apareceu nas revisões (planos e código do 01a, 2026-10-16). Procurar de novo em cada plano e no código.

- Fluxo de 2FA sem limite de tentativas e sem amarrar o desafio à etapa (configurar x verificar). **Why:** permite trocar o TOTP do admin só com a senha. **How to apply:** em todo fluxo de várias etapas, conferir estado amarrado no servidor e contador de falhas.
- "Imutável" só por trigger, com o papel da aplicação dono das tabelas e TRUNCATE livre. O `scripts/verificar-migracoes.mjs` agora barra DISABLE TRIGGER, RLS desligado, GRANT a PUBLIC/anon/authenticated/service_role, GRANT que altera a auditoria e SECURITY DEFINER sem search_path, mas **ainda não** barra `ALTER TABLE ... OWNER TO bairrin_app`, `CREATE POLICY` sem `TO`, corpo de DO entre aspas simples, nem chamada de função escondida em `RAISE ... USING MESSAGE = f('...')` (texto de RAISE/COMMENT não é analisado). **How to apply:** em migração nova, ler esses padrões à mão.
- Anonimização feita só no contexto Identidade; cópias em outros módulos, `idempotencia`, jobs, Sentry e auditoria ficam esquecidas.
- Fallback ou configuração que joga tabelas no schema `public` do Supabase. `REVOKE` em objeto de outro dono é no-op silencioso (só WARNING): no Supabase o `public` é do `postgres`.
- Sentry/observabilidade tratados como "não é log" e fora do teste de dado pessoal.
- Lista de chaves pessoais: o redator já usa `ehChaveProtegida` (S25 resolvido). **How to apply:** campo pessoal novo (01b em diante) entra em `titular/dado-pessoal.ts` e ganha teste nos dois destinos.
- Texto livre do log fora do redator: `logger.error(erro)` / `{err}` sem mensagem põe `erro.message` no `msg`; argumentos de interpolação (`'%s'`) também vão crus; o `isWrongExceptionsHandlerContract` do nestjs-pino faz o mesmo com erros do Nest. **How to apply:** cobrar `hooks.logMethod` (ou regra de lint) antes de dado pessoal real chegar.
- Dado pessoal ou token em query string (logado pelo pino-http por padrão).
- Cache persistido e fila offline no app sem limpeza no logout.
- Pipeline de CI sem audit de dependências.
- Verificação de e-mail que não amarra o código a quem definiu a senha: o recadastro que substitui a senha de conta pendente abre uma corrida.
- Freio por IP que confia em `X-Forwarded-For` além do proxy real (no Fly: 2 saltos; confirmar em homologação).

Relacionado: [[areas-sensiveis]]
