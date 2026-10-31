---
name: mobile-base-componentes
description: Componentes base do mobile-base (etapa 12a): armadilhas de RN 0.88 + RNTL 14 + Jest 30 (tipos de ref, foco do Pressable, anúncio só no iOS, testes de plataforma, prettier em pasta alheia)
metadata:
  type: project
---

Conferido em 2026-10-31 (plano 01b, etapa 12a, `packages/mobile-base/src/{componentes,telas,textos}`):
- RN 0.88: `Pressable` só passa `{pressed}` ao estilo; foco vem de `onFocus`/`onBlur` (hook `useFoco`). Anel = `outline*` (Nova Arquitetura). `HostInstance`, `TextInputInstance` e `ScrollViewInstance` são os tipos de ref (`useRef<Text>`/`Ref<TextInput>` não compilam). `TextInput.autoComplete` já aceita `new-password`, `current-password`, `one-time-code`, `tel`.
- Sem `UNSAFE_getByType` no RNTL 14: dê `testID` fixo ao filho que o teste precisa achar (indicador do botão, quadrado da caixa). `getByRole` só acha `accessible`; `Text` conta como acessível. Segundo `render` no mesmo teste desmonta o primeiro.
- Jest (não Vitest): `expect(x, mensagem)` não existe (TS2554); use `it.each` com a chave no nome. `jest.replaceProperty(Platform, 'OS', 'android')` + `jest.restoreAllMocks()` funciona e restaura (padrão do jest-expo é `ios`). `jest.spyOn(AccessibilityInfo, 'announceForAccessibility')` herda as chamadas do mock global: faça `mockClear()` no `beforeEach`.
- `ScrollView.prototype.scrollTo` é `jest.fn` do preset (o `instance` do RNTL é o host, não a classe). `Modal` do preset renderiza os filhos só com `visible`; `requestClose` dispara `onRequestClose`.
- `not.toHaveStyle({ height: expect.anything() })` não vale: use `StyleSheet.flatten(el.props.style as StyleProp<ViewStyle>)?.height`.
- O pacote não tem tipos do Node: teste que lê arquivo usa `jest.requireActual<{...}>('node:fs')` com interface própria e `declare const __dirname: string`.
- Foco sobre fundo escuro (toast `neutral.700`, faixa `neutral.800`): `focus.ring` (`blue.600`) dá 1,7:1 e 2,35:1; `anelDeFocoSobreEscuro` usa `text.onAction`.
- Anúncio manual só no iOS vem de `anunciar()` (`componentes/acessibilidade.ts`); sempre ao lado de região viva (`accessibilityLiveRegion`), nunca no lugar.
- `prettier --write packages/mobile-base/src` reformata o `src/sessao/**` de outro dev em paralelo: rode só nas suas pastas.
- `git mv`/`git rm` mexem no índice que o lead já preparou (arquivos novos do M1 estavam em `A`): prefira `mv`/`rm` quando o índice não for seu.
- Logo: o Metro não importa `.svg`; `componentes/marca/logo.ts` guarda o texto e `logo.test.ts` compara com `assets/brand/bairrin-logo-horizontal.svg`.
