# Especificação de UI/UX: wireframes do painel web do administrador

- Fase 2, parte B. Rodada 1. Data: 2026-10-16. Brief `docs/produto/briefs/08-painel-admin.md` (aprovado); tokens, grid e componentes web de `00-design-system.md` (seção "Painel web"), citados pelo nome.
- Marca: Bairrin (`00-nome-e-identidade.md`, seção 2.7); logo horizontal no cabeçalho e no login, título da aba "<Tela> · Bairrin Painel". Referência 1280 px; cada tela tem nota para 1024 e 375 px (CA-102).
- Legenda: `[Botão]`, `[campo ▾]` lista suspensa, `( )` rádio, `①` anotação.

## Objetivo e usuário
O dono opera sozinho, no computador, várias vezes ao dia: precisa ver de relance o que exige ação (lojas na fila, pedidos atrasados, disputas), decidir com todas as informações na mesma tela e mexer em dinheiro com segurança e rastro. Densidade maior que nos apps, mas cada tela tem uma ação principal.

## Fluxo
P1 Login → (P1b Configurar 2FA, só na primeira vez) → P2 Painel inicial → cada indicador leva à lista filtrada: P3 Fila de aprovação, P4 Disputa, Pedidos, Lojas. P5 Comissões e P6 Relatórios pela barra lateral.

## Layout comum (1280 px)
```
┌────────────┬─────────────────────────────────────────────────────┐
│ Bairrin    │ Título da tela            🔔 3   Pedro ▾ (Sair)  ① │
│ ▣ Início ② │─────────────────────────────────────────────────────│
│ ▣ Aprovação 4                                                    │
│ ▣ Lojas    │   conteúdo (12 colunas, margem 32)                  │
│ ▣ Pedidos  │                                                     │
│ ▣ Disputas 2                                                     │
│ ▣ Catálogo │                                                     │
│ ▣ Avaliações                                                     │
│ ▣ Comissões│                                                     │
│ ▣ Relatórios                                                     │
│ ▣ Usuários │                                                     │
│ ▣ Configurações                                                  │
│ ▣ Auditoria│                                                     │
└────────────┴─────────────────────────────────────────────────────┘
```
① Barra superior: título (h1), sino com Badge dos alertas de CA-103 (abre lista; cada item some quando tratado), menu da conta. ② Barra lateral 240 px com Badges de contagem; item atual com fundo `bg.selected`, barra 3 px `blue.600` e marcado como página atual. Primeiro elemento da página: link "Pular para o conteúdo". Sessão expirando (CA-101): Modal aos 28 min "Sua sessão vai expirar em 2 min" + [Continuar conectado]; ao expirar, volta ao login preservando a URL.
- **1024 px:** barra lateral recolhida (72 px, só ícones com rótulo acessível e dica no foco e no hover).
- **375 px:** barra superior com "Menu" (gaveta), título e sino; conteúdo em 1 coluna.

## P1. Login com 2FA (CA-09, CA-101)
```
            ┌──────────────────────────────┐
            │ Bairrin · Painel             │
            │ E-mail   [                 ] │
            │ Senha    [            ] Mostrar
            │ [ Entrar                   ] │
            └──────────────────────────────┘
  passo 2:  ┌──────────────────────────────┐
            │ Código de verificação ①      │
            │ Abra o app autenticador e    │
            │ digite o código de 6 dígitos.│
            │ [ _ _ _ _ _ _ ]              │
            │ [ Verificar                ] │
            │ Usar um código de recuperação②
            └──────────────────────────────┘
```
Cartão centralizado de 400 px, fundo `bg.canvas`. ① Campo único de 6 dígitos (`autocomplete` de código único, teclado numérico), envia sozinho ao completar. ② Troca o campo por "Código de recuperação". Erros genéricos de propósito, com a mesma mensagem para senha errada, conta inexistente e bloqueio (CA-04): "Não foi possível entrar. Confira o e-mail e a senha ou tente de novo em alguns minutos."; no código: "Código inválido ou expirado. Confira o horário do celular." (detalhe em `01-fundacao-identidade.md`).
P1b Configurar 2FA (obrigatório antes de qualquer tela): passos numerados "1 de 3: Escaneie o QR code" (QR + "Não consegue escanear? Digite a chave" com chave em texto e botão "Copiar"), "2 de 3: Digite o código gerado", "3 de 3: Guarde os códigos de recuperação" (lista em fonte monoespaçada do sistema, [Baixar] [Copiar] e checkbox "Guardei os códigos em local seguro" que habilita [Concluir]).
- 1024 e 375: mesmo cartão, largura total menos 16 px no celular.

## P2. Painel inicial (CA-100, CA-80, CA-103)
```
┌─────────────────────────────────────────────────────────────────┐
│ Início                      Período: (•) Hoje ( ) 7 dias  ①     │
│ Precisa de atenção ②                                            │
│ ⚠ 3 pedidos atrasados  ⏱ 4 lojas em análise  ⚖ 2 disputas (1   │
│   [Ver]                  [Ver]                 atrasada) [Ver]  │
│ ┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────┐③  │
│ │Pedidos pagos││GMV          ││Lojas ativas ││Pedidos      │    │
│ │ 48          ││ R$ 6.214,30 ││ 27          ││atrasados 3  │    │
│ │▲ 12% vs ont.││▼ 4% vs ont. ││ = igual     ││▲ 2 vs ontem │    │
│ └─────────────┘└─────────────┘└─────────────┘└─────────────┘    │
│ ┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────┐    │
│ │Perdidos sem ││Não retirados││Disputas     ││Lojas em     │    │
│ │aceite 1     ││ 0           ││abertas 2    ││análise 4    │    │
│ └─────────────┘└─────────────┘└─────────────┘└─────────────┘    │
│ Atualizado às 14:32 · [Atualizar] ④                             │
└─────────────────────────────────────────────────────────────────┘
```
① Controle segmentado Hoje / 7 dias. ② Faixa de alertas: só aparece com algo a tratar; cada item é ícone + número + texto + link para a lista filtrada; tom de perigo para atrasados e disputas atrasadas, aviso para fila. Sem nada: "Tudo em dia por aqui." (sucesso, uma linha). ③ 8 Cards de indicador (CA-100), card inteiro clicável para a lista filtrada; a variação traz seta + texto, e para indicadores ruins (atrasados, perdidos, não retirados) "▲" usa tom de perigo, ou seja, a cor segue o sentido e o texto explica. ④ Atualiza sozinho a cada 60 s sem mexer no foco; anúncio só se um alerta novo surgir.
Estados: carregando (Skeleton dos 8 cards); erro em um card não derruba os outros ("Não carregou · Tentar de novo" dentro do card); primeiro dia sem dados: números "0" e texto "Sem pedidos ainda hoje".
- **1024:** 3 cards por linha. **375:** faixa de alertas primeiro, cards em 2 colunas compactas (rótulo + número), variação abaixo.

## P3. Fila de aprovação de lojas (CA-89, CA-27)
```
┌──────────────────────┬──────────────────────────────────────────┐
│ Aprovação  ①         │ Calçados Silva           (Em análise) ③  │
│ [Novas 3|Alterações 1]│ Enviada há 2 h · cadastro próprio       │
│ [🔍 Buscar loja    ] │ CNPJ 12.345.678/0001-90 [Consultar ↗] ④  │
│ ▸ Calçados Silva  ②  │ Razão social · Categoria · Telefone      │
│   há 2 h · Calçados  │ ┌ mapa com pino ┐ R. Cel. Hipólito, 340  │
│ ▸ Bazar da Praça     │ └───────────────┘ Centro                 │
│   há 1 d ⚠ atrasada  │ Entrega: raio 5 km · R$ 5 · 30–45 min    │
│ ▸ Mercadinho Bom     │ Retirada: sim · pronto em 20 min         │
│                      │ Horários ▾   Produtos (12) ▾ ⑤           │
│                      │ Checklist ⑥ ✓ horário ✓ entrega          │
│                      │             ✓ 1+ produto ✕ recebimento   │
│                      │ [Pedir ajuste] [Reprovar] [ Aprovar ] ⑦  │
└──────────────────────┴──────────────────────────────────────────┘
```
① Lista + detalhe (mestre-detalhe), lista com 360 px. Abas "Novas" e "Alterações" (CA-27), com contagem. ② Item da lista: nome, tempo de espera, categoria; mais de 1 dia útil com chip "Atrasada"; ordenada da mais antiga. ③ Chip de status. ④ Link externo abre em nova aba, avisado no rótulo ("abre em nova aba"). ⑤ Seções recolhíveis; produtos em grade de miniaturas com nome e preço. ⑥ Checklist de RN-02 com ícone + texto; item faltante não bloqueia aprovar, mas aparece em aviso ("A loja só aparece para clientes quando tiver todos os itens"). ⑦ "Aprovar" é a principal. "Reprovar" abre Modal com "Motivo (enviado ao lojista)" obrigatório; "Pedir ajuste" abre Modal com checkboxes dos campos + observação. Após decidir: Toast "Calçados Silva aprovada. Avisamos o lojista." e o foco vai para o próximo item.
Aba Alterações: mesmo layout, detalhe mostra "Antes → Depois" por campo (antes riscado em `text.secondary`, depois em semibold), aviso "Repasses desta loja estão suspensos até a decisão" e ações [Recusar alteração] [Aprovar alteração].
Estados: fila vazia "Nenhuma loja aguardando aprovação." ; nenhum item selecionado: "Escolha uma loja na lista".
- **1024:** lista 280 px, checklist em uma coluna. **375:** só a lista; tocar abre o detalhe em tela própria com "‹ Voltar"; ações disponíveis, mas com aviso "Revisar o catálogo funciona melhor no computador".

## P4. Detalhe de uma disputa (CA-96, CA-73, CA-75, CA-110)
```
┌─────────────────────────────────────────────────────────────────┐
│ ‹ Disputas / #D-118 · Pedido #4821   (Aberta) ⚠ decide até 21/10①
│ ┌──────────────────────────────┐ ┌───────────────────────────┐  │
│ │ Tipo: Não recebi ②           │ │ Decisão ⑤                 │  │
│ │ Aberta 16/10 15:20 (no prazo │ │ ( ) Estorno total          │  │
│ │ de 24 h)                     │ │     R$ 214,80             │  │
│ │ Entrega · Entregue SEM código│ │ ( ) Estorno parcial       │  │
│ │ ⚠ motivo: "cliente não       │ │     Valor [R$         ]   │  │
│ │ atendeu, deixei na portaria" │ │ ( ) Manter (sem estorno)  │  │
│ │ Repasse: retido ③            │ │ Justificativa (enviada às │  │
│ │ Mensagens ④                  │ │ duas partes) [          ] │  │
│ │ Ana S. 15:20 "Não chegou…"   │ │ Efeito: libera R$ 0,00 à  │  │
│ │ Loja 15:41 "Deixei com…" 📎  │ │ loja; estorna R$ 214,80 ⑥ │  │
│ │ Linha do tempo do pedido ▾   │ │ [ Registrar decisão     ] │  │
│ │ Itens e pagamentos ▾         │ └───────────────────────────┘  │
│ └──────────────────────────────┘                                │
└─────────────────────────────────────────────────────────────────┘
```
① Breadcrumb, chip de status e prazo de 3 dias úteis; vencido: chip de perigo "Atrasada". ② Tipo e prazo legal com a data de abertura. ③ Situação do repasse: "Retido" ou "Já repassado em 14/10" com aviso "A decisão será cobrada por estorno no gateway ou desconto no próximo repasse". ④ Mensagens das duas partes em ordem cronológica, com autor e hora; anexos abrem em visualizador com texto alternativo do nome do arquivo. Fatos que pesam (entregue ou retirado sem código, código validado) aparecem destacados em Banner de aviso ou de sucesso no topo do bloco. ⑤ Painel de decisão fixo à direita (380 px), rolando separado. Estorno parcial: valor validado (maior que zero e menor que o total, "Informe um valor entre R$ 0,01 e R$ 214,79"). ⑥ Resumo do efeito em texto, atualizado ao escolher. "Registrar decisão" abre Modal de confirmação com o resumo e [Confirmar decisão]; irreversível, avisado no texto.
Estados: decidida: painel de decisão vira resumo somente leitura (quem, quando, o quê) com link para a auditoria. Erro do gateway ao estornar: Banner de erro "O estorno não foi feito pelo gateway. A decisão está salva; tente o estorno de novo." + [Tentar de novo].
- **1024:** painel de decisão vai para baixo do conteúdo (1 coluna), com atalho "Ir para a decisão" no topo. **375:** leitura completa; decisão disponível, empilhada.

## P5. Configurações de comissão com histórico (CA-94, CA-70, CA-61)
```
┌─────────────────────────────────────────────────────────────────┐
│ Comissões                                                       │
│ Regras padrão ①                                    [Editar]     │
│ Percentual padrão       3%  (vigente desde 01/11/2026)          │
│ Próxima mudança         5% a partir de 01/11/2027 (agendada) ②  │
│ Comissão mínima         R$ 1,00 por pedido                      │
│ Taxa de pagamento       paga pela loja (ao custo)               │
│ Isenção de loja nova    90 dias do primeiro pedido pago         │
│ Exceções por loja ③     [🔍 loja] [+ Definir para uma loja]     │
│ Loja            Percentual  Isenção até   Desde                 │
│ Bazar da Praça  2%          —             10/10/2026  [Editar]  │
│ Histórico ④   [Período ▾] [Autor ▾]                             │
│ Data       Regra            Antes   Depois  Vigência   Autor    │
│ 16/10 14:02 Percentual pad.  3%     5%     01/11/2027  Pedro    │
└─────────────────────────────────────────────────────────────────┘
```
① Bloco de leitura; "Editar" abre formulário de página (não modal, por ser dinheiro): campos com unidade visível ("%", "R$", "dias"), texto de ajuda "Vale só para pedidos criados depois da vigência". ② Aumento do padrão exige "Vigência" com data mínima de hoje + 30 dias; data menor mostra erro "Aumentos precisam de 30 dias de aviso. Escolha a partir de 15/11/2026." e uma prévia "Os lojistas serão avisados em 16/10 com esta data". Confirmação por Modal com resumo antes → depois e campo "Motivo". ③ Tabela de exceções (percentual próprio, isenção com data final por loja). ④ Tabela de histórico somente leitura, mais recente primeiro, com paginação; sem ação de editar ou apagar.
Estados: salvando; sucesso: Toast "Regra salva. Vale para pedidos a partir de 15/11/2026."; histórico vazio: "Nenhuma mudança registrada ainda.".
- **1024:** tabelas escondem "Desde" e "Autor" (visíveis ao expandir a linha). **375:** leitura em cards; edição mostra "Edite comissões no computador" (não bloqueia, mas recomenda).

## P6. Relatórios (CA-95)
```
┌─────────────────────────────────────────────────────────────────┐
│ Relatórios   Período [01/10/2026 – 16/10/2026 ▾]               │
│ Modalidade (•)Todas ( )Entrega ( )Retirada   [Exportar CSV] ①   │
│ ┌──────────┐┌──────────┐┌──────────┐┌──────────┐ ②              │
│ │GMV       ││Pedidos   ││Comissão  ││Não cobrado│              │
│ │R$ 48.310 ││pagos 412 ││R$ 1.120  ││(isenção)  │              │
│ └──────────┘└──────────┘└──────────┘│R$ 330     │              │
│ Cancelados 9 · Estornados 7 · Taxas repassadas R$ 610 ·         │
│ Repasses feitos R$ 40.200 · pendentes R$ 5.770 ③                │
│ Por loja ④                                                      │
│ Loja ▲     Pedidos  GMV       Comissão  (mín.)  Isenção  Repasse│
│ Bazar da P.  38    R$ 3.900   R$ 117,00 R$ 4,00 —        R$ ... │
│ ...                                        1–25 de 27  ‹ ›      │
│ Total        412   R$ 48.310  R$ 1.120  R$ 31   R$ 330  R$ 45.970⑤
└─────────────────────────────────────────────────────────────────┘
```
① Filtros no topo; "Exportar CSV" secundário (exporta exatamente o que está filtrado; nome do arquivo com o período). Período com atalhos: Hoje, 7 dias, Este mês, Mês passado, Personalizado. ② Cards de indicador. ③ Linha de totais secundários em texto. ④ Tabela ordenável por qualquer coluna, valores alinhados à direita com algarismos tabulares, "(mín.)" = parcela da comissão mínima, com dica explicando. ⑤ Linha de total fixa ao pé da tabela.
Estados: gerando (Skeleton); período sem dados: "Nenhum pedido pago neste período."; período longo (mais de 12 meses): aviso "Pode demorar alguns segundos"; exportando: botão em carregando e Toast "CSV baixado".
- **1024:** a tabela mostra Loja, Pedidos, GMV, Comissão, Repasse; o resto aparece ao expandir a linha. **375:** cards de indicador em 2 colunas; tabela vira lista de cards por loja (nome, GMV, comissão); exportação disponível.

## Acessibilidade (painel)
- Cada tela com um único h1 (título da barra superior) e h2 por bloco; regiões nomeadas (navegação, principal).
- Tabelas com cabeçalho de coluna real, legenda e ordenação anunciada ("Ordenado por GMV, decrescente").
- Mestre-detalhe (P3): ao selecionar, o foco vai para o título do detalhe; "Voltar à lista" disponível pelo teclado.
- Modais de dinheiro prendem o foco e devolvem ao gatilho; Esc fecha sem confirmar.
- Nada só por cor: setas e texto nas variações, ícone + texto nos alertas.
- Atualizações automáticas (P2) não roubam o foco nem anunciam sem necessidade.

## O que o dev precisa implementar (além da apresentação)
- P1: autenticação em dois passos, TOTP, códigos de recuperação, limite de tentativas, expiração de sessão com aviso.
- P2: endpoints agregados por dia e 7 dias, comparação com o período anterior, alertas de CA-103 com marcação de "tratado".
- P3: fila com alterações pendentes, link de consulta de CNPJ, mapa estático, decisões com registro e aviso ao lojista.
- P4: mensagens e anexos das partes, estado do repasse, cálculo do efeito da decisão, estorno via gateway com nova tentativa, prazo de 3 dias úteis.
- P5: regras com vigência futura, validação dos 30 dias, histórico imutável, aviso aos lojistas.
- P6: relatório por período, loja e modalidade, totais que batem com os lançamentos, exportação CSV do filtro atual.
- Comum: auditoria de todas as ações (CA-99), autorização em todas as rotas (CA-101).

## Arquivos de apresentação afetados
Nenhum ainda (sem stack).

## Perguntas em aberto
1. ~~Nome da marca~~ Respondida em 2026-10-16: Bairrin.
2. Mestre-detalhe na fila de aprovação (proposto, mais rápido para decidir várias lojas) ou página separada por loja?
3. Editar comissão em página própria com confirmação (proposto) ou direto na tela, como formulário simples?
4. O painel inicial deve se atualizar sozinho a cada 60 s (proposto) ou só ao recarregar?
5. Prazo de "atrasada" na fila de aprovação: 1 dia útil (promessa da visão) está bom?
