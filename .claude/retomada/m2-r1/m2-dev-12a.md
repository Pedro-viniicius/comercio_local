## Resumo
Etapa 12a pronta. Os 13 componentes base, os textos, `mensagemDoCampo` e o logo em `SvgXml` estão em `packages/mobile-base`. `EstadoDaApi`, os textos `estadoDaApi` e os 25 testes da tela saíram dos dois apps e foram para `packages/mobile-base/src/{telas,textos}`, usando o Botão novo (D2, D8, D9). Os `assets/brand/bairrin-logo-horizontal.svg` chegou do `designer` antes do Cabeçalho de marca, então usei o SVG. Não houve commit. O lint dos meus arquivos e o `tsc` fora de `src/sessao` passam. Os erros de lint e de `tsc` que aparecem em `src/sessao/**` são do trabalho em andamento do outro `dev`.

## Arquivos alterados
Todos em `/home/ufla/Documentos/comercio_local`.
- `packages/mobile-base/src/componentes/` (novo): `Botao`, `Campo`, `mascara-de-telefone`, `CaixaDeSelecao`, `CampoDeCodigo`, `Banner`, `Toast` (com `ProvedorDeToast` e `useToast`), `ModalDeConfirmacao`, `BarraSuperior`, `ItemDeLista`, `FaixaOffline`, `EstadoVazio`, `CabecalhoDeMarca`, `LeitorDeTextoLegal`, `texto-legal`, `marca/logo.ts`, `acessibilidade.ts`, `estilos.ts`, `index.ts`. Cada um tem o seu `*.test.ts(x)`, e `marca/logo.test.ts` cobre o logo.
- `packages/mobile-base/src/telas/EstadoDaApi.tsx` (novo): usa o Botão e `anunciar()`.
- `packages/mobile-base/src/telas/EstadoDaApi.test.tsx` e `EstadoDaApi.bordas.test.tsx`: vieram do consumidor. Preservei todos os testes originais e acrescentei 5 (D8, D9, D2).
- `packages/mobile-base/src/textos/pt-BR.ts`, `mensagem-do-campo.ts`, `mensagem-do-campo.test.ts`, `pt-BR.test.ts` (novos).
- `packages/mobile-base/src/index.ts`: exporta componentes, `EstadoDaApi`, `mensagemDoCampo` e `textos`. Não liga `sessao`; isso fica com o lead.
- `apps/{consumidor,lojista}/src/app/index.tsx`: importa `EstadoDaApi` de `@bairrin/mobile-base`.
- `apps/{consumidor,lojista}/src/textos/pt-BR.ts`: ficou só `titulo`.
- `apps/{consumidor,lojista}/src/testes/rotas.test.tsx` e `rotas.bordas.test.tsx`: os textos da tela vêm de `@bairrin/mobile-base`.
- Removidas dos apps: `src/telas/EstadoDaApi.tsx` e os dois testes da tela.
- `.claude/agent-memory/dev/mobile-base-componentes.md` e a linha em `MEMORY.md`.
- Não toquei em `scripts/apps-expo.test.mjs`: a remoção não exigiu ajuste.

## Critérios de aceite
| CA | Onde está | Teste |
|---|---|---|
| 01 (cadastro): campos, Caixa de seleção com links, Campo de código, telefone com máscara, Cabeçalho de marca | `Campo.tsx`, `mascara-de-telefone.ts`, `CaixaDeSelecao.tsx`, `CampoDeCodigo.tsx`, `CabecalhoDeMarca.tsx` | `Campo.test`, `mascara-de-telefone.test`, `CaixaDeSelecao.test`, `CampoDeCodigo.test`, `CabecalhoDeMarca.test`, `logo.test` |
| 06 (recuperação): código, senha, Banner e Toast | `CampoDeCodigo.tsx`, `Campo.tsx`, `Banner.tsx`, `Toast.tsx`, textos `erroPorTela.recuperacaoDeSenha` | `CampoDeCodigo.test`, `Banner.test`, `Toast.test`, `mensagem-do-campo.test` |
| 13 (erro de campo por `erro.<campo>.<codigo>`, `motivo` como reserva) | `textos/pt-BR.ts`, `textos/mensagem-do-campo.ts`, `Campo.tsx` | `mensagem-do-campo.test`: usa os esquemas reais de `@bairrin/contratos` (cadastro, login, código, redefinição, exclusão); `pt-BR.test` |
| Componentes conforme a spec: estados, WCAG 2.2 AA, pt-BR | todos os `componentes/*.tsx` | Alvos de 44 e foco `focus.ring` em cada componente interativo; símbolos escondidos do leitor de tela; região viva educada ou assertiva por tipo; `textos` só no pacote |
| R1: mover `EstadoDaApi`, textos e testes | `telas/EstadoDaApi.tsx`, `textos/pt-BR.ts`; cópias dos apps apagadas | `EstadoDaApi.test` e `EstadoDaApi.bordas.test` (30); `rotas*.test` nos dois apps (9 cada) |
| D2: estado ocupado | `Botao.tsx` (`carregando`) | `Botao.test`, `EstadoDaApi.bordas.test`: busy, desabilitado, indicador, foco mantido, toque ignorado |
| D8: foco com anel `focus.ring` | `estilos.ts` (`anelDeFoco`), `acessibilidade.ts` (`useFoco`) | `Botao.test`, `EstadoDaApi.bordas.test` e os testes de cada componente interativo |
| D9: `announceForAccessibility` só no iOS | `acessibilidade.ts` (`anunciar`) | Casos `ios` e `android` com `Platform.OS` trocado em `EstadoDaApi.bordas`, `Campo`, `CaixaDeSelecao`, `CampoDeCodigo`, `Banner`, `Toast` e `FaixaOffline` |

Mutação conferida: tirei a pausa do `Toast` e 2 testes falharam; restaurei.

## Verificação
- `pnpm --filter @bairrin/mobile-base exec jest src/componentes src/textos` → 288 passaram, 0 falharam (18 suítes).
- `pnpm --filter @bairrin/mobile-base exec jest` → 358 passaram. Inclui 3 de dependências e os testes de `src/sessao` do outro dev (linha de base: 3). Duas rodadas seguidas passaram.
- `src/telas` → 30 passaram (25 originais + 5 novos).
- `pnpm --filter consumidor exec jest` → 9 passaram (linha de base: 34; 25 foram para o pacote).
- `pnpm --filter lojista exec jest` → 9 passaram (linha de base: 34).
- `tsc --noEmit` de `consumidor` e `lojista` → ok.
- `tsc --noEmit` de `mobile-base` → ok fora de `src/sessao`. Lá há erros de tipo em `src/sessao/armazenamento-seguro.test.ts`.
- `pnpm exec eslint` em `packages/mobile-base/src/{componentes,telas,textos,index.ts}`, `apps/consumidor` e `apps/lojista` → ok. Em `src/sessao` há 40 erros, do trabalho em andamento do outro `dev`.
- `prettier --check` nos meus arquivos → ok.
- `expo export --platform android` (consumidor e lojista) → ok; saída apagada.
- `node --test scripts/apps-expo.test.mjs` → 18 passaram.
- `pnpm deps:verificar` → sem violações (521 módulos).

## Decisões e desvios do plano
- **Leitor de texto legal em `componentes/`:** a spec 01 (linha 39) o põe em `telas/`, mas o plano 12a e a delegação o põem em `componentes/`; segui o plano.
- **`mensagemDoCampo` com 4º argumento `tela` (opcional):** o painel já faz isso. É necessário porque o mesmo `campo.codigo` tem duas frases: `senha.obrigatorio` é "Informe sua senha" no login e "Crie uma senha" no cadastro; `codigo.invalido` é a frase da A3 ou a da A4. A assinatura de 3 argumentos continua válida.
- **Chaves sem texto de propósito:** `nome.invalido`, `senha.invalido`, `novaSenha.invalido` e os `*.comum`. O `motivo` da API já é o texto final e varia (nome longo ou caractere proibido; senha curta, longa ou "Senha incorreta"). Está comentado no `pt-BR.ts` e testado.
- **Logo:** `marca/logo.ts` guarda uma cópia do SVG, porque o Metro não importa `.svg`. O `logo.test.ts` compara com `assets/brand/bairrin-logo-horizontal.svg` e falha se divergirem. Não criei nada em `assets/brand`.
- **Foco sobre fundo escuro (Toast e Faixa offline):** o azul de `focus.ring` dá 1,7:1 sobre `neutral.700` e 2,35:1 sobre `neutral.800`. Usei `anelDeFocoSobreEscuro` (branco). O anel padrão usa `outlineOffset` 2 (respiro transparente), não um respiro branco literal.
- **Sem animação no Toast nem na rolagem do Leitor:** isso já cumpre "movimento reduzido".
- **Faixa offline:** é só apresentação; a detecção de conexão fica para outra etapa (NetInfo não está nas dependências).
- **Sem ícones:** não há conjunto de ícones aprovado. Os componentes usam símbolos de texto (`✓`, `✕`, `!`, `‹`, `›`), escondidos do leitor de tela. `icone` é um `ReactNode` vindo da tela.
- **Não implementei (a spec cita, nenhuma tela da fatia usa):**
  - estado de sucesso do Botão (check por 1 s);
  - contador de caracteres no Campo;
  - regras de senha com ícone de check (A2), que é lógica da tela da etapa 14;
  - botão "Voltar ao topo" flutuante: ele fica no fim do texto.
- **Índice do git alterado:** usei `git mv` e `git rm` nas cópias de `EstadoDaApi`, o que mexeu no índice que o lead já tinha preparado (itens `D` e `R` aparecem no `git status`). Nada foi commitado. Se preferir, é só refazer o `git add`.
- **Arquivos do outro `dev` reformatados:** por engano rodei `prettier --write packages/mobile-base/src`, que reformatou `src/sessao/armazenamento-seguro.test.ts`, `persistencia-permitida.ts`, `provedor-de-sessao.test.tsx` e `sessao-do-app.test.ts`. Foi só formatação, em torno de 16:08 de 31/10. Avise o outro `dev` caso ele estivesse editando esses arquivos.

## Pendências e riscos
- **Docs desatualizadas:**
  - `packages/mobile-base/README.md` (etapa 20b): documentar componentes, `mensagemDoCampo`, `ProvedorDeToast` e o logo copiado.
  - `apps/consumidor/README.md` e `apps/lojista/README.md`: linhas 18, 30 e 68 ainda dizem que `EstadoDaApi` e os textos estão em `src/telas`, `src/textos` e em cópia nos apps.
  - `README.md` raiz, linha 139: o exemplo `pnpm --filter consumidor exec jest src/telas/EstadoDaApi.test.tsx` agora é `pnpm --filter @bairrin/mobile-base exec jest src/telas/EstadoDaApi.test.tsx`.
  - Não os editei porque estavam fora da minha posse.
- **Spec 01, linha 260:** o painel ainda importa o logo de `apps/painel/src/autenticacao/bairrin-logo-horizontal.svg`. Fica para o painel ou o lead.
- **Área segura no Toast:** `ProvedorDeToast` recebe `margemInferior` e não usa `react-native-safe-area-context`, porque `mobile-base` não declara essa dependência. A tela ou o app soma a área segura e a altura da navegação. Se quiser o cálculo no próprio provedor, é dependência nova no `package.json` do pacote.
- **Limites de teste:** o Jest não prova o comportamento nativo de TalkBack e VoiceOver (região viva, foco no título do Modal, ações dos links da Caixa de seleção) nem o aspecto visual do anel `outline` e do logo `SvgXml`. Vale uma passada manual no aparelho antes de fechar o grupo M2.
- **`src/index.ts`:** o lead precisa ligar `./sessao/index.ts` quando a etapa 12 fechar.
