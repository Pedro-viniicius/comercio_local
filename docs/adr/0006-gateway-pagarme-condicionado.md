# ADR-006: Pagar.me condicionado a um portão de cinco itens

- Situação: aceita com condição (decisão do dono, 2026-10-16). Nada de gateway foi implementado.
- Origem: `docs/produto/planos/00-arquitetura.md`, abordagem 4 e "Portão do plano 05 (S13)".

## Contexto

A plataforma não guarda dinheiro do lojista: o gateway faz a subconta por loja e o split. O cartão nunca passa pelo servidor. Nenhum gateway atendeu a todos os critérios com confirmação documental. Asaas ficou fora por exigir tokenização a partir do servidor, o que fere RN-23. O dono não tem CNPJ ainda.

## Decisão

Recomendação: **Pagar.me**, com Stripe e Mercado Pago como reservas, nessa ordem. O plano 05 (pagamentos) só é escrito depois do portão:

1. confirmação por escrito do Pagar.me sobre a autenticação do webhook (sem assinatura, o dono escolhe a alternativa: Basic Auth, ou segredo na URL com lista de IPs e consulta à API);
2. webhook tratado só pelo id da cobrança que nós criamos, com valor e status lidos da API e comparados ao pedido, ignorando o id de pedido do payload;
3. tokenização a partir de app nativo confirmada e questionário PCI DSS aplicável identificado;
4. "split apenas para clientes PSP" esclarecido com o comercial e um advogado;
5. chaves por ambiente em Fly secrets, chave pública separada da secreta e teste de redação dos campos do gateway nos logs.

Em qualquer gateway, o webhook é um aviso e o estado é confirmado por consulta à API antes de lançar. A porta `GatewayDePagamento` tem um `GatewayFalso` usado em desenvolvimento, testes e CI (`*_PROVEDOR=falso`).

## Consequências

- Trocar de gateway é trocar o adaptador, sem mexer em Pedidos.
- O plano 05 fica bloqueado até o portão e até a existência do CNPJ.
- Preços e prazos do gateway vêm do contrato, não do plano.
