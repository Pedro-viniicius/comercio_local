# Avaliações de lojas e produtos

- Status: aprovado
- Aprovado pelo dono em 2026-10-16, com as respostas às perguntas em aberto incorporadas
- Prioridade: média
- Data: 2026-10-16
- Fatia do MVP: 7 de 8 (índice em `docs/produto/visao.md`, seção 12)

## Problema
O consumidor vai comprar de lojas que nunca ouviu falar. A nota de outros compradores da mesma cidade é o sinal mais barato de confiança, e para a loja é um retorno sobre o que melhorar.

## Para quem
Consumidora (lê e escreve), lojista (lê e responde) e admin (modera). Personas em `docs/produto/visao.md`, seção 2.

## Por que agora
Entra no MVP porque é pequena e porque, sem ela, a home mostra lojas sem nenhum sinal de qualidade. Depende do pedido concluído (fatia 6).

## Proposta
Avaliação por pedido concluído, com nota à loja, nota opcional por produto e comentário; média visível a partir de 3 avaliações; resposta pública do lojista; moderação por lista de termos, denúncia e decisão do admin; privacidade do avaliador.

## Dependências e ordem
- Depende da fatia 6 (status "concluído") e da fatia 3 (exibição na home, na loja e no produto).
- A moderação pelo admin é uma tela da fatia 8; aqui ficam as regras e a API.

## Histórias de usuário
- Como consumidora, quero avaliar a loja depois de receber, para ajudar outras pessoas da cidade.
- Como consumidora, quero ver a nota e os comentários antes de comprar, para escolher com segurança.
- Como lojista, quero responder a uma avaliação, para mostrar que cuido do cliente.
- Como administrador, quero ocultar comentário ofensivo com motivo, para manter o ambiente saudável.

## Critérios de aceite
- CA-82 — Dado um pedido concluído, quando o consumidor abre o pedido ou toca no push "Como foi sua compra?", então pode dar nota de 1 a 5 à loja, nota opcional de 1 a 5 a cada produto e comentário opcional de até 500 caracteres; só existe uma avaliação por pedido, editável por 48 h.
- CA-83 — Dado um pedido concluído há mais de 14 dias sem avaliação, então a opção de avaliar não aparece mais; dado um pedido cancelado, expirado ou em disputa, então a opção nunca aparece; a API recusa avaliações fora dessas regras.
- CA-84 — Dado as avaliações publicadas de uma loja, então a nota média (uma casa decimal) e a quantidade aparecem na home, na página da loja e na página de produto; com menos de 3 avaliações, aparece "Loja nova" no lugar da média; a média é recalculada quando uma avaliação é publicada, editada ou ocultada.
- CA-85 — Dado uma avaliação publicada, quando o lojista responde (uma resposta por avaliação, até 300 caracteres), então a resposta aparece pública abaixo da avaliação com a data; o lojista não pode editar nem apagar a avaliação do consumidor.
- CA-86 — Dado um comentário com termos da lista de bloqueio (mantida pelo admin) ou denunciado pelo lojista com motivo, então ele fica "em moderação" e não aparece até o admin decidir; dado que o admin oculta com motivo, então a avaliação sai da média e o consumidor é avisado do motivo; a nota sem comentário nunca é ocultada por moderação de texto.
- CA-87 — Dado uma avaliação exibida, então mostra só o primeiro nome e a inicial do sobrenome do consumidor e a data, nunca e-mail, telefone ou endereço; a API pública de avaliações não devolve identificadores de usuário.
- CA-88 — Dado a página da loja, quando o usuário abre "Avaliações", então vê a lista com as mais recentes primeiro, filtro por nota e a distribuição de notas (quantas de 5, 4, 3, 2 e 1), com paginação.

## Fora do escopo
Avaliação com foto; avaliação do consumidor pela loja; selos e rankings; incentivos por avaliar; detecção automática de avaliação falsa.

## Como vamos medir o sucesso
% de pedidos concluídos avaliados; distribuição de notas; tempo mediano de resposta do lojista; avaliações ocultadas por mil publicadas.

## Riscos e premissas
- Premissa: 3 avaliações bastam para exibir média sem distorcer. Revisar no piloto.
- Risco: lojista pressiona o consumidor por nota alta. Mitigação: edição limitada a 48 h e canal de denúncia na fatia 8.
- Risco: avaliação negativa injusta por atraso do próprio consumidor. Mitigação: resposta pública do lojista.

## Pendências para entrar no ar (não bloqueiam o desenvolvimento)
- Regras de moderação publicadas (o que é ocultado e por quê).

## Perguntas em aberto
- Nota por produto entra no MVP ou só a nota da loja? Proposta: entra, opcional, porque custa pouco e alimenta a página de produto.

## Interface
Telas: avaliar pedido, lista de avaliações da loja com filtro, resposta do lojista (app do lojista), fila de moderação (painel). Precisa de spec do designer: sim, simples.
