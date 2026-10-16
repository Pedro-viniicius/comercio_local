---
name: reference-fontes-gateways
description: Onde conferir na documentação oficial os critérios de gateway (Pix, tokenização, split, webhook, sandbox) e o que não foi achado em 2026-10-16
metadata:
  type: reference
---

- Pagar.me: índice da doc em https://docs.pagar.me/llms.txt (páginas .md buscáveis). Tokenização: `/reference/criar-token-cart%C3%A3o-1`. Split: `/docs/split-1` ("apenas para clientes PSP"). Recebedores: `/reference/criar-recebedor-1`. **Não achado:** autenticação do webhook e sandbox sem CNPJ — perguntar ao comercial.
- Asaas: webhooks `https://docs.asaas.com/docs/sobre-os-webhooks` (header `asaas-access-token`); subcontas `/docs/criacao-de-subcontas` (conta-mãe PJ); tokenização é chamada do servidor.
- Mercado Pago: split exige OAuth por vendedor (`/developers/pt/docs/split-payments/...`); webhook `x-signature`; contas de teste em `/developers/pt/docs/your-integrations/test/accounts`.
- Stripe: Pix para contas BR em https://docs.stripe.com/payments/pix; Connect BR→BR não confirmado.
- Preços de infra: docs.fly.io/about/pricing (multiplicador 1,615 em `gru`), supabase.com/pricing, expo.dev/pricing, developers.google.com/maps/billing-and-pricing/pricing.

Relacionado: [[project-arquitetura-mvp]]
