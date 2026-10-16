# Especificação de UI/UX: wireframes das telas-chave dos apps (consumidor e lojista)

- Fase 2, parte B. Rodada 1. Data: 2026-10-16. Briefs aprovados 01 a 07; tokens e componentes de `00-design-system.md` (citados pelo nome, sem repetir); tom e formatos de `00-nome-e-identidade.md`.
- Marca: Bairrin, slogan "lojas do seu bairro" (`00-nome-e-identidade.md`, seção 2.7). Largura de referência 360 px; tudo funciona em 320 px e com texto em 200%.
- Legenda dos blocos: `[Botão]` botão, `( )`/`(•)` rádio, `[ ]` campo, `▾` abre folha inferior, `‹` voltar, `①` anotação.
- Regras que valem para todas as telas, para não repetir: offline mostra a Faixa offline e o último conteúdo (CA-38); carregamento com Skeleton só após 300 ms; erro de carga vira Estado vazio com "Tentar de novo"; nomes longos quebram em 2 linhas e depois reticências, com o texto completo no rótulo acessível; a ação principal fica fixa no rodapé quando a tela rola.

## Objetivo e usuário
Ana precisa ir de "abri o app" a "paguei e sei quando chega (ou quando buscar)" em poucos toques, com uma mão. Seu Carlos precisa ver o pedido na hora, aceitar em um toque e cadastrar produto entre um cliente e outro.

## Fluxo
Consumidor: C1 Localização → C2 Home → C3 Produto → C4 Carrinho → C5 Checkout (revisão) → C6 Pix → C7 Acompanhamento → C8 Avaliar. C9 Cadastro aparece quando a pessoa sem conta toca "Fechar pedido" (o app deixa navegar e montar carrinho sem conta).
Lojista: L1 Pedidos ⇄ L2 Detalhe do pedido; L3 Cadastrar produto (aba Produtos); L4 Financeiro; L5 Status da loja (barra superior de Pedidos e aba Loja).

## App do consumidor

### C1. Localização e endereço (CA-29, CA-30)
Objetivo: definir o ponto de entrega sem travar. Entrada: primeiro acesso, ou tocar o endereço na barra superior da home. Saída: home com lojas daquele ponto.
```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ ①     (ilustração de pino)   │   │ ‹  Onde você está?           │
│ Veja as lojas perto de você  │   │ [🔍 CEP ou rua e número    ] ④│
│ Usamos sua localização só    │   │ ⌖ Usar minha localização ⑤   │
│ para mostrar lojas que       │   │ ─ Endereços salvos ───────── │
│ entregam onde você está.     │   │ ⌂ Casa · R. das Flores, 120 ⑥│
│                              │   │ ▣ Trabalho · Av. Brasil, 9   │
│ [ Usar minha localização ] ② │   │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│   Digitar endereço       ③   │   │ (confirmação: mapa + pino)  ⑦│
└──────────────────────────────┘   └──────────────────────────────┘
```
① Tela de explicação antes do pedido de permissão do sistema (só uma vez). ② Ação principal: dispara a permissão do sistema. ③ Botão terciário, mesmo peso de escolha, nunca escondido. ④ Campo de busca com sugestões; CEP com máscara `99999-999`. ⑤ Item de lista; se a permissão foi negada, abre explicação + "Abrir configurações". ⑥ Itens de lista com rótulo (Casa, Trabalho, Outro); selecionado com check. ⑦ Depois de escolher: mapa pequeno com pino arrastável e campos "Número", "Complemento", "Ponto de referência" e rótulo em Chips de filtro; ação "Salvar endereço" (logado) ou "Usar este endereço" (sem login, fica só no celular).
Estados: buscando localização ("Procurando você…", até 10 s, depois sugere digitar); GPS impreciso (>200 m) pede confirmação no mapa; endereço sem nenhuma loja: home com Estado vazio (ver C2); offline: busca desabilitada com a razão, endereços salvos continuam selecionáveis.
A11y: o mapa é complementar; o endereço em texto é sempre a fonte; pino arrastável também ajustável por "Ajustar no mapa" com botões de direção para quem não arrasta.

### C2. Home com seletor Entrega | Retirar (CA-31, CA-32, CA-105)
Objetivo: mostrar o que existe perto. Entrada: abrir o app. Saída: loja, produto, categoria ou busca.
```
┌──────────────────────────────┐
│ Entregar em R. das Flores ▾ ①│ 🔔
│ ┌──────────┬───────────────┐ │
│ │ Entrega ✓│ Retirar na loja│②│
│ └──────────┴───────────────┘ │
│ [🔍 Buscar produtos e lojas ]③│
│ (Roupas)(Calçados)(Presentes)④→
│ Lojas perto de você          │
│ ┌──────────────────────────┐ │
│ │▣ Calçados Silva          │⑤│
│ │ 1,2 km · 30–45 min · R$ 5│ │
│ │ ★ 4,7 (32)               │ │
│ └──────────────────────────┘ │
│ … abertas, depois fechadas ⑥ │
│ [ Ver carrinho · 2 · R$ 89,90]⑦
│ Início  Buscar  Pedidos  Conta│
└──────────────────────────────┘
```
① Barra superior com endereço; no modo Retirar o texto vira "Perto de R. das Flores ▾". ② Controle segmentado de 2 opções (alvo 44, selecionado com check + fundo `bg.selected`, lembrado entre sessões); trocar recarrega a lista e anuncia "Mostrando lojas com retirada". ③ Campo de busca que abre a tela de busca. ④ Chips de categoria em uma linha rolável com o último chip parcialmente visível (indica rolagem) e "Ver todas" no fim. ⑤ Card de loja (CA-31). No modo Retirar, a linha de metadados vira "1,2 km · pronto em cerca de 20 min" e a segunda linha "R. Coronel Hipólito, 340". ⑥ Fechadas e pausadas depois das abertas, com cabeçalho "Fechadas agora". ⑦ Barra fixa do carrinho, só com itens.
Estados: carregando (3 Skeletons de card de loja); vazio no modo Entrega: "Ainda não há lojas que entregam neste endereço." + "Ver lojas com retirada" (se houver) + "Trocar endereço"; vazio no Retirar: "Nenhuma loja com retirada por perto." + "Ver lojas com entrega"; offline: lista em cache com Faixa offline. Conteúdo longo: nome de loja em 2 linhas; taxa "Entrega grátis acima de R$ 80,00" quebra linha, não corta.
A11y: ordem de foco endereço → seletor → busca → categorias → lista → carrinho → navegação; cada card lido como uma frase.

### C3. Página de produto (CA-34, CA-36, CA-41, CA-42)
Objetivo: escolher variação e adicionar. Entrada: card de produto, busca ou link. Saída: carrinho ou continuar comprando.
```
┌──────────────────────────────┐
│ ‹                    ⤴ compart.│
│ ┌──────────────────────────┐ │
│ │   foto 1:1      2 de 5  ①│ │
│ └──────────────────────────┘ │
│ Tênis Casual Couro           │
│ R$ 189,90                  ② │
│ Cor: Preto                   │
│ (■ Preto ✓)(■ Marrom)        │
│ Tamanho: escolha ③           │
│ (37)(38)(39)(~40~ esgotado)  │
│ Descrição (mostrar mais) ④   │
│ ┌ Calçados Silva  ★ 4,7    ┐⑤│
│ └ 1,2 km · 30–45 min · R$ 5┘ │
│ Escolha o tamanho para       │
│ continuar ⑥                  │
│ [ Adicionar ao carrinho    ] │
└──────────────────────────────┘
```
① Carrossel de fotos. ② Preço `font.title`; com variações de preço diferente: "R$ 169,90 a R$ 189,90" até escolher. ③ Seletor de variações; o preço e o estoque se atualizam ao escolher; "Só restam 2" em `amber.700` quando estoque ≤ 3. ④ Descrição recolhida após 4 linhas. ⑤ Bloco da loja (toque abre a loja); no modo Retirar: "Retirada: pronto em cerca de 20 min". ⑥ Razão do botão desabilitado, ligada ao botão para o leitor de tela. Após adicionar: Toast "Adicionado ao carrinho" com ação "Ver carrinho"; o botão volta ao normal (permite adicionar outro).
Estados: loja não entrega aqui (CA-36): Banner de aviso no topo "Esta loja não entrega no seu endereço" + "Trocar endereço" e, se houver retirada, "Retirar na loja"; botão desabilitado. Loja fechada: Banner "Fechada · abre às 08:00. Você pode olhar os produtos."; botão desabilitado. Combinação esgotada: "Esse tamanho acabou. Escolha outro.". Carrinho de outra loja (CA-41): Modal de confirmação "Seu carrinho tem itens da Loja A" / "Cada pedido é de uma loja só. Quer trocar?" / [Trocar de loja] [Manter carrinho]. Produto pausado (link antigo): Estado vazio "Este produto não está mais à venda" + "Ver a loja".

### C4. Carrinho (CA-42 a CA-44)
```
┌──────────────────────────────┐
│ ‹ Carrinho · Calçados Silva  │
│ Tênis Casual · Preto, 39     │
│ R$ 189,90      [−] 1 [+]  ①  │
│ Meia ·  Branca  indisponível ②│
│ ──────────────────────────── │
│ Subtotal            R$ 209,80│
│ Entrega             R$ 5,00 ③│
│ Total               R$ 214,80│
│ Chega em 30–45 min           │
│ Faltam R$ 20,20 para o pedido│
│ mínimo desta loja ④          │
│ [ Fechar pedido            ] │
└──────────────────────────────┘
```
① Campo de quantidade; no limite: "Só restam 3". ② Item indisponível em `text.tertiary` com chip "Indisponível", fora do total, ação "Remover". ③ "Grátis" quando atinge o "grátis acima de"; no modo Retirar a linha some e aparece "Retirada na loja · pronto em cerca de 20 min". ④ Só no modo Entrega (CA-44); botão desabilitado com essa razão. Vazio: Estado vazio "Seu carrinho está vazio" + "Ver lojas perto".

### C5. Checkout com revisão (CA-45, CA-47, CA-106)
Objetivo: confirmar tudo em uma tela. Entrada: "Fechar pedido" (pede login/cadastro C9 se preciso). Saída: Pix (C6) ou cartão (formulário do gateway).
```
┌──────────────────────────────┐
│ ‹ Revisar pedido             │
│ Como receber ①               │
│ (•) Entrega · R$ 5,00        │
│ ( ) Retirar na loja · grátis │
│ Entregar em ②                │
│ Casa · R. das Flores, 120  ▾ │
│ Telefone de contato ③        │
│ [(35) 99999-1234           ] │
│ Observação (opcional) 0/200  │
│ [                          ] │
│ Pagamento ④                  │
│ (•) Pix  ( ) Cartão de crédito│
│ Itens (2) ▾        R$ 209,80 │
│ Entrega               R$ 5,00│
│ Total               R$ 214,80│
│ [ Confirmar pedido · R$ 214,80]⑤
└──────────────────────────────┘
```
① Escolha da modalidade só se a loja tem retirada (pré-selecionada pelo modo da home; "Entrega" só aparece se a loja entrega no endereço). ② Folha inferior de endereços; endereços fora do raio aparecem desabilitados com "Fora da área desta loja". Em Retirar, este bloco vira: "Você vai retirar na loja" (título), endereço completo com link "Abrir no mapa", horário de hoje e "Pronto em cerca de 20 min"; sem taxa nem pedido mínimo. ③ Campo telefone, pré-preenchido da conta. ④ Rádios; cartão salvo aparece como "Cartão final 4242". ⑤ Ação principal com o total; ao tocar: estado carregando, bloqueia toque duplo (CA-46).
Estados: preço ou estoque mudou (CA-47): Folha inferior "Alguns itens mudaram" listando antes → agora, com [Revisar carrinho]. Erro de rede ao confirmar: Banner de erro "Não conseguimos confirmar. Seu pedido não foi feito. Tente de novo." (o app reenvia com a mesma chave). E-mail não verificado: Banner "Confirme seu e-mail para fazer pedidos" + "Reenviar e-mail".

### C6. Pagamento Pix (CA-57, CA-48, CA-68)
```
┌──────────────────────────────┐
│ ✕ Pague com Pix              │
│ Pedido #4821 · R$ 214,80     │
│      ┌──────────┐            │
│      │ QR code  │ ①          │
│      └──────────┘            │
│ [ Copiar código Pix        ]②│
│        29:41                 │
│      para pagar ③            │
│ ⟳ Aguardando o pagamento…    │
│ Como pagar ▾ ④               │
└──────────────────────────────┘
```
① e ③ Contagem do Pix. ② Ação principal no celular (quem paga no mesmo aparelho copia e cola): botão primário aqui, já que o QR serve só a quem tem outro aparelho. ④ Passos em 3 linhas ("Abra o app do seu banco", "Escolha Pix copia e cola", "Cole o código e confirme"). Fechar (✕): Modal "Sair sem pagar?" / "O pedido fica aguardando até 14:32. Você pode voltar em Pedidos." / [Continuar pagando] [Sair].
Estados: gerando (até 3 s: Skeleton do QR + "Gerando o Pix…"); falha do gateway: Estado vazio "Não conseguimos iniciar o pagamento. Tente de novo." + [Tentar de novo]; confirmado → troca para tela de sucesso "Pagamento confirmado. Avisamos a loja." + [Acompanhar pedido]; expirado → "O prazo do Pix acabou e o pedido foi cancelado. Nada foi cobrado." + [Fazer o pedido de novo].

### C7. Acompanhamento do pedido (CA-54, CA-56, CA-71 a CA-75, CA-80, CA-109, CA-53)
```
┌──────────────────────────────┐   Retirada (pronto para retirar):
│ ‹ Pedido #4821   (Saiu p/ ent)│  ┌──────────────────────────────┐
│ Chega até 15:10 ①            │   │ Pronto! Retire até amanhã 18h│
│ Entregador: João             │   │ Código de retirada           │
│ Código de entrega            │   │      4 8 2 1                 │
│      7 3 0 5   ②             │   │ R. Cel. Hipólito, 340        │
│ Mostre ao entregador         │   │ [Abrir no mapa] Hoje 8h–18h  │
│ ●─ Pago 14:20                │   └──────────────────────────────┘
│ ●─ Aceito 14:22              │
│ ●─ Em preparação             │
│ ◉─ Saiu para entrega 14:41 ③ │
│ ○  Entregue                  │
│ [ Falar com a loja ] ④       │
│ Itens, endereço, pagamento ▾⑤│
│ Recebeu o pedido? ⑥          │
└──────────────────────────────┘
```
① Previsão `font.title` (aceite + X min); atraso (CA-80): Banner de aviso acima "A loja está atrasada; previsão atualizada em breve". ② Código de entrega `font.display`, lido dígito a dígito. ③ Linha do tempo do status do pedido, com os passos de retirada quando for o caso (Em preparação → Pronto para retirar → Retirado). ④ Botão secundário, só depois do aceite (CA-56); abre WhatsApp ou telefone. ⑤ Seções recolhíveis com itens, endereço, forma de pagamento e "Ver comprovante". ⑥ Depois de "Entregue": [Recebi o pedido] (primário) e "Não recebi" (terciário, até 24 h, com o prazo "até amanhã 14:50"); após a conclusão, "Produto errado ou com defeito" até 7 dias (abre folha inferior com tipo, descrição e foto opcional) e "Avaliar pedido" (C8). Antes do aceite: "Cancelar pedido" (terciário destrutivo, Modal de confirmação "O valor volta integral pelo mesmo meio"); depois do aceite: "Preciso de ajuda".
Estados: atualização em tempo real (CA-74): ao mudar status, a linha anima (sem animação com movimento reduzido) e anuncia "Status: saiu para entrega"; offline: último estado + Faixa offline + "Atualizado às 14:41"; cancelado ou expirado: chip de status no topo + motivo + "O estorno de R$ 214,80 foi pedido; cai em até X dias".

### C8. Avaliar pedido (CA-82, CA-83)
```
┌──────────────────────────────┐
│ ✕ Como foi sua compra?       │
│ Calçados Silva               │
│ ☆ ☆ ☆ ☆ ☆  ①                 │
│ Produtos (opcional)          │
│ Tênis Casual  ☆☆☆☆☆          │
│ Comentário (opcional) 0/500 ②│
│ [                          ] │
│ Seu nome aparece como "Ana S."③
│ [ Enviar avaliação         ] │
└──────────────────────────────┘
```
① Nota de 1 a 5 como grupo de rádios (5 alvos de 44 px, rótulos "1 estrela, péssimo" a "5 estrelas, ótimo"); texto da nota aparece ao escolher ("Ótimo"). Botão desabilitado até a nota da loja. ② Campo de texto com contador. ③ Aviso de privacidade (CA-87). Sucesso: Toast "Obrigado! Sua avaliação foi publicada." e volta ao pedido, que mostra "Editar avaliação (até 48 h)".

### C9. Cadastro com telefone (CA-01)
```
┌──────────────────────────────┐
│ ‹ Criar conta                │
│ Nome  [                    ] │
│ E-mail [                   ] │
│ Celular com DDD ①            │
│ [(35) 99999-1234           ] │
│ Usamos para a loja falar com │
│ você sobre o pedido.         │
│ Senha [            ] Mostrar │
│ ✓ 8 caracteres ou mais ②     │
│ [✓] Li e aceito os Termos e a│
│ Política de Privacidade ③    │
│ [ Criar conta              ] │
│ Já tenho conta · Entrar      │
└──────────────────────────────┘
```
① Campo telefone com o motivo da coleta logo abaixo (LGPD). ② Regras da senha marcadas conforme digita. ③ Checkbox 44 px, links abrem o texto sem perder o que foi digitado. Erros por campo ao enviar ("Informe o celular com DDD"); nunca revelar que o e-mail já tem conta (CA-02: a resposta é sempre a tela de confirmação; detalhe em `01-fundacao-identidade.md`); foco vai ao primeiro erro. Sucesso: tela de confirmação com código de 6 dígitos (A3 de `01-fundacao-identidade.md`). Teclados: e-mail, telefone numérico; preenchimento automático do sistema habilitado.

## App do lojista

### L1. Pedidos por abas com alerta de pedido novo (CA-55, CA-76, CA-80, CA-81)
```
┌──────────────────────────────┐
│ Calçados Silva  ● Aberta  ①  │
│ Pausar pedidos         [◯ ]  │
│▓ Pedido novo! Aceite em até ▓②
│▓ 15 min.        [Ver pedido]▓│
│ Novos 1 │Em prep. 2│A caminho│③
│ ou pronto 1 │ Concluídos     │
│ ┌──────────────────────────┐ │
│ ┃ #4821 · Novo  🛵 Entrega ④│ │
│ ┃ 2 itens · R$ 214,80      │ │
│ ┃ Aceite em 12 min         │ │
│ ┃ [Recusar]   [Aceitar]  ⑤ │ │
│ └──────────────────────────┘ │
│ Pedidos  Produtos  Financ. Loja│
└──────────────────────────────┘
```
① Estado da loja (L5) com ponto + texto. ② Alerta de pedido novo, com som e vibração até decidir. ③ Abas roláveis com contagem (Badge); rótulo completo "A caminho ou pronto". ④ Card de pedido com chip de status e chip de modalidade (Entrega ou Retirada) sempre visíveis; atrasados no topo com a marca "Atrasado · 18 min". Sem dados pessoais na lista (CA-56). ⑤ Ações rápidas no próprio card só na aba Novos; "Aceitar" é a principal.
Estados: vazio por aba ("Nenhum pedido novo. Deixe o app aberto: avisamos com som quando chegar."); sem permissão de notificação: Banner de erro fixo "Ative as notificações para não perder pedidos" + [Ativar]; mudança feita offline (CA-81): chip "Enviando…" no card e, se rejeitada, Toast "O pedido #4821 já foi cancelado pelo cliente. Mostramos o estado atual."

### L2. Detalhe do pedido com ações de status (CA-50, CA-71, CA-72, CA-75, CA-107, CA-108, CA-109, CA-110, CA-56)
```
┌──────────────────────────────┐
│ ‹ Pedido #4821 (Em preparação)│
│ 🛵 Entrega · até 15:10 ①     │
│ Ana S. · (35) 99999-1234 ☎ ② │
│ R. das Flores, 120, ap 3     │
│ Ref.: perto da padaria       │
│ Obs.: "Embrulhar p/ presente"│
│ 1× Tênis Casual · Preto, 39  │
│ Total R$ 214,80 · Pix pago   │
│ Você recebe R$ 206,35 ▾ ③    │
│ [ Saiu para entrega        ]④│
│   Preciso cancelar           │
└──────────────────────────────┘
```
① Modalidade e previsão em destaque. ② Telefone e endereço só após o aceite (CA-56), com botões "Ligar" e "WhatsApp". ③ Detalhe: produtos, comissão, taxa de pagamento, líquido. ④ Uma ação principal por status:
- Novo: [Aceitar pedido] + "Recusar" (destrutivo secundário) → Folha inferior de motivo (rádios: Sem estoque, Loja fechada, Fora da área, Outro com campo) + [Recusar pedido], com "O cliente recebe o valor de volta e vê este motivo."
- Em preparação (entrega): [Saiu para entrega] → Folha inferior com "Nome do entregador (opcional)" e "Chega por volta de" (sugerido) + [Confirmar saída].
- Saiu para entrega: [Marcar como entregue] → Folha inferior "Digite o código que o cliente mostrou" (4 campos numéricos) + [Confirmar entrega]; link "Entregue sem código" pede motivo e avisa "O cliente poderá contestar por 24 h".
- Em preparação (retirada): [Pronto para retirada]. Pronto: [Cliente retirou] → mesmo código de 4 dígitos; "Retirado sem código" com motivo. Após 24 h pronto (CA-108): ação extra "Não retirado" (destrutivo) com Modal "O valor volta integral ao cliente e o estoque volta à loja.".
Erros: código errado "Código não confere. Peça ao cliente para mostrar de novo." (3 tentativas, depois só "sem código"). Telefone some 7 dias após a conclusão (texto "Contato disponível até 23/10").

### L3. Cadastrar produto com câmera e variações (CA-19 a CA-22, CA-24)
```
┌──────────────────────────────┐
│ ‹ Novo produto      Rascunho │
│ [📷][foto][foto][ + ] 3/5 ①  │
│ Nome  [               ] 0/80 │
│ Preço [R$             ]      │
│ Categoria [Calçados       ▾] │
│ Descrição (opcional) 0/1000  │
│ Variações ②                  │
│ Tamanho: (37)(38)(39)(+)     │
│ Cor: (Preto)(Marrom)(+)      │
│ Estoque e preço por opção ▾ ③│
│ [ Publicar produto         ]④│
│   Salvar rascunho            │
└──────────────────────────────┘
```
① Primeira caixa abre a câmera direto (galeria como segunda opção); fotos reordenáveis por arrastar e por botões "Mover para a esquerda/direita"; a primeira é a capa; enviando: barra de progresso por foto; campo opcional "Descrição da foto" (texto alternativo). ② "Adicionar variação" cria eixo Tamanho ou Cor com chips editáveis. ③ Lista de combinações (Preto 37, Preto 38…) com estoque (Campo de quantidade) e preço opcional; atalho "Mesmo estoque para todas". Sem variação: um único campo "Estoque". ④ Desabilitado até foto, nome, preço, categoria e estoque, com a lista do que falta; loja ainda não aprovada: "Será publicado quando sua loja for aprovada".
Estados: offline (CA-24): salvar fica "Pendente de envio" com chip no produto e envio automático; foto rejeitada: erro na miniatura "Esta foto não pôde ser usada. Tente outra."; sair com alterações: Modal "Salvar como rascunho?".

### L4. Financeiro (CA-63, CA-70)
```
┌──────────────────────────────┐
│ Financeiro                   │
│ Disponível     A receber     │
│ R$ 1.240,50    R$ 830,00  ①  │
│ Próximo repasse: seg 20/10   │
│ ▓ Isenção: sem comissão até ▓②
│ ▓ 15/01. Você economizou    ▓│
│ ▓ R$ 96,30.                 ▓│
│ [Últimos 30 dias ▾] Exportar③│
│ Lançamentos | Repasses  ④    │
│ #4821 · 16/10       +R$ 206,35│
│ Bruto 214,80 · Comissão 0,00 │
│ Taxa Pix 2,15 ...            │
└──────────────────────────────┘
```
① Dois indicadores lado a lado (empilham com texto em 200%), com "O que é isso?" que explica cada saldo em linguagem simples. ② Banner informativo durante a isenção; 7 dias antes do fim vira aviso: "Sua isenção termina em 15/01. Nos últimos 90 dias você vendeu R$ X; a comissão seria R$ Y." ③ Período em folha inferior; "Exportar CSV" secundário. ④ Controle segmentado. Repasse falho: chip de erro + "Confira seus dados de recebimento". Dados bancários pendentes (CA-27): Banner "Repasses suspensos até aprovarmos seus novos dados". Vazio: "Nenhuma venda no período".

### L5. Status da loja e pausar pedidos (CA-28, CA-104)
Entrada: interruptor em L1 ou aba Loja. Pausar abre Folha inferior: "Pausar novos pedidos" / motivo opcional (Chips: Muito movimento, Sem entregador, Outro) / "Até quando?" (Por 30 min, Por 1 h, Até eu reativar, Até amanhã) / [Pausar pedidos] + texto "Os pedidos em andamento continuam." Pausada: o topo de L1 mostra chip de aviso "Pausada até 16:30" + [Reativar] (primário). Aba Loja: lista com Horários, Entrega, "Oferecer retirada na loja" (interruptor; ao ligar, Folha inferior com "Tempo de preparo (min)" e o aviso "Seu endereço completo passará a aparecer para os clientes" + [Ativar retirada]), "Não faço entrega" (habilitado só com retirada ativa, com essa razão), Dados de recebimento (status em chip), Notificações.
A11y: estado da loja sempre em texto, não só pelo ponto; o interruptor anuncia "Pausar pedidos, desligado".

## Acessibilidade (transversal)
- Alvos de 44 px; códigos de 4 dígitos com campos individuais que aceitam colar e anunciam "dígito 2 de 4".
- Ordem de leitura acompanha a visual; ação fixa do rodapé vem antes da navegação inferior.
- Status sempre com ícone + texto; prazos com hora absoluta além do relativo ("até 15:10", "Aceite em 12 min").
- Alerta do lojista: som + vibração + texto; respeita o modo silencioso do sistema? Ver pergunta 4.

## O que o dev precisa implementar (além da apresentação)
- C1: permissão de localização, geocodificação e busca por CEP, endereço local sem login. C2: modo Entrega/Retirar persistido e passado a todas as consultas. C3/C4: disponibilidade por combinação, troca de loja do carrinho, cálculo de totais e mínimo. C5: idempotência na confirmação, detecção de mudança de preço/estoque. C6: cobrança Pix, atualização em até 5 s, expiração. C7: atualização em tempo real, contestação com prazos, comprovante, links para WhatsApp/telefone/mapa. C8: regras de janela e edição de 48 h. C9: validação de telefone, aceite versionado, e-mail de verificação.
- L1: push com som distinto e repetição até a decisão, contagem por aba, fila offline. L2: transições por modalidade, validação de código, prazos de "não retirado" e de visibilidade do telefone. L3: câmera, compressão, upload com progresso, combinações de variação, rascunho offline. L4: saldos, filtros, CSV, aviso de isenção. L5: pausa com prazo, ativação de retirada.

## Arquivos de apresentação afetados
Nenhum ainda (sem stack). Atualizei `00-design-system.md`: chips de status para "pronto para retirada", "retirado", "não retirado" e chip de modalidade.

## Perguntas em aberto
1. ~~Nome e slogan~~ Respondida em 2026-10-16: Bairrin, "lojas do seu bairro". Na tela de boas-vindas antes de C1, o logo empilhado vem acompanhado do slogan.
2. Navegar e montar carrinho sem conta, pedindo cadastro só em "Fechar pedido" (proposto) ou cadastro logo no início?
3. No Pix, "Copiar código" como ação principal (proposto, pois a maioria paga no mesmo celular) em vez do QR?
4. Alerta de pedido novo deve tocar mesmo com o celular no silencioso (exige permissão especial no Android e "alerta crítico" no iOS, sujeito à Apple)?
5. Ações rápidas Aceitar/Recusar direto no card da aba Novos (proposto) ou só no detalhe?
6. Opções de "Até quando?" ao pausar: as quatro propostas bastam?
