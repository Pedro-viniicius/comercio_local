# Especificação de UI/UX: nome e identidade visual

**Nome escolhido: Bairrin (2026-10-16). Identidade aprovada.** (fonte do sistema, paleta, ícone de pino com toldo e ponto verde)

- Fase 2 (design), parte A. Rodada 1. Data: 2026-10-16.
- Base: `docs/produto/visao.md` (personas Ana, Seu Carlos e admin), `docs/produto/decisoes.md` (azul primário para confiança, verde discreto secundário, limpo e minimalista).
- Complemento: `docs/produto/specs/00-design-system.md` (tokens e componentes).
- Status: proposta para o dono escolher o nome e aprovar a identidade. Nada aqui foi verificado em registro de domínio, INPI, redes ou lojas de apps; isso vem depois, a partir da tabela da seção 1.3.

## Objetivo e usuário

O nome e a marca precisam funcionar em três contextos: na tela inicial do celular da Ana (ícone pequeno, ao lado de iFood e Shopee), no adesivo com QR code na vitrine do Seu Carlos (lido de longe, falado no balcão: "baixa o ___ que eu entrego hoje") e na boca das pessoas (indicação entre vizinhos). Por isso: nome curto, que se fala do jeito que se escreve, que lembra "perto" e "da cidade", e uma marca que pareça confiável (dinheiro e dados) sem parecer banco.

## 1. Nomes

### 1.1 Critérios usados
1. Fácil de falar e de escrever depois de ouvir (teste do balcão: alguém escuta e acha na loja de apps).
2. Sensação de local e de proximidade, sem depender da cidade piloto.
3. Convidativo e simples; nada de sigla nem inglês.
4. Distante de iFood, Rappi, OLX, Enjoei, Elo7, Shopee, Magalu, Mercado Livre (e de Daki, app de mercado rápido, que descartou "Daqui").
5. Curto o bastante para caber sob o ícone (até ~10 caracteres sem corte no Android e iOS).

### 1.2 Candidatos

Primeira leva (1 a 15) verificada em `docs/produto/specs/00-verificacao-nomes.md`; os descartados ficam riscados para registro. Segunda leva (16 a 25) verificada no mesmo arquivo.

| # | Nome | Pronúncia | Significado ou associação | Por que soa local | Possível fraqueza | Verificação (2026-10-16) |
|---|---|---|---|---|---|---|
| 1 | Logali | lo-ga-LI | "Logo ali", como o mineiro e o interiorano indicam um lugar perto | Expressão do dia a dia do interior; promete distância curta | Pode ser escrito "Logo Ali" ou "Logaly"; precisa de registro das variações | Médio: `.com.br` ocupado (alternativo livre); Logali Group (SAP, classe 42) e app na Play; soa como Loggi |
| 2 | ~~Pertinho~~ (descartado) | per-TI-nho | "Perto" com carinho | Diminutivo afetivo, tom de vizinho | Palavra comum: domínio exato e marca provavelmente ocupados; registro de marca mais fraco | **Alto, descartado:** app homônimo nas duas lojas, handle ocupado, "Pertinho de Casa" no segmento |
| 3 | Bairrin | bai-RIM | "Bairrinho" no falar mineiro | Remete ao bairro e à loja da esquina | Grafia sem "o" pode gerar dúvida ("Bairrim"? "Bairrinho"?) | Médio (limite com baixo): os dois `.com.br` livres; `bairrin.com` tem projeto homônimo sobre proximidade |
| 4 | Comprali | com-pra-LI | "Compra ali" | Fala de quem indica a loja do lado | Lembra "Compra Certa" e similares; precisa conferir colisão | Médio: `.com.br` registrado em 2026-05 por terceiro (sem site); app antigo homônimo de lista de compras |
| 5 | ~~Vizin~~ (descartado) | vi-ZIM | "Vizinho" encurtado | Relação de vizinhança, confiança pessoal | Fonética "Vizim" vs. grafia "Vizin"; pode soar como app de condomínio | **Alto, descartado:** Vizin já é marketplace de comércio local (Cascavel), com app e empresa |
| 6 | Esquina | es-KI-na | A loja da esquina | Imagem universal do comércio de rua | Palavra comum; domínio exato quase certamente ocupado; usar com sufixo | Médio: `esquinaapp.com.br` livre, mas palavra genérica cercada de derivados no comércio; fraca no INPI |
| 7 | ~~Darua~~ (descartado) | da-RU-a | "Da rua": loja de rua, comércio de rua | Nomeia exatamente o público lojista | "Da rua" também significa "de fora de casa" e pode soar informal demais | **Alto, descartado:** `.com.br` em uso ativo por empresa de mídia exterior (classe 35) |
| 8 | ~~Chegaí~~ (descartado) | che-ga-Í | "Chega aí": convite e promessa de entrega hoje | Gíria amigável, fala de vizinho | Acento no nome complica domínio e busca; sem acento vira "Chegai" | **Alto, descartado:** projeto homônimo com app e perfil (ingressos em eventos) |
| 9 | Aquiperto | a-ki-PER-to | "Aqui perto" | Diz a proposta de valor sem explicar | Longo (9 letras) e descritivo, marca menos distinta | Médio: `.com.br` principal em disputa de registro; "Tem Aqui Perto" no mesmo segmento |
| 10 | ~~Vitrinha~~ (descartado) | vi-TRI-nha | Vitrine pequena, a vitrine da loja no celular | Lembra a vitrine da loja de rua | Confunde com "vitrine" na fala; pode soar só catálogo, não entrega | **Alto, descartado:** dois serviços Vitrinha ativos, um lançado em 2026-10-11 para pequenos negócios |
| 11 | Pracinha | pra-SI-nha | A praça central, onde fica o comércio | Toda cidade média tem a sua | Lembra lazer mais do que compra; palavra comum | Médio: `.com.br` ocupado (alternativo livre); nome de município paulista e termo comum |
| 12 | ~~Balcão~~ (descartado) | bal-CÃO | O balcão da loja, atendimento de pessoa para pessoa | Comércio tradicional, de confiança | "ã" no domínio vira "balcao"; palavra comum; usado por outros negócios | **Alto, descartado:** "BalcãoApp" com domínio e handle; nome saturado |
| 13 | ~~Tô Perto~~ (descartado) | tô PER-to | "Estou perto", na voz da loja | Coloquial, direto | Dois termos e acento; grafia varia ("To Perto", "Toperto") | **Alto, descartado:** TôPerto.com, marketplace local em piloto |
| 14 | Uailoja | uai-LO-ja | "Uai" mineiro + loja | Forte identidade mineira | Trade-off: é regional; soa estranho fora de MG e limita a expansão | Médio: `.com.br` com resposta ambígua (conferir no Registro.br); sem homônimos; regionalismo limita a expansão |
| 15 | Paraíso Já | pa-ra-Í-so JÁ | Cidade piloto + entrega hoje | Imediato para São Sebastião do Paraíso | Trade-off: não escala para outras cidades; exigiria rebatizar ou virar submarca | Baixo: todos os domínios livres, sem homônimos; continua não escalando para outras cidades |
| 16 | Centrin | cen-TRIM | "Centrinho": o centro da cidade, onde fica o comércio de rua | Toda cidade tem o seu centro; o "-in" é o falar mineiro e do interior | Grafia "Centrim"; pode lembrar "centro de distribuição" | Médio: `.com.br` principal ocupado sem uso (alternativo livre); `.com` só com homônimo de saúde na China |
| 17 | Ruali | ru-a-LI | "Rua ali": a loja da rua de perto | Junta o comércio de rua e a distância curta | Pode ser lido "Rualí" ou "Ruáli"; pouco usual na fala | Médio: `.com.br` registrado em 2025-01 por terceiro, sem uso (alternativo livre); `.com` à venda |
| 18 | Pertali | per-ta-LI | "Perto, ali" | Proximidade dita duas vezes, jeito de interior | Lembra "Pertinho" (descartado) e Logali pela terminação | Baixo: todos os domínios e lojas livres; atenção à semelhança com Pertinho no INPI |
| 19 | ~~Lojin~~ (descartado) | lo-JIM | "Lojinha" no falar mineiro | Afetivo, a lojinha do bairro | Pode soar pequeno demais para mercado e calçados; grafia "Lojim" | **Alto, descartado:** `lojin.com.br` em uso ativo (venda de ingressos) |
| 20 | Cidadin | ci-da-DIM | "Cidadezinha": o comércio da sua cidade | Fala da cidade sem dizer qual; escala para qualquer município | Três sílabas com "d" repetido; pode soar diminutivo de "cidadão" | Médio (limite com baixo): os dois `.com.br` livres; `.com` é marca de remédios na Índia (outro ramo) |
| 21 | ~~Temali~~ (descartado) | te-ma-LI | "Tem ali": o que você procura existe aqui perto | É a frase que o vizinho diz ("tem ali na loja do Carlos") | Pode ser lido "Tê-máli"; homônimo de molho georgiano (tkemali), sem relação | **Alto, descartado:** app "TemAli" de ofertas locais nas duas lojas, lançado em 2026-10-09 |
| 22 | ~~Achali~~ (descartado) | a-cha-LI | "Acha ali": encontrar perto | Descoberta local, conversa de balcão | "Achar" pode puxar para classificados ou achados e perdidos | **Alto, descartado:** diretório de negócios locais de Cuiabá no ar em `achali.com.br` |
| 23 | Comprin | com-PRIM | "Comprinha" mineiro | Compra pequena do dia a dia, afetiva | Muito próximo de Comprali (médio) e de "compra" genérico | Baixo: todos os domínios e lojas livres; radical "compr-" saturado e próximo de Comprali |
| 24 | Ruazin | ru-a-ZIM | "Ruazinha": a rua do comércio | Imagem da rua de lojas da cidade média | "z" e "s" confundem na escrita ("Ruasin") | Baixo: todos os domínios, handle e lojas livres; nada parecido encontrado |
| 25 | Pegali | pe-ga-LI | "Pega ali": buscar na loja ou receber já | Conversa com a retirada na loja, que entrou no MVP | "Pegar" tem conotação informal; pode soar só retirada | Baixo: `.com.br` livres; `.com` só redireciona a um blog pessoal |

### 1.3 Tabela para verificação de disponibilidade

Para cada nome, verificar o domínio principal e a alternativa, o handle no Instagram (e o mesmo no TikTok) e a busca do nome na Google Play e na App Store. Alternativas usam o sufixo "app" ou "loja".

| # | Nome | Domínio `.com.br` sugerido | Alternativa de domínio | Handle Instagram | Nome nas lojas de apps | Verificação (2026-10-16) |
|---|---|---|---|---|---|---|
| 1 | Logali | logali.com.br | logaliapp.com.br | @logali.app | Logali: lojas da sua cidade | Médio: `.com.br` ocupado (alternativo livre); Logali Group (SAP, classe 42) e app na Play; soa como Loggi |
| 2 | ~~Pertinho~~ (descartado) | pertinho.com.br | pertinhoapp.com.br | @pertinho.app | Pertinho: compre perto | **Alto, descartado:** app homônimo nas duas lojas, handle ocupado, "Pertinho de Casa" no segmento |
| 3 | Bairrin | bairrin.com.br | bairrinapp.com.br | @bairrin.app | Bairrin: lojas do seu bairro | Médio (limite com baixo): os dois `.com.br` livres; `bairrin.com` tem projeto homônimo sobre proximidade |
| 4 | Comprali | comprali.com.br | compraliapp.com.br | @comprali.app | Comprali: lojas perto de você | Médio: `.com.br` registrado em 2026-05 por terceiro (sem site); app antigo homônimo de lista de compras |
| 5 | ~~Vizin~~ (descartado) | vizin.com.br | vizinapp.com.br | @vizin.app | Vizin: lojas da vizinhança | **Alto, descartado:** Vizin já é marketplace de comércio local (Cascavel), com app e empresa |
| 6 | Esquina | esquinaapp.com.br | lojadaesquina.com.br | @esquina.app | Esquina: a loja perto de você | Médio: `esquinaapp.com.br` livre, mas palavra genérica cercada de derivados no comércio; fraca no INPI |
| 7 | ~~Darua~~ (descartado) | darua.com.br | daruaapp.com.br | @darua.app | Darua: comércio de rua | **Alto, descartado:** `.com.br` em uso ativo por empresa de mídia exterior (classe 35) |
| 8 | ~~Chegaí~~ (descartado) | chegai.com.br | chegaiapp.com.br | @chegai.app | Chegaí: lojas da cidade | **Alto, descartado:** projeto homônimo com app e perfil (ingressos em eventos) |
| 9 | Aquiperto | aquiperto.com.br | aquipertoapp.com.br | @aquiperto.app | Aquiperto: lojas da sua cidade | Médio: `.com.br` principal em disputa de registro; "Tem Aqui Perto" no mesmo segmento |
| 10 | ~~Vitrinha~~ (descartado) | vitrinha.com.br | vitrinhaapp.com.br | @vitrinha.app | Vitrinha: vitrine da cidade | **Alto, descartado:** dois serviços Vitrinha ativos, um lançado em 2026-10-11 para pequenos negócios |
| 11 | Pracinha | pracinha.com.br | pracinhaapp.com.br | @pracinha.app | Pracinha: comércio local | Médio: `.com.br` ocupado (alternativo livre); nome de município paulista e termo comum |
| 12 | ~~Balcão~~ (descartado) | balcaoapp.com.br | balcaolocal.com.br | @balcao.app | Balcão: lojas da cidade | **Alto, descartado:** "BalcãoApp" com domínio e handle; nome saturado |
| 13 | ~~Tô Perto~~ (descartado) | toperto.com.br | topertoapp.com.br | @toperto.app | Tô Perto: lojas e entrega hoje | **Alto, descartado:** TôPerto.com, marketplace local em piloto |
| 14 | Uailoja | uailoja.com.br | uailojaapp.com.br | @uailoja | Uailoja: o comércio de Minas | Médio: `.com.br` com resposta ambígua (conferir no Registro.br); sem homônimos; regionalismo limita a expansão |
| 15 | Paraíso Já | paraisoja.com.br | paraisojaapp.com.br | @paraisoja | Paraíso Já: lojas da cidade | Baixo: todos os domínios livres, sem homônimos; continua não escalando para outras cidades |
| 16 | Centrin | centrin.com.br | centrinapp.com.br | @centrin.app | Centrin: o centro da cidade | Médio: `.com.br` principal ocupado sem uso (alternativo livre); `.com` só com homônimo de saúde na China |
| 17 | Ruali | ruali.com.br | rualiapp.com.br | @ruali.app | Ruali: lojas da sua cidade | Médio: `.com.br` registrado em 2025-01 por terceiro, sem uso (alternativo livre); `.com` à venda |
| 18 | Pertali | pertali.com.br | pertaliapp.com.br | @pertali.app | Pertali: lojas perto de você | Baixo: todos os domínios e lojas livres; atenção à semelhança com Pertinho no INPI |
| 19 | ~~Lojin~~ (descartado) | lojin.com.br | lojinapp.com.br | @lojin.app | Lojin: as lojas da sua cidade | **Alto, descartado:** `lojin.com.br` em uso ativo (venda de ingressos) |
| 20 | Cidadin | cidadin.com.br | cidadinapp.com.br | @cidadin.app | Cidadin: o comércio da cidade | Médio (limite com baixo): os dois `.com.br` livres; `.com` é marca de remédios na Índia (outro ramo) |
| 21 | ~~Temali~~ (descartado) | temali.com.br | temaliapp.com.br | @temali.app | Temali: tem ali, chega hoje | **Alto, descartado:** app "TemAli" de ofertas locais nas duas lojas, lançado em 2026-10-09 |
| 22 | ~~Achali~~ (descartado) | achali.com.br | achaliapp.com.br | @achali.app | Achali: lojas perto de você | **Alto, descartado:** diretório de negócios locais de Cuiabá no ar em `achali.com.br` |
| 23 | Comprin | comprin.com.br | comprinapp.com.br | @comprin.app | Comprin: compre na sua cidade | Baixo: todos os domínios e lojas livres; radical "compr-" saturado e próximo de Comprali |
| 24 | Ruazin | ruazin.com.br | ruazinapp.com.br | @ruazin.app | Ruazin: o comércio da sua rua | Baixo: todos os domínios, handle e lojas livres; nada parecido encontrado |
| 25 | Pegali | pegali.com.br | pegaliapp.com.br | @pegali.app | Pegali: compre perto, pegue já | Baixo: `.com.br` livres; `.com` só redireciona a um blog pessoal |

Observações para quem verificar:
- Conferir também o INPI (classes 35 e 42 e, se houver, 39), não só domínio: domínio livre não garante marca livre.
- Nas lojas de apps, o título tem limite de 30 caracteres; todos os sugeridos acima cabem (conferido; seis títulos da primeira leva foram encurtados na rodada 2).
- Handle com ".app" é recomendado mesmo que o simples esteja livre, para padronizar entre redes; registrar os dois quando possível.

### 1.4 Lista final para o dono (8 a 10 nomes) e os 3 melhores

Lição das duas verificações: palavra comum do português já está tomada ou saturada; nome inventado com sentido imediato, no diminutivo ou na junção do interior, sobreviveu melhor. Ficaram fora da lista os 10 descartados e, por escolha de desenho, Esquina (genérico, fraco no INPI), Pracinha (município paulista, termo comum), Comprali (`.com.br` de terceiro), Logali (Logali Group em software, `.com.br` ocupado e som de Loggi) e Aquiperto (principal em disputa, "Tem Aqui Perto" no segmento).

Lista final, na ordem que recomendo:

| Ordem | Nome | Risco | Por que está aqui | Ressalva da verificação |
|---|---|---|---|---|
| 1 | Bairrin | Médio (limite com baixo) | O mais afetivo e com mais cara de "comércio do meu bairro"; som curto e mineiro sem "uai" | `bairrin.com` tem um projeto pequeno com tema de proximidade |
| 2 | Ruazin | Baixo | O mais limpo da verificação; remete à rua de lojas de qualquer cidade | Grafia "z" ou "s" ("Ruasin"); registrar a variação |
| 3 | Cidadin | Médio (limite com baixo) | Diz "o comércio da sua cidade" e serve a qualquer município | `.com` é marca de remédios na Índia (classe 5, outro ramo) |
| 4 | Pegali | Baixo | "Pega ali" combina com retirada e com entrega rápida | Tom informal; pode soar só retirada |
| 5 | Centrin | Médio | O centro comercial, público inicial de lojas de rua | `.com.br` principal ocupado; usar `centrinapp.com.br` |
| 6 | Pertali | Baixo | Proximidade dita de forma direta | Primo de Pertinho, descartado por homônimos; risco de semelhança no INPI |
| 7 | Comprin | Baixo | Compra pequena do dia a dia, afetiva | Radical "compr-" saturado; vizinho de Comprali |
| 8 | Ruali | Médio | Rua + ali, curto | `.com.br` principal registrado por terceiro; leitura da tônica varia |
| 9 | Uailoja | Médio | Identidade mineira forte, sem homônimos | `.com.br` com resposta ambígua; regionalismo limita a expansão para fora de MG |

Submarca do piloto, fora da lista: **Paraíso Já** (risco baixo, tudo livre). Serve para campanha ou selo do lançamento em São Sebastião do Paraíso ("Bairrin Paraíso Já"). Trade-off: como nome do produto, não escala; cada cidade nova pediria outro nome ou um rebatismo.

Os 3 melhores:
1. **Bairrin.** Som: duas sílabas, termina em som nasal fácil ("bai-RIM"). Memória: a palavra "bairro" está inteira, então quem ouve uma vez lembra. Local: o diminutivo mineiro dá o tom de vizinho sem soar caricato. Escala: toda cidade tem bairros, e o nome funciona fora de Minas. Registro: palavra inventada, distintiva no INPI. Risco médio no limite do baixo, e o único ponto é o `.com` estrangeiro; por isso continua o primeiro.
2. **Ruazin.** Som e memória parecidos com Bairrin (mesma família de diminutivo), com a imagem concreta da rua de comércio, que é exatamente o público lojista. Escala para qualquer cidade. Melhor resultado da verificação (tudo livre). Fica em 2º porque três sílabas com "z" dão mais erro de grafia na indicação falada.
3. **Cidadin.** O mais claro sobre a promessa ("as lojas da sua cidade") e o que melhor escala para várias cidades. Distintivo no INPI para comércio. Fica em 3º pelo `.com` com homônimo, ainda que em outro ramo e país, e por soar um pouco mais longo na fala.

Registros no mesmo dia em que o dono escolher, para o nome escolhido:
- Registro.br: o `.com.br` principal, o alternativo e as variações de grafia (para Bairrin, `bairrim.com.br`; para Ruazin, `ruasin.com.br`) apontando para o principal.
- `.com` se estiver livre (não está para Bairrin nem para Cidadin; nesse caso, seguir sem ele).
- Handles iguais no Instagram, TikTok e Facebook (`@<nome>.app` e, se livre, `@<nome>`), confirmados logado.
- INPI: pedido de marca mista ou nominativa nas classes 35 (comércio, intermediação) e 42 (software), depois de uma busca de anterioridade com variações fonéticas. Como a empresa ainda não existe, confirmar com o advogado em nome de quem depositar.
- Busca manual final nas duas lojas de apps e no Google antes de pagar qualquer registro.

## 2. Identidade visual

### 2.1 Conceito
Limpo e minimalista: muito branco, um azul firme para tudo que é ação e confiança, e o verde só para o que é bom e já aconteceu (aberto, pago, entregue). Nenhum gradiente, nenhuma ilustração pesada. A foto do produto é a estrela da tela; a marca fica em segundo plano.

### 2.2 Paleta

Azul primário (confiança, ação):

| Token | Hex | Uso principal |
|---|---|---|
| `color.blue.50` | #EFF5FF | Fundo de destaque, chip informativo |
| `color.blue.100` | #DBE7FE | Fundo de item selecionado |
| `color.blue.200` | #B8D0FC | Borda de item selecionado (decorativa) |
| `color.blue.300` | #88B0F8 | Texto e link no modo escuro (futuro) |
| `color.blue.400` | #5A8DF1 | Ilustração, gráficos |
| `color.blue.500` | #3170E6 | Gráficos; nunca texto pequeno em fundo `blue.50` |
| `color.blue.600` | #1F5BD1 | **Cor da marca.** Botão primário, link, foco, aba ativa |
| `color.blue.700` | #1A49AB | Botão primário pressionado, texto em fundo `blue.50` |
| `color.blue.800` | #1A3D88 | Texto em fundo `blue.100` |
| `color.blue.900` | #18336B | Fundo escuro de marca (splash, rodapé do site) |

Verde secundário (discreto: aberto, pago, entregue):

| Token | Hex | Uso principal |
|---|---|---|
| `color.green.50` | #ECF8F1 | Fundo de chip e banner de sucesso |
| `color.green.100` | #D3EFDF | Fundo de seleção positiva |
| `color.green.500` | #2E9A62 | Ícone e ponto de status (componente, não texto) |
| `color.green.600` | #1F8050 | Texto "Aberta", ícone de sucesso |
| `color.green.700` | #176642 | Texto em fundo `green.50` |
| `color.green.800` | #145237 | Texto em fundo `green.100` |

Neutros (cinza levemente azulado, para conversar com o primário):

| Token | Hex | Uso principal |
|---|---|---|
| `color.neutral.0` | #FFFFFF | Superfície (cards, folhas, barras) |
| `color.neutral.50` | #F7F8FA | Fundo da tela (canvas) |
| `color.neutral.100` | #EEF0F3 | Fundo de campo desabilitado, skeleton, chip neutro |
| `color.neutral.200` | #DFE3E8 | Separador, borda de card (decorativa) |
| `color.neutral.300` | #C5CBD3 | Borda de card em hover no painel (decorativa) |
| `color.neutral.400` | #848D9A | Borda de campo de formulário e de controles (3:1) |
| `color.neutral.500` | #646D7B | Texto secundário curto, placeholder, ícone inativo |
| `color.neutral.600` | #4F5765 | Texto secundário de corpo |
| `color.neutral.700` | #3A414D | Texto de apoio forte, fundo do toast |
| `color.neutral.800` | #262B34 | Fundo da faixa offline |
| `color.neutral.900` | #151920 | Texto principal |

Semânticas:

| Papel | Fundo | Texto e ícone | Componente sólido (texto branco) |
|---|---|---|---|
| Sucesso | `green.50` #ECF8F1 | `green.700` #176642 | `green.600` #1F8050 |
| Aviso | `amber.50` #FFF6E5 | `amber.700` #8F4E00 | `amber.500` #E59A0B só com texto `neutral.900` |
| Erro | `red.50` #FDF0EF | `red.700` #A8231F | `red.600` #C9302C |
| Informação | `blue.50` #EFF5FF | `blue.700` #1A49AB | `blue.600` #1F5BD1 |

### 2.3 Contraste das combinações recomendadas

Calculado pela fórmula de luminância relativa do WCAG 2.2. Mínimos: 4,5:1 texto normal; 3:1 texto grande (24 px, ou 18,66 px em negrito) e componentes.

| Texto / elemento | Fundo | Razão | Uso | Resultado |
|---|---|---|---|---|
| `neutral.900` #151920 | `neutral.0` #FFFFFF | 17,62:1 | Texto principal | AA e AAA |
| `neutral.900` | `neutral.50` #F7F8FA | 16,58:1 | Texto no canvas | AA e AAA |
| `neutral.600` #4F5765 | `neutral.0` | 7,28:1 | Texto secundário | AA e AAA |
| `neutral.600` | `neutral.50` | 6,85:1 | Texto secundário no canvas | AA |
| `neutral.500` #646D7B | `neutral.0` | 5,23:1 | Placeholder, legenda | AA |
| `neutral.500` | `neutral.50` | 4,92:1 | Legenda no canvas | AA |
| `neutral.500` | `neutral.100` #EEF0F3 | 4,58:1 | Texto de campo desabilitado | AA (no limite) |
| `neutral.700` #3A414D | `neutral.100` | 9,00:1 | Chip neutro | AA |
| `neutral.400` #848D9A | `neutral.0` | 3,36:1 | Borda de campo, checkbox | AA componente |
| `neutral.400` | `neutral.50` | 3,16:1 | Borda de campo no canvas | AA componente |
| `neutral.0` | `blue.600` #1F5BD1 | 6,04:1 | Botão primário | AA |
| `neutral.0` | `blue.700` #1A49AB | 8,12:1 | Botão primário pressionado | AA e AAA |
| `blue.600` | `neutral.0` | 6,04:1 | Link, botão secundário, anel de foco | AA |
| `blue.600` | `neutral.50` | 5,69:1 | Link no canvas | AA |
| `blue.600` | `neutral.100` | 5,29:1 | Link em área cinza | AA |
| `blue.700` | `blue.50` #EFF5FF | 7,42:1 | Chip e banner informativo | AA |
| `blue.800` #1A3D88 | `blue.100` #DBE7FE | 8,16:1 | Item selecionado | AA e AAA |
| `green.600` #1F8050 | `neutral.0` | 4,93:1 | "Aberta", ícone de sucesso | AA |
| `green.700` #176642 | `green.50` | 6,39:1 | Chip e banner de sucesso | AA |
| `neutral.0` | `green.600` | 4,93:1 | Componente sólido de sucesso | AA |
| `amber.700` #8F4E00 | `amber.50` #FFF6E5 | 6,01:1 | Chip e banner de aviso | AA |
| `amber.700` | `neutral.0` | 6,45:1 | Ícone e texto de aviso | AA |
| `neutral.900` | `amber.500` #E59A0B | 7,52:1 | Faixa de alerta sólida | AA e AAA |
| `red.700` #A8231F | `red.50` #FDF0EF | 6,46:1 | Chip e banner de erro | AA |
| `red.600` #C9302C | `neutral.0` | 5,33:1 | Mensagem de erro do campo, borda de erro | AA |
| `neutral.0` | `red.600` | 5,33:1 | Botão destrutivo | AA |
| `neutral.0` | `neutral.800` #262B34 | 14,21:1 | Faixa offline | AA e AAA |
| `neutral.0` | `neutral.700` | 10,28:1 | Toast | AA e AAA |
| `neutral.0` | `blue.900` #18336B | 12,18:1 | Splash, rodapé | AA e AAA |

Combinações proibidas (falham): branco sobre `amber.500` (2,34:1); `amber.500` como texto ou ícone em branco (2,34:1); `neutral.400` como texto (3,36:1); `neutral.300` e `neutral.200` como borda de campo (1,63:1 e 1,29:1, só decorativas); `blue.500` como texto em `blue.50` (4,18:1); `green.500` como texto (3,55:1, só ícone ou ponto ao lado de texto).

### 2.4 Tipografia

| Critério | Fonte do sistema (SF Pro no iOS, Roboto no Android, `system-ui` na web) | Fonte própria (ex.: Inter) |
|---|---|---|
| Peso no app | Zero: já está no aparelho | ~300 a 600 KB por 2 pesos, mais no painel web |
| Celular intermediário e conexão instável | Ideal: nada a baixar, renderização otimizada | Download e carga a mais; risco de texto piscando na web |
| Ajuste de tamanho do sistema (acessibilidade) | Suporte completo e testado | Funciona, mas exige cuidado com métricas |
| Familiaridade | A Ana e o Seu Carlos leem essa fonte o dia todo | Diferente, mais "marca" |
| Consistência entre iOS, Android e web | Pequenas diferenças de largura | Idêntica em tudo |
| Licença e aprovação | Nenhuma | OFL (gratuita), mas **exige aprovação** por ser dependência nova |

**Recomendação: fonte do sistema** na interface dos dois apps e do painel. A marca vem do logo, da cor e do tom, não da fonte do corpo. Inter fica como alternativa caso o dono queira aparência idêntica entre plataformas (**exige aprovação**). O wordmark do logo é desenhado e entregue como vetor (SVG), então não depende de fonte instalada.

Escala (6 tamanhos, 2 pesos). Pesos: regular (400) e semibold (600; no Android, Roboto Medium 500 se 600 não existir).

| Token | Tamanho / altura de linha | Peso | Uso |
|---|---|---|---|
| `font.caption` | 12 / 16 px | 400 | Legenda, carimbo de hora; nunca texto essencial sozinho |
| `font.body-sm` | 14 / 20 px | 400 e 600 | Texto secundário, metadados do card, chips |
| `font.body` | 16 / 24 px | 400 e 600 | Corpo, campos, botões |
| `font.title-sm` | 18 / 24 px | 600 | Título de card e seção |
| `font.title` | 22 / 28 px | 600 | Título de tela, preço na página do produto |
| `font.display` | 28 / 36 px | 600 | Contagem do Pix, número grande do painel, código de entrega |

Regras: respeitar o tamanho de fonte do sistema até 200% sem cortar texto (quebra de linha antes de reticências); números de preço, contagem e código com algarismos tabulares quando a fonte permitir; linhas de texto corrido limitadas a ~70 caracteres no painel web.

### 2.5 Ícone do app e logo (conceito)

Símbolo: um pino de mapa cuja parte de cima é o toldo listrado de uma loja de rua. Lê-se "loja" e "perto" ao mesmo tempo, em qualquer cidade e com qualquer um dos nomes candidatos. Um ponto verde pequeno no centro do pino sinaliza "aberta agora".

Ícone do app: fundo `blue.600`, símbolo branco ocupando ~60% da área (zona segura dos ícones adaptativos do Android e da máscara do iOS), ponto `green.500`. Sem texto no ícone.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="108" height="108">
  <rect width="108" height="108" rx="24" fill="#1F5BD1"/>
  <!-- pino -->
  <path d="M54 88c-2 0-22-22-22-40a22 22 0 0 1 44 0c0 18-20 40-22 40z" fill="#FFFFFF"/>
  <!-- toldo listrado -->
  <path d="M34 40h40l-3 8H37z" fill="#1A49AB"/>
  <path d="M41 40h6l-1 8h-6zM53 40h6v8h-6zM65 40h6l1 8h-6z" fill="#FFFFFF"/>
  <!-- ponto "aberta" -->
  <circle cx="54" cy="60" r="6" fill="#2E9A62"/>
</svg>
```

Logo: símbolo à esquerda + wordmark em minúsculas, semibold, `neutral.900` (ou branco em fundo `blue.600`/`blue.900`), espaço entre símbolo e texto igual à largura do ponto verde x 2.

Regras mínimas de uso:
- Versões: completa (símbolo + nome), só símbolo (ícone, avatar de rede, favicon), monocromática branca e monocromática `neutral.900`.
- Tamanho mínimo: símbolo 24 px na tela (16 px só no favicon, sem o ponto verde); logo completo 96 px de largura; impresso, 20 mm.
- Área de respiro: em volta do logo, no mínimo a altura do toldo.
- Fundos permitidos: branco, `neutral.50`, `blue.600`, `blue.900`. Sobre foto, só com uma camada de cor sólida por trás.
- Não fazer: esticar, girar, trocar as cores, aplicar sombra ou gradiente, colocar o verde no fundo do ícone.
- QR code da vitrine: logo completo acima, QR em `neutral.900` sobre branco (nunca azul claro, para a leitura funcionar), texto "Peça desta loja pelo celular e receba hoje".

### 2.6 Tom de voz

Princípios: curto, específico, gentil. Fala como um atendente de balcão educado: trata por "você", não usa gíria forçada nem termo técnico, diz o que aconteceu e o que fazer agora. Valores sempre em reais com vírgula ("R$ 12,90"), distância com uma casa ("1,2 km"), horários "14h30" ou "às 14:30" (padrão do sistema: "14:30").

| Situação | Em vez de | Escrever |
|---|---|---|
| Botão de compra | "OK" / "Confirmar" | "Adicionar ao carrinho" |
| Variação não escolhida | "Seleção inválida" | "Escolha o tamanho para continuar" |
| Sem conexão (CA-38) | "Erro de rede (timeout)" | "Você está offline. Mostrando o que foi carregado por último." |
| Reconectou | "Conexão restabelecida" | "Conectado de novo" |
| Nenhuma loja perto | "Nenhum resultado" | "Ainda não há lojas que entregam neste endereço. Tente outro endereço." |
| Busca vazia | "0 resultados" | "Nada encontrado para "tênis 39". Confira a escrita ou busque por categoria." |
| Pix | "Aguardando" | "Pague em até 29:41. Depois disso, o pedido é cancelado." |
| Pagamento confirmado | "Sucesso!" | "Pagamento confirmado. Avisamos a loja." |
| Cartão recusado | "Erro 402" | "O cartão foi recusado. Confira os dados ou pague com Pix." |
| Atraso (CA-80) | "Pedido em atraso" | "A loja está atrasada; previsão atualizada em breve" |
| Loja fechada (CA-31) | "Indisponível" | "Fechada · abre às 08:00" |
| Pedido novo (lojista) | "Nova notificação" | "Pedido novo! Aceite em até 15 min." |
| Recusa (lojista) | "Motivo:" | "Por que você vai recusar? O cliente vai ver este motivo." |
| Excluir produto | "Tem certeza?" | "Excluir "Tênis Casual"? Ele sai da loja agora. Pedidos já feitos não mudam." |
| Campo obrigatório | "Campo obrigatório" | "Informe o telefone com DDD" |

### 2.7 Marca Bairrin

Nome aprovado pelo dono em 2026-10-16. Escreve-se **Bairrin** em texto corrido (inicial maiúscula); o wordmark é sempre em minúsculas: **bairrin**. Pronúncia: bai-RIM.

**Slogan.** Recomendado: **"lojas do seu bairro"**. Acompanha o nome nas primeiras aparições (tela de boas-vindas, splash, lojas de apps, adesivo da vitrine, perfil nas redes), porque ensina a grafia e diz o que é o app. Variação para campanhas de entrega: "lojas do seu bairro, entrega hoje". Título nas lojas de apps: "Bairrin: lojas do seu bairro" (28 caracteres). Depois que a marca for conhecida, o nome pode aparecer sozinho.

**Wordmark e composição.**
- Fonte do sistema em semibold (600), minúsculas, espaçamento entre letras -0,5 (em 40 px). Os SVGs abaixo usam `<text>` com `font-family: system-ui`; **o dev converte o texto em caminhos (outline)** no editor vetorial antes de gerar os assets finais, para que o logo não dependa da fonte instalada.
- Horizontal (padrão): símbolo à esquerda; altura do símbolo = 1,6 × altura das minúsculas do wordmark; espaço entre símbolo e texto = 0,3 × altura do símbolo; texto centralizado na vertical com o círculo do pino.
- Empilhada (para formatos quadrados, splash, adesivo): símbolo centralizado acima, wordmark abaixo, espaço = 0,3 × altura do símbolo.
- Área de respiro: a altura do toldo em todos os lados. Tamanho mínimo: horizontal 96 px de largura (20 mm impresso); empilhada 64 px; símbolo 24 px.

**Cores por fundo.**

| Fundo | Pino | Toldo | Ponto | Wordmark |
|---|---|---|---|---|
| Branco ou `neutral.50` | `blue.600` | listras branco e `blue.300` | `green.500` com anel branco | `neutral.900` |
| `blue.600` ou `blue.900` | branco | listras `blue.700` e branco | `green.500` | branco |
| Monocromático claro (impressão de 1 cor) | `neutral.900` | vazado | vazado | `neutral.900` |
| Monocromático escuro | branco | vazado | vazado | branco |

**Símbolo isolado** (`assets/brand/bairrin-simbolo.svg`; alt: "Bairrin"):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 66" width="48" height="66" role="img" aria-label="Bairrin">
  <path d="M24 65C22 65 2 43 2 24a22 22 0 0 1 44 0c0 19-20 41-22 41z" fill="#1F5BD1"/>
  <path d="M5 13h38l-2 9H7z" fill="#FFFFFF"/>
  <path d="M5 13h7.6l-.8 9H7zM20.2 13h7.6v9h-7.6zM35.4 13H43l-2 9h-4.8z" fill="#88B0F8"/>
  <circle cx="24" cy="36" r="6.5" fill="#2E9A62" stroke="#FFFFFF" stroke-width="2.5"/>
</svg>
```

**Ícone do app, versão completa** (`assets/brand/bairrin-icone-ios-1024.svg`, exportado em PNG 1024×1024 sem transparência; o iOS aplica o arredondamento, então o quadrado não tem cantos arredondados):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="1024" height="1024">
  <rect width="108" height="108" fill="#1F5BD1"/>
  <g transform="translate(32.4 24.3) scale(0.9)">
    <path d="M24 65C22 65 2 43 2 24a22 22 0 0 1 44 0c0 19-20 41-22 41z" fill="#FFFFFF"/>
    <path d="M5 13h38l-2 9H7z" fill="#1A49AB"/>
    <path d="M12.6 13h7.6v9h-7.6zM27.8 13h7.6v9h-7.6z" fill="#FFFFFF"/>
    <circle cx="24" cy="36" r="6.5" fill="#2E9A62"/>
  </g>
</svg>
```

**Ícone adaptativo do Android.** Camada de fundo `assets/brand/bairrin-icone-android-fundo.svg` = quadrado 108×108 em `#1F5BD1`. Camada da frente (`assets/brand/bairrin-icone-android-frente.svg`): símbolo escalado a 90%, inteiro dentro da zona segura (círculo de 66 de diâmetro no centro do quadro de 108), testado com as máscaras circular, quadrada e de gota. Versão monocromática para ícones temáticos do Android 13+: `assets/brand/bairrin-icone-android-mono.svg` (mesmo desenho, só o pino, sem toldo listrado nem ponto).
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="432" height="432">
  <!-- zona segura: círculo de 66 de diâmetro centrado em (54,54); nada essencial fora dela -->
  <g transform="translate(32.4 24.3) scale(0.9)">
    <path d="M24 65C22 65 2 43 2 24a22 22 0 0 1 44 0c0 19-20 41-22 41z" fill="#FFFFFF"/>
    <path d="M5 13h38l-2 9H7z" fill="#1A49AB"/>
    <path d="M12.6 13h7.6v9h-7.6zM27.8 13h7.6v9h-7.6z" fill="#FFFFFF"/>
    <circle cx="24" cy="36" r="6.5" fill="#2E9A62"/>
  </g>
</svg>
```

**Favicon 32 px, sem o ponto verde e sem listras** (`assets/brand/bairrin-favicon-32.svg`; gerar também `favicon.ico` 16/32/48 e `apple-touch-icon` 180 px a partir do ícone completo):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="7" fill="#1F5BD1"/>
  <path d="M16 29C15 29 7 20.5 7 13a9 9 0 0 1 18 0c0 7.5-8 16-9 16z" fill="#FFFFFF"/>
  <path d="M8 9.5h16l-.6 4H8.6z" fill="#1A49AB"/>
</svg>
```

**Logo horizontal** (`assets/brand/bairrin-logo-horizontal.svg`; versões `-branco` e `-mono` com as cores da tabela; alt: "Bairrin"; quando o logo é link para o início, alt "Bairrin, página inicial"):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 232 66" width="232" height="66" role="img" aria-label="Bairrin">
  <path d="M24 65C22 65 2 43 2 24a22 22 0 0 1 44 0c0 19-20 41-22 41z" fill="#1F5BD1"/>
  <path d="M5 13h38l-2 9H7z" fill="#FFFFFF"/>
  <path d="M5 13h7.6l-.8 9H7zM20.2 13h7.6v9h-7.6zM35.4 13H43l-2 9h-4.8z" fill="#88B0F8"/>
  <circle cx="24" cy="36" r="6.5" fill="#2E9A62" stroke="#FFFFFF" stroke-width="2.5"/>
  <text x="62" y="46" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="40" font-weight="600" letter-spacing="-0.5" fill="#151920">bairrin</text>
</svg>
```

**Logo empilhado** (`assets/brand/bairrin-logo-empilhado.svg`; mesmas variantes):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 124" width="160" height="124" role="img" aria-label="Bairrin">
  <g transform="translate(56 0)">
    <path d="M24 65C22 65 2 43 2 24a22 22 0 0 1 44 0c0 19-20 41-22 41z" fill="#1F5BD1"/>
    <path d="M5 13h38l-2 9H7z" fill="#FFFFFF"/>
    <path d="M5 13h7.6l-.8 9H7zM20.2 13h7.6v9h-7.6zM35.4 13H43l-2 9h-4.8z" fill="#88B0F8"/>
    <circle cx="24" cy="36" r="6.5" fill="#2E9A62" stroke="#FFFFFF" stroke-width="2.5"/>
  </g>
  <text x="80" y="114" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="36" font-weight="600" letter-spacing="-0.5" fill="#151920">bairrin</text>
</svg>
```

**Assets a gerar (lista para o dev):**

| Arquivo | Uso | Texto alternativo |
|---|---|---|
| `assets/brand/bairrin-simbolo.svg` | Avatar, carregamento, marcadores | "Bairrin" (decorativo quando o nome está ao lado) |
| `assets/brand/bairrin-logo-horizontal.svg` (+ `-branco`, `-mono`) | Cabeçalho do painel, login, site, e-mails | "Bairrin" / "Bairrin, página inicial" |
| `assets/brand/bairrin-logo-empilhado.svg` (+ `-branco`, `-mono`) | Splash, adesivo da vitrine, materiais quadrados | "Bairrin" |
| `assets/brand/bairrin-icone-ios-1024.svg` → PNG 1024 | Ícone iOS e App Store | não se aplica (o sistema usa o nome do app) |
| `assets/brand/bairrin-icone-android-frente.svg`, `-fundo.svg`, `-mono.svg` | Ícone adaptativo e temático do Android | não se aplica |
| `assets/brand/bairrin-icone-play-512.png` | Ficha da Google Play | não se aplica |
| `assets/brand/bairrin-favicon-32.svg`, `favicon.ico`, `apple-touch-icon.png` | Painel web e página de deep link | não se aplica |
| `assets/brand/bairrin-splash.svg` | Splash: fundo `blue.900`, logo empilhado branco + slogan em `blue.200` (7,81:1) | "Bairrin, lojas do seu bairro" |

O caminho `assets/brand/` é sugestão; o arquiteto pode ajustar à estrutura da stack, mantendo os nomes de arquivo.

## Acessibilidade
- Todas as combinações de texto da seção 2.3 passam AA; a lista de proibidas vira regra de revisão.
- Cor nunca é o único sinal: status de loja e de pedido levam ícone e texto (ver design system).
- Logo e ícone têm texto alternativo com o nome do produto ("Logali, página inicial", por exemplo); o símbolo sozinho é decorativo quando há o nome ao lado.
- Fonte do sistema garante o ajuste de tamanho de texto do usuário.

## O que o dev precisa implementar
- Nada nesta parte além dos tokens de cor e tipografia, descritos em `00-design-system.md`.
- Depois da escolha do nome: o designer entrega o SVG final do símbolo, do logo e do ícone (com as variantes adaptativa do Android e de máscara do iOS) para o dev colocar nos assets.

## Arquivos de apresentação afetados
- Nenhum ainda (não há código). Assets futuros: ícone do app (iOS e Android), favicon do painel, logo SVG, splash.

## Perguntas em aberto
1. ~~Nome~~ Respondida em 2026-10-16: Bairrin. Resta: Paraíso Já entra como submarca do piloto ("Bairrin Paraíso Já") ou fica de fora?
2. O dono aceita um nome regional mineiro (Uailoja) ou ligado à cidade (Paraíso Já), sabendo que limita a expansão?
3. ~~Fonte~~ Respondida em 2026-10-16: fonte do sistema.
4. ~~Ponto verde~~ Respondida em 2026-10-16: ícone com pino, toldo e ponto verde aprovado.
5. Slogan: recomendado "lojas do seu bairro" (seção 2.7); o dono confirma?
