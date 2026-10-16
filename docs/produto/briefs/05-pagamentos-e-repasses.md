# Pagamentos e repasses: Pix, cartão, split e extrato

- Status: aprovado
- Aprovado pelo dono em 2026-10-16, com as respostas às perguntas em aberto incorporadas
- Prioridade: alta
- Data: 2026-10-16
- Fatia do MVP: 5 de 8 (índice em `docs/produto/visao.md`, seção 12)
- Sensível: sim (dinheiro, dados de cartão, dados bancários)

## Problema
O consumidor precisa pagar em segundos e com confiança; o lojista precisa receber a parte dele sem surpresa; a plataforma precisa cobrar a comissão certa, estornar quando devido e provar cada centavo. Um erro aqui destrói a confiança dos dois lados.

## Para quem
Consumidora, lojista e administrador (`docs/produto/visao.md`, seção 2).

## Por que agora
Sem pagamento não há pedido (fatia 4) nem receita. É a fatia mais sensível e exige revisão de segurança desde o plano.

## Proposta
Integração com um gateway de pagamento que ofereça Pix, cartão de crédito com tokenização no app, sub-contas por loja e split automático. Webhooks verificados e idempotentes, estorno pelo mesmo meio, extrato do lojista, repasse periódico, lançamentos financeiros imutáveis e conciliação diária com o gateway. A escolha do gateway é do arquiteto; a regra de comissão e de taxa de pagamento está em `docs/produto/decisoes.md` (modelo de comissão) e em `docs/produto/analise-comissao.md`.

Termos: tokenização troca os dados do cartão por um código que só o gateway consegue usar; webhook é o aviso automático que o gateway envia ao nosso servidor quando algo acontece (pagamento aprovado, estornado); split é a divisão automática do valor entre plataforma e loja; conciliação é conferir que o que o gateway diz bate com o que registramos.

## Dependências e ordem
- Depende da fatia 4 (pedido) e da fatia 2 (dados de recebimento, CA-26).
- A fatia 8 configura percentuais, comissão mínima, atribuição da taxa de pagamento e isenção de loja nova (CA-94); até lá, valem os padrões do sistema.
- Etapa sensível: exige revisão do `seguranca` no plano e no código.

## Histórias de usuário
- Como consumidora, quero pagar com Pix e ver o pedido confirmado sozinho, para não ficar atualizando a tela.
- Como consumidora, quero pagar com cartão sem que meu número fique guardado por aí, para me sentir segura.
- Como lojista, quero ver quanto vendi, quanto foi descontado e quando recebo, para confiar na plataforma.
- Como administradora da plataforma, quero que cada centavo tenha rastro e que o fim do dia feche sem divergência, para dormir tranquila.

## Critérios de aceite
- CA-57 — Dado um pedido confirmado com Pix, quando é criado, então o app mostra em até 3 s o QR code e o código "copia e cola" gerados pelo gateway, com contagem regressiva do prazo; quando o gateway avisa o pagamento (webhook), a tela muda para "Pagamento confirmado" em até 5 s sem o usuário recarregar.
- CA-58 — Dado um pedido com cartão de crédito, quando o consumidor digita os dados, então eles vão do app direto ao gateway (tokenização pelo SDK do gateway) e o nosso servidor recebe apenas o token, a bandeira e os últimos 4 dígitos; número completo, validade e CVV nunca chegam ao servidor nem a logs (teste automatizado inspeciona as requisições do app).
- CA-59 — Dado um cartão recusado, então o consumidor vê "Pagamento não autorizado. Tente outro cartão ou Pix", sem detalhes sensíveis; o pedido segue "aguardando pagamento" até expirar (CA-48) e cada tentativa fica registrada; dado consentimento explícito, o token do cartão pode ser salvo para a próxima compra e removido em um toque.
- CA-60 — Dado um webhook do gateway, quando recebido, então a assinatura é verificada e rejeitada se inválida (resposta 401, ocorrência registrada); o mesmo evento recebido duas vezes não altera estado nem cria lançamento duplicado; um evento fora de ordem (estorno antes da confirmação, por exemplo) é guardado e reprocessado em ordem; teste de integração cobre os três casos.
- CA-61 — Dado um pagamento aprovado, então o valor é dividido em comissão da plataforma (percentual vigente da loja na criação do pedido, 3% no lançamento, com mínimo de R$ 1,00 por pedido e nunca maior que o valor dos produtos; 0% e sem mínimo durante a isenção de loja nova), taxa de pagamento (custo do gateway, atribuída à loja por regra padrão; a atribuição continua configurável pelo admin, CA-94) e repasse ao lojista; cada parte vira um lançamento separado no extrato, com a taxa de pagamento em linha própria; teste de propriedade garante que comissão + taxa + repasse = valor pago.
- CA-62 — Dado um cancelamento de pedido com pagamento aprovado, então o estorno integral é solicitado ao gateway pelo mesmo meio (Pix ou cartão), lançamentos de reversão são criados e o status financeiro vai de "estorno solicitado" para "estornado" quando o webhook confirmar; o consumidor é avisado com o prazo informado pelo gateway.
- CA-63 — Dado um lojista, quando abre "Financeiro", então vê saldo a receber, saldo disponível, próximo repasse previsto e a lista de lançamentos por pedido (bruto, comissão, taxa, líquido) e de repasses, com filtro por período e exportação em CSV; os totais batem com a soma dos lançamentos (teste).
- CA-64 — Dado saldo disponível (pedidos concluídos e prazo de liquidação do gateway vencido), quando o ciclo de repasse roda (semanal, parametrizável), então uma transferência é criada para a conta cadastrada da loja, com comprovante e status; repasse que falha avisa lojista e admin e volta para "pendente" sem perder o valor; loja com alteração de dados bancários pendente (CA-27) ou pedido em disputa (CA-73) tem o valor correspondente retido; disputa aberta depois do repasse é resolvida por estorno via gateway ou desconto no próximo repasse (CA-96).
- CA-65 — Dado qualquer lançamento financeiro, então ele é somente-acréscimo (nunca editado ou apagado), com ator, origem (webhook, admin, sistema), data e hora, valores e referência ao evento do gateway; correções são novos lançamentos de ajuste com justificativa; teste confirma que a API não expõe edição nem exclusão.
- CA-66 — Dado o fim de cada dia, quando a rotina de conciliação roda, então compara pagamentos aprovados, estornados e repassados no gateway com os registros da plataforma e gera um relatório de divergências para o admin; nos testes de integração o resultado esperado é zero divergências.
- CA-67 — Dado o cálculo de comissão e split, então os valores são em centavos, com regra única de arredondamento (meio para cima, no centavo) documentada, a comissão mínima de R$ 1,00 aplicada depois do arredondamento e limitada ao valor dos produtos, e um teste de propriedade com milhares de combinações de valor, percentual e meio de pagamento (Pix e cartão, com taxa percentual mais fixa) confirma que a soma das partes é igual ao total, inclusive em pedidos cujo percentual dá menos de R$ 1,00.
- CA-68 — Dado o gateway indisponível ou lento ao criar uma cobrança, quando o tempo limite estoura (5 s), então o consumidor vê "Não conseguimos iniciar o pagamento. Tente de novo", o pedido continua "aguardando pagamento" e a nova tentativa reaproveita a mesma chave de idempotência junto ao gateway, sem criar cobrança duplicada.
- CA-69 — Dado a integração com o gateway, então as chaves ficam em variáveis de ambiente ou cofre de segredos (nunca no repositório), os logs não contêm número de cartão, CPF, chave Pix, tokens nem payloads completos do gateway, e um teste automatizado verifica a redação de campos sensíveis nos logs.
- CA-70 — Dado uma loja nova em isenção (90 dias contados do primeiro pedido pago, parametrizável), quando um pedido é pago, então a comissão aplicada é 0% (a taxa de pagamento continua cobrada) e o valor que seria cobrado fica registrado para relatório; o prazo só começa a contar no primeiro pedido pago, não na aprovação da loja; quando termina, os pedidos seguintes usam o percentual da loja ou o padrão, e o lojista é avisado 7 dias antes do fim com o total vendido e a comissão que passará a pagar.

## Fora do escopo
Cartão de débito, carteiras digitais (Apple Pay, Google Pay), parcelamento, antecipação de recebíveis, boleto, vale ou voucher, crédito ao lojista, emissão de nota fiscal.

## Como vamos medir o sucesso
Taxa de aprovação por meio de pagamento; tempo mediano da criação do Pix à confirmação; divergências de conciliação por dia (meta: zero); repasses com falha; chargebacks por mil pedidos.

## Riscos e premissas
- Premissa: o gateway escolhido oferece Pix, cartão com tokenização no app, sub-contas, split e webhooks assinados. O arquiteto confirma com a documentação do gateway antes do plano.
- A taxa de pagamento é lançamento separado, atribuída à loja por padrão (decisão do dono); a atribuição continua configurável pelo admin para não exigir código novo se a regra mudar.
- Risco: chargeback em cartão recai sobre a plataforma ou sobre a loja conforme o contrato com o gateway. Definir e registrar no contrato de adesão do lojista.
- Risco: regra fiscal de retenção na comissão. Validar com contador.

## Pendências para entrar no ar (não bloqueiam o desenvolvimento)
- Abertura da empresa (CNPJ) com contador, inclusive o enquadramento no Simples Nacional; depois, conta de produção no gateway em nome da empresa, com análise de risco aprovada.
- Contrato de adesão do lojista com regras de repasse, prazo, estorno e chargeback.
- Parecer contábil sobre tributação da comissão e emissão de nota da plataforma ao lojista.

## Perguntas em aberto
- Respondida em 2026-10-16: a taxa de pagamento é da loja, ao custo do gateway (decisão do dono, modelo de comissão).
- Ciclo de repasse semanal ou diário? Proposta: semanal no piloto, diário quando o volume justificar.
- Reter o repasse por 7 dias para cobrir a janela de defeito, ou liberar na conclusão (premissa adotada)? Ver "perguntas que restam" na seção 13 da visão.

## Interface
Telas: pagamento Pix (QR code, copia e cola, contagem regressiva, confirmação), pagamento com cartão (formulário do SDK, salvar cartão, erro), Financeiro do lojista (saldos, lançamentos, repasses, exportar). Precisa de spec do designer: sim.
