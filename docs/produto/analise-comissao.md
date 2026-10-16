# Análise de viabilidade da comissão

- Status: aprovado pelo dono em 2026-10-16 (recomendação da seção 5: 3% + taxa de pagamento ao custo, comissão mínima de R$ 1,00, 5% como padrão após o lançamento, 90 dias sem comissão por loja)
- Data: 2026-10-16 (todas as fontes consultadas nesta data; preços de concorrentes e gateways mudam com frequência)
- Pergunta: 3% de comissão é sustentável? Que percentual ou modelo híbrido recomendar?
- Convenção: **[Fn]** é fato com fonte (lista no fim); **(P)** é premissa nossa, a validar.

**Resposta curta.** 3% só se sustenta se a taxa do meio de pagamento for cobrada à parte, ao custo (como iFood e Shopee fazem). Absorvendo o gateway, 3% dá margem negativa em todo pedido no cartão. O patamar sustentável sem equipe subsidiada fica em torno de 5% + taxa de pagamento, ou um híbrido com mensalidade opcional. Mesmo a 5% + pagamento, o lojista paga menos da metade do concorrente mais barato.

## 1. O que os concorrentes cobram do lojista

| Plataforma | Comissão | Fixo / extras | Pedido de R$ 120 no cartão | Fonte |
|---|---|---|---|---|
| Mercado Livre Clássico | 10% a 14% por categoria | Itens < R$ 79: custo operacional variável (~R$ 6 a 7). Itens ≥ R$ 79: frete por conta do vendedor | ~R$ 14,40 (12%) + frete | [F1] terceiros |
| Mercado Livre Premium | 15% a 19% (parcelado sem juros) | idem | ~R$ 20,40 (17%) + frete | [F1] terceiros |
| Shopee (CNPJ, desde 03/2026) | 20% até R$ 79,99; 14% acima | + R$ 4 a R$ 26 por item conforme faixa de preço; frete grátis obrigatório embutido | R$ 36,80 (14% + R$ 20) | [F2] terceiros |
| Magalu | 10% a 20% por categoria (moda ~19%) | tarifa fixa por item (R$ 3 a 5, não confirmada); novos sellers 9,9% por tempo limitado | ~R$ 25,60 (18% + R$ 4) | [F3] terceiros |
| iFood Plano Básico (loja entrega) | 12% | + 3,2% pagamento online; mensalidade R$ 110 acima de R$ 1.800/mês | R$ 18,24 + mensalidade | [F4] oficial |
| iFood Plano Entrega | 23% | + 3,2%; mensalidade R$ 150 acima de R$ 1.800/mês; entregador do iFood | R$ 31,44 + mensalidade | [F4] oficial |
| Amazon Brasil | 8% a 15% por categoria (moda ~14%) | plano Individual R$ 2/item ou Profissional R$ 19/mês | ~R$ 16,80 | [F5] terceiros |

Leitura: o mercado cobra de 12% a 30% do pedido. O modelo mais próximo do nosso é o iFood Básico (a loja entrega): 15,2% efetivos. Para ML, Shopee e Amazon, a tabela oficial não estava acessível na consulta; os valores vêm de blogs de precificação convergentes e devem ser conferidos nos simuladores oficiais antes de qualquer material de venda.

## 2. Nossos custos

### 2.1 Gateway com split (Pix e cartão)

| Provedor | Pix | Crédito à vista | Split / subcontas | Observações | Fonte |
|---|---|---|---|---|---|
| Asaas | R$ 1,99 por Pix (R$ 0,99 nos 3 primeiros meses) | R$ 0,49 + 2,99% (promo 1,99%) | split por API (fixo ou %); sem taxa publicada | recebe em até 2 dias úteis; antecipação 1,25% a.m.; sem mensalidade | [F6] oficial |
| Efí | 1,19% | 3,49% (recebe em até 31 dias) | split por API; sem taxa publicada | parcelado 3,99% a 4,39%; antecipação 4% por borderô (máx. R$ 30) | [F7] oficial |
| Stripe | 1,19% (Pix só por convite) | 3,99% + R$ 0,39 | Connect: +0,25% quando a plataforma define o preço | disputa R$ 55 por ocorrência; boleto R$ 3,45 | [F8] oficial |
| Pagar.me | 0,99% | 4,19% (recebe no dia seguinte) | split com "repasses múltiplos e estornos automáticos"; sem taxa publicada | página sem data; parcelado não publicado | [F9] oficial |
| Mercado Pago | 0,99% | 3,98% (30 dias) a 4,98% (na hora) | Split 1:1 via `marketplace_fee`; lojista precisa de conta MP; dinheiro circula só entre contas MP | página oficial de custos bloqueou a consulta; valores de terceiros | [F10] oficial (split) e terceiros (taxas) |
| Iugu | não publicado | não publicado | split em Pix, boleto e cartão; sem taxa de implantação | pedir tabela ao comercial | [F11] oficial |

**Premissa central adotada (P):** Pix a 1,0% do valor e cartão à vista a 3,5% + R$ 0,40 por transação, ponto médio das tabelas acima. Parcelamento fica fora do MVP (P). Escolher um gateway com split e subcontas faz o dinheiro do lojista nunca passar pela nossa conta, o que simplifica contabilidade e evita a discussão de sermos instituição de pagamento (P, validar com advogado).

### 2.2 Infraestrutura, lojas de apps, suporte e tributos

| Item | Valor | Fonte |
|---|---|---|
| Hospedagem da API (Railway Pro) | US$ 20/mês mínimo; ~US$ 20 por vCPU e US$ 10 por GB de RAM | [F14] oficial |
| Postgres gerenciado + auth + storage (Supabase Pro) | US$ 25/mês (8 GB de disco, 100 GB de arquivos, 250 GB de egress, 100 mil MAU) | [F14] oficial |
| Imagens de produto (Cloudflare R2) | US$ 0,015 por GB-mês, egress grátis, 10 GB grátis | [F14] oficial |
| Push (Firebase Cloud Messaging) | sem custo | [F14] oficial |
| Builds e updates dos apps (Expo EAS Starter) | US$ 19/mês + uso | [F14] oficial |
| Apple Developer Program | US$ 99 por ano | [F12] oficial |
| Google Play Console | US$ 25, uma única vez | [F13] oficial |
| Comissão das lojas sobre as vendas | **não se aplica**: bens físicos consumidos fora do app devem usar pagamento fora do in-app purchase (Apple 3.1.3(e)) e são exceção ao faturamento do Google Play | [F12][F13] oficial |
| Total de infra e ferramentas no início | ~US$ 100 a 130/mês ≈ **R$ 500 a 700/mês** a R$ 5,00/US$ (PTAX de 09/10/2026: R$ 4,99) | (P) a partir de [F14][F17] |
| Contabilidade | R$ 300 a 600/mês | (P) |
| Suporte | 2 min por pedido a R$ 30/h = **R$ 1,00 por pedido**; onboarding assistido 1 a 2 h por loja = R$ 30 a 60 por loja, uma vez | (P) |
| Chargeback e fraude | perda de 0,3% do volume no cartão (P); taxa por disputa R$ 55 na Stripe, não publicada nos demais | [F8] e (P) |
| Tributos sobre a receita de comissão (Simples Nacional) | "intermediação de negócios" é atividade do Anexo V sujeita ao Fator R: folha ≥ 28% da receita → Anexo III (6% na 1ª faixa); abaixo → Anexo V (15,5%). Licenciamento de software segue a mesma lógica | [F15] terceiros; texto da LC 123 não acessível na consulta |

Custos fixos usados no ponto de equilíbrio (P): **F1 = R$ 1.200/mês** (infra, ferramentas, contador; sócios fazem o suporte) e **F2 = R$ 5.500/mês** (F1 + uma pessoa de suporte/operações PJ a R$ 4.000 + R$ 300 de marketing local).

## 3. Unit economics por pedido

Premissas (P): imposto de 6% sobre a comissão (Anexo III); suporte R$ 1,00 por pedido; perda por chargeback de 0,3% do ticket no cartão; gateway conforme 2.1. Margem = comissão − imposto − suporte − chargeback − (gateway, se absorvido).

### Cenário A: a plataforma absorve a taxa do gateway (comissão "tudo incluso")

| Ticket | Método | Custo gateway | 2% | 3% | 5% | 8% |
|---|---|---|---|---|---|---|
| R$ 60 | Pix | R$ 0,60 | −0,47 | 0,09 | 1,22 | 2,91 |
| R$ 60 | Cartão | R$ 2,50 | −2,55 | −1,99 | −0,86 | 0,83 |
| R$ 120 | Pix | R$ 1,20 | 0,06 | 1,18 | 3,44 | 6,82 |
| R$ 120 | Cartão | R$ 4,60 | −3,70 | −2,58 | −0,32 | 3,06 |
| R$ 250 | Pix | R$ 2,50 | 1,20 | 3,55 | 8,25 | 15,30 |
| R$ 250 | Cartão | R$ 9,15 | −6,20 | −3,85 | 0,85 | 7,90 |

### Cenário B: a taxa do gateway é repassada ao lojista, ao custo, como "taxa de pagamento online"

| Ticket | Método | Taxa paga pelo lojista | 2% | 3% | 5% | 8% |
|---|---|---|---|---|---|---|
| R$ 60 | Pix | R$ 0,60 | 0,13 | 0,69 | 1,82 | 3,51 |
| R$ 60 | Cartão | R$ 2,50 | −0,05 | 0,51 | 1,64 | 3,33 |
| R$ 120 | Pix | R$ 1,20 | 1,26 | 2,38 | 4,64 | 8,02 |
| R$ 120 | Cartão | R$ 4,60 | 0,90 | 2,02 | 4,28 | 7,66 |
| R$ 250 | Pix | R$ 2,50 | 3,70 | 6,05 | 10,75 | 17,80 |
| R$ 250 | Cartão | R$ 9,15 | 2,95 | 5,30 | 10,00 | 17,05 |

### Ponto de equilíbrio (ticket R$ 120, metade Pix e metade cartão (P), com base em [F16]: Pix 42% x cartão 41% das compras online em 2025)

| Comissão | Margem/pedido A | Pedidos/mês para F1 (A) | Pedidos/mês para F2 (A) | Margem/pedido B | Pedidos/mês para F1 (B) | Pedidos/mês para F2 (B) |
|---|---|---|---|---|---|---|
| 2% | −R$ 1,82 | inviável | inviável | R$ 1,08 | 1.115 | 5.112 |
| 3% | −R$ 0,70 | inviável | inviável | R$ 2,20 | 544 | 2.495 |
| 5% | R$ 1,56 | 769 | 3.526 | R$ 4,46 | 269 | 1.233 |
| 8% | R$ 4,94 | 243 | 1.112 | R$ 7,84 | 153 | 701 |

Sensibilidade: se cairmos no Anexo V (15,5%), a margem do cenário B a 3% vai de R$ 2,20 para R$ 1,86 (F2 exige ~2.950 pedidos/mês) e a 5% de R$ 4,46 para R$ 3,89 (~1.410 pedidos/mês). O fixo de R$ 0,40 do cartão pesa nos tickets baixos: a 3% um pedido de R$ 20 no cartão rende R$ 0,60 e custa R$ 1,10 só de gateway, por isso a comissão mínima por pedido da seção 5.

## 4. Do ponto de vista do lojista: pedido de R$ 120 no cartão

| Plataforma | Custo para o lojista | % | Sobra |
|---|---|---|---|
| Nossa, 3% + taxa de pagamento (Pix: R$ 4,80 / 4,0%) | R$ 8,20 | 6,8% | R$ 111,80 |
| Nossa, 5% + taxa de pagamento (Pix: R$ 7,20 / 6,0%) | R$ 10,60 | 8,8% | R$ 109,40 |
| Nossa, 8% + taxa de pagamento | R$ 14,20 | 11,8% | R$ 105,80 |
| Mercado Livre Clássico (12%) | R$ 14,40 + frete | 12,0% | R$ 105,60 − frete |
| Amazon (14%) | R$ 16,80 | 14,0% | R$ 103,20 |
| iFood Básico (12% + 3,2%) | R$ 18,24 | 15,2% | R$ 101,76 |
| Mercado Livre Premium (17%) | R$ 20,40 + frete | 17,0% | R$ 99,60 − frete |
| Magalu (18% + R$ 4) | R$ 25,60 | 21,3% | R$ 94,40 |
| iFood Entrega (23% + 3,2%) | R$ 31,44 | 26,2% | R$ 88,56 |
| Shopee (14% + R$ 20) | R$ 36,80 | 30,7% | R$ 83,20 |

Em todos os casos o lojista ainda arca com a entrega (própria ou motoboy, R$ 8 a 15 na cidade (P)), como no iFood Básico e no Mercado Livre acima de R$ 79. A taxa de pagamento que repassamos (3,5% + R$ 0,40 no cartão) é da ordem do que ele já paga na maquininha (P, não verificado), então a comissão é o único custo realmente novo para ele.

## 5. Recomendação

1. **Estrutura de preço: comissão + taxa de pagamento online separada e ao custo.** Comissão de lançamento de **3%**; taxa de pagamento igual ao custo do gateway (≈ 1% no Pix, ≈ 3,5% + R$ 0,40 no cartão), exibida em separado no extrato, como fazem iFood e Shopee. Nunca "3% tudo incluso": o cenário A mostra prejuízo em todo pedido no cartão até 5%.
2. **Comissão mínima de R$ 1,00 por pedido**, para que pedidos de baixo valor não deem prejuízo operacional.
3. **Patamar sustentável: 5% + taxa de pagamento**, a ser comunicado desde o contrato como o preço padrão após o período de lançamento (prazo e aviso de 30 dias no contrato). A 5% o negócio paga uma pessoa de suporte com ~1.230 pedidos/mês; a 3% precisa de ~2.500. Mesmo a 5% + pagamento, o lojista paga 8,8% no cartão e 6% no Pix, contra 12% a 30% nos concorrentes.
4. **Híbrido opcional, só depois do primeiro ano:** Plano Pro a R$ 59/mês com comissão de 2% + pagamento. Com base de 5%, compensa para a loja a partir de R$ 1.967 de vendas por mês na plataforma; dá receita recorrente e previsibilidade para o lojista. Não lançar no MVP: adiciona cobrança recorrente, inadimplência e complexidade antes de haver volume.
5. **Período sem comissão para captar lojistas:** 90 dias por loja a partir do primeiro pedido, isentando só a comissão (a taxa de pagamento continua, ao custo). Custo estimado no piloto (P: 50 lojas × 20 pedidos/mês × R$ 120): R$ 3.600 por mês de comissão abdicada, R$ 10.800 nos 90 dias. Se a plataforma também absorvesse o gateway, somaria R$ 2.900/mês; não recomendo.
6. **Receitas futuras que não entram na conta de hoje:** destaque de loja ou produto, antecipação de repasse, e frete pago pelo consumidor (não é receita nossa, mas tira a entrega da conta do lojista).
7. **Riscos:** (a) ticket médio real abaixo de R$ 120 derruba a margem por pedido; (b) mix de cartão acima de 50% e parcelamento pressionam o custo; (c) suporte real acima de 2 min por pedido nos primeiros meses; (d) enquadramento no Anexo V dobra o imposto; (e) exigência do gateway (ex.: Mercado Pago obriga conta MP para cada lojista) pode travar o onboarding; (f) reforma tributária prevê split payment a partir de 2027, com possível impacto em custos e fluxo de pagamentos [F18].
8. **O que validar com os primeiros 10 lojistas antes de fixar a tabela:** ticket médio e mix Pix/cartão reais; o que já pagam na maquininha; se aceitam 5% + pagamento como preço padrão; se preferem mensalidade; quanto custa a entrega deles por pedido.

## 6. Piloto em São Sebastião do Paraíso (MG)

| Indicador | Valor | Fonte |
|---|---|---|
| População (Censo 2022) | 71.796 | [F19] IBGE |
| População estimada (1º/7/2025) | 75.179 | [F20] IBGE |
| Domicílios particulares permanentes ocupados (Censo 2022) | 26.679 (2,67 moradores por domicílio) | [F19] IBGE |
| Empresas e outras organizações atuantes (CEMPRE 2024) | 3.721 (3.856 unidades locais; 23.342 pessoas ocupadas) | [F21] IBGE |
| Unidades locais de comércio varejista, CNAE 47 (CEMPRE 2024) | 858, com 3.807 pessoas ocupadas | [F21] IBGE |
| Região (Censo 2022) | Passos 111.939; Guaxupé 50.911; Franca (SP) 352.536. Com o piloto, 587.182 habitantes, 8,2 vezes a cidade | [F19] IBGE |

O que o ponto de equilíbrio da seção 3 significa na cidade (ticket R$ 120, metade Pix e metade cartão, 30 lojas ativas, que são 3,5% das 858 unidades varejistas):

| Cenário | Pedidos/mês | Por domicílio/mês | Por loja/mês (30 lojas) | Leitura |
|---|---|---|---|---|
| 3% + pagamento, custo fixo F1 (R$ 1.200) | 544 | 0,020 (1 pedido a cada 49 domicílios) | 18 (0,6 por dia) | alcançável no piloto |
| 5% + pagamento, F1 | 269 | 0,010 (1 a cada 99) | 9 (0,3 por dia) | folgado |
| 3% + pagamento, F2 (R$ 5.500, com pessoa de suporte) | 2.495 | 0,094 (1 a cada 11) | 83 (2,8 por dia) | improvável só com o piloto |
| 5% + pagamento, F2 | 1.233 | 0,046 (1 a cada 22) | 41 (1,4 por dia) | exige penetração alta para uma cidade só |

Conclusão: o piloto **valida** o modelo, não sustenta o negócio. Com 2% dos domicílios comprando uma vez por mês ele paga infra, ferramentas e contador, mas não paga uma pessoa de suporte: para isso seriam 9% dos domicílios todo mês a 3%, ou 4,6% a 5%, patamares altos para uma cidade de 75 mil habitantes. A sustentabilidade vem de replicar o mesmo pacote na região (Passos, Guaxupé e Franca somam oito vezes a população do piloto) e de subir ao patamar de 5% após o lançamento. Premissa (P): 30 lojas ativas e 20 pedidos por loja por mês no sexto mês; os dados de ticket e mix virão do próprio piloto.

Pendência de negócio: a empresa ainda não existe. A abertura com contador (CNAE, enquadramento no Simples e Fator R) precede a contratação do gateway, que exige CNPJ e conta PJ (P).

## 7. Fato x premissa

| Afirmação | Tipo | Como validar |
|---|---|---|
| Taxas do iFood (12%/23%, 3,2%, R$ 110/150) | Fato [F4], oficial, vigente em 23/06/2026 | reconferir no Portal do Parceiro |
| Taxas de ML, Shopee, Magalu e Amazon | Fato de terceiros [F1][F2][F3][F5], tabelas oficiais não acessíveis | simuladores oficiais de cada plataforma |
| Taxas de Asaas, Efí, Stripe, Pagar.me | Fato [F6][F7][F8][F9], páginas oficiais | pedir proposta comercial (negociam por volume) |
| Taxas do Mercado Pago | Terceiros [F10]; split oficial | página oficial de custos e comercial |
| Lojas de apps: US$ 99/ano, US$ 25 único, sem comissão sobre bens físicos | Fato [F12][F13], oficial | reconferir diretrizes na publicação |
| Preços de infra (Railway, Supabase, R2, FCM, Expo) | Fato [F14], oficial | conta real após 3 meses de uso |
| Pix 42% x cartão 41% das compras online (2025) | Fato [F16], pesquisa Ebanx/PCMI | medir no piloto |
| Premissa central do gateway (1% Pix; 3,5% + R$ 0,40 cartão) | Premissa | contrato assinado com o gateway |
| Mix 50/50, ticket R$ 120, suporte R$ 1/pedido, chargeback 0,3% | Premissa | dados do piloto |
| Anexo III (6%) com Fator R ≥ 28%; "intermediação de negócios" no Anexo V | Terceiros [F15]; texto legal não conferido | contador, antes da abertura da empresa |
| Custos fixos F1 = R$ 1.200 e F2 = R$ 5.500 | Premissa | orçamento real |
| População, domicílios e unidades varejistas de São Sebastião do Paraíso | Fato [F19][F20][F21], IBGE via API SIDRA | reconferir no IBGE Cidades |
| Plataforma não ser instituição de pagamento ao usar split do gateway | Premissa jurídica | advogado especializado em meios de pagamento |

## 8. Resumo

1. O mercado cobra do lojista de 12% (Mercado Livre Clássico) a 30% (Shopee) num pedido de R$ 120; o iFood Básico, nosso modelo mais parecido, cobra 15,2%.
2. Nosso custo variável é dominado pelo gateway: ~1% no Pix e ~3,5% + R$ 0,40 no cartão; infra e lojas de apps custam ~R$ 500 a 700/mês, e as lojas não cobram comissão sobre bens físicos.
3. "3% tudo incluso" é inviável: margem negativa em todo pedido no cartão.
4. 3% + taxa de pagamento repassada ao custo é viável como preço de lançamento: ~R$ 2,20 de margem por pedido de R$ 120, equilíbrio em ~544 pedidos/mês sem equipe paga.
5. 5% + taxa de pagamento é o patamar sustentável: ~R$ 4,46 por pedido, paga uma pessoa de suporte com ~1.230 pedidos/mês, e ainda custa ao lojista menos da metade do concorrente mais barato.
6. Comissão mínima de R$ 1,00 por pedido e isenção de 90 dias só da comissão (custo de ~R$ 10.800 no piloto de 50 lojas).
7. Híbrido com mensalidade (R$ 59 + 2%) só depois do primeiro ano.
8. Validar com contador o enquadramento no Simples e com advogado o uso do split do gateway antes do lançamento.
9. O piloto em São Sebastião do Paraíso (26.679 domicílios, 858 unidades varejistas) valida o modelo: cobre o custo mínimo com 2% dos domicílios comprando uma vez por mês, mas só sustenta equipe com a expansão regional.

## Fontes (consultadas em 16/10/2026)

- [F1] Mercado Livre (terceiros): https://ajudaecom.com.br/taxas-mercado-livre/ e https://ecommercenapratica.com/blog/comissao-mercado-livre/
- [F2] Shopee (terceiros): https://blog.calcularte.com.br/index.php/2026/03/06/taxas-comissoes-shopee-2026/ , https://ecommercenapratica.com/blog/taxa-shopee/ e https://marketplace.anymarket.com.br/mudanca-de-comissao-shopee/
- [F3] Magalu (terceiros): https://www.totvs.com/blog/marketing-e-vendas/marketplace-magalu/ , https://basedoecommerce.com.br/guia-como-vender-no-magalu/ e https://www.ecommercebrasil.com.br/noticias/magalu-reduz-50-da-comissao-para-novos-vendedores
- [F4] iFood (oficial): https://blog-parceiros.ifood.com.br/taxas-ifood/
- [F5] Amazon (terceiros): https://www.deveccom.com/amazon/ e https://puramargem.com.br/blog/comissao-da-amazon-no-brasil-quanto-some-por-venda-em-2026
- [F6] Asaas (oficial): https://www.asaas.com/precos-e-taxas
- [F7] Efí (oficial): https://sejaefi.com.br/tarifas
- [F8] Stripe (oficial): https://stripe.com/en-br/pricing
- [F9] Pagar.me (oficial): https://pagar.me/precos
- [F10] Mercado Pago: split oficial https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace ; taxas por terceiros https://heropay.ai/guias/taxas-de-pagamento e https://nacao.digital/blog/checkout-transparente/
- [F11] Iugu (oficial): https://iugu.com/produto/marketplace/
- [F12] Apple: https://developer.apple.com/programs/enroll/ e https://developer.apple.com/app-store/review/guidelines/ (3.1.3(e))
- [F13] Google Play: https://support.google.com/googleplay/android-developer/answer/6112435 e https://support.google.com/googleplay/android-developer/answer/9858738
- [F14] Infra: https://railway.com/pricing , https://supabase.com/pricing , https://developers.cloudflare.com/r2/pricing/ , https://firebase.google.com/pricing , https://expo.dev/pricing
- [F15] Simples Nacional (terceiros): https://www.contabilizei.com.br/contabilidade-online/atividades-sujeitas-ao-fator-r/ , https://jornalcontabil.com.br/noticia/anexo-iii-e-anexo-v-no-simples-nacional-entenda-as-suas-diferencas/ e https://contaja.com.br/blog/tabela-simples-nacional/
- [F16] Pix x cartão no e-commerce (Ebanx/PCMI, fev/2026): https://istoedinheiro.com.br/pix-supera-cartoes-de-credito-commerce
- [F17] Câmbio (PTAX 09/10/2026, via terceiro): https://boca.com.br/economia/dolar/cotacao-dolar-09-10-2026
- [F18] Reforma tributária e split payment: https://tributodevido.com.br/portal/split-payment-guia-definitivo-pix-cartao-varejo-2026/
- [F19] IBGE, Censo 2022: população por município (SIDRA, tabela 4709) https://sidra.ibge.gov.br/tabela/4709 e domicílios particulares permanentes ocupados (SIDRA, tabela 4712) https://sidra.ibge.gov.br/tabela/4712 , consultados pela API SIDRA em 16/10/2026
- [F20] IBGE, Estimativas da população (SIDRA, tabela 6579) https://sidra.ibge.gov.br/tabela/6579 , consultada pela API SIDRA em 16/10/2026
- [F21] IBGE, Cadastro Central de Empresas 2024, por seção e divisão da CNAE 2.0 (SIDRA, tabela 9510) https://sidra.ibge.gov.br/tabela/9510 , consultada pela API SIDRA em 16/10/2026
