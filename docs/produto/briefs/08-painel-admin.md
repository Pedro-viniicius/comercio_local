# Painel do administrador (web)

- Status: aprovado
- Aprovado pelo dono em 2026-10-16, com as respostas às perguntas em aberto incorporadas
- Prioridade: alta
- Data: 2026-10-16
- Fatia do MVP: 8 de 8 (índice em `docs/produto/visao.md`, seção 12)
- Sensível: sim (dados pessoais, dinheiro, autorização)

## Problema
O dono opera a plataforma sozinho no começo. Ele precisa aprovar lojas rápido, cadastrar lojas âncora em nome dos lojistas, acompanhar pedidos e dinheiro, resolver disputas e mudar regras (comissão, raio, prazos, categorias) sem pedir a um desenvolvedor.

## Para quem
Administrador (`docs/produto/visao.md`, seção 2), no computador.

## Por que agora
Parte dele (aprovação de lojas, cadastro assistido e configurações) é pré-requisito para publicar qualquer loja; o restante é o que torna o piloto operável.

## Proposta
Painel web com: fila de aprovação e gestão de lojas, cadastro assistido com convite, catálogo, pedidos com cancelamento, comissões e isenção de loja nova, relatórios financeiros, disputas, configurações da plataforma, fichas de usuários com atendimento LGPD, auditoria, painel inicial com indicadores e alertas.

## Dependências e ordem
- Depende da fatia 1 (perfil admin com 2FA).
- Recomendação: dividir em duas entregas. 8a (CA-89, CA-91, CA-97, CA-99, CA-101) logo após a fatia 2, para publicar lojas. 8b (restante) após a fatia 6.

## Histórias de usuário
- Como administrador, quero aprovar uma loja em menos de cinco minutos, com tudo o que preciso em uma tela, para não travar a entrada de lojistas.
- Como administrador, quero cadastrar a loja de um lojista que visitei e convidá-lo a assumir, para montar a oferta antes da demanda.
- Como administrador, quero mudar a comissão de uma loja sem deploy e com histórico, para negociar caso a caso.
- Como administrador, quero decidir uma disputa vendo os dois lados e o código de entrega, para ser justo e rápido.
- Como administrador, quero fechar o mês com relatório que bate com os lançamentos, para prestar contas.

## Critérios de aceite
- CA-89 — Dado lojas "em análise", quando o admin abre a fila, então vê, para cada uma, dados cadastrais, CNPJ com link para consulta de situação, endereço no mapa, produtos já cadastrados e pode "Aprovar", "Reprovar" (motivo obrigatório, enviado ao lojista) ou "Pedir ajuste" (lista de campos); a decisão fica registrada com autor e data; alterações pendentes de lojas aprovadas (CA-27) aparecem na mesma fila.
- CA-90 — Dado a lista de lojas, quando o admin filtra por status, categoria ou cidade e abre uma loja, então pode suspender ou reativar com motivo; loja suspensa some do app do consumidor imediatamente, não recebe pedidos novos e os pedidos em andamento continuam até o fim.
- CA-91 — Dado o cadastro assistido, quando o admin cria uma loja e produtos em nome de um lojista e envia o convite (e-mail ou SMS com link de uso único e validade de 7 dias), então o lojista define a senha, aceita os termos e assume a loja; até o aceite dos termos, a loja não é publicada.
- CA-92 — Dado o catálogo, quando o admin busca um produto por nome, loja ou categoria, então pode editar, pausar ou remover com motivo, e a alteração aparece para o lojista com a indicação "alterado pela plataforma"; toda alteração fica na auditoria.
- CA-93 — Dado a lista de pedidos, quando o admin filtra por status, modalidade (entrega ou retirada), loja, período ou consumidor e abre um pedido, então vê itens, valores, linha do tempo e pagamentos e pode cancelar com estorno informando o motivo; a ação exige confirmação e fica na auditoria.
- CA-94 — Dado as configurações de comissão, quando o admin altera o percentual padrão (3% no lançamento, 5% depois), o percentual de uma loja, a comissão mínima por pedido (R$ 1,00), a regra de atribuição da taxa de pagamento (padrão: loja) ou a isenção de loja nova (padrão em dias contados do primeiro pedido pago, ou data final por loja), então a mudança vale só para pedidos criados depois, e o histórico guarda valor anterior, novo, autor e data; a tela mostra o histórico; aumento do percentual padrão exige data de vigência com ao menos 30 dias de antecedência, usada no aviso aos lojistas.
- CA-95 — Dado um período escolhido, quando o admin abre "Relatórios", então vê GMV, pedidos pagos, cancelados e estornados, comissão bruta (inclusive a parcela da comissão mínima), comissão não cobrada por isenção de loja nova, taxas de pagamento repassadas às lojas, repasses realizados e pendentes, no total, por loja e por modalidade (entrega ou retirada), com exportação CSV; teste automatizado confere que os totais batem com a soma dos lançamentos.
- CA-96 — Dado disputas abertas, quando o admin abre uma, então vê o pedido, o tipo da disputa ("não recebi" ou "não retirei", aberta em até 24 h; "produto errado ou com defeito", em até 7 dias), o motivo, as mensagens e anexos do consumidor e do lojista (cada parte escreve pelo próprio app), o código de entrega ou de retirada usado e se o repasse já foi feito, e decide: estorno total, estorno parcial (valor informado) ou manter; a decisão avisa os dois lados, libera ou cancela o repasse retido ou, se já repassado, executa o estorno via gateway ou desconta do próximo repasse da loja, e fica na auditoria; disputa sem decisão em 3 dias úteis aparece como "atrasada".
- CA-97 — Dado as configurações da plataforma, quando o admin edita cidades ativas e raio máximo de entrega, raio de retirada, prazo de aceite, prazo de expiração do Pix e do cartão, janelas de contestação (24 h e 7 dias), prazo para marcar "não retirado", ciclo de repasse, categorias de produto (criar, renomear, desativar) e textos legais (termos e política com número de versão), então as mudanças valem imediatamente para novas operações e os usuários veem a nova versão dos textos no próximo acesso, com novo aceite quando exigido.
- CA-98 — Dado um consumidor buscado por e-mail ou telefone, quando o admin abre a ficha, então vê pedidos e status da conta, pode bloquear ou desbloquear com motivo e registrar o atendimento de pedidos de exportação ou exclusão de dados; cada abertura de ficha fica registrada (quem e quando), por exigência da LGPD.
- CA-99 — Dado qualquer ação do admin que altera dados, então a auditoria guarda quem, quando, o quê, valor anterior e novo; a tela de auditoria permite filtrar por período, tipo e autor; registros nunca são editáveis.
- CA-100 — Dado o painel inicial, quando o admin entra, então vê os números do dia e da semana: pedidos pagos, GMV, lojas ativas, pedidos atrasados, pedidos perdidos por falta de aceite, pedidos não retirados, disputas abertas e lojas em análise, cada um levando à lista correspondente.
- CA-101 — Dado um usuário sem perfil admin, quando acessa qualquer URL do painel, então é redirecionado ao login e nada é exibido; dado o admin inativo por 30 min, então a sessão expira e exige senha e 2FA de novo; todas as rotas do painel têm teste de autorização.
- CA-102 — Dado o painel aberto em 1280 px e em 1024 px de largura, então todas as telas são usáveis sem rolagem horizontal; em 375 px, as listas e o painel inicial são legíveis para consulta (ações complexas podem exigir tela maior).
- CA-103 — Dado os eventos nova loja em análise, nova disputa, falha de repasse e divergência de conciliação, então o admin recebe e-mail e vê um indicador no painel; o indicador some quando o item é tratado.

## Fora do escopo
Vários operadores com papéis e permissões; antifraude automatizado; BI e gráficos avançados; app do admin; consulta automática de CNPJ na Receita.

## Como vamos medir o sucesso
Tempo mediano de aprovação de loja; tempo mediano de decisão de disputa; lojas cadastradas por cadastro assistido que são assumidas pelo lojista; relatórios mensais sem divergência.

## Riscos e premissas
- Premissa: um único perfil admin basta no piloto. Se outra pessoa entrar na operação, o item 23 do backlog vira prioridade.
- Risco: o painel concentra poder sobre dinheiro e dados. Mitigação: 2FA, sessão curta, auditoria imutável e revisão do `seguranca`.
- Risco: tela de usuários vira porta de vazamento de dado pessoal. Mitigação: busca exata (não listagem geral), registro de cada consulta, dados mascarados por padrão.

## Pendências para entrar no ar (não bloqueiam o desenvolvimento)
- Procedimento escrito de atendimento a pedidos LGPD (prazos e canal).
- Política de disputa e reembolso publicada (compartilhada com as fatias 4 e 6).

## Perguntas em aberto
- O painel precisa de versão em português e inglês? Proposta: só português.
- O dono quer receber os alertas também pelo celular (push no app do lojista com perfil admin)? Proposta: e-mail no MVP.

## Interface
Telas: login com 2FA, painel inicial, fila de aprovação, lojas (lista e detalhe), cadastro assistido, catálogo, pedidos (lista e detalhe), comissões, relatórios, disputas, configurações, usuários, auditoria. Precisa de spec do designer: sim (web, desktop primeiro).
