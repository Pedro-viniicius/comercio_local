# Lojista: loja e catálogo pelo celular

- Status: aprovado
- Aprovado pelo dono em 2026-10-16, com as respostas às perguntas em aberto incorporadas
- Prioridade: alta
- Data: 2026-10-16
- Fatia do MVP: 2 de 8 (índice em `docs/produto/visao.md`, seção 12)

## Problema
O lojista de rua não tem equipe de tecnologia nem computador no dia a dia. Se montar a vitrine exigir mais do que o celular e alguns minutos por produto, ele não entra. Sem lojas e produtos publicados, não existe marketplace.

## Para quem
Lojista ("Seu Carlos", em `docs/produto/visao.md`, seção 2). O admin aparece como aprovador (fatia 8).

## Por que agora
É a oferta do marketplace. A estratégia de aquisição (visão, seção 10) depende de o cadastro ser rápido, funcionar com conexão ruim e permitir cadastro assistido.

## Proposta
No app do lojista: criar a loja (dados, CNPJ, endereço com mapa, horários, raio e taxa de entrega, opção de retirada na loja), cadastrar produtos com fotos pela câmera, variações de tamanho e cor com estoque por combinação, publicar ou pausar, importar por planilha, informar dados de recebimento e pausar pedidos. Tudo tolerante a conexão instável.

Termos: geocodificação é a conversão de um endereço em coordenadas no mapa; sub-conta é a conta da loja dentro do gateway de pagamento, para onde vai a parte dela em cada venda.

## Dependências e ordem
- Depende da fatia 1 (conta e login).
- A publicação da loja depende da aprovação do admin (fatia 8, CA-89). Recomendação: implementar a aprovação de lojas e as configurações básicas do painel logo depois desta fatia, antes da fatia 3.
- A sub-conta no gateway (CA-26) é concluída pela fatia 5; aqui fica a coleta dos dados e o status.

## Histórias de usuário
- Como lojista, quero criar minha loja pelo celular em poucos minutos, para começar a vender sem depender de ninguém.
- Como lojista, quero cadastrar um produto tirando a foto na hora e informando preço e tamanhos, para manter a vitrine atualizada nos intervalos do balcão.
- Como lojista, quero que o estoque por tamanho e cor seja respeitado, para não vender o que não tenho.
- Como lojista, quero subir uma planilha quando já tenho a lista de produtos, para não digitar tudo de novo.
- Como lojista, quero pausar os pedidos quando fecho mais cedo ou saio de férias, para não perder reputação.
- Como lojista sem motoboy, quero oferecer retirada na loja, para vender pelo app mesmo sem entregar.

## Critérios de aceite
- CA-14 — Dado um usuário autenticado no app do lojista sem loja, quando informa nome da loja, CNPJ, categoria principal, telefone de contato e endereço (CEP, número, complemento), então a loja é criada com status "em análise", a conta recebe o perfil lojista e o app mostra a lista do que falta para publicar (horários, entrega, produtos, dados de recebimento).
- CA-15 — Dado um CNPJ com dígitos verificadores inválidos ou já usado por outra loja, quando o lojista envia o formulário, então vê o erro no próprio campo ("CNPJ inválido" ou "CNPJ já cadastrado, fale com o suporte") e nada é salvo; o CNPJ é guardado só com dígitos.
- CA-16 — Dado um endereço informado, quando é salvo, então o app mostra o pino no mapa obtido por geocodificação e permite arrastá-lo para ajustar; as coordenadas finais são as usadas na busca por proximidade.
- CA-17 — Dado uma loja criada, quando o lojista define horário por dia da semana (inclusive "fechado"), raio de entrega em km (até o máximo definido pelo admin), taxa de entrega fixa (pode ser zero), opcionalmente "grátis acima de R$ X", pedido mínimo opcional e tempo estimado de entrega em minutos (ou marca "Não faço entrega", permitido só com a retirada ativa, CA-104), então o botão "Enviar para análise" fica habilitado; sem esses campos, ele fica desabilitado com a lista do que falta.
- CA-18 — Dado uma loja aprovada pelo admin (fatia 8), quando a aprovação acontece, então o lojista recebe push e a loja passa a aparecer para consumidores assim que tiver um produto publicado; dado uma loja reprovada, então o lojista vê o motivo, corrige e reenvia.
- CA-19 — Dado um lojista com loja, quando tira até 5 fotos com a câmera ou escolhe da galeria e informa nome (até 80 caracteres), preço maior que zero, categoria e descrição opcional (até 1.000 caracteres), então o produto é salvo como rascunho e aparece em "Meus produtos"; a imagem é comprimida no celular antes do envio (premissa: até 1 MB por foto) e o fluxo cabe em uma única tela depois das fotos.
- CA-20 — Dado um produto, quando o lojista adiciona eixos de variação (tamanho e/ou cor) com valores (por exemplo P, M, G e azul, preto), então cada combinação tem estoque próprio e pode ter preço próprio; o produto mostra o estoque total e a faixa de preço; produto sem variação tem uma única combinação padrão.
- CA-21 — Dado uma combinação com estoque zero, quando o consumidor vê o produto, então ela aparece como "esgotado" e não pode ser adicionada; dado o lojista ajusta o estoque com um motivo (reposição, venda no balcão, perda, correção), então o histórico guarda quem, quando, quanto e por quê.
- CA-22 — Dado um rascunho com ao menos uma foto, nome, preço, categoria e estoque definidos, quando o lojista publica, então o produto fica visível na loja (se a loja estiver aprovada); dado um produto pausado, então ele some da busca e das páginas, mas continua nos pedidos já feitos.
- CA-23 — Dado o modelo de planilha baixado do app (CSV ou XLSX com nome, preço, categoria, descrição, variações e estoque), quando o lojista envia a planilha preenchida, então vê uma prévia com linhas válidas e inválidas (motivo por linha), confirma, e os produtos válidos entram como rascunho sem foto, com aviso de quais ainda precisam de foto para publicar; planilha com mais de 500 linhas é recusada com orientação de dividir.
- CA-24 — Dado o lojista sem conexão, quando salva um produto ou altera estoque, então a ação fica guardada no celular como "pendente de envio", com indicador visível, é enviada automaticamente quando a conexão volta e não duplica (cada operação leva um identificador gerado no celular).
- CA-25 — Dado o envio de uma imagem, quando o servidor a recebe, então valida tipo (JPEG, PNG, WEBP) e tamanho, rejeita o que não for imagem, remove metadados (EXIF, inclusive localização) e gera versões redimensionadas (miniatura e detalhe); teste automatizado cobre arquivo disfarçado de imagem.
- CA-26 — Dado uma loja aprovada, quando o lojista informa dados de recebimento (conta bancária ou chave Pix em nome do CNPJ da loja), então o formato é validado, os dados são enviados ao gateway para criar a sub-conta (fatia 5) e o app mostra o status ("em verificação", "ativa", "com problema"); depois de salvos, os dados aparecem sempre mascarados.
- CA-27 — Dado uma loja aprovada, quando o lojista altera CNPJ, razão social, endereço ou dados de recebimento, então a alteração fica "pendente de aprovação" do admin, a loja continua operando com os dados anteriores e os repasses ficam suspensos até a confirmação; nome fantasia, horários, taxa, raio e descrição valem na hora.
- CA-28 — Dado uma loja aprovada e aberta, quando o lojista ativa "Pausar pedidos" (motivo opcional e, opcionalmente, até quando), então a loja aparece como "temporariamente fechada" para consumidores e não recebe novos pedidos; os pedidos em andamento continuam.
- CA-104 — Dado uma loja, quando o lojista ativa "Oferecer retirada na loja" (desligado por padrão, sugerido durante o cadastro e ativável pelo admin no cadastro assistido) e informa o tempo de preparo para retirada em minutos, então a tela avisa que o endereço completo da loja passará a ser exibido aos consumidores e pede confirmação; confirmada, a loja passa a aparecer no modo Retirar na loja (CA-105) e o endereço completo fica visível (CA-35); desligar a retirada não afeta pedidos em andamento; a loja pode operar só com retirada marcando "Não faço entrega" (CA-17).

## Fora do escopo
Importação por foto com IA; várias unidades por loja; funcionários com permissões; promoções e cupons; edição em lote; consulta automática da situação do CNPJ na Receita (fica como link manual para o admin no MVP).

## Como vamos medir o sucesso
Tempo mediano da criação da loja ao envio para análise; % de lojas que publicam ao menos 10 produtos em 7 dias; % de produtos criados pelo celular com foto da câmera; falhas de sincronização offline (meta: zero duplicidades).

## Riscos e premissas
- Premissa: lojista com CNPJ (inclusive MEI). Pessoa física fica fora até validação com contador.
- Premissa: distância em linha reta e raio único por loja; raio por bairro ou por rota fica para depois.
- Risco: fotos de baixa qualidade afetam conversão. Mitigação: guia de foto na tela de câmera e cadastro assistido para as lojas âncora.
- Risco: geocodificação errada coloca a loja no lugar errado. Mitigação: confirmação do pino pelo lojista e pelo admin na aprovação.

## Pendências para entrar no ar (não bloqueiam o desenvolvimento)
- Contrato de adesão do lojista (termos específicos de venda, repasse e devolução), revisado por advogado.
- Definição com contador de quem emite nota fiscal ao consumidor (a loja) e como a plataforma documenta a comissão.

## Perguntas em aberto
- Limite de produtos por loja no MVP? Proposta: sem limite, com paginação.
- Categorias iniciais: roupas, calçados, presentes, casa e utilidades, mercado, outros. Falta alguma?

## Interface
Telas: criar loja (passos), endereço com mapa, horários, entrega e retirada na loja, lista de produtos, cadastrar e editar produto (câmera), variações e estoque, importar planilha (prévia), dados de recebimento, status da loja e pausar pedidos. Precisa de spec do designer: sim.
