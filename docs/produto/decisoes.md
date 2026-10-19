# Decisões de produto

Uma entrada por decisão, a mais nova primeiro. "Decisão do dono" é o que ele pediu explicitamente em 2026-10-16. "Premissa adotada" é o que o time assumiu por falta de resposta e precisa de confirmação; premissa não é decisão e pode ser revista sem fato novo.

## 2026-10-18 — Decisão do dono: terceira rodada na etapa 5b (S85)
- Contexto: na rodada 2 da etapa 5b, o `seguranca` deu BLOQUEANTE pelo S85 (ALTA). Uma senha de 128 caracteres feita com caracteres que se expandem na normalização NFKC, mais um trecho longo de símbolos, custava de 350 a 700 ms de CPU por requisição numa rota pública. O lead mediu 354 ms por chamada.
- Decisão: uma terceira rodada na 5b só para o S85 (corrigir a complexidade da regra composta e limitar o trabalho pelo tamanho normalizado, com testes de tempo), conferida pelo `seguranca`. Entra no mesmo commit do grupo B.
- Alternativa descartada: desligar a regra composta, o que reabriria parte do S74.
- O dono escolheu a opção recomendada pelo lead.

## 2026-10-18 — Decisão do dono: terceira rodada no grupo B do 01b
- Contexto: depois de duas rodadas de revisão das etapas 3, 4, 5 e 12b, três revisores apontaram o mesmo defeito: R7 do `revisor` (CRÍTICO), resíduo do S77 do `seguranca` (MÉDIA) e Q20 do `qa` (médio). A gravação da rotação do token de renovação podia desfazer uma revogação confirmada no mesmo instante (redefinição de senha, logout ou reuso detectado).
- Decisão: uma terceira rodada só para esse defeito, mais o Q21 (baixo, revogação pendente sobrescrita no `cliente-api`) e as referências do plano (R8, R9). `seguranca` e `revisor` conferem. Depois, commit e push do grupo B.
- O dono escolheu a opção recomendada pelo lead.

## 2026-10-17 — Decisão do dono: fontes da lista de senhas comuns (P11 do 01b)
- Contexto: na etapa 5b, o `dev` constatou que nem todas as fontes do `@zxcvbn-ts/language-pt-br` são MIT. As palavras comuns (`commonWords`) vêm do OpenSubtitles, sob ODC-BY, que só exige atribuição. Os sobrenomes vêm do pt.wiktionary, sob CC BY-SA, que exige compartilhar pela mesma licença. A lista completa também aumentava o pacote do painel em cerca de 128 KB gzip. O `arquiteto` decidiu que a lista pública fica só na API e que o painel e os apps levam só a regra de forma e as listas escritas à mão.
- Decisão: opção 1 da P11. Entram o SecLists (MIT), os nomes do IBGE e as palavras do OpenSubtitles (ODC-BY), com atribuição no cabeçalho do arquivo gerado e no README. Saem os sobrenomes do Wiktionary, e no lugar deles entram cerca de 100 sobrenomes do Censo 2022 do IBGE, escritos à mão.
- Motivo: mantém a cobertura de palavras do português sem obrigar o código a sair sob CC BY-SA. Perde-se só a cauda longa de sobrenomes.
- Ressalva: é leitura das licenças, não parecer jurídico. Os termos atuais do portal do IBGE não foram conferidos.

## 2026-10-17 — Decisão do dono: achados que sobraram da revisão do grupo A do 01b
- Contexto: depois das duas rodadas de revisão do grupo A (etapas 1a, 2, 3a e 5a), o `seguranca` deu o veredito "corrigir antes do release". Sobraram dois achados MÉDIA, corrigidos só em parte: S70 (texto de erro com dado pessoal ainda chega ao log por `e.stack`, `child`/`assign`/`setBindings` e telefone ou CPF formatado) e S74 (a lista de senhas comuns escrita à mão é curta).
- Decisão: o S70 é corrigido já, numa terceira rodada só dele, antes do commit do grupo A. O S71 (BAIXA, do mesmo arquivo do lint) entrou junto. O S74 vira a etapa 5b do plano 01b, no grupo B, obrigatória antes da etapa 6, que é a primeira a gravar senha. A 5b usa uma lista pública versionada como dado, com licença conferida, sem pacote novo.
- Motivo: o S70 tem correção pequena e já descrita. O S74 exige baixar e conferir listas de terceiros. Nenhuma etapa grava senha antes da 6, então hoje não há exposição.
- O dono escolheu a opção recomendada pelo lead e autorizou o commit e o push do grupo A depois do S70.
- Resultado da rodada 3: `seguranca` sem bloqueios (S70 e S71 corrigidos); `revisor` aprovado com ressalvas, só sugestões (R35 a R38).

## 2026-10-16 — Decisão do dono: publicação automática nas lojas aprovada
- Contexto: o dono pediu automatizar o envio dos apps para a App Store e a Google Play. O `arquiteto` fez o plano `docs/produto/planos/publicacao-nas-lojas.md` (CA-111 a CA-121), revisado pelo `seguranca` em duas rodadas.
- Decisão: plano aprovado com todas as recomendações.
  - Automação: EAS Build e EAS Submit no Expo Free, disparados pelo GitHub Actions; envio só às trilhas de teste; promoção para produção manual, pelo dono.
  - P1: contas de organização nas lojas depois do CNPJ e do D-U-N-S.
  - P2: sem EAS Update até haver o plano pago do Expo.
  - P3: o dono aceita o risco do `EXPO_TOKEN` como secret do repositório, que no GitHub Free não tem environments, com as condições da P3 do plano. Reabre o aceite: colaborador novo; token pessoal ou robô com papel acima de Developer; a conta de serviço da Play ganhar produção, gestão de trilhas ou papel IAM; outro secret no repositório; repositório público; chave da Apple como App Manager.
  - P4: a política de privacidade é publicada quando `bairrin.com.br` for registrado.
  - P8: a localização do GPS é efêmera; só o endereço salvo pelo usuário é guardado.
  - P9: sem histórico de busca, só contadores agregados.
  - P10: no MVP, só as métricas que o servidor já vê, agregadas e sem a conta; sem SDK de analytics nos apps.
- Pendências que só o dono resolve: pagar a Apple (US$ 99 por ano) e a Play (US$ 25, uma vez), abrir o CNPJ, pedir o D-U-N-S e escolher onde hospedar a API. A implementação começa depois das etapas 8 e 9 do 01a (2026-10-19) e da etapa 1 do 01b, que mexe nos mesmos arquivos.
- O dono respondeu "APROVADO" à pergunta de aprovação, e o lead registrou isso como aprovação.

## 2026-10-16 — Decisão do dono: plano 01b atualizado aprovado
- Contexto: o `arquiteto` acrescentou ao `docs/produto/planos/01b-identidade.md` o grupo 0 (etapas 0a e 0b, com as pendências do 01a). Também corrigiu a etapa 2 (já feita no 01a), a etapa 16 (a guarda de autenticação no núcleo passa a usar uma porta) e os comandos de integração.
- Decisão: plano aprovado, com a premissa P5. O verificador reprova política sem `TO` ou aberta a `PUBLIC`, `anon`, `authenticated` ou `service_role`; `TO bairrin_app USING (true)` continua aceito. O dono respondeu "-continue" à pergunta de aprovação, e o lead registrou isso como aprovação.
- Pendência P6 (poison pill do relay): fora do 01b, obrigatória antes do primeiro deploy de produção; o dono decide quando entra.

## 2026-10-16 — Decisão do dono: pendências da revisão do 01a vão para o começo do 01b
- Contexto: a revisão do plano 01a (fundação) terminou sem bloqueio, com três achados baixos do `qa` (Q5 a Q7) e quatro recomendações do `seguranca` para antes do 01b, que traz dado pessoal de verdade.
- Decisão: corrigir tudo no começo do 01b, numa etapa própria, antes das demais.
  - Q5: `logger.info({ req: null })` lança `TypeError` no serializador da requisição.
  - Q6: o verificador de migrações aceita SQL dinâmico concatenado, `ALTER DEFAULT PRIVILEGES ... GRANT` para o papel da aplicação, `CREATE POLICY ... USING (true)`, `BYPASSRLS`/`SUPERUSER`, `SET ROLE`, `SET row_security = off` e `COPY ... PROGRAM`.
  - Q7: `compartilhado/email/enviador-falso.ts` fica fora da regra de adaptador do dependency-cruiser.
  - `seguranca`, 1: a mensagem do log (`msg`) escapa do redator quando o primeiro argumento é um `Error`, quando o objeto vem sem texto ou quando há argumentos de interpolação (`hooks.logMethod`).
  - `seguranca`, 2: o verificador deve reprovar também `ALTER TABLE ... OWNER TO bairrin_app` e `CREATE POLICY` sem `TO`.
  - `seguranca`, 3: `SCHEMAS_FECHADOS` (checagem do release) precisa incluir `identidade`, ou passar a cobrir todo schema do dono `bairrin_migracao` mais `public`.
  - `seguranca`, 4: o Postgres local (`infra/postgres/init/01-papeis.sql`) deve espelhar o `REVOKE ALL ON SCHEMA public FROM PUBLIC` do Supabase.
- Motivo: nenhum é explorável hoje, porque o 01a não guarda dado pessoal. Já o 01b passa a guardar.
- Alternativas descartadas: aceitar os três achados baixos como risco; corrigir já, numa terceira rodada do 01a.

## 2026-10-16 — Decisão do dono: arquitetura aprovada e respostas ao arquiteto
- Contexto: Fase 3 entregue nos planos `docs/produto/planos/00-arquitetura.md`, `01a` e `01b`, com perguntas do arquiteto ao dono.
- Decisão: stack TypeScript conforme o plano 00: Expo com dois apps (consumidor e lojista), NestJS + Prisma + PostgreSQL, painel React, Fly.io + Supabase em São Paulo, Pagar.me condicionado à confirmação de requisitos. Dois fornecedores de hospedagem aceitos. Avaliações como módulo próprio.
- Respostas: o CNPJ será aberto quando o aplicativo estiver pronto; nenhum serviço pago por enquanto (desenvolvimento local; hospedagem, PITR e contas de produção ficam para depois); login permitido sem e-mail verificado, verificação exigida só antes de pagar (CA-45), como o brief propunha; exportação de dados LGPD por download autenticado no app, com e-mail só de aviso (CA-10); limite de 50 falhas de login por IP em 15 min, além do limite por e-mail do CA-04.
- Motivo: custo zero até o app estar pronto, contratação fácil no Brasil e uma só linguagem nos três produtos.
- Alternativas descartadas: ver tabela de abordagens e ADRs do plano 00.
- Risco residual (BAIXA, avaliado pelo `seguranca` em 2026-10-16): alguém pode criar e usar, sem pagar, uma conta com o e-mail de outra pessoa até o dono do e-mail recuperar a senha; nesse caso a recuperação verifica o e-mail e derruba as sessões do ocupante. Condição: criar loja ou receber o perfil lojista exige e-mail verificado no servidor (plano 02). Aceito pelo lead como consequência direta da decisão do dono; o dono pode revê-lo.

## 2026-10-16 — Decisão do dono: nome Bairrin e identidade visual aprovada
- Contexto: 25 candidatos em duas levas, verificados em domínio, Instagram, lojas de apps e homônimos (`docs/produto/specs/00-verificacao-nomes.md`); finalistas Bairrin, Ruazin e Cidadin.
- Decisão: o produto se chama Bairrin ("bairrinho" no falar mineiro). Identidade conforme `docs/produto/specs/00-nome-e-identidade.md`: azul `#1F5BD1` primário, verde discreto secundário, fonte do sistema, ícone de pino com toldo.
- Ressalvas: `bairrin.com` pertence a um projeto estrangeiro homônimo; o INPI (classes 35 e 42) não foi consultado.
- Pendências para hoje: registrar `bairrin.com.br` e `bairrinapp.com.br`; reservar @bairrin.app no Instagram, TikTok e Facebook; fazer a busca de anterioridade no INPI; como a empresa não existe, confirmar com advogado em nome de quem registrar.
- Alternativas descartadas: Ruazin (grafia com "z"), Cidadin (`.com` de terceiros), Paraíso Já (não escala; possível submarca do piloto).

## 2026-10-16 — Decisão do dono: Fase 1 aprovada
- Decisão: o dono aprovou os documentos de produto (`visao.md`, `backlog.md`, os oito briefs) com as respostas às perguntas em aberto incorporadas e o modelo de comissão abaixo. Os briefs passam a `aprovado`. Restam duas perguntas (visão, seção 13): retenção do repasse por 7 dias e tratamento do pedido não retirado.

## 2026-10-16 — Decisão do dono: modelo de comissão
- Contexto: o ponto de partida era 3% "tudo incluso". A análise em `docs/produto/analise-comissao.md` comparou Mercado Livre, Shopee, Magalu e iFood e estimou custos de gateway, infraestrutura, lojas de apps e suporte.
- Decisão: comissão de lançamento de 3% sobre o valor dos produtos; taxa de pagamento online repassada ao lojista ao custo do gateway (cerca de 1% no Pix; cerca de 3,5% + R$ 0,40 no cartão; valores a fechar no contrato com o gateway), exibida em separado no extrato; comissão mínima de R$ 1,00 por pedido; 5% + taxa de pagamento como preço padrão depois do período de lançamento, comunicado desde o contrato de adesão e com aviso prévio de 30 dias; isenção de 90 dias só da comissão para loja nova, contada do primeiro pedido pago; plano com mensalidade só depois do primeiro ano (continua como item 18 do backlog).
- Motivo: manter o preço competitivo para o pequeno lojista sem margem negativa no cartão, e deixar o aumento para 5% transparente desde o início.
- Alternativas descartadas: "3% tudo incluso" (margem negativa nos pedidos no cartão); mensalidade desde o início (barreira de entrada para quem ainda não vendeu).
- Onde reflete: visão (seção 5, RN-11, RN-13, RN-14), briefs 05 (CA-61, CA-67, CA-70) e 08 (CA-94, CA-95).

## 2026-10-16 — Decisão do dono: telefone obrigatório no cadastro do consumidor
- Contexto: entrega e retirada dependem de contato rápido com o consumidor; a pergunta era se o telefone entraria no cadastro ou só no checkout.
- Decisão: telefone celular obrigatório já no cadastro, com formato validado (DDD e número). Premissa adotada: sem verificação por SMS no MVP, porque SMS tem custo por mensagem; reavaliar se telefones errados atrapalharem entregas (backlog, item 28).
- Motivo: menos atrito no checkout e contato garantido desde o primeiro pedido.
- Alternativas descartadas: telefone só no checkout; verificação por SMS já no MVP.

## 2026-10-16 — Decisão do dono: janelas de contestação de 24 h e 7 dias
- Contexto: era preciso definir até quando o consumidor pode reclamar de um pedido entregue ou retirado.
- Decisão: "não recebi" ou "não retirei" até 24 h depois de marcado como entregue ou retirado sem código; "produto errado ou com defeito" até 7 dias depois da conclusão; as duas abrem disputa decidida pelo admin. O pedido vira "concluído" após 24 h sem contestação de recebimento, ou na hora quando a retirada é confirmada com código.
- Premissa adotada sobre o repasse: liberado após a conclusão e o prazo de liquidação do gateway; disputa aberta depois disso é resolvida por estorno via gateway ou desconto no próximo repasse da loja. Alternativa: reter o repasse por 7 dias, o que protege a plataforma mas piora o caixa do lojista, justamente um argumento de venda contra os grandes marketplaces. Está como pergunta ao dono (visão, seção 13).
- Motivo: equilíbrio entre proteção do consumidor e caixa do lojista.

## 2026-10-16 — Decisão do dono: retirada na loja entra no MVP
- Contexto: o consumidor perto da loja quer buscar agora, e lojas sem motoboy ficariam de fora. O dono decidiu incluir a retirada, como nos aplicativos de comida.
- Decisão: o consumidor escolhe entre "Entrega" e "Retirar na loja". Desenho adotado pelo time, o mais simples que cumpre o pedido, com os trade-offs:
  - Retirada é opcional por loja, desligada por padrão e sugerida no cadastro; o admin pode ativar no cadastro assistido. A loja pode marcar "Não faço entrega" se a retirada estiver ativa. Alternativa descartada: ligada por padrão (mais oferta, mas lojista surpreendido por cliente na porta).
  - Visibilidade: seletor "Entrega | Retirar na loja" na home. No modo Retirar aparecem as lojas com retirada dentro do raio de retirada definido pelo admin (premissa: 10 km, cobre a cidade), mesmo fora do raio de entrega. Alternativa descartada: uma lista só, decidindo a modalidade no checkout (mais oferta visível, mas confunde taxa, prazo e disponibilidade).
  - Endereço: loja com retirada ativa mostra o endereço completo com link para o mapa; sem retirada, só o bairro (CA-35).
  - Checkout de retirada: sem endereço, sem taxa de entrega e sem pedido mínimo. Alternativa descartada: manter o pedido mínimo (o mínimo existe para justificar a entrega).
  - Status próprios: pronto para retirada e retirado, com código de retirada de 4 dígitos. Retirado com código conclui o pedido na hora, porque o código é a confirmação do consumidor; retirado sem código abre 24 h de contestação. Alternativa descartada: 24 h em todos os casos (mais uniforme, mas atrasa o repasse sem ganho de segurança).
  - Não retirado: após 24 h (parametrizável) em "pronto para retirada", a loja pode cancelar como "não retirado" com estorno integral; o evento fica registrado por consumidor e por loja. Alternativa: retenção parcial pela loja (compensa o preparo, mas gera atrito e exige regra de valor). Está como pergunta ao dono.
  - Painel: filtro e relatório por modalidade; parâmetros de raio de retirada e prazo de não retirado. Repasse igual ao da entrega, liberado na conclusão.
- CAs novos: CA-104 (brief 2), CA-105 (brief 3), CA-106 a CA-108 (brief 4), CA-109 e CA-110 (brief 6), sem renumerar os anteriores. RN-25 a RN-28 na visão.

## 2026-10-16 — Decisão do dono: a empresa ainda não existe
- Contexto: conta no gateway, contas nas lojas de apps e emissão de nota exigem pessoa jurídica.
- Decisão: a abertura da empresa, com contador e inclusive o enquadramento no Simples Nacional, entra na lista de pendências para entrar no ar. Não bloqueia o desenvolvimento: gateways e lojas de apps têm ambiente de teste. Atenção ao prazo: a conta de desenvolvedor da Apple para empresas exige número D-U-N-S, que depende do CNPJ (conferir na página do Apple Developer Program).
- Motivo: fato informado pelo dono.

## 2026-10-16 — Decisão do dono: cidade piloto é São Sebastião do Paraíso (MG)
- Contexto: o dono mora na cidade. População de 71.796 habitantes no Censo 2022 e estimativa de 75.179 em 2025 (IBGE, código do município 3164704; fonte: https://www.ibge.gov.br/cidades-e-estados/mg/3164704.html).
- Decisão: piloto na cidade, começando pelo centro comercial; cidade, raio máximo e categorias continuam parametrizáveis para a expansão.
- Motivo: proximidade do dono com os lojistas (cadastro assistido e suporte presencial) e cidade pequena o bastante para o raio de retirada cobrir tudo.
- Alternativas descartadas: cidade maior (mais demanda, mas operação à distância e concorrência maior no começo).

## 2026-10-16 — Premissa adotada: login por e-mail e senha no MVP
- Contexto: o pedido não define o método de login. Login social (Google e Apple) traz regras extras da App Store e mais integração.
- Decisão provisória: e-mail e senha com verificação de e-mail; telefone obrigatório no cadastro, sem verificação por SMS (ver decisão do dono acima). Login social e código por SMS ficam para depois.
- Motivo: menos superfície de segurança e menos dependências no começo.
- Alternativas descartadas por ora: login só por telefone com SMS (custo por mensagem, dependência de provedor); login social (exige "Entrar com a Apple" no iOS quando há outro login de terceiros).

## 2026-10-16 — Premissa adotada: lojista precisa de CNPJ
- Contexto: o split de pagamento e a emissão de nota exigem identificar o recebedor. Pessoa física vendendo pela plataforma tem implicações tributárias que não foram analisadas.
- Decisão provisória: só lojas com CNPJ (inclusive MEI) no MVP.
- Motivo: simplifica a conta no gateway e a conformidade.
- Alternativas descartadas por ora: aceitar CPF (validar com contador antes de reabrir).

## 2026-10-16 — Premissa adotada: um pedido por loja
- Contexto: entrega feita pela própria loja torna um pedido com várias lojas várias entregas, com taxas e prazos diferentes.
- Decisão provisória: o carrinho é por loja; comprar de duas lojas gera dois pedidos.
- Motivo: o modelo de dados, o split e a entrega ficam simples.
- Alternativas descartadas por ora: carrinho multi-loja dividido em pedidos no checkout (fica para o futuro).

## 2026-10-16 — Premissa adotada: pagamento com split via gateway e sub-contas
- Contexto: a plataforma não deve guardar dinheiro do lojista em conta própria sem autorização regulatória.
- Decisão provisória: gateway de pagamento com sub-conta por loja e split automático; o servidor nunca vê dados de cartão.
- Motivo: conformidade e menos risco financeiro. O gateway específico é decidido pelo arquiteto; a taxa de pagamento é da loja, ao custo (decisão do dono, modelo de comissão).
- Alternativas descartadas por ora: receber tudo na conta da plataforma e repassar manualmente (risco regulatório e operacional).

## 2026-10-16 — Premissa adotada: a própria loja entrega no MVP
- Contexto: integrar entregadores sob demanda exige contrato, custo por corrida e tratamento de falhas; muitas lojas de rua já entregam com motoboy próprio ou contratado.
- Decisão provisória: a loja entrega com equipe própria ou motoboy que ela contrata; o app registra status, previsão e código de entrega. Integrações (Lalamove, Loggi, Uber Direct e similares) ficam para depois.
- Motivo: custo zero de logística para a plataforma e menos escopo no MVP.
- Alternativas descartadas por ora: frota própria; integração com entregadores desde o início. Pergunta em aberto para o dono.
- Complemento (decisão do dono, 2026-10-16): a retirada na loja entra no MVP; a integração com entregadores continua fora.

## 2026-10-16 — Decisão do dono: processo com equipe de agentes, Fase 1 sem a sessão do agente produto
- Contexto: o CLAUDE.md define o agente `produto` como sessão própria. O dono pediu para seguir o prompt e ignorar esse agente por enquanto.
- Decisão: a Fase 1 (documentos de produto e briefs) foi produzida pelo lead; os briefs ficaram em `rascunho` até o OK do dono, dado em 2026-10-16 com as respostas às perguntas em aberto. As demais fases seguem o fluxo do CLAUDE.md (designer, arquiteto, dev, qa, revisor, seguranca).
- Motivo: velocidade. Risco: os documentos nasceram sem a entrevista com o dono; por isso as premissas estão marcadas e listadas como perguntas.

## 2026-10-16 — Decisão do dono: segurança, confiabilidade e qualidade como requisitos do MVP
- Decisão: autenticação por perfil, tokens em armazenamento seguro do celular, LGPD, validação de entrada em todas as camadas; transações, idempotência em pedidos e pagamentos, migrações versionadas, auditoria de operações financeiras, backups; testes unitários no domínio, integração em casos de uso e repositórios, UI nos fluxos críticos e e2e, com meta de cobertura e CI que compila os apps; ADRs, README por módulo, lint e convenções.
- Motivo: o produto lida com dinheiro e dados pessoais desde o primeiro pedido.

## 2026-10-16 — Decisão do dono: arquitetura com DDD, Clean Architecture e monólito modular
- Decisão: bounded contexts (Catálogo, Pedidos, Pagamentos, Lojistas, Entregas, Identidade, Notificações) com agregados, entidades, value objects e eventos de domínio; monólito modular preparado para extrair serviços; API documentada consumida pelos apps e pelo painel; padrões (Repository, Factory, Strategy, Specification, Domain Events) só onde fizerem sentido.
- Motivo: manutenibilidade com equipe pequena, sem o custo de microsserviços no início.
- Alternativas descartadas: microsserviços desde o início (custo operacional alto para o estágio); CRUD sem fronteiras de domínio (vira dívida rápido em pagamentos e pedidos).
- Detalhamento: fica com o arquiteto, no plano da Fase 3, inclusive a escolha entre dois apps ou um app com perfis e entre multiplataforma e nativo.

## 2026-10-16 — Decisão do dono: identidade visual limpa e minimalista, azul primário e verde secundário
- Decisão: azul como cor primária (confiança), verde discreto como secundária; paleta em hex, tipografia, ícone, logo conceitual e design system mobile na Fase 2. Nome a escolher entre 8 a 10 sugestões com verificação de domínio `.com.br`, redes sociais e lojas de apps.
- Motivo: pedido do dono.

## 2026-10-16 — Decisão do dono: receita por comissão, 3% como ponto de partida
- Decisão: comissão por venda, começando em 3%, com análise de viabilidade comparando Mercado Livre, Shopee, Magalu e iFood e estimando custos; o percentual final pode ser menor ou virar modelo híbrido (comissão + mensalidade opcional). Captação com onboarding pelo celular, período sem taxa, cadastro assistido e importação de catálogo por foto ou planilha.
- Motivo: ser competitivo para o pequeno lojista.
- Onde está a análise: `docs/produto/analise-comissao.md`.
- Resolvida em 2026-10-16: ver "Decisão do dono: modelo de comissão".

## 2026-10-16 — Decisão do dono: três interfaces
- Decisão: painel do administrador (web), app do lojista (mobile) e app do consumidor (mobile), com os escopos descritos em `docs/produto/visao.md`, seção 8.
- Motivo: cada público tem contexto de uso diferente (computador para operar, celular para vender e comprar).

## 2026-10-16 — Decisão do dono: marketplace mobile do comércio local
- Decisão: aplicativo para Android e iOS que conecta consumidores aos comércios da própria cidade, com proposta de valor de proximidade e entrega no mesmo dia ou em horas. Público inicial: varejistas de rua (roupas, calçados, presentes, utilidades, pequenos mercados) e consumidores da mesma cidade.
- Motivo: os grandes marketplaces não servem bem o comércio local nem a entrega imediata; o WhatsApp não escala.
- Alternativas descartadas: site responsivo em vez de app (push, câmera, GPS e deep links funcionam melhor no app; o painel do admin, sim, é web).
