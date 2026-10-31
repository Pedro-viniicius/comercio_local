# Rodada 1 de correção do M2 — designer

Fechados: D10, D11, D12, D13, D14, D16, D17, D18, D19, D20, S129, R18.

- `ModalDeConfirmacao.tsx` (D10): conteúdo do cartão em `ScrollView`; cartão com `maxHeight` = altura da janela − `espaco[4]`×2 (`useWindowDimensions`); `testID` `modal-de-confirmacao-cartao` e `modal-de-confirmacao-rolagem`.
- `CaixaDeSelecao.tsx` (D11): "✓" com `allowFontScaling={false}`.
- `BarraSuperior.tsx` (D12): selo com `minHeight: 20` e `maxFontSizeMultiplier={1.3}`; (D13) título com 2 linhas quando `PixelRatio.getFontScale() > 1.3`.
- `CabecalhoDeMarca.tsx` (D14): `alignSelf: 'stretch'`.
- `Campo.tsx`: (D16) `maxLength` e `autoFocus`; (D17) rótulo em `Pressable` `accessible={false}` que chama `focus()` numa ref interna (ref externa, objeto ou função, preservada); (S129) senha visível no Android → `keyboardType: 'visible-password'`.
- `CampoDeCodigo.tsx`: (D16) `autoFocus`; (D17) idem; (D18) `dica` como `accessibilityHint` quando não há `ajuda` nem erro.
- `Toast.tsx` (D19): duração dobra (4→8 s, 6→12 s) com leitor de tela ligado (`AccessibilityInfo.isScreenReaderEnabled`) ou `getFontScale() > 1.3`; toque/foco na ação continua pausando.
- `textos/pt-BR.ts` (D18): removida `componentes.carregando`; `codigo.dica` passou a ser usada.
- `apps/{consumidor,lojista}/app.config.ts` (D20): comentário "= `blue.600`" / "= `blue.900`".
- `apps/painel/src/autenticacao/bairrin-logo-horizontal.svg` (R18): cópia byte a byte de `assets/brand` (197×66); `LogoBairrin.tsx` exibe 98×33; `logo.test.ts` novo confere a igualdade.
- Testes novos/ajustados nos componentes acima (os testes de Toast e BarraSuperior fixam `getFontScale` em 1 no `beforeEach`, porque o mock do RN devolve 2).
- Lead: README do painel e spec 01 (linha 260) atualizados para o logo.

Pendências: passada manual no aparelho (TalkBack/VoiceOver, fonte 200%, 320 px, foco do modal, `ScrollView` nativo); `Icone` em SVG para depois.
