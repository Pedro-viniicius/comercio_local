# ADR-009: Conexão instável com cache público, fila offline cifrada e `Idempotency-Key`

- Situação: aceita (decisão do dono, 2026-10-16). Ainda não implementada (plano 02 em diante).
- Origem: `docs/produto/planos/00-arquitetura.md`, abordagem 7 (S11).

## Contexto

Lojistas e consumidores usam o app com rede ruim (CA-24, CA-38 e CA-81). As mutações pausadas do TanStack Query foram descartadas porque não dão política de descarte por operação.

## Decisão

- Leitura: TanStack Query com cache persistido no aparelho, **só** para consultas de uma lista permitida (vitrine pública, sem dado pessoal).
- Escrita: fila própria e pequena em `packages/mobile-base/src/fila-offline`. Cada operação nasce com UUID gerado no aparelho, é persistida, e os corpos ficam cifrados com chave do SecureStore. As operações seguem em ordem quando a rede volta.
- Servidor: cabeçalho `Idempotency-Key`, obrigatório em criação de pedido, pagamento e operações da fila. O escopo é conta, método e rota. A resposta guardada fica 7 dias e não leva dado pessoal. Mesma chave com corpo diferente dá 422; transição inválida dá 409 com o estado atual, e o app descarta a operação com aviso.
- Logout, expiração e troca de conta limpam cache, fila e `queryClient`.

## Consequências

- Exige a tabela `compartilhado.idempotencia`, com retenção de 7 dias; a tarefa diária de limpeza (ADR-011) precisará cobri-la quando a tabela existir.
- Já existe o cabeçalho `Idempotency-Key` na lista de cabeçalhos aceitos pelo CORS (`configurar-aplicacao.ts`); o resto é futuro.
- O cache de leitura nunca guarda dado pessoal, então um aparelho perdido não vaza pedidos.
