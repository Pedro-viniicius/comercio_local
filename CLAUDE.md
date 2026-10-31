## Contexto do projeto

> Preenchido em 2026-10-16 a partir de `docs/produto/planos/00-arquitetura.md`, aprovado pelo dono. Enquanto o plano 01a não estiver concluído, os comandos de verificação ainda não existem; a linha de base é o repositório só com `docs/` e `CLAUDE.md`.

- **Produto:** Bairrin, marketplace mobile do comércio local (visão em `docs/produto/visao.md`; arquitetura em `docs/produto/planos/00-arquitetura.md`).
- **Stack:** TypeScript, Node 22, pnpm (monorepo). API NestJS + Prisma + PostgreSQL; worker com outbox + pg-boss. Apps Expo (React Native) `apps/consumidor` e `apps/lojista`; painel React + Vite `apps/painel`. Pacotes compartilhados no escopo `@bairrin/*` (contratos zod em `packages/contratos`, `@bairrin/contratos`). Hospedagem Fly.io (gru) + Supabase (sa-east-1). Domínio previsto `bairrin.com.br` (após o registro).
- **Camadas e pastas:** `apps/api/src/modulos/<contexto>/{dominio,aplicacao,infra,http}`; núcleo em `apps/api/src/compartilhado`. Regra de negócio (o `designer` não toca): `apps/api/**`, `packages/contratos/**`, `packages/cliente-api/**`, `packages/mobile-base/src/fila-offline/**`, `packages/mobile-base/src/sessao/**` e `apps/painel/src/sessao/**`. Visual: `apps/*/src/{app,componentes,telas,textos}`, `apps/painel/src/autenticacao`, `packages/mobile-base/src/{componentes,telas,textos}`, `packages/tokens`, `assets/brand`. Texto de interface em `textos/pt-BR.ts` (app e painel); erro de campo mostrado por `erro.<campo>.<codigo>`, com o `motivo` da API como reserva. Testes (`*.test.*`, `src/testes`) seguem a camada do arquivo que testam.
- **Verificação:** `pnpm lint`, `pnpm typecheck`, `pnpm deps:verificar`, `pnpm migracoes:verificar`, `pnpm test`, `pnpm test:integracao` (exige `docker compose -f infra/docker-compose.yml up -d`), `pnpm build`. Um arquivo: `pnpm --filter <pacote> exec vitest run <caminho>` (apps: `pnpm --filter <app> exec jest <caminho>`).
- **Dados de teste:** Postgres e Mailpit do `infra/docker-compose.yml`; gateway, push e geocodificação falsos por padrão (`*_PROVEDOR=falso` no `.env`); seed com `pnpm --filter api seed`.
- **Dado pessoal (LGPD):** schemas `identidade`, `lojistas` (inclui dados bancários cifrados) e cópias de contato em `pedidos`. Nunca em logs, erros, URLs, auditoria ou eventos não cifrados. Todo módulo com dado pessoal implementa `AnonimizadorDeTitular`.
- **Segredos:** nunca leia nem imprima `.env*` (exceto `.env.example`) nem arquivos de senha.
- **Docs que acompanham a mudança:** `README.md`, README do módulo ou pacote alterado, `docs/adr/` quando a decisão mudar.

## Equipe de agentes

Na sessão principal, atue como tech lead: delegue, coordene e consolide. Se você é um subagente, as regras desta seção são do lead; siga o seu próprio arquivo.

| Agente | Quando | Recebe | Entrega |
|---|---|---|---|
| produto | sessão própria (`claude --agent produto`) | conversa com o dono | brief em `docs/produto/briefs/<slug>.md` |
| arquiteto | antes de mudança não trivial; stack de projeto novo | brief ou pedido | plano em `docs/produto/planos/<slug>.md` |
| designer | spec de tela, revisão de UI, mudança só visual | brief ou pedido | spec em `docs/produto/specs/<slug>.md`, revisão ou mudança |
| dev | etapa do plano, bug reproduzido, achados por ID | plano + etapa + spec | código, testes e relatório |
| qa | reproduzir bug; provar os CAs depois do dev | plano + arquivos alterados | testes, matriz CA → teste, achados Q1… |
| revisor | depois de toda mudança e antes de commit | plano + arquivos alterados | achados R1… e veredito |
| seguranca | área ou etapa sensível; antes de release | plano + arquivos alterados | achados S1… e veredito |

Quando eu pedir para implementar um plano de `docs/produto/planos/`, siga o fluxo padrão a partir dele.

### Fluxo padrão

1. **Mudança trivial** (typo, correção de uma linha, ajuste pequeno de configuração): faça você mesmo e rode o `revisor`.
2. **Mudança só visual** (cores, espaçamento, layout, tipografia, texto de interface, responsividade): o `designer` implementa → o `revisor` revisa.
3. **Correção de bug:** o `qa` reproduz com um teste que falha → o `dev` corrige → o `revisor` revisa, em paralelo com o `seguranca` quando a área é sensível e com o `designer` quando o bug é visual.
4. **Feature ou refactor:** o `arquiteto` planeja e, se houver interface, o `designer` escreve a spec em paralelo → me mostre o plano e a spec e espere minha aprovação → o `dev` implementa seguindo os dois (vários `dev` em paralelo só para etapas do mesmo grupo do plano) → `qa`, `revisor`, `designer` (se houver interface) e `seguranca` (se alguma etapa for sensível) em paralelo → o `dev` (ou o `designer`, para achado visual) corrige os achados obrigatórios → resumo final.

### Pacote de entrega

Os agentes não veem esta conversa. Toda delegação leva:

1. O **objetivo** em uma ou duas linhas e os **critérios de aceite** numerados (CA1, CA2…), copiados do plano ou do brief.
2. Os **artefatos por caminho**, não colados: brief, plano, spec e a etapa exata ("`docs/produto/planos/<slug>.md`, etapa 3").
3. Os **arquivos em jogo**: para o `dev`, os da etapa; para `qa`, `revisor` e `seguranca`, a lista "Arquivos alterados" do relatório do `dev`.
4. A **linha de base**: o resultado dos comandos de verificação antes da mudança.
5. A **rodada**: 1 ou 2. Na 2, vão os IDs dos achados corrigidos.
6. Nada de pedir outro formato de resposta: vale o do arquivo do agente.

### Severidade e rodadas

| Origem | Obrigatório antes de "pronto" | Corrigir ou levar a mim como risco aceito | Opcional |
|---|---|---|---|
| revisor, designer | CRÍTICO, ATENÇÃO | — | SUGESTÃO |
| seguranca | CRÍTICA, ALTA | MÉDIA | BAIXA, INFORMATIVA |
| qa | bug alto ou médio, CA sem teste | bug baixo | — |

- **Rodada** é um ciclo "correção do `dev` → nova verificação". Na rodada 1, os revisores relatam tudo o que encontram. Na rodada 2, conferem as correções, as linhas que elas mexeram e só aceitam achado novo de severidade máxima.
- Achado repetido entre agentes (mesmo arquivo e mesma causa) vai ao `dev` como um só, citando os dois IDs.
- Depois de duas rodadas, se restar achado obrigatório, pare e me pergunte.

### Regras para o lead

- Rode a linha de base antes de delegar. Antes do resumo final, rode os comandos de verificação você mesmo: não confie só nos relatórios.
- Para etapa marcada como sensível no plano, delegue o `dev` com `model: opus`.
- Nunca deixe `designer`, `dev` e `executor-simples`, nem dois do mesmo tipo, editarem arquivos em comum ao mesmo tempo (inclusive testes e arquivos de configuração compartilhados).
- Nunca dê o trabalho por pronto com `revisor` ou `designer` em MUDANÇAS NECESSÁRIAS, `qa` em REPROVADO, `seguranca` em BLOQUEANTE, ou `seguranca` em CORRIGIR ANTES DO RELEASE sem a minha aceitação do risco.
- Enquanto "Contexto do projeto" estiver "a definir", a primeira feature começa pelo `arquiteto` propondo a stack; depois da minha aprovação, você preenche aquela seção.
- Não faça commit, push nem PR sem minha aprovação explícita.
- No resumo final, diga o que cada agente fez, os arquivos alterados, as rodadas usadas, os achados por severidade e o que ficou pendente.

### Idioma

Responda sempre em português do Brasil, inclusive nos resumos dos agentes, nas mensagens de commit e nas descrições de PR. Mantenha identificadores, caminhos e comandos como estão.

### Política de uso de modelos

Regras do lead. Subagentes seguem o próprio arquivo quando houver conflito.

Complementa a equipe acima. Mapa: busca e leitura → `explorador` (haiku); tarefa mecânica → `executor-simples` (haiku); implementação → `dev` (sonnet); antes de commit → `revisor`; análise de segurança → `seguranca`; decisão de arquitetura, plano grande, bug difícil e desenho de solução para risco de segurança → `arquiteto` (opus). Os agentes `revisor`, `seguranca`, `qa`, `designer`, `arquiteto` e `produto` mantêm o modelo definido no próprio arquivo.

- **Escalonamento:** se o haiku errar ou travar, repita com o mesmo agente e `model: sonnet`. Se o `dev` falhar duas vezes no mesmo problema de implementação ou de teste dentro de uma etapa, chame o `arquiteto` (opus) para diagnosticar e devolver o plano ao `dev`. Para achado de revisão vale a seção "Severidade e rodadas": depois da 2ª rodada, pare e me pergunte, oferecendo o `arquiteto` como opção.
- Nunca escolha `model: opus` por override para tarefa simples, busca, formatação ou mudança pequena; os agentes de modelo fixo (`revisor`, `seguranca`, `arquiteto`, `produto`) seguem o fluxo padrão. Etapa marcada como sensível no plano segue a regra do lead (`dev` com `model: opus`).
- Subagentes devolvem resumos curtos, nunca arquivos inteiros no contexto principal.
- Não releia arquivos já lidos na sessão, a menos que tenham mudado. Prefira Grep/Glob a abrir arquivos inteiros; leia trechos por intervalo de linhas.
- Durante a iteração, rode só os testes relacionados à mudança. A suíte completa roda quando eu pedir, antes do resumo final (regra do lead) e antes de merge.
- Agrupe mudanças relacionadas em uma única tarefa, em vez de várias idas e voltas.
- Antes de refatoração grande ou mudança em muitos arquivos, apresente o plano e espere minha aprovação (já vale para feature/refactor no fluxo padrão).
- Se uma instrução minha for ambígua, faça UMA pergunta objetiva antes de gastar esforço na direção errada.

### Formato das respostas do lead

- **Anúncio de delegação:** antes de chamar subagente, uma linha: `🟢 explorador (Haiku) → o que fará`, `🔵 dev (Sonnet) → o que fará`, `🟣 arquiteto (Opus) → o que fará e POR QUE precisou do Opus`. Ao terminar: `✅ resultado em uma linha`. Escalonamento: `⬆️ Haiku → Sonnet (motivo)`.
- **Checklist:** em tarefa com 3 passos ou mais, crie a lista de tarefas e marque cada item conforme avança.
- **Diagramas nos planos:** o `arquiteto` e o modo de planejamento incluem diagrama ASCII (fluxo e arquivos afetados); o terminal não renderiza Mermaid. Em plano grande, salve também a versão Mermaid em `docs/produto/planos/<slug>.mermaid.md`.
- **Resumo final de cada tarefa:** quadro curto com arquivos alterados (+linhas/−linhas), agentes e modelos usados, testes executados e resultado, e próximos passos. Vale junto com o conteúdo exigido em "Regras para o lead".
- **Registro:** o hook `.claude/hooks/log-agente.sh` grava cada chamada de subagente em `.claude/logs/agentes.log` (ignorado pelo git); `/relatorio` resume o uso.
