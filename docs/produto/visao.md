# Visão do produto: Bairrin, marketplace do comércio local

- Estágio atual: ideia (nada construído; os documentos desta pasta são a primeira versão)
- Data: 2026-10-16
- Nome do produto: Bairrin (escolhido em 2026-10-16; identidade em `docs/produto/specs/00-nome-e-identidade.md`)
- Cidade piloto: São Sebastião do Paraíso (MG), onde o dono mora (decisão do dono, 2026-10-16)
- Análise de comissão: `docs/produto/analise-comissao.md` (documento separado)

## 1. Problema

Lojistas de rua (roupas, calçados, presentes, utilidades, pequenos mercados) vendem bem para quem passa na porta, mas perdem a venda de quem está em casa, no trabalho ou do outro lado da cidade. Para vender on-line, hoje eles dependem do WhatsApp e do Instagram (atendimento manual, um cliente por vez, sem catálogo nem pagamento integrados) ou dos grandes marketplaces (Mercado Livre, Shopee, Magalu), que cobram comissões altas, entregam em dias e colocam a loja de bairro para competir com o país inteiro, anulando a única vantagem que ela tem: estar perto.

Do lado do consumidor, quem precisa de algo hoje (um presente, um tênis, um utensílio, itens de mercado) ou vai até a loja ou espera dias por uma entrega de longe. Ele não sabe o que existe nas lojas a dois quilômetros de casa.

Termos usados neste documento:
- Marketplace: plataforma onde vários vendedores anunciam e vendem; a plataforma cuida da vitrine, do pagamento e da coordenação do pedido.
- MVP (produto mínimo viável): a menor versão do produto que permite testar a ideia com usuários reais.

## 2. Para quem (personas)

As personas abaixo são hipóteses para orientar o desenho, não resultado de pesquisa. Antes do piloto, validar cada uma com pelo menos cinco entrevistas.

### Consumidora: "Ana"
- 34 anos, professora, mora em São Sebastião do Paraíso, dois filhos.
- Compra pelo celular, paga com Pix, usa iFood e Shopee.
- Situação de uso: precisa de algo hoje (presente de última hora, roupa para um evento, item de casa), está com pressa, uma mão no celular e conexão de dados nem sempre boa.
- O que ela quer: achar rápido o que existe perto, confiar que a loja existe e entrega, pagar sem fricção e saber quando o pedido chega.
- O que a afasta: cadastro longo, catálogo vazio, entrega incerta, pagamento que falha.

### Lojista: "Seu Carlos"
- 52 anos, dono de loja de calçados no centro, dois funcionários, sem equipe de tecnologia.
- Vende pelo WhatsApp e posta no Instagram quando sobra tempo; celular Android intermediário; não usa computador no dia a dia.
- Situação de uso: atende balcão e celular ao mesmo tempo; precisa saber na hora quando chega pedido; cadastra produto nos intervalos, com foto tirada no próprio celular.
- O que ele quer: vender mais sem contratar ninguém, receber o dinheiro sem surpresa, não pagar mensalidade sem retorno.
- O que o afasta: cadastro demorado, taxas que ele não entende, pedidos que ele não vê a tempo, repasse atrasado.

### Administrador: o dono da plataforma
- Opera sozinho no começo, pelo computador.
- Precisa aprovar lojas rápido, acompanhar pedidos e dinheiro, resolver disputas e ajustar regras (comissão, raio, cidade) sem depender de desenvolvedor.

## 3. Como resolvem hoje

| Alternativa | O que resolve | O que falta |
|---|---|---|
| WhatsApp e Instagram | Contato direto, confiança pessoal, custo zero | Catálogo e estoque manuais, pagamento por fora, sem descoberta de lojas novas, não escala |
| Mercado Livre, Shopee, Magalu, Amazon | Alcance nacional, pagamento e logística prontos | Comissão alta para o pequeno, entrega em dias, loja local invisível entre milhões de anúncios |
| iFood (restaurantes e mercados) | Entrega rápida e local, pedido com aviso no celular | Focado em comida; comissão e mensalidade altas; roupa, calçado e presente não cabem |
| Ir até a loja | Ver e levar na hora | Tempo e deslocamento; o consumidor não sabe quem vende o quê perto dele |

Fatos com fonte (consultados em 2026-10-16):
- O WhatsApp é o principal canal de comunicação e de vendas para 82% dos donos de pequenos negócios, e 73% dizem usar ferramentas on-line para vender (Sebrae, Pesquisa Pulso dos Pequenos Negócios, 12ª edição; conferir a data da edição na fonte). Fonte: https://agenciasebrae.com.br/dados/whatsapp-se-consolida-nas-vendas-on-line-enquanto-facebook-e-lojas-proprias-perdem-folego/
- O Pix foi o meio de pagamento mais usado no Brasil no 2º semestre de 2025, com 54,7% das transações; os cartões vêm em seguida, com 30,4% (Banco Central, Estatísticas de Pagamentos de Varejo, divulgadas em abril de 2026). Fonte: https://www.band.com.br/economia/noticias/pix-lidera-pagamentos-no-brasil-com-547-das-transacoes-diz-banco-central-202604081055
- Entre 3.081 pequenos negócios ouvidos, a maioria vende em canais próprios ou em um único marketplace; o Mercado Livre é o principal canal e a Shopee cresce entre MEIs e microempresas (Sebrae e Fórum E-Commerce Brasil, Radar do Mercado Digital 2026). Fonte: https://datasebrae.com.br/wp-content/uploads/2026/08/Radar-do-Mercado-digital-2026.pdf
- São Sebastião do Paraíso (MG) tinha 71.796 habitantes no Censo 2022 e estimativa de 75.179 em 2025 (IBGE, código do município 3164704). Fonte: https://www.ibge.gov.br/cidades-e-estados/mg/3164704.html. Número de estabelecimentos comerciais da cidade: não encontrado com fonte; a confirmar com a ACISSP ou no Cadastro Central de Empresas do IBGE.

Premissas sem fonte, a validar em entrevistas: o lojista de rua aceita pagar uma comissão pequena por venda se não houver mensalidade; o consumidor prefere receber em horas a receber em dias quando o preço é parecido.

## 4. Proposta de valor

- Para o consumidor: tudo o que as lojas da sua cidade vendem, no seu celular, entregue hoje ou pronto para retirar na loja em minutos. A promessa é proximidade e velocidade, não o menor preço do país.
- Para o lojista: uma vitrine on-line montada pelo celular em minutos, com pedido, pagamento e repasse resolvidos, pagando só quando vende.
- Para o Bairrin: comissão pequena sobre um volume grande de pedidos recorrentes, com custo de logística zero no início, porque a loja entrega.

## 5. Modelo de negócio

Modelo aprovado pelo dono em 2026-10-16, a partir da recomendação de `docs/produto/analise-comissao.md` (detalhes, comparação com concorrentes e fontes estão lá).

- Comissão de lançamento: 3% sobre o valor dos produtos do pedido pago, com mínimo de R$ 1,00 por pedido. A taxa de entrega vai integral para a loja; pedido com retirada na loja não tem taxa de entrega.
- Taxa de pagamento online: repassada ao lojista ao custo do gateway (a empresa que processa Pix e cartão), cerca de 1% no Pix e cerca de 3,5% + R$ 0,40 no cartão, valores a fechar no contrato com o gateway, exibida em linha separada no extrato.
- Preço padrão depois do lançamento: 5% + taxa de pagamento, comunicado desde o contrato de adesão e com aviso prévio de 30 dias antes de valer.
- Isenção para loja nova: 90 dias sem comissão, contados do primeiro pedido pago; a taxa de pagamento continua sendo cobrada.
- Plano com mensalidade: só depois do primeiro ano (backlog, item 18). Sem receita de entrega e sem anúncios pagos no MVP.
- Custos principais: gateway de pagamento, infraestrutura, lojas de aplicativos, suporte e aquisição de lojistas (detalhados na análise de comissão).

## 6. Métricas de sucesso

As metas iniciais são premissas para calibrar no piloto, não compromissos.

| Métrica | Por que importa | Meta inicial (premissa) |
|---|---|---|
| Lojas ativas (com ao menos 1 pedido nos últimos 30 dias) | Oferta real, não cadastro vazio | 30 lojas ativas em 3 meses de piloto |
| Pedidos pagos por semana | Tração | Crescimento semana a semana durante o piloto |
| % de pedidos entregues no mesmo dia | É a promessa do produto | 80% ou mais |
| Tempo entre pagamento confirmado e entrega (mediana) | Velocidade percebida | 3 horas ou menos |
| Recompra em 30 dias | O consumidor volta? | 25% ou mais |
| Nota média das lojas | Confiança | 4,5 ou mais |
| Take rate efetivo (receita dividida pelo GMV) | Sustentabilidade | Perto de 3% no lançamento, sem contar a taxa de pagamento repassada ao custo; 5% depois |
| Tempo até a primeira venda de uma loja nova | Qualidade do onboarding | 14 dias ou menos |
| Pedidos cancelados por falta de aceite da loja | Saúde da oferta | 5% ou menos |
| % de pedidos com retirada na loja | Mede a demanda pela modalidade e o uso por quem está fora do raio de entrega | Acompanhar, sem meta |
| Pedidos prontos e não retirados | Custo da retirada para a loja | 3% ou menos dos pedidos de retirada |

Termos: GMV é o volume bruto vendido pela plataforma; take rate é a parte que a plataforma fica, em % do GMV.

## 7. Restrições

- Piloto em São Sebastião do Paraíso (MG), cidade de cerca de 72 mil habitantes (IBGE, Censo 2022): o raio de retirada pode cobrir a cidade inteira e a entrega, quase toda a área urbana; a oferta inicial é pequena, então importa mais cobrir bem o centro comercial do que ter densidade por bairro.
- A empresa ainda não existe: conta no gateway, contas nas lojas de apps e emissão de nota dependem da abertura do CNPJ (pendência para entrar no ar, com contador, inclusive o enquadramento no Simples Nacional). O desenvolvimento usa ambientes de teste.
- Equipe pequena e orçamento inicial baixo: priorizar o que entra no MVP; a stack deve ser barata de operar e fácil de contratar no Brasil (decisão do arquiteto, com aprovação do dono).
- Dois sistemas operacionais (Android e iOS) e um painel web desde o início.
- LGPD (Lei Geral de Proteção de Dados): coleta mínima, consentimento registrado, direitos de acesso e exclusão, dado pessoal nunca em logs. Confirmar com advogado antes do lançamento.
- Pagamentos: o servidor nunca vê dados de cartão (tokenização no gateway); split de pagamento (divisão automática entre plataforma e lojista) via gateway com sub-contas.
- Obrigações fiscais do marketplace e do lojista (nota fiscal, retenções): fora do MVP, mas pendência para entrar no ar; validar com contador.
- Conexão instável e celulares intermediários são o cenário normal, não a exceção.

## 8. MVP vs. futuro

| Área | MVP | Futuro |
|---|---|---|
| Identidade | E-mail, senha e telefone no cadastro, perfis consumidor, lojista e admin, 2FA no admin, LGPD básica | Login com Google e Apple, verificação do telefone por SMS |
| Lojista | Loja, horários, raio e taxa de entrega, opção de retirada na loja, produtos com foto, variações e estoque, importação por planilha, extrato e repasses, pausar pedidos | Importação por foto com IA, várias unidades, funcionários com permissões, promoções |
| Consumidor | GPS ou endereço, modo Entrega ou Retirar na loja, lojas e produtos próximos, categorias, busca, página de produto e de loja, deep links, modo offline de leitura | Favoritos, cupons, chat com a loja, recomendações, listas |
| Pedido | Carrinho por loja, escolha entre entrega e retirada na loja, checkout, aceite pela loja em prazo, ciclo de status, cancelamento, contato com a loja | Carrinho multi-loja, agendamento, troca e devolução estruturadas |
| Pagamento | Pix e cartão de crédito, split, estorno, extrato, repasse, auditoria, conciliação | Cartão de débito, Apple Pay e Google Pay, parcelamento, antecipação ao lojista |
| Entrega e retirada | A própria loja entrega; retirada na loja com código; status, previsão, código de entrega, atraso sinalizado, push | Entregadores sob demanda (integração), rastreio por GPS do entregador, frete por distância |
| Avaliações | Nota e comentário por pedido, resposta do lojista, moderação | Avaliação com foto, selos de loja |
| Admin | Aprovação e gestão de lojas, cadastro assistido, catálogo, pedidos, comissões, relatórios, disputas, configurações, auditoria | Vários operadores com papéis, antifraude automatizado, BI |
| Receita | Comissão de 3% no lançamento (5% depois) mais taxa de pagamento ao custo; isenção de comissão para loja nova | Plano mensal opcional com comissão menor, destaque pago |
| Cidades | Uma cidade piloto, parametrizável | Várias cidades, operação regional |

## 9. Regras de negócio

- RN-01 Um pedido pertence a uma única loja. O carrinho é por loja; comprar de duas lojas gera dois pedidos.
- RN-02 Uma loja só aparece para consumidores depois de aprovada pelo admin, com horário de funcionamento, ao menos uma modalidade ativa (entrega, com raio e taxa, ou retirada na loja) e ao menos um produto publicado.
- RN-03 No modo Entrega, o consumidor só vê lojas cujo raio de entrega cobre o endereço (ou a posição) escolhido; no modo Retirar na loja, vê lojas com retirada ativa dentro do raio de retirada definido pelo admin (premissa: 10 km). No MVP a distância é em linha reta.
- RN-04 Loja fora do horário, ou com pedidos pausados, aparece como fechada e não aceita pedidos; os produtos continuam visíveis.
- RN-05 Nome, variação e preço dos itens são congelados na confirmação do pedido; alterações posteriores no catálogo não afetam pedidos existentes.
- RN-06 O estoque é reservado na confirmação do pedido e liberado se o pagamento não for confirmado no prazo (30 min para Pix, parametrizável) ou se o pedido for cancelado.
- RN-07 O pedido só é mostrado à loja depois do pagamento confirmado.
- RN-08 A loja tem 15 minutos (parametrizável), dentro do horário de funcionamento, para aceitar ou recusar; sem resposta, o pedido é cancelado automaticamente com estorno integral.
- RN-09 O consumidor cancela sem custo até a loja aceitar; depois disso, só a loja cancela ou o admin decide por disputa.
- RN-10 Todo cancelamento com pagamento aprovado gera estorno integral pelo mesmo meio de pagamento.
- RN-11 A comissão incide sobre o valor dos produtos do pedido pago (3% no lançamento; 5% como preço padrão depois, com aviso prévio de 30 dias), com mínimo de R$ 1,00 por pedido e nunca maior que o valor dos produtos; a taxa de pagamento online é da loja, ao custo do gateway, lançada em linha separada; a taxa de entrega é repassada integralmente à loja. Pedido de retirada não tem taxa de entrega.
- RN-12 O percentual de comissão de um pedido é o vigente para a loja na data de criação do pedido; mudanças valem só para pedidos futuros.
- RN-13 Loja nova fica isenta só da comissão por 90 dias contados do primeiro pedido pago; a taxa de pagamento continua; a comissão mínima não se aplica durante a isenção; o valor que seria cobrado é registrado para relatório.
- RN-14 Repasse ao lojista = valor pago − comissão − taxa de pagamento (custo do gateway), liberado após a conclusão do pedido e o prazo de liquidação do gateway; a atribuição da taxa é configurável pelo admin, com a loja como padrão.
- RN-15 Pedido em disputa retém o repasse daquele pedido ainda não realizado até a decisão do admin; se o repasse já foi feito, a decisão de estorno é executada via gateway ou descontada do próximo repasse da loja (premissa adotada; alternativa: reter todo repasse por 7 dias, ver "perguntas que restam" na seção 13).
- RN-16 Toda operação financeira (pagamento, split, estorno, repasse, mudança de comissão) gera registro de auditoria imutável com autor, data e hora, origem e valores.
- RN-17 Criação de pedido, confirmação de pagamento e processamento de webhook (aviso automático do gateway) são idempotentes: a mesma operação repetida não produz efeito duplicado.
- RN-18 Valores monetários são guardados em centavos (inteiros), em reais; comissão e split usam uma única regra de arredondamento, e a soma das partes é sempre igual ao total.
- RN-19 Só quem teve pedido concluído avalia, uma vez por pedido, em até 14 dias; a média da loja só aparece a partir de 3 avaliações.
- RN-20 Uma conta é única por e-mail e pode ter os perfis consumidor e lojista; o perfil admin só é concedido manualmente.
- RN-21 Dado pessoal (nome, e-mail, telefone, CPF, endereço, dados bancários e de cartão) nunca aparece em logs, mensagens de erro ou URLs; coleta-se o mínimo e o consentimento é registrado com versão e data.
- RN-22 Exclusão de conta anonimiza os dados pessoais e preserva registros de pedidos e financeiros pelo prazo legal (prazo a confirmar com advogado e contador).
- RN-23 Dados de cartão nunca passam pelo servidor da plataforma; só o token do gateway é guardado, com consentimento do consumidor.
- RN-24 Alteração de CNPJ, endereço ou dados bancários da loja fica pendente de aprovação do admin e suspende os repasses até a confirmação.
- RN-25 Retirada na loja é opcional por loja, desligada por padrão; pode ser ativada pelo lojista ou pelo admin no cadastro assistido. Loja com retirada ativa tem o endereço completo exibido ao consumidor; sem retirada, só o bairro. Loja pode operar só com retirada ("Não faço entrega").
- RN-26 Pedido de retirada não tem endereço de entrega, taxa de entrega nem pedido mínimo; segue o mesmo aceite em prazo (RN-08) e tem status próprios: pronto para retirada e retirado. Retirado com o código de 4 dígitos do consumidor conclui o pedido na hora; retirado sem código abre a janela de 24 h de contestação.
- RN-27 Pedido pronto para retirada e não retirado em 24 h (parametrizável) pode ser cancelado pela loja como "não retirado", com estorno integral; o evento fica registrado por consumidor e por loja para o admin.
- RN-28 Contestações: "não recebi" ou "não retirei" até 24 h após a marcação de entregue ou de retirado sem código; "produto errado ou com defeito" até 7 dias após a conclusão; as duas abrem disputa decidida pelo admin.

## 10. Estratégia de aquisição de lojistas

Princípios:
1. Densidade antes de alcance: um bairro ou centro comercial por vez. O consumidor precisa achar vinte lojas úteis perto dele, não duas.
2. Oferta antes da demanda: abrir o Bairrin ao consumidor só com um conjunto mínimo de lojas âncora publicadas (premissa: 20 a 30 na área piloto).
3. Pagar só quando vende: sem mensalidade e com isenção de comissão nos primeiros 90 dias, o risco percebido pelo lojista cai.

| Tática | Como funciona | Prós | Contras |
|---|---|---|---|
| Onboarding pelo celular (autosserviço) | O lojista cria loja e produtos no app em minutos, fotos pela câmera; o admin aprova em até 1 dia útil | Escala, custo baixo | Catálogo incompleto, fotos ruins, abandono no cadastro |
| Cadastro assistido | A equipe visita a loja, fotografa, cadastra pelo painel e convida o lojista a assumir | Conversão alta, catálogo bom desde o dia 1, relacionamento | Caro em tempo, não escala, depende de pessoas |
| Isenção de comissão para loja nova | 0% de comissão por 90 dias contados do primeiro pedido pago; a taxa de pagamento continua | Derruba a objeção de custo | Receita zero no começo; risco de saída no fim do período; mitigar mostrando no extrato quanto a loja vendeu |
| Importação por planilha | Modelo CSV ou XLSX; prévia com erros por linha | Útil para lojas com sistema ou ERP | Poucas lojas de rua têm planilha; fotos ficam pendentes |
| Importação por foto (futuro) | Foto da prateleira ou etiqueta vira sugestão de produto por IA | Reduz muito o esforço | Custo e precisão incertos; exige revisão humana; fora do MVP |
| Parcerias locais | ACISSP (Associação Comercial, Industrial, Agropecuária e de Serviços de São Sebastião do Paraíso; fonte: https://www.sicredi.com.br/coop/culturasrsmg/noticias/negocios/sicredi-e-acissp-firmam-convenio-de-cooperacao-para-impulsionar-desenvolvimento/), CDL local (existência a confirmar), Sebrae Minas na região e prefeitura | Credibilidade e acesso em lote | Ciclo lento; pode exigir contrapartida |
| Retirada na loja como porta de entrada | Loja sem motoboy entra oferecendo só retirada e passa a entregar depois | Amplia a oferta no começo | Dilui a promessa de entrega; o app deixa a modalidade explícita |
| Material físico na loja | Adesivo ou QR code com deep link para a loja no app | O lojista traz o próprio cliente | Depende do engajamento do lojista |

Jornada recomendada para o piloto:
1. Começar pelo centro comercial de São Sebastião do Paraíso e listar 60 lojas-alvo por categoria, com apoio da ACISSP (a confirmar).
2. Cadastro assistido das primeiras 20 a 30 lojas âncora, em paralelo ao desenvolvimento do app do consumidor. Isso exige painel admin e app do lojista prontos antes (ver ordem dos briefs).
3. Abrir para consumidores com divulgação local (redes sociais das próprias lojas, QR code na vitrine).
4. Acompanhar por loja nas duas primeiras semanas: tempo até a primeira venda, pedidos perdidos por falta de aceite, avaliações. Intervir com treino ou suspensão.
5. Sete dias antes do fim da isenção, mostrar no extrato quanto a loja vendeu e quanto pagaria de comissão.

Métricas de aquisição: lojas publicadas por semana; % que concluem o cadastro sozinhas; tempo até a primeira venda; custo de aquisição por loja (horas da equipe + material); saída ao fim da isenção de comissão.

## 11. Riscos principais

- Ovo e galinha: sem lojas não há consumidores, e vice-versa. Mitigação: oferta antes da demanda e foco em um bairro.
- Loja não vê o pedido a tempo. Mitigação: push com som, prazo de aceite, cancelamento automático e visibilidade no admin.
- Entrega pela própria loja pode ser inconsistente. Mitigação: previsão informada pela loja, código de entrega, métricas por loja, suspensão de lojas com atraso recorrente.
- Fraude e chargeback (contestação da compra no cartão). Mitigação: antifraude do gateway, código de entrega, limite de valor por pedido no início.
- Regulação e tributos de marketplace. Mitigação: pendência com contador e advogado antes do lançamento.
- Retirada na loja dilui a promessa de entrega. Mitigação: modo explícito na home, texto claro no checkout e acompanhamento da participação da modalidade.

## 12. Fatias do MVP e índice de critérios de aceite

Os critérios de aceite (CA) têm numeração única em todo o MVP. Cada brief lista os seus. Os CAs de CA-104 a CA-110 foram acrescentados em 2026-10-16 para a retirada na loja, sem renumerar os anteriores; por isso algumas faixas não são contíguas. Total: 110.

| # | Brief | Caminho | CAs |
|---|---|---|---|
| 1 | Fundação e identidade | `docs/produto/briefs/01-fundacao-identidade.md` | CA-01 a CA-13 |
| 2 | Lojista: loja e catálogo | `docs/produto/briefs/02-lojista-loja-e-catalogo.md` | CA-14 a CA-28, CA-104 |
| 3 | Consumidor: descoberta | `docs/produto/briefs/03-consumidor-descoberta.md` | CA-29 a CA-40, CA-105 |
| 4 | Carrinho, checkout e pedidos | `docs/produto/briefs/04-carrinho-checkout-pedidos.md` | CA-41 a CA-56, CA-106 a CA-108 |
| 5 | Pagamentos e repasses | `docs/produto/briefs/05-pagamentos-e-repasses.md` | CA-57 a CA-70 |
| 6 | Entregas e notificações | `docs/produto/briefs/06-entregas-e-notificacoes.md` | CA-71 a CA-81, CA-109 e CA-110 |
| 7 | Avaliações | `docs/produto/briefs/07-avaliacoes.md` | CA-82 a CA-88 |
| 8 | Painel do administrador | `docs/produto/briefs/08-painel-admin.md` | CA-89 a CA-103 |

Ordem sugerida de implementação: 1 → 2 → 8 (parte de aprovação de lojas e configurações) → 3 → 4 → 5 → 6 → 7 → 8 (restante). O arquiteto pode dividir o brief 8 em duas entregas.

## 13. Perguntas ao dono

Respondidas em 2026-10-16, registradas em `docs/produto/decisoes.md` e cobertas pela aprovação da Fase 1: cidade piloto; empresa ainda sem CNPJ; entrega pela própria loja no MVP, sem integração com entregadores (premissa aceita com a aprovação); retirada na loja no MVP; quem paga a taxa do gateway (a loja, ao custo, no modelo de comissão aprovado); lojista só com CNPJ (premissa aceita com a aprovação); janelas de contestação; telefone no cadastro.

Respondidas em 2026-10-16 com a aprovação da Fase 3 (ver `decisoes.md`): stack e hospedagem conforme o plano `docs/produto/planos/00-arquitetura.md`; CNPJ aberto quando o app estiver pronto; nenhum serviço pago por enquanto; Avaliações como módulo próprio; login sem e-mail verificado, verificação só antes de pagar; exportação LGPD por download no app; limite de 50 falhas de login por IP em 15 min.

Perguntas que restam:
1. Repasse liberado após a conclusão do pedido (24 h sem contestação, ou na hora na retirada com código), com disputa posterior resolvida por estorno via gateway ou desconto no próximo repasse (premissa adotada), ou retido por 7 dias para cobrir a janela de defeito? Reter protege a plataforma e piora o caixa do lojista.
2. Pedido pronto e não retirado: estorno integral ao consumidor (premissa adotada) ou retenção parcial pela loja?
