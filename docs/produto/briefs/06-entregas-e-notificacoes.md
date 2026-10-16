# Entregas, retirada na loja, acompanhamento em tempo real e notificações

- Status: aprovado
- Aprovado pelo dono em 2026-10-16, com as respostas às perguntas em aberto incorporadas
- Prioridade: alta
- Data: 2026-10-16
- Fatia do MVP: 6 de 8 (índice em `docs/produto/visao.md`, seção 12)

## Problema
A promessa do produto é receber hoje. Para isso, a loja precisa ver o pedido no segundo em que ele chega, o consumidor precisa saber em que pé está a entrega, e os dois precisam de um jeito confiável de confirmar que o pedido foi entregue.

## Para quem
Consumidora e lojista (`docs/produto/visao.md`, seção 2); o admin acompanha atrasos e disputas (fatia 8).

## Por que agora
Fecha o ciclo do pedido iniciado na fatia 4 e é o que o consumidor sente como "velocidade".

## Proposta
Status de entrega mantidos pela própria loja (premissa do MVP), com previsão calculada, código de entrega de 4 dígitos, confirmação pelo consumidor com janela de contestação; retirada na loja com aviso de "pronto para retirada" e código de retirada; sinalização de atraso, atualização em tempo real nas telas, push para lojista e consumidor com deep link, central de notificações e tolerância a conexão instável do lojista.

Termos: push é a notificação que aparece no celular mesmo com o app fechado; tempo real aqui significa que a tela muda sozinha em poucos segundos.

## Dependências e ordem
- Depende das fatias 4 (status do pedido) e 5 (pedido pago dispara o fluxo).
- Os eventos de domínio das fatias anteriores são a fonte das notificações; esta fatia implementa o envio e o acompanhamento.

## Histórias de usuário
- Como lojista, quero ser avisado com som quando chega pedido, mesmo com o app fechado, para não perder venda.
- Como consumidora, quero ver quando o pedido saiu e quando deve chegar, para me organizar.
- Como consumidora, quero um jeito simples de dizer que não recebi, para não ficar no prejuízo.
- Como lojista, quero provar que entreguei, para não sofrer com contestação indevida.
- Como consumidora, quero ser avisada quando o pedido estiver pronto para retirar, com o endereço e um código, para buscar sem fila nem confusão.

## Critérios de aceite
- CA-71 — Dado um pedido em preparação, quando o lojista toca "Saiu para entrega" e informa, opcionalmente, o nome do entregador e a previsão de chegada, então o status muda, o consumidor recebe push e vê a previsão no detalhe do pedido.
- CA-72 — Dado um pedido que saiu para entrega, quando o lojista marca "Entregue", então o consumidor recebe push para confirmar; dado que o consumidor confirma ou não contesta o recebimento em 24 h (parametrizável), então o pedido vira "concluído", o que libera a avaliação (fatia 7) e conta o valor para repasse (fatia 5); a disputa por produto errado ou com defeito continua possível até 7 dias após a conclusão (CA-73).
- CA-73 — Dado um pedido marcado como entregue (ou retirado sem código), quando o consumidor toca "Não recebi" (ou "Não retirei") em até 24 h, ou "Produto errado ou com defeito" em até 7 dias após a conclusão, então uma disputa é aberta (fatia 8) com o tipo e o prazo registrados e o pedido fica "em disputa"; o repasse ainda não realizado é retido e, se já foi realizado, a decisão é executada por estorno via gateway ou desconto no próximo repasse (CA-96); fora dos prazos os botões não aparecem e a API recusa.
- CA-74 — Dado o detalhe do pedido aberto no app do consumidor ou do lojista, quando o status muda no servidor, então a tela atualiza em até 5 s sem ação do usuário (mecanismo a decidir pelo arquiteto: push silencioso, websocket ou polling curto); teste de integração cobre a atualização.
- CA-75 — Dado um pedido que saiu para entrega, então o consumidor vê um código de entrega de 4 dígitos; quando o lojista marca "Entregue", então informa o código (validado) ou escolhe "Entregue sem código" com motivo, e essa escolha fica sinalizada no pedido e visível ao admin em caso de disputa.
- CA-76 — Dado um pedido pago, então todos os dispositivos do lojista com sessão ativa recebem push com som distinto e o pedido aparece em "Novos"; dado nenhum dispositivo com token de push válido, então um e-mail de alerta é enviado ao lojista e o admin vê a loja como "sem notificação ativa".
- CA-77 — Dado os eventos aceito, saiu para entrega, pronto para retirada, entregue, retirado, cancelado, não retirado, estornado e expirado, quando ocorrem, então o consumidor recebe push com texto específico do evento e o toque abre o detalhe do pedido por deep link; a central de notificações do app lista as últimas 30.
- CA-78 — Dado o usuário, quando acessa "Notificações" nas configurações, então pode desligar avisos não transacionais (ainda não existem no MVP, mas a preferência já é guardada) e não pode desligar os avisos de pedido; o texto explica o motivo.
- CA-79 — Dado um token de push inválido ou expirado retornado pelo provedor, então o token é removido e o fato registrado sem dados pessoais; dado o reenvio de um mesmo evento, então o usuário não recebe notificação duplicada (idempotência por evento e destinatário).
- CA-80 — Dado uma loja com tempo estimado de entrega X min, quando o pedido é aceito, então a previsão exibida ao consumidor é o horário do aceite mais X; dado um pedido 15 min além da previsão sem estar entregue, então ele fica marcado como "atrasado" para o lojista (destaque na lista) e para o admin (indicador no painel), e o consumidor vê "A loja está atrasada; previsão atualizada em breve".
- CA-81 — Dado o lojista sem conexão, quando muda o status de um pedido, então a mudança fica enfileirada no celular com indicador, é enviada ao reconectar e, se o pedido já tiver sido cancelado ou alterado no servidor, o app mostra o estado atual e descarta a mudança inválida com aviso.
- CA-109 — Dado um pedido de retirada, quando o lojista marca "Pronto para retirada", então o consumidor recebe push e vê no detalhe o endereço completo da loja com link para o mapa, o horário de funcionamento, o prazo para retirar e o código de retirada de 4 dígitos; a tela atualiza em tempo real como em CA-74.
- CA-110 — Dado um pedido pronto para retirada, quando o lojista toca "Retirado" e informa o código do consumidor (validado), então o pedido vira "retirado" e "concluído" na hora, liberando avaliação e repasse; quando escolhe "Retirado sem código" com motivo, então o pedido vira "retirado" e o consumidor tem 24 h para contestar com "Não retirei" antes da conclusão, com a escolha sinalizada ao admin; nos dois casos a disputa por produto errado ou com defeito segue possível por 7 dias.

## Fora do escopo
Integração com entregadores sob demanda; rastreio por GPS do entregador; app para entregador; cálculo de frete por distância; SMS e WhatsApp como canal de notificação (só push e e-mail no MVP).

## Como vamos medir o sucesso
Tempo mediano do pagamento ao aceite e do aceite à entrega; % de pedidos entregues no mesmo dia; % de pedidos atrasados; % de entregas confirmadas com código; disputas por "não recebi" por mil pedidos; falhas de entrega de push.

## Riscos e premissas
- Premissa: a loja entrega com equipe própria ou motoboy contratado por ela. Trade-off: zero custo logístico para a plataforma e menos escopo, contra qualidade de entrega desigual e lojas sem motoboy fora do piloto. Pergunta em aberto para o dono.
- Risco: Android com economia de bateria agressiva atrasa push. Mitigação: orientação na tela do lojista, canal de notificação de alta prioridade e e-mail de alerta.
- Risco: lojista marca "entregue" sem código para encerrar rápido. Mitigação: sinalização ao admin e peso na decisão de disputa.
- Decisão de desenho: retirada confirmada com código conclui o pedido na hora, porque o código é a confirmação do consumidor presente na loja; sem código, valem as mesmas 24 h da entrega. Trade-off: menos uniforme, mas libera o repasse mais cedo sem perder segurança.

## Pendências para entrar no ar (não bloqueiam o desenvolvimento)
- Contas nos serviços de push (Firebase Cloud Messaging e Apple Push Notification service) em nome da empresa.
- Política de disputa e reembolso publicada.

## Perguntas em aberto
- O consumidor pode ver o telefone do entregador? Proposta: não; o contato é com a loja (CA-56).
- Respondida em 2026-10-16: 24 h para "não recebi" ou "não retirei" e 7 dias para "produto errado ou com defeito" (decisão do dono).

## Interface
Telas: detalhe do pedido com linha do tempo, previsão e código de entrega ou de retirada, endereço da loja com mapa na retirada (consumidor); ações de status, informar entregador e código, marcar pronto para retirada, retirado e não retirado, pedidos atrasados em destaque (lojista); central e configurações de notificações (ambos). Precisa de spec do designer: sim.
