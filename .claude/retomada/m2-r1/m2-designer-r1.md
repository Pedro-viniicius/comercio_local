## Veredito: MUDANÇAS NECESSÁRIAS
## Rodada: 1

Revisei por leitura de código e dos tokens, e olhei os PNG de ícone. Não capturei tela: não há tela montada com esses componentes. Calculei os contrastes a partir dos tokens e todos passam (4,5:1 nos textos, 3:1 em borda e foco). Isso inclui o anel `focus.ring` sobre os fundos claros do Banner e o `anelDeFocoSobreEscuro` sobre o Toast e a Faixa offline.

Conferi também que o `react-native-svg` entra no autolinking do Android dos apps (resolvido pelo `expo-modules-autolinking`). Não há achado aí.

## Achados

### ATENÇÃO

- **D10** `packages/mobile-base/src/componentes/ModalDeConfirmacao.tsx:72` e `:106` — o cartão do modal é uma `View` fixa, centralizada, sem `ScrollView`.
  - Impacto: com fonte do sistema a 200% em tela de 320×568, título, texto e dois botões passam da altura. Os botões ficam cortados e inalcançáveis, e a ação (inclusive a destrutiva) não pode ser confirmada nem cancelada. O botão "voltar" do Android é a única saída. Isso quebra "Texto em 200%: nada corta" (spec 01, Estados) e a regra do design system "nada de altura fixa em texto".
  - Correção: envolver o conteúdo do cartão em `ScrollView` com `maxHeight` (altura da janela menos as margens) e `contentContainerStyle` com o gap. O fundo continua não fechando ao toque.

- **D11** `packages/mobile-base/src/componentes/CaixaDeSelecao.tsx:87` e `:157` — o "✓" é um `Text` `bodySm` que cresce com a fonte do sistema, dentro de um quadrado fixo de 24 px.
  - Impacto: a 200% o glifo (14→28 px, altura de linha 40) passa do quadrado. A parte de fora é branco sobre branco, então o check aparece cortado ou deformado. O estado "marcada" fica ilegível justamente para quem amplia a fonte.
  - Correção: `allowFontScaling={false}` no glifo, ou melhor, desenhar o check com `react-native-svg` (já é dependência do pacote) com traço de 2 px em `text.onAction`. Isso também resolve a variação do glifo entre fontes do sistema.

- **D12** `packages/mobile-base/src/componentes/BarraSuperior.tsx:151-152` — o selo tem `height: 20` fixo com texto `caption` que escala.
  - Impacto: a 200% o "99+" é cortado ou estoura o círculo. Quebra a regra "nada de altura fixa em texto" e a matriz do design system (99+ pedidos, 200%).
  - Correção: trocar por `minHeight: 20` com `paddingVertical` pequeno, ou limitar o texto do selo com `maxFontSizeMultiplier={1.3}`. Como o selo é decorativo e o nome acessível já leva a contagem, o limite é aceitável.

### SUGESTÃO

- **D13** `packages/mobile-base/src/componentes/BarraSuperior.tsx:101` — o título tem `numberOfLines={1}` (é o que a spec pede), mas a 200% o título é truncado e perde conteúdo (WCAG 1.4.4). Permitir 2 linhas quando `PixelRatio.getFontScale() > 1.3`.

- **D14** `packages/mobile-base/src/componentes/CabecalhoDeMarca.tsx:41` — o logo usa `width: '60%'`, mas o cabeçalho tem `alignItems: 'center'` e nenhuma largura própria.
  - Se a tela pai também centralizar os filhos, o cabeçalho encolhe até o slogan e os 60% colapsam, com o logo minúsculo ou sumido.
  - Acrescentar `alignSelf: 'stretch'` ao `cabecalho`. O Jest não pega isso: vale conferir na tela A1.

- **D15** `packages/mobile-base/src/textos/mensagem-do-campo.ts` — o 4º argumento `tela` é `string` solta, então um erro de digitação ("cadastros") cai em silêncio no texto geral.
  - Tipar como `keyof typeof textos.erroPorTela` (e o campo, se quiser).
  - A decisão do 4º argumento em si está correta: o mesmo `campo.codigo` precisa de duas frases (A1/A2 e A3/A4).

- **D16** `packages/mobile-base/src/componentes/Campo.tsx` — o Campo não repassa `maxLength` nem `autoFocus`.
  - A A2 tem nome de até 80 caracteres (spec 01, linha 87) e a A3 e a A4 pedem foco automático no código. Hoje a tela só consegue limitar o texto pelo erro após o envio.
  - Incluir `maxLength` e `autoFocus` opcionais. Com `maxLength`, o contador omitido ("120/500") passa a fazer sentido junto, mas não é obrigatório agora.

- **D17** `packages/mobile-base/src/componentes/Campo.tsx` (e `CampoDeCodigo.tsx`) — o rótulo visível é um `Text` escondido do leitor de tela. Quem enxerga e toca no rótulo não leva o foco ao campo. Envolver o rótulo em `Pressable` (`accessible={false}`) que chame `ref.focus()`, ou aceitar essa lacuna como menor.

- **D18** `packages/mobile-base/src/textos/pt-BR.ts` — as chaves `componentes.carregando` e `componentes.codigo.dica` não são usadas por nenhum componente nem tela (busca no repositório sem resultado). Usar a `dica` no `CampoDeCodigo` quando não houver `ajuda` (é útil ao leitor de tela) ou remover as duas.

- **D19** `packages/mobile-base/src/componentes/Toast.tsx:61-65` — o toast some sozinho em 4 s (6 s com ação), e só a ação pausa o relógio.
  - Essa é a regra do design system. Para quem usa leitor de tela ou fonte ampliada, 4 s pode ser curto, pelo princípio de tempo ajustável (WCAG 2.2.1).
  - Considerar `AccessibilityInfo.isScreenReaderEnabled()` para dobrar a duração, ou registrar a regra como aceita.

- **D20** `apps/{consumidor,lojista}/app.config.ts` — o `backgroundColor` do `adaptiveIcon` (`#1F5BD1` e `#18336B`) está em hex solto. É defensável, porque o `app.config.ts` não consome o pacote compilado de tokens, e está batendo com a spec 00-nome-e-identidade (linha 408). Manter e acrescentar um comentário "= `blue.600`" e "= `blue.900`".

## Decisões do `dev`

- **Símbolos de texto no lugar de ícones: aceito para a fatia 01.** Estão escondidos do leitor de tela e nunca são o único sinal, pois sempre há texto. Antes das telas de catálogo (fatia 2), criar um `Icone` interno com SVG próprio (check, ✕, alerta, info, setas, loja) via `react-native-svg`, que já é dependência. Isso não é pacote novo de ícones, mas o dono deve ver a decisão. O D11 é o único ponto onde o glifo hoje falha.
- **Itens da spec não implementados: aceito.**
  - Sucesso do Botão (check por 1 s): nenhuma tela da fatia usa.
  - Contador de caracteres: só faz sentido com o `maxLength` do D16.
  - Regras de senha com check (A2): é lógica da tela da etapa 14. O `Campo` aceita `ajuda`, mas o check com texto precisará de um nó da tela ou de um pequeno componente de regra.
  - "Voltar ao topo" flutuante: aceito ao fim do texto. Evita tapar o conteúdo e o botão tem 44 px.
  - Estado de sucesso do Campo (ex.: CNPJ encontrado, design system): fica para a fatia 2.
- **Toast com `margemInferior`: aceito.** O provedor é montado uma vez por app, onde o `useSafeAreaInsets` já está disponível, e o `mobile-base` evita dependência nova. Documentar no README do pacote que o app soma área segura mais a altura da navegação inferior.
- **`mensagemDoCampo` com 4º argumento:** aceito, com o D15.
- **Leitor de texto legal em `componentes/`:** correto, o plano manda isso. A spec 01, linha 39, diz `telas/`; atualizar a spec depois (é minha).

## EstadoDaApi (D2, D8, D9)

Conforme.
- **D2:** usa o Botão com `carregando`, `busy`, foco mantido e toque ignorado.
- **D8:** o foco com anel `focus.ring` vem do `Botao` (`useFoco` e `anelDeFoco`).
- **D9:** `anunciar()` só no iOS, e o "Verificando…" inicial não é anunciado.

Os textos "A API respondeu com erro" são de diagnóstico (CA-F6) e não devem ir ao usuário final. Essa tela deve sair do caminho de produção quando as rotas `(conta)` entrarem.

## Ícones no `app.config.ts`

Corretos.
- Caminhos e PNG existem (iOS 1024 sem alfa, frente e mono do Android, variação do lojista).
- O pino fica dentro da zona segura do ícone adaptativo (cerca de 37% da largura).
- O monocromático usa só a silhueta do pino, adequado ao ícone temático.
- As cores de fundo batem com a spec.

## Tela de abertura (`expo-splash-screen`)

Não deve entrar agora.
- É dependência nova e precisa da aprovação do dono.
- A abertura só faz sentido junto com o layout raiz: `preventAutoHideAsync` no início e `hideAsync` depois que a sessão restaurar. Isso é a etapa 17 (rotas `(conta)`), não a 12a.
- Enquanto isso, o Android 12+ mostra o ícone sobre fundo padrão, aceitável para builds internos.
- Condição: entrar antes de qualquer build entregue a testadores. `assets/brand/png/splash-1024.png` e a cor `#18336B` (`blue.900`) já estão prontos. Registrar isso como pendência da etapa 17.

## Pendências para o dev

- D10, D11 e D12 (obrigatórios antes de "pronto"). Um `dev` ou eu, a seu critério, já que são só apresentação. Posso corrigir na rodada 2 se o lead liberar a edição.
- Passada manual no aparelho (TalkBack e VoiceOver, fonte a 200%, tela de 320 px), como o `dev` já apontou. O Jest não prova o anel `outline`, o `SvgXml` nem o foco do modal.
- Atualizar a spec 01, linha 39 (Leitor em `componentes/`), e a linha 260 (o painel ainda importa o logo da pasta própria). Faço isso na próxima edição de spec.
