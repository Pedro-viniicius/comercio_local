# @bairrin/tokens

Tokens de design do Bairrin em TypeScript, sem dependência externa. A fonte dos valores é `docs/produto/specs/00-design-system.md` (e a identidade, em `docs/produto/specs/00-nome-e-identidade.md`). O pacote é privado ao monorepo.

## O que exporta

| Export                                                                                       | Conteúdo                                                                                                                                     |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `paleta`                                                                                     | Cores brutas (o azul da marca é `paleta.blue[600]`, `#1F5BD1`). Não use direto em componente.                                                |
| `temaClaro`, `temaEscuro`, `TemaDeCores`, `CorComOpacidade`                                  | Cores semânticas (`bg`, `text`, `border`, `action`, `focus`, `status`, `banner`, `toast`, `nav`, `overlay`). O tema escuro ainda está vazio. |
| `fonte`, `pesoDaFonte`, `familiaDaFonte`, `tamanhoMinimoDeTextoEssencial`                    | Escala de tipografia (fonte do sistema), pesos e tamanho mínimo de texto essencial.                                                          |
| `espaco`, `raio`, `tamanho`, `elevacao`, `duracao`, `easing`, `easingParaCss`, `breakpoints` | Espaço (escala de 4 px), raios, tamanhos, sombras, movimento e pontos de quebra.                                                             |

Valores em px, exceto onde o nome diz outra unidade.

## Regras

- Componente usa só a camada semântica (`temaClaro.action.primary`), nunca um hex solto.
- Todo hex é de 6 dígitos em maiúsculas. O teste confere isso, a razão de contraste (WCAG 2.2) dos pares de texto e a cor da marca.
- Mudou um valor? Mude primeiro a spec de design, depois aqui. Quem decide o visual é o `designer`.

## Como é consumido

- Painel: `apps/painel/src/estilos/tokens.css.ts` gera as variáveis CSS a partir deste pacote.
- Apps Expo (`apps/consumidor` e `apps/lojista`): importam o pacote pela condição `react-native` (o Metro e o Jest leem o fonte em `src`) e montam o tema com `temaClaro`, `espaco`, `raio` e `fonte` em `StyleSheet`.

O pacote exporta o fonte pela condição `@bairrin/fonte` e `react-native`, e o `dist` por `default`. O painel e os testes leem o fonte, então não é preciso compilar o pacote antes; o `dist` só é usado por quem importa pela condição `default`.

## Comandos

```bash
pnpm --filter @bairrin/tokens test
pnpm --filter @bairrin/tokens typecheck
pnpm --filter @bairrin/tokens build
```
