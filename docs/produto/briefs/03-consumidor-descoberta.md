# Consumidor: descoberta por proximidade

- Status: aprovado
- Aprovado pelo dono em 2026-10-16, com as respostas às perguntas em aberto incorporadas
- Prioridade: alta
- Data: 2026-10-16
- Fatia do MVP: 3 de 8 (índice em `docs/produto/visao.md`, seção 12)

## Problema
O consumidor não sabe o que as lojas perto dele vendem. Ele precisa, em segundos e com uma mão no celular, ver lojas que entregam no endereço dele hoje, achar o produto e entender quanto custa e quando chega.

## Para quem
Consumidora ("Ana", em `docs/produto/visao.md`, seção 2), muitas vezes com pressa e conexão instável.

## Por que agora
É a primeira impressão do produto e a tradução direta da proposta de valor: proximidade e velocidade.

## Proposta
Home baseada em localização (GPS ou endereço digitado) com seletor "Entrega | Retirar na loja": no modo Entrega, lojas que entregam ali; no modo Retirar, lojas com retirada dentro do raio de retirada; sempre ordenadas por distância. Navegação por categoria; busca por texto; página de produto com variações e disponibilidade; página da loja; deep links para loja e produto; leitura offline do último conteúdo.

Termos: deep link é um link que abre uma tela específica dentro do app; haversine é a fórmula que calcula distância em linha reta entre dois pontos no globo.

## Dependências e ordem
- Depende das fatias 1 (login para salvar endereço) e 2 (lojas e produtos publicados) e da aprovação de lojas no painel (fatia 8, CA-89).
- Navegar não exige login; comprar (fatia 4) exige.

## Histórias de usuário
- Como consumidora, quero ver as lojas que entregam na minha casa hoje, para resolver o que preciso agora.
- Como consumidora, quero buscar "tênis infantil" e ver só o que existe perto, para não perder tempo com oferta que não chega hoje.
- Como consumidora, quero saber a taxa e o tempo de entrega antes de escolher, para não me frustrar no checkout.
- Como lojista, quero compartilhar o link da minha loja no WhatsApp, para trazer meus clientes para o app.

## Critérios de aceite
- CA-29 — Dado o primeiro acesso ao app do consumidor, quando o app pede permissão de localização e o usuário concede, então a posição atual vira o ponto de entrega provisório e a home lista lojas que entregam ali; quando nega, o app pede CEP ou endereço, sem bloquear o uso, e funciona da mesma forma.
- CA-30 — Dado um usuário logado, quando salva um endereço com rótulo (casa, trabalho, outro), complemento e ponto de referência, então pode alternar entre endereços na home e o selecionado vai pré-preenchido no checkout; sem login, o endereço fica só no celular.
- CA-31 — Dado um ponto de entrega definido e o modo Entrega (padrão), quando o usuário abre a home, então vê as lojas aprovadas cujo raio cobre o ponto, ordenadas por distância, cada uma com distância em km (uma casa decimal), tempo estimado, taxa de entrega (ou "grátis acima de R$ X") e nota média (ou "Loja nova"); lojas fechadas ou com pedidos pausados aparecem depois das abertas, com "Fechada · abre às HH:MM" ou "Pausada".
- CA-32 — Dado a home, quando o usuário toca uma categoria (definidas pelo admin: roupas, calçados, presentes, casa e utilidades, mercado, outros), então vê produtos publicados dessa categoria, de lojas que entregam ali, ordenados pela distância da loja, com paginação por rolagem.
- CA-33 — Dado o campo de busca, quando o usuário digita ao menos 2 caracteres, então vê produtos e lojas cujo nome contém o termo (ignorando acentos e maiúsculas), filtrados pela área de entrega, em até 1 s na conexão de teste; sem resultado, vê "Nada encontrado perto de você" com sugestão de outra palavra ou categoria.
- CA-34 — Dado um produto, quando o usuário abre, então vê fotos em carrossel, nome, preço (ou faixa), seletor de variações com disponibilidade por combinação, descrição, bloco da loja (nome, distância, tempo e taxa de entrega, nota) e o botão "Adicionar ao carrinho", desabilitado até escolher todas as variações obrigatórias ou se a combinação estiver esgotada.
- CA-35 — Dado uma loja, quando o usuário abre a página dela, então vê nome, bairro (ou o endereço completo com link para o mapa, quando a loja oferece retirada), horários, taxa e tempo de entrega, tempo de preparo para retirada quando houver, pedido mínimo, nota e quantidade de avaliações e os produtos agrupados por categoria; loja fechada mostra aviso no topo.
- CA-36 — Dado uma loja cujo raio não cobre o ponto de entrega do usuário (por exemplo, aberta por link), quando a página carrega, então mostra "Esta loja não entrega no seu endereço" e os botões de adicionar ficam desabilitados, com a opção de trocar de endereço; se a loja oferece retirada, o app mostra também "Retirar na loja" e, ao escolher, os botões ficam habilitados no modo retirada.
- CA-37 — Dado um link de loja ou produto no formato https://<domínio>/l/<loja> ou https://<domínio>/p/<produto>, quando aberto em um celular com o app instalado, então o app abre direto na tela certa (Android App Links e iOS Universal Links); sem o app, abre uma página web mínima com nome, foto, preço e o botão de instalar.
- CA-38 — Dado o celular sem conexão, quando o usuário abre o app, então vê o último conteúdo carregado com a faixa "Você está offline", e o app tenta de novo sozinho ao reconectar; nunca tela em branco nem mensagem técnica.
- CA-39 — Dado um banco com 200 lojas e 5.000 produtos na mesma cidade (dados de teste), quando a home, uma categoria ou a busca são consultadas, então a API responde em menos de 500 ms no percentil 95 no ambiente de teste e sempre pagina (no máximo 20 itens por página).
- CA-40 — Dado as coordenadas do ponto de entrega e da loja, quando a distância é calculada, então usa a fórmula de haversine arredondada para 0,1 km, e o filtro "dentro do raio" usa exatamente a mesma conta no servidor; premissa: linha reta no MVP, distância por rota no futuro.
- CA-105 — Dado a home, quando o usuário alterna para "Retirar na loja" (seletor Entrega | Retirar na loja, lembrado entre sessões), então vê as lojas com retirada ativa dentro do raio de retirada definido pelo admin (premissa: 10 km do ponto do usuário), abertas primeiro e ordenadas por distância, cada uma com distância, "pronto em cerca de X min" e rua e número; categorias, busca, página de produto e página da loja respeitam o modo escolhido, e o bloco da loja mostra "Retirada: pronto em cerca de X min" no lugar de taxa e tempo de entrega.

## Fora do escopo
Favoritos, recomendações personalizadas, filtros avançados (preço, marca), ordenação por preço, mapa com todas as lojas, busca por voz, distância por rota.

## Como vamos medir o sucesso
% de sessões que chegam a uma página de produto; % de buscas sem resultado; tempo até a primeira interação; taxa de concessão de permissão de localização; cliques em deep links de lojistas.

## Riscos e premissas
- Premissa: ordenar por distância é a melhor ordem inicial. Risco: lojas boas e um pouco mais longe ficam escondidas; revisar com dados do piloto.
- Risco: catálogo pequeno no início gera buscas vazias. Mitigação: oferta antes da demanda (visão, seção 10) e texto de busca vazia que leva às categorias.
- Premissa: raio da loja e distância em linha reta aproximam bem a área real de entrega em uma cidade do porte de São Sebastião do Paraíso.

## Pendências para entrar no ar (não bloqueiam o desenvolvimento)
- Domínio registrado e configurado para App Links e Universal Links (depende do nome, Fase 2).
- Texto de permissão de localização nas lojas de apps (exigido por Apple e Google).

## Perguntas em aberto
- A home mostra lojas ou produtos em destaque primeiro? Proposta: lojas primeiro (a unidade de entrega é a loja), categorias no topo.
- Raio de busca quando não há loja cobrindo o ponto: mostrar "ainda não chegamos aqui" com cadastro de interesse? Proposta: sim, simples (e-mail opcional).

## Interface
Telas: permissão de localização, escolher e salvar endereço, home com seletor Entrega | Retirar na loja, categoria, busca e resultados, página de produto, página da loja, estado offline, página web mínima de deep link. Precisa de spec do designer: sim.
