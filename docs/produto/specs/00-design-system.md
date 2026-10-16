# Especificação de UI/UX: design system (apps mobile e bases do painel web)

- Fase 2 (design), parte A. Rodada 1. Data: 2026-10-16.
- Base: `docs/produto/visao.md`, `docs/produto/decisoes.md`, seções "Interface" dos briefs 01 a 08. Paleta, tipografia e tom de voz: `docs/produto/specs/00-nome-e-identidade.md`.
- Escopo: tokens, componentes e regras. Os wireframes por tela vêm na parte B.
- Nomes de token são neutros em relação à tecnologia (`grupo.papel.variação`); o arquiteto escolhe como gerá-los.

## Objetivo e usuário

Uma base única para três interfaces: app do consumidor (Ana, com pressa, uma mão, conexão ruim), app do lojista (Seu Carlos, Android intermediário, atendendo balcão ao mesmo tempo) e painel web do admin (computador, desktop primeiro). Prioridades: legibilidade sob sol e com pressa, alvo de toque grande, nada de tela em branco, status sempre claro.

## Fluxo

Não se aplica (fluxos nas specs por tela). Regra transversal: toda ação tem retorno em até 100 ms (estado pressionado) e resultado visível (toast, mudança de estado ou erro com saída).

## Layout (mobile e desktop)

- Mobile: margem lateral `space.4` (16 px); entre blocos `space.6`; largura de referência 360 px; funciona de 320 px sem rolagem horizontal. Área segura respeitada (notch, barra de gestos).
- Uma ação principal por tela, fixa no rodapé quando a tela rola (ex.: "Adicionar ao carrinho", "Ir para pagamento").
- Web: ver seção "Painel web".

## Tokens

### Cor (camada semântica; os valores vêm da paleta)

| Token semântico | Valor |
|---|---|
| `color.bg.canvas` | `neutral.50` |
| `color.bg.surface` | `neutral.0` |
| `color.bg.subtle` | `neutral.100` |
| `color.bg.selected` | `blue.100` |
| `color.text.primary` | `neutral.900` |
| `color.text.secondary` | `neutral.600` |
| `color.text.tertiary` | `neutral.500` (legenda, placeholder) |
| `color.text.onAction` | `neutral.0` |
| `color.text.onSelected` | `blue.800` (chip de filtro selecionado sobre `bg.selected`; 8,16:1) |
| `color.text.link` | `blue.600` |
| `color.border.subtle` | `neutral.200` (decorativa) |
| `color.border.control` | `neutral.400` (campos, checkbox; 3:1) |
| `color.action.primary` / `.pressed` | `blue.600` / `blue.700` |
| `color.action.destructive` / `.pressed` | `red.600` / `red.700` |
| `color.focus.ring` | `blue.600` |
| `color.status.success.bg` / `.fg` / `.solid` | `green.50` / `green.700` / `green.600` |
| `color.status.warning.bg` / `.fg` / `.solid` / `.onSolid` | `amber.50` / `amber.700` / `amber.500` / `neutral.900` (único texto que passa sobre `solid`; 7,52:1) |
| `color.status.danger.bg` / `.fg` / `.solid` | `red.50` / `red.700` / `red.600` |
| `color.status.info.bg` / `.fg` / `.solid` | `blue.50` / `blue.700` / `blue.600` |
| `color.status.neutral.bg` / `.fg` | `neutral.100` / `neutral.700` |
| `color.overlay.scrim` | `neutral.900` com 48% de opacidade |
| `color.banner.offline` | `neutral.800` |
| `color.toast.bg` | `neutral.700` (texto `text.onAction`; 10,28:1) |
| `color.nav.indicator` | `blue.50` (pílula atrás do ícone da aba ativa; decorativa, ícone `text.link` passa de 3:1) |

Componentes usam só tokens semânticos, nunca a paleta direto. Isso prepara o modo escuro.

### Tipografia
`font.caption` 12/16, `font.body-sm` 14/20, `font.body` 16/24, `font.title-sm` 18/24, `font.title` 22/28, `font.display` 28/36. Pesos `font.weight.regular` 400 e `font.weight.semibold` 600. Família `font.family.base` = fonte do sistema (ver identidade). Mínimo para texto essencial: 14 px.

### Espaçamento (escala de 4 px)
`space.0` 0 · `space.1` 4 · `space.2` 8 · `space.3` 12 · `space.4` 16 · `space.5` 20 · `space.6` 24 · `space.8` 32 · `space.10` 40 · `space.12` 48 · `space.16` 64.

### Raio
`radius.sm` 4 (chip pequeno, badge) · `radius.md` 8 (campo, botão) · `radius.lg` 12 (card) · `radius.xl` 16 (folha inferior, modal) · `radius.full` 9999 (avatar, chip de filtro, pílula).

### Elevação
| Token | Sombra | Uso |
|---|---|---|
| `elevation.0` | nenhuma, borda `border.subtle` | Cards em lista (padrão: mais leve para celular fraco) |
| `elevation.1` | 0 1 2 rgba(21,25,32,.08) | Barra superior ao rolar, card em hover (web) |
| `elevation.2` | 0 4 12 rgba(21,25,32,.12) | Barra fixa de ação, toast, menu |
| `elevation.3` | 0 8 24 rgba(21,25,32,.16) | Folha inferior, modal |

### Tamanho e alvo
`size.touch.min` 44 (mobile; nenhum alvo menor) · `size.touch.web` 32 (painel) · `size.touch.webMin` 24 (mínimo absoluto no painel) · `size.icon.sm` 16 · `size.icon.md` 20 · `size.icon.lg` 24 · `size.control.height` 48 (mobile) / 40 (web) · `size.bottomNav.height` 64 + área segura.

### Movimento
`motion.duration.fast` 120 ms (pressionar, alternar) · `motion.duration.base` 200 ms (toast, chips) · `motion.duration.slow` 300 ms (folha inferior, troca de tela) · `motion.duration.reduced` 0 ms (valor com movimento reduzido) · `motion.easing.standard` cubic-bezier(.2,0,0,1) · `motion.easing.exit` cubic-bezier(.4,0,1,1).
No painel, o CSS gerado zera `--duracao-fast/base/slow` com `prefers-reduced-motion: reduce`; no nativo, o `mobile-base` lê a preferência do sistema. Com `prefers-reduced-motion` (ou "remover animações" no iOS/Android): durações viram 0 ms ou só troca de opacidade de até 120 ms; skeleton sem brilho deslizante; carrossel sem rolagem automática; nada pisca mais de 3 vezes por segundo.

### Breakpoints (web)
`bp.sm` 0–767 · `bp.md` 768–1023 · `bp.lg` 1024–1279 · `bp.xl` 1280+.

## Componentes

| Componente | Existente ou novo | Onde fica |
|---|---|---|
| Todos abaixo | Novo (não há código) | Biblioteca de componentes base, compartilhada pelos dois apps; painel com equivalentes web usando os mesmos tokens |

Estados de referência (valem para todo componente interativo, salvo nota):
- **Pressionado:** cor `.pressed` ou fundo `bg.subtle`; sem depender só de animação.
- **Foco (teclado, leitor de tela, controle externo):** anel 2 px `focus.ring` com 2 px de respiro (`neutral.0`) por fora; nunca removido.
- **Desabilitado:** fundo `bg.subtle`, texto `text.tertiary` (4,58:1, legível); exposto como desabilitado para leitor de tela; a razão aparece perto ("Escolha o tamanho para continuar").
- **Carregando:** indicador no próprio componente, mesma largura, rótulo para leitor de tela ("Carregando"); bloqueia toque duplo.

### Botões
| Variante | Visual | Uso |
|---|---|---|
| Primário | Fundo `action.primary`, texto branco, semibold 16, altura 48, `radius.md` | Uma por tela |
| Secundário | Fundo `bg.surface`, borda 1 px `action.primary`, texto `text.link` | Ação alternativa ("Pagar com cartão") |
| Terciário | Só texto `text.link`, alvo 44 de altura | "Ver todas", "Pular" |
| Destrutivo | Fundo `action.destructive`, texto branco; em listas, terciário vermelho | "Recusar pedido", "Excluir" |
Estados: pressionado; foco; desabilitado; carregando (rótulo dá lugar ao indicador e ao texto "Enviando…" para leitor de tela); sucesso (ícone de check 1 s, depois o resultado na tela). Conteúdo longo: o rótulo quebra em 2 linhas, nunca corta; rótulo sempre verbo + objeto. Ícone sozinho só com rótulo acessível e alvo 44×44.

### Campos
Base: rótulo acima (sempre visível, nunca só placeholder), campo 48 px, borda `border.control`, `radius.md`, texto de ajuda abaixo em `body-sm`.
- **Estados:** foco (borda 2 px `focus.ring`); erro (borda `status.danger.solid`, ícone de alerta + mensagem em `status.danger.fg` abaixo, anunciada ao leitor de tela, dizendo como corrigir); sucesso (só quando útil, ex.: CNPJ validado: ícone check verde + "CNPJ encontrado"); desabilitado; somente leitura (sem borda, fundo `bg.subtle`).
- **Texto:** contador de caracteres quando houver limite ("120/500").
- **Senha:** botão "Mostrar senha"/"Ocultar senha" de 44×44 dentro do campo; regras listadas antes de digitar, marcadas com ícone conforme cumpridas.
- **Telefone:** máscara `(99) 99999-9999` aplicada enquanto digita; teclado numérico; cola com ou sem máscara aceita.
- **CNPJ:** máscara `99.999.999/9999-99`; teclado numérico; "carregando" enquanto consulta.
- **Busca:** ícone de lupa, botão "Limpar" (44×44) quando há texto, teclado com ação "Buscar"; sugestões recentes abaixo.
- **Seleção:** em mobile abre folha inferior com lista de opções (rádio), nunca lista suspensa pequena; no painel, lista suspensa nativa.
- **Quantidade (stepper):** botões "−" e "+" 44×44 com rótulos "Diminuir quantidade"/"Aumentar quantidade", valor no meio anunciado ao mudar; "−" vira lixeira ("Remover item") na quantidade 1; "+" desabilitado no limite de estoque com texto "Máximo disponível: 3".

### Cards
- **Loja (CA-31):** logo 48 px (`radius.md`), nome (`title-sm`, até 2 linhas), linha de metadados em `body-sm` com ícone + texto: "1,2 km · 30–45 min · R$ 5,00" (ou "Entrega grátis acima de R$ 80,00"), nota "★ 4,7 (32)" ou chip "Loja nova". Estado aberta: sem selo (é o normal). Fechada: chip neutro com ícone de relógio "Fechada · abre às 08:00", logo com 60% de opacidade e card ordenado depois das abertas; pausada: chip de aviso com ícone de pausa "Pausada". O texto nunca depende só da opacidade. Toque inteiro abre a loja; rótulo de leitor de tela lê nome, estado, distância, tempo, taxa e nota em uma frase.
- **Produto:** foto 1:1 (`radius.lg`, fundo `bg.subtle` enquanto carrega), nome (2 linhas e reticências), preço `body` semibold ("R$ 129,90" ou "a partir de R$ 89,90"), nome da loja em `body-sm` quando listado fora da loja. Esgotado: chip neutro "Esgotado". Foto ausente: ícone neutro de sacola em vez da foto.
- **Pedido:** número curto ("#4821"), loja ou cliente, chip de status, total, horário; no lojista, tempo restante para aceitar ou previsão. Atrasado (CA-80): borda esquerda 4 px `status.danger.solid` + chip de perigo com ícone de alerta "Atrasado · 18 min", ordenado no topo da aba.

### Chips e badges de status de pedido (CA-52, CA-55)
Modalidade (CA-55): chip neutro com ícone de moto "Entrega" ou de loja "Retirada", sempre visível no card do pedido.
Chip: altura 28, `radius.full`, ícone 16 + texto `body-sm` semibold. Cor reforça, nunca é o único sinal.

| Status | Texto (consumidor / lojista) | Ícone (conceito) | Tom |
|---|---|---|---|
| aguardando pagamento | Aguardando pagamento | relógio | aviso |
| novo | Enviado à loja / Novo | sino | informação |
| em preparação | Em preparação | pacote | informação |
| saiu para entrega | Saiu para entrega | moto ou caminhão | informação |
| pronto para retirada | Pronto para retirar | sacola | sucesso |
| retirado | Retirado | sacola com check | sucesso |
| entregue | Entregue | check | sucesso |
| concluído | Concluído | check duplo | neutro |
| cancelado | Cancelado | x em círculo | perigo |
| expirado | Expirado (pagamento não feito) | relógio cortado | neutro |
| não retirado | Não retirado (estornado) | sacola cortada | neutro |
| em disputa | Em análise | balança ou escudo | aviso |
| atrasado (marca extra) | Atrasado · N min | alerta triangular | perigo |

Badge de contagem (abas e ícones): círculo `status.danger.solid` com número `text.onAction` 12 px semibold, mínimo 20 px; "99+" acima de 99; leitor de tela: "Pedidos, 3 novos".

Chip de filtro (categorias, avaliações): `radius.full`, alvo 44 de altura (chip visual 32 + área de toque), selecionado com fundo `bg.selected`, texto `text.onSelected` e ícone de check (não só cor).

### Lista e separadores
Item de lista: mínimo 56 px (uma linha) ou 72 px (duas linhas), área de toque inteira, ícone à esquerda, seta à direita quando navega. Separador 1 px `border.subtle` com recuo igual à margem do texto. Grupos com cabeçalho `body-sm` semibold `text.secondary`. Lista longa carrega por partes com skeleton no fim; fim da lista sem texto extra.

### Barra superior
Altura 56, fundo `bg.surface`, título `title-sm` (até 1 linha e reticências; o título completo é o nome acessível), voltar à esquerda (44×44, "Voltar"), até 2 ações à direita (ex.: compartilhar, notificações com badge). Ao rolar, ganha `elevation.1`. Na home do consumidor, a barra mostra o endereço atual ("Entregar em Rua das Flores, 120 ▾"), que abre a escolha de endereço.

### Navegação inferior
4 abas, ícone 24 + rótulo `caption` semibold sempre visível; aba ativa com ícone preenchido, texto `text.link` e indicador em pílula `nav.indicator` atrás do ícone (forma + cor). Tocar a aba ativa volta ao topo.
- **Consumidor:** Início · Buscar · Pedidos (badge com pedidos em andamento) · Conta. O carrinho não é aba: quando há itens, aparece a barra fixa "Ver carrinho · 2 itens · R$ 89,90" acima da navegação (porque o carrinho é por loja, RN-01).
- **Lojista:** Pedidos (badge com novos; aba inicial) · Produtos · Financeiro · Loja (dados, horários, entrega, pausar pedidos). O estado da loja ("Aberta", "Pausada", "Fechada") fica sempre visível na barra superior de Pedidos, com interruptor "Pausar pedidos".

### Folha inferior e modais
- **Folha inferior:** para escolha (variação, endereço, filtro, motivo de recusa). `radius.xl` no topo, alça visível, fecha arrastando, tocando no fundo ou no botão "Fechar"; foco preso dentro e devolvido ao elemento que abriu; título anunciado; altura até 90% da tela, conteúdo rola por dentro, ação principal fixa no rodapé.
- **Modal de confirmação:** só para ações destrutivas ou irreversíveis. Título com a pergunta ("Recusar o pedido #4821?"), texto com a consequência, botões com verbos ("Recusar pedido" / "Voltar"). Ação segura em destaque visual quando a destrutiva for grave.

### Toasts e banners
- **Toast:** fundo `toast.bg`, texto `text.onAction`, ícone por tipo; aparece acima da navegação, some em 4 s (6 s se tiver ação "Desfazer"); pausa com foco ou toque; anunciado como status educado (polite). Erro que exige ação nunca é toast: vira banner ou erro de campo.
- **Banner em linha:** fundo e texto do tom semântico, ícone, título curto, ação opcional, botão "Fechar" quando dispensável.
- **Faixa offline (CA-38):** faixa fixa logo abaixo da barra superior, fundo `banner.offline`, ícone de wi-fi cortado, texto "Você está offline. Mostrando o que foi carregado por último." Não cobre conteúdo (empurra), não some sozinha enquanto offline, botão "Tentar de novo" 44 px. Ao voltar: a faixa sai e um toast de sucesso "Conectado de novo" aparece; o conteúdo atualiza sozinho sem perder a rolagem. Ações que exigem rede ficam desabilitadas com a razão ("Sem conexão: tente quando voltar"). Nunca tela em branco nem texto técnico.
- **Alerta de pedido novo (CA-55, lojista):** banner fixo no topo de qualquer tela do app, fundo `status.info.solid`, texto `text.onAction` "Pedido novo! Aceite em até 15 min." + botão "Ver pedido"; som e vibração repetem até aceitar ou recusar; o card do pedido fica com borda esquerda `status.info.solid` e contador "Aceite em 12 min". Não depende só do som (texto visível) nem só da cor.

### Skeletons
Blocos `bg.subtle` com a forma do conteúdo final (card de loja, grade de produtos, linha de pedido), `radius` igual ao componente. Brilho suave de 1,2 s; sem brilho com movimento reduzido. Leitor de tela: um único anúncio "Carregando lojas". Mostrar só após 300 ms (antes disso, nada) e no máximo até o conteúdo ou o erro chegar. Se houver cache, mostrar o cache em vez do skeleton.

### Estados vazios
Ícone simples 48 px `neutral.500`, título `title-sm` dizendo o que falta, uma frase do porquê e uma ação primária ou secundária. Exemplos: "Seu carrinho está vazio" + "Ver lojas perto"; "Nenhum pedido novo" (lojista) + texto "Deixe o app aberto: avisamos com som quando chegar."; "Nenhum produto ainda" + "Cadastrar primeiro produto".
Erro de carregamento: mesmo formato, título "Não conseguimos carregar as lojas", ação "Tentar de novo".

### Carrossel de fotos (CA-34)
Fotos 1:1 em largura total, deslizar horizontal, indicador "2 de 5" em texto (além dos pontos), botões anterior/próximo acessíveis para leitor de tela e teclado; tocar abre a foto em tela cheia com zoom e "Fechar". Sem rolagem automática. Foto quebrada: placeholder neutro com ícone. Texto alternativo: ver Acessibilidade.

### Seletor de variações (CA-34)
Um grupo por atributo (ex.: "Tamanho", "Cor"), título com o valor escolhido ("Tamanho: 39"). Opções em chips de 44 px de altura (texto; cor com amostra + nome). Estados: disponível; selecionado (fundo `bg.selected`, borda 2 px `focus.ring`, check); esgotado na combinação (texto riscado + "esgotado" para leitor de tela, ainda focável para informar, não selecionável); obrigatório não escolhido ao tentar avançar (mensagem de erro do grupo "Escolha o tamanho"). Botão "Adicionar ao carrinho" desabilitado até tudo escolhido ou com a combinação esgotada, com a razão visível acima dele. Muitas opções: quebra em linhas, nunca rolagem horizontal escondida.

### Contagem regressiva do Pix (CA-57)
Bloco central: QR code (mín. 200 px, fundo branco com margem), botão secundário "Copiar código Pix" (vira "Código copiado" com check por 3 s + toast), contagem em `font.display` "29:41" com rótulo "para pagar". Abaixo dos 5 min: tom de aviso + texto "Faltam menos de 5 minutos". Leitor de tela: não anuncia a cada segundo; anuncia ao abrir, a cada 5 min, em 1 min e ao expirar. Esperando: indicador discreto "Aguardando o pagamento…". Confirmado: a tela troca sozinha para ícone de sucesso + "Pagamento confirmado. Avisamos a loja." (anúncio assertivo). Expirado: ícone neutro + "O prazo do Pix acabou e o pedido foi cancelado. Nada foi cobrado." + "Fazer o pedido de novo". Offline durante a espera: faixa offline; a contagem continua pelo relógio local.

### Linha do tempo do status do pedido
Vertical, um passo por status do ciclo (CA-52). Cada passo: ícone em círculo 24 px + texto + horário. Concluído: ícone check `status.success.solid`, linha sólida. Atual: círculo `status.info.solid` preenchido, texto semibold, marcado como passo atual para leitor de tela ("Em preparação, etapa atual, 14:05"). Próximo: círculo vazado `border.control`, texto `text.tertiary`, linha tracejada. Cancelado, expirado ou em disputa: o passo final troca pelo status de saída em tom correspondente, com o motivo abaixo. Atraso (CA-80): banner de aviso acima da linha "A loja está atrasada; previsão atualizada em breve". Previsão e código de entrega em destaque acima da linha (código em `font.display`, algarismos espaçados, "Mostre este código ao entregador").

## Painel web

- **Tokens:** os mesmos; `size.control.height` 40; alvo mínimo 32 (24 absoluto); fonte base 16 em formulários, 14 em tabelas densas.
- **Grid:** barra lateral + conteúdo. ≥1280: barra lateral expandida 240 px (ícone + rótulo), conteúdo em 12 colunas, gutter 24, margem 32, largura máxima 1440. 1024–1279: barra lateral recolhida 72 px (só ícones, com rótulo acessível e dica ao passar o mouse e ao focar; botão "Expandir menu" a sobrepõe), gutter 16. <768: barra lateral vira menu em gaveta aberto por botão "Menu" na barra superior; 4 colunas, margem 16.
- **Tabela:** cabeçalho fixo ao rolar, colunas ordenáveis com ícone de direção e estado anunciado, linha com altura 48, número alinhado à direita com algarismos tabulares, status em chip. Filtros em barra acima (busca + até 4 filtros + "Limpar filtros", com chips dos filtros ativos). Paginação abaixo: "1–25 de 312", anterior/próxima, tamanho da página. Estados: carregando (skeleton de linhas), vazio ("Nenhuma loja aguardando aprovação"), vazio por filtro ("Nada com esses filtros" + "Limpar filtros"), erro com "Tentar de novo". Em 1024: colunas de baixa prioridade ocultas (marcadas na spec de cada tela) e acessíveis no detalhe. Em 375: cada linha vira card empilhado com os 3–4 campos principais (CA-102: legível para consulta).
- **Formulários:** rótulo acima, uma coluna até 640 px de largura (duas colunas só para pares curtos, como CEP e número, em ≥1024); ações no rodapé alinhadas à direita ("Salvar alterações" primário, "Cancelar" terciário); erros por campo e resumo no topo com links para cada campo ao enviar; aviso ao sair com alterações não salvas.
- **Indicadores do painel inicial:** cards com rótulo `body-sm`, número `font.display`, variação com seta + texto ("+12% vs. semana passada", nunca só cor), link "Ver detalhes". Linha de alertas no topo: pedidos atrasados (CA-80), lojas aguardando aprovação, disputas abertas, cada um com contagem e link. 1280: 4 cards por linha; 1024: 3 ou 2; 375: 1 por linha, alertas primeiro.
- **CA-102:** nenhuma tela com rolagem horizontal em 1280 e 1024; tabelas largas reduzem colunas, não rolam a página. Em 375, ações complexas (cadastro assistido, configurações) podem mostrar o aviso "Esta tela funciona melhor no computador", sem bloquear a leitura.

## Modo escuro

Premissa: MVP só no tema claro. Os componentes usam apenas tokens semânticos, então o tema escuro é um segundo mapa de valores (ex.: `bg.canvas` → `neutral.900`, `text.link` → `blue.300`, que dá 8,07:1 sobre `neutral.900`). **Pergunta ao dono:** o modo escuro entra no MVP ou depois?

## Ícones

Proposta: **Lucide** (licença ISC, ~1.500 ícones de traço 2 px, pacotes para web e mobile, visual limpo que combina com a identidade). Alternativa: Phosphor (MIT, vários pesos, inclusive preenchido, útil para a aba ativa). **Exige aprovação; sem aprovação, nada entra.** Regras: traço uniforme, `size.icon.*`, cor herdada do texto; ícone decorativo oculto do leitor de tela; ícone que é a única informação tem rótulo.

## Estados

Cada componente acima lista os seus. Matriz mínima para o QA visual: padrão, pressionado, foco, desabilitado, carregando, erro, sucesso, vazio, conteúdo longo (nome de loja de 60 caracteres, produto de 120, preço de R$ 99.999,99, 99+ pedidos), texto do sistema em 200%, largura 320 px, offline.

## Textos da interface

Já listados nos componentes; tabela de microcopy e regras de formato (moeda, distância, hora) na identidade, seção 2.6. Os textos devem viver no arquivo de textos ou traduções que o arquiteto definir (sugestão: um arquivo por app, chaves por tela, pt-BR como único idioma no MVP).

## Acessibilidade

- **Contraste:** só combinações da tabela 2.3 da identidade; proibidas listadas lá.
- **Foco visível** em todo elemento interativo (anel 2 px + respiro); ordem de foco igual à ordem visual: barra superior → conteúdo → ação fixa → navegação inferior.
- **Rótulos:** todo campo com rótulo visível e associado; botões de ícone com nome acessível; estados (selecionado, desabilitado, expandido, atual) expostos pelo componente nativo de cada plataforma antes de qualquer atributo extra.
- **Ordem de leitura:** card lido como uma frase; preço lido "129 reais e 90 centavos" (deixar o leitor de tela do sistema formatar a moeda).
- **Alvo de toque:** 44×44 no celular, sempre; 24×24 mínimo no painel (32 recomendado); 8 px entre alvos vizinhos.
- **Movimento reduzido:** ver tokens de movimento.
- **Texto ampliado:** layout testado com fonte do sistema em 200%; nada de altura fixa em texto.
- **Fotos de produto:** texto alternativo gerado como "Foto 2 de 5 de Tênis Casual Couro, cor preta" a partir do nome e da variação; o lojista pode escrever uma descrição opcional ("Descreva a foto para quem usa leitor de tela"); logo de loja: "Logo da Calçados Silva"; fotos puramente decorativas ocultas.
- **Tempo:** o prazo de aceite (lojista) e o Pix (consumidor) são limites do negócio; avisar antes e mostrar o tempo restante em texto.
- **Mensagens dinâmicas:** toasts educados (polite); pagamento confirmado, pedido novo e erros bloqueantes assertivos.

## O que o dev precisa implementar

1. Arquivo único de tokens (fonte da verdade) com paleta, camada semântica, tipografia, espaço, raio, elevação, tamanho, movimento e breakpoints, gerando o formato de cada plataforma (apps e painel).
2. Tema claro ligado aos tokens semânticos, com o mapa escuro deixado vazio para depois.
3. Componentes base: Botão (4 variantes), Campo (texto, senha, telefone, CNPJ, busca, seleção, quantidade), Card (loja, produto, pedido), Chip de status e de filtro, Badge, Item de lista, Barra superior, Navegação inferior (consumidor e lojista), Folha inferior, Modal de confirmação, Toast, Banner, Faixa offline, Alerta de pedido novo, Skeleton, Estado vazio, Carrossel, Seletor de variações, Contagem do Pix, Linha do tempo.
4. Painel: layout com barra lateral responsiva, Tabela com filtros e paginação, Formulário, Card de indicador.
5. Utilitários de formato pt-BR: moeda, distância, hora, telefone e CNPJ com máscara.
6. Detecção de movimento reduzido e de conexão, expostas aos componentes.
7. Uma página ou tela de catálogo interno dos componentes com todos os estados (para revisão visual do designer e do QA).

## Arquivos de apresentação afetados

Nenhum ainda. Depois da escolha da stack: arquivo de tokens, tema, pasta de componentes base de cada app e do painel, arquivo de textos.

## Perguntas em aberto

1. Modo escuro no MVP ou depois? (premissa: depois)
2. Aprova Lucide como conjunto de ícones (ou Phosphor)? Exige aprovação.
3. Fonte do sistema (recomendada) ou Inter? Inter exige aprovação.
4. Os dois apps (consumidor e lojista) serão separados ou um app com perfis? Muda a navegação inferior (decisão do arquiteto).
5. Som do alerta de pedido novo: usar som padrão do sistema ou criar um som próprio da marca?
6. O painel precisa funcionar em tablet (768–1023) como alvo, ou só 1024+ e 375 para consulta, como diz o CA-102?
