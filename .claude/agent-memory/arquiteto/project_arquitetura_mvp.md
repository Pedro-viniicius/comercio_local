---
name: project-arquitetura-mvp
description: Stack e decisões de arquitetura do Bairrin (aprovadas pelo dono em 2026-10-16), o porquê de cada uma e o que ainda está pendente
metadata:
  type: project
---

Arquitetura aprovada pelo dono em 2026-10-16 (`docs/produto/decisoes.md`); planos `00-arquitetura.md`, `01a-fundacao-repositorio.md` (implementado e revisado, menos etapas 8 e 9 dos apps Expo, previstas para 2026-10-19) e `01b-identidade.md`.

- TypeScript de ponta a ponta (monorepo pnpm): API NestJS + Prisma + Postgres, worker com outbox + pg-boss; dois apps Expo; painel React + Vite; contratos zod. **Why:** equipe pequena, uma linguagem só.
- Fly.io `gru` + Supabase `sa-east-1`, mas nada pago até o app ficar pronto (dono, 2026-10-16). Gateway Pagar.me condicionado a 3 confirmações; até lá `GatewayFalso`.
- Login sem e-mail verificado; verificação exigida só antes de pagar (CA-45) e para criar loja (plano 02). Exportação LGPD por download autenticado.
- Regras que viraram padrão: auditoria sem dado pessoal, `AnonimizadorDeTitular` por módulo, guarda global com `@Publico()`, nada em `public`, RLS e dois papéis de banco. **How to apply:** todo plano novo confere a tabela "Requisitos de segurança para os próximos planos" do 00.
- Núcleo: portas puras fora de `compartilhado/{infra,http,log,...}`; a guarda global do 01b depende de porta no núcleo porque o núcleo não pode importar `modulos/`. **How to apply:** ao planejar algo no núcleo que precisa de dado de um módulo, criar porta no núcleo e implementação no módulo.
- Armadilha de plano: o filtro `pnpm --filter api test:integracao -- <trecho>` casa só com o nome do arquivo e descarta trecho com `/`. **How to apply:** nas verificações, usar o nome do arquivo, nunca a pasta.
- Pendência obrigatória antes do 1º deploy de produção: *poison pill* do relay da outbox (precisa de coluna ou tabela nova). Registrada no 01b (P6); quem decide é o dono, o desenho é do arquiteto.
- `SCHEMAS_FECHADOS` virou piso; a checagem do release cobre sozinha os schemas do papel de migração e os com USAGE de `bairrin_app` (01b, etapa 0a). **Why:** não depender de lembrar de editar a lista a cada plano.

Relacionado: [[reference-fontes-gateways]]
