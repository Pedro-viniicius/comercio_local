# Carrinho, checkout e ciclo do pedido

- Status: aprovado
- Aprovado pelo dono em 2026-10-16, com as respostas às perguntas em aberto incorporadas
- Prioridade: alta
- Data: 2026-10-16
- Fatia do MVP: 4 de 8 (índice em `docs/produto/visao.md`, seção 12)

## Problema
Entre achar o produto e recebê-lo há um acordo entre três partes: o consumidor paga, a loja aceita e prepara, a plataforma garante que o pedido não se perca, não duplique e não cobre o que não pode entregar. Esse ciclo precisa ser previsível para os três.

## Para quem
Consumidora e lojista (`docs/produto/visao.md`, seção 2). O admin observa e intervém pela fatia 8.

## Por que agora
É o núcleo do negócio: todo o dinheiro e toda a reputação passam pelo pedido.

## Proposta
Carrinho por loja, escolha entre entrega e retirada na loja, checkout com endereço (só na entrega), telefone, observação e escolha de pagamento, criação idempotente do pedido com preços congelados e estoque reservado, expiração de pedidos não pagos, aceite pela loja em prazo com cancelamento automático, máquina de estados única e listas de pedidos para consumidor e lojista.

Termos: idempotência significa que repetir a mesma operação não gera efeito duplicado; máquina de estados é a lista de status possíveis e das transições permitidas entre eles.

## Dependências e ordem
- Depende das fatias 1, 2 e 3. O pagamento em si é da fatia 5; aqui o pedido fica "aguardando pagamento" e reage à confirmação ou ao estorno.
- As notificações push citadas são implementadas na fatia 6; nesta fatia, os eventos de domínio são publicados.

## Histórias de usuário
- Como consumidora, quero fechar o pedido em poucos toques, com o endereço e o telefone já preenchidos, para não desistir no meio.
- Como consumidora, quero saber na hora se a loja aceitou, para não ficar esperando um pedido que não vem.
- Como lojista, quero aceitar ou recusar o pedido com um toque e ver tudo o que preciso preparar, para não errar.
- Como lojista, quero que o pedido só chegue depois de pago, para não preparar à toa.
- Como consumidora, quero retirar na loja quando estou perto, para não pagar entrega nem esperar.

## Critérios de aceite
- CA-41 — Dado um carrinho com itens da loja A, quando o usuário adiciona um item da loja B, então o app explica que cada pedido é de uma loja e oferece "Trocar de loja" (esvazia e adiciona) ou "Manter carrinho"; nada é perdido sem confirmação.
- CA-42 — Dado um item com estoque 3 na combinação escolhida, quando o usuário tenta quantidade 4, então a quantidade fica em 3 com o aviso "só restam 3"; se o estoque zerar com o item no carrinho, ele aparece como indisponível e sai do total.
- CA-43 — Dado um carrinho, quando o usuário abre, então vê itens com variação, quantidade e preço, subtotal, taxa de entrega da loja (zerada quando o subtotal atinge o "grátis acima de"), total e tempo estimado; valores em centavos, com teste automatizado de soma e arredondamento.
- CA-44 — Dado uma loja com pedido mínimo configurado, quando o subtotal está abaixo, então o botão "Fechar pedido" fica desabilitado com "Faltam R$ X para o pedido mínimo desta loja"; o pedido mínimo não se aplica à retirada na loja (CA-106).
- CA-45 — Dado um carrinho válido e o usuário logado com e-mail verificado, quando toca "Fechar pedido" no modo Entrega, então escolhe ou cadastra o endereço (só endereços dentro do raio da loja são selecionáveis), confirma o telefone de contato (pré-preenchido com o da conta, editável, formato validado), escreve observação opcional (até 200 caracteres), escolhe Pix ou cartão e vê a revisão completa antes de confirmar.
- CA-46 — Dado o toque em "Confirmar pedido", quando a requisição é repetida por falha de rede ou toque duplo com a mesma chave de idempotência (identificador gerado no app para aquela confirmação), então existe um único pedido e a resposta é a mesma; uma segunda confirmação do mesmo carrinho com chave diferente em menos de 10 s também não cria pedido duplicado.
- CA-47 — Dado um pedido confirmado, então cada item guarda nome, variação, preço unitário e quantidade do momento e o estoque das combinações é reservado; dado que preço ou disponibilidade mudou entre o carrinho e a confirmação, então o pedido não é criado e o app mostra o que mudou e pede nova confirmação.
- CA-48 — Dado um pedido aguardando pagamento, quando passa o prazo (30 min para Pix, 10 min para cartão sem resposta, parametrizáveis pelo admin), então o pedido vira "expirado", o estoque reservado é liberado e o consumidor é avisado; um pagamento que chegue depois da expiração é estornado automaticamente (fatia 5).
- CA-49 — Dado a confirmação do pagamento (fatia 5), então o pedido passa a "novo" e aparece para a loja com alerta sonoro; antes disso, a loja não vê o pedido em lugar nenhum.
- CA-50 — Dado um pedido novo, quando o lojista toca "Aceitar", então o status vira "em preparação", a previsão de entrega é calculada e o consumidor é avisado; quando toca "Recusar" e escolhe um motivo (sem estoque, fechado, fora da área, outro), então o pedido é cancelado, o estorno integral é iniciado e o consumidor é avisado com o motivo.
- CA-51 — Dado um pedido novo sem resposta da loja em 15 min (parametrizável) dentro do horário de funcionamento, então o sistema cancela automaticamente, inicia o estorno, avisa os dois lados e registra "pedido perdido" para a loja, visível no painel do admin.
- CA-52 — Dado o ciclo de status (aguardando pagamento → novo → em preparação → saiu para entrega → entregue → concluído na entrega; em preparação → pronto para retirada → retirado → concluído na retirada; cancelado, expirado, não retirado e em disputa como saídas), quando qualquer transição é tentada pela API, então só as permitidas acontecem; cada transição grava data e hora, autor (consumidor, lojista, admin, sistema) e motivo; teste automatizado cobre todas as transições inválidas.
- CA-53 — Dado um pedido em "novo" (ainda não aceito), quando o consumidor toca "Cancelar pedido", então o cancelamento é imediato com estorno integral; a partir de "em preparação", o botão vira "Preciso de ajuda" e abre uma disputa (fatia 8).
- CA-54 — Dado um consumidor com pedidos, quando abre "Meus pedidos", então vê a lista (loja, status, total, data) com os pedidos em andamento no topo, e o detalhe mostra itens, endereço, forma de pagamento, linha do tempo de status e comprovante de pagamento.
- CA-55 — Dado o app do lojista, quando abre "Pedidos", então vê as abas Novos, Em preparação, A caminho ou pronto (saiu para entrega e pronto para retirada) e Concluídos, com contagem, a modalidade (entrega ou retirada) em destaque em cada cartão e as ações de cada status; um pedido novo mantém alerta sonoro e visual até ser aceito ou recusado.
- CA-56 — Dado um pedido aceito, quando o consumidor abre o detalhe, então vê "Falar com a loja" (abre o WhatsApp ou o telefone da loja); antes do aceite o botão não aparece; o telefone do consumidor é mostrado ao lojista só no detalhe do pedido aceito, nunca em listas, e some do app do lojista 7 dias após a conclusão.
- CA-106 — Dado um carrinho válido em uma loja que oferece retirada, quando o usuário toca "Fechar pedido", então escolhe a modalidade (Entrega ou Retirar na loja, pré-selecionada pelo modo da home; Entrega só aparece se a loja entrega no endereço do usuário); em Retirar na loja o checkout não pede endereço, não cobra taxa de entrega, não aplica pedido mínimo, mostra o endereço completo da loja com link para o mapa, o horário de funcionamento e "pronto em cerca de X min", e a revisão deixa claro "Você vai retirar na loja".
- CA-107 — Dado um pedido de retirada aceito pela loja, quando o lojista toca "Pronto para retirada", então o status muda e o consumidor é avisado (CA-109); quando o lojista toca "Retirado" com o código do consumidor, então o pedido passa a "retirado" e "concluído" (CA-110); transições de entrega (saiu para entrega, entregue) são rejeitadas para pedidos de retirada, e vice-versa, com teste automatizado.
- CA-108 — Dado um pedido "pronto para retirada" há mais de 24 h (parametrizável pelo admin), quando o lojista marca "Não retirado", então o pedido é cancelado com estorno integral, o estoque volta, o consumidor é avisado e o evento fica registrado por consumidor e por loja para o admin; antes do prazo a ação não aparece; o consumidor recebe lembrete por push 2 h depois de "pronto" e 2 h antes do prazo.

## Fora do escopo
Carrinho multi-loja; agendamento; cupons; troca e devolução estruturadas; gorjeta; pedido por telefone ou WhatsApp lançado pelo lojista.

## Como vamos medir o sucesso
Conversão carrinho → pedido pago; % de pedidos recusados ou perdidos pela loja; tempo mediano até o aceite; zero pedidos duplicados em produção (monitorado); % de pedidos cancelados pelo consumidor antes do aceite.

## Riscos e premissas
- Premissa: 15 min de prazo de aceite e 30 min de Pix são bons pontos de partida; parametrizáveis.
- Risco: lojista perde pedidos por não ouvir o alerta. Mitigação na fatia 6 (som persistente, e-mail de alerta, indicador no admin).
- Risco: reserva de estoque trava item para outros compradores enquanto o Pix não é pago. Aceito no MVP, pois o prazo é curto.

## Pendências para entrar no ar (não bloqueiam o desenvolvimento)
- Política de cancelamento e reembolso publicada para consumidor e lojista (revisão jurídica, inclusive direito de arrependimento do CDC em compras a distância).

## Perguntas em aberto
- O lojista pode editar o pedido (remover item em falta com estorno parcial) em vez de recusar? Proposta: fora do MVP; recusa com motivo.
- Pedido pronto e não retirado: estorno integral (premissa adotada em CA-108) ou retenção parcial pela loja?
- Respondida em 2026-10-16: retirada na loja entra no MVP (decisão do dono).

## Interface
Telas: carrinho, checkout (modalidade, endereço só na entrega, telefone, observação, pagamento, revisão), confirmação e acompanhamento do pedido, Meus pedidos e detalhe (consumidor); Pedidos por aba, detalhe do pedido com aceitar e recusar, motivo de recusa (lojista). Precisa de spec do designer: sim.
