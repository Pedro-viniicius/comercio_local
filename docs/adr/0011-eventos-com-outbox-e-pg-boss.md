# ADR-011: Eventos com outbox e pg-boss, pelo menos uma vez, assinantes idempotentes

- Situação: aceita (decisão do dono, 2026-10-16). Núcleo implementado na fundação (plano 01a, etapa 11).
- Origem: `docs/produto/planos/00-arquitetura.md`, seção "Comunicação entre contextos e extração futura".

## Contexto

Os contextos precisam reagir a fatos de outros contextos (pedido criado, pagamento aprovado) sem acoplamento síncrono nem broker de mensagens. Publicar um evento fora da transação do caso de uso pode perder o evento ou publicar algo que sofreu rollback.

## Decisão

- O evento é gravado na tabela `compartilhado.outbox` **na mesma transação** do caso de uso (`PublicadorDeEventos`; fora de transação ele recusa).
- O relay, no worker, lê a outbox em lotes com `FOR UPDATE SKIP LOCKED` e cria um job do pg-boss por assinante, com chave única evento e assinante. Dois relays concorrentes não duplicam entrega.
- Cada assinante é idempotente, pela tabela `compartilhado.eventos_processados` (chave evento + assinante). A entrega é pelo menos uma vez; o efeito no banco acontece uma vez só. Falha do assinante gera nova tentativa do pg-boss.
- O pg-boss vive no schema `pgboss`. O schema é criado e migrado por um passo próprio, `node dist/cli/migrar-pg-boss.js`, com o papel de migração (no `release_command`, depois do `prisma migrate deploy`, e no `globalSetup` dos testes). A aplicação sobe com `migrate: false` e `bairrin_app` só com DML.
- O payload da outbox leva ids e nunca dado pessoal, token ou senha. O erro de um assinante vai para o `output` do job do pg-boss, então o assinante lança erro sanitizado, sem `cause`.
- Retenção: outbox publicada 30 dias e jobs encerrados 7 dias, por uma tarefa diária de limpeza (03h15, horário de Brasília).
- Eventos são versionados (`tipo` no formato `<contexto>.<Fato>`, `versao`, payload só com ids) e ficam no contrato do contexto, como `packages/contratos/src/identidade/eventos.ts`.

## Consequências

- Sem broker e sem microsserviço; o worker é um processo separado no deploy.
- O assinante precisa ser escrito para receber o mesmo evento mais de uma vez.
- Cada módulo registra seus assinantes no `RegistroDeAssinantes`; o nome segue `contexto.nome-do-assinante`.
- Para extrair um serviço no futuro, a outbox já separa quem produz de quem consome. As chamadas síncronas entre contextos (reserva de estoque, validação de código de entrega, pendências na exclusão de conta) viriam a ser sagas com compensação.
