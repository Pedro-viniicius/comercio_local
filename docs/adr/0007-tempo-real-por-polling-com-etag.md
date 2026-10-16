# ADR-007: Polling curto com ETag para acompanhar pedidos

- Situação: aceita (decisão do dono, 2026-10-16). Ainda não implementada (planos 04 e 06).
- Origem: `docs/produto/planos/00-arquitetura.md`, abordagem 5.

## Contexto

O consumidor e o lojista precisam ver a mudança de status de um pedido em até 5 segundos (CA-74 e CA-57). WebSocket e SSE exigem conexão longa, sessões presas a uma instância e reconexão em rede ruim; o React Native não tem `EventSource` nativo. Push silencioso não garante entrega no iOS.

## Decisão

Polling a cada 3 segundos, só com a tela de pedido ou de Pix em foco, com `ETag` e resposta 304 quando nada mudou. Para o app fechado, push visível (ADR-008). O hook `useAcompanharPedido` esconde o mecanismo.

## Consequências

- Sem estado no servidor: funciona com várias instâncias.
- Requisições ociosas: cerca de 33 req/s para 100 telas abertas, aceitável para o piloto.
- Trocar por SSE depois não muda as telas, só o hook.
- O servidor autoriza a requisição antes de devolver 304 (S24).
