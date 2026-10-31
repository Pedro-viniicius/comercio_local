# Revisão M2 — rodada 1 (plano 01b: etapas 12 e 12a) + itens sem revisão já na main

## Objetivo
- Etapa 12 (SENSÍVEL: sessão) — docs/produto/planos/01b-identidade.md, linha | 12 | inteira (inclui "Vindo da revisão do M1" e
  observações r2): sessão dos apps no packages/mobile-base (SecureStore WHEN_UNLOCKED_THIS_DEVICE_ONLY, limpeza na 1ª abertura,
  provedor que limpa tudo no logout/expiração/troca de conta, persister por lista permitida, revogação em chave própria,
  aoFalharEmSegundoPlano só com origem, clienteDoApp, login só depois de renovar/encerrar; S119 dataExtractionRules próprias com
  teste do manifesto; faceIDPermission false; S121 lint por lista de permissão sem disable inline + teste com espiões; S125 https).
- Etapa 12a — linha | 12a |: 13 componentes base (spec docs/produto/specs/01-fundacao-identidade.md, "Componentes"), textos com
  erro.<campo>.<codigo> e mensagemDoCampo; EstadoDaApi movida dos apps para o mobile-base (R1), com D2, D8, D9.
- Integração do lead: src/index.ts exporta a sessão; apps/*/src/app/index.tsx usam urlDaApiConfigurada(..., __DEV__) (S125);
  app.config.ts com icon e android.adaptiveIcon (assets/brand/png); scripts/instalacao-limpa.test.mjs copia assets/;
  .github/workflows/android-nativo.yml sem `cache: gradle` (falhou no CI do bfd7cee: setup-java antes do prebuild);
  READMEs dos apps e raiz.
- Já na main (bfd7cee) SEM revisor — revisar junto: Q35 (--fsModuleCachePath nos scripts de teste de tokens, contratos,
  cliente-api, painel, api + scripts/vitest-cache-por-pacote.test.mjs) e assets/brand (SVGs, gerar-png.sh, PNGs, README,
  spec 00-nome-e-identidade.md com a variação do lojista).

## Critérios de aceite (brief docs/produto/briefs/01-fundacao-identidade.md, linhas 34-46)
- CA-03: tokens só no armazenamento seguro do aparelho. CA-05: renovação sem senha; logout/troca de senha invalidam.
- CA-01, CA-06, CA-13 (parte de app): componentes de cadastro/recuperação; erro de campo por erro.<campo>.<codigo>, motivo da API como reserva.
- Exigências da linha da etapa 12 (cada uma deve ter teste) e da 12a (spec, WCAG 2.2 AA, pt-BR).

## Artefatos
- Relatórios: m2-dev-12.md, m2-dev-12a.md (decisões e desvios: src/instalacao/marca-de-instalacao.ts fora da posse; lint por regex;
  import()/require proibidos em src/sessao; porta registrarFalha no lugar do Sentry; fila e persister como portas opcionais;
  mensagemDoCampo com 4º argumento tela; logo copiado em marca/logo.ts com teste de igualdade; anelDeFocoSobreEscuro;
  componentes sem ícones; Toast com margemInferior sem safe-area).
- Risco levantado pelo dev da 12: a limpeza da 1ª abertura apaga a revogação pendente da instalação anterior (tokens vivem no servidor
  até 30 dias). Julgar: transformar a sessão antiga em revogação pendente em vez de apagar? (o Keychain sobrevive à desinstalação).
- Lista de arquivos: m2-arquivos.md. Decisões do dono: docs/produto/decisoes.md.

## Linha de base
- Commit bfd7cee (main, CI principal verde): consumidor/lojista 34, mobile-base 3, scripts 491, api 1515, painel 478...
- Agora (lead, 2026-10-31): lint, typecheck, deps:verificar, build ok; tokens 73, contratos 625, cliente-api 166, mobile-base 370,
  consumidor 9, lojista 9 (25 testes da tela foram para o mobile-base), painel 478, api 1515, scripts 515 (instalacao-limpa 7/7
  depois da correção do lead); expo export android dos dois apps ok; prebuild android gera os ícones.
- audit --prod --audit-level=high limpo (node-forge 1.4.2); restam minimatch/glob (moderadas) e deepmerge (baixa) via expo/jest.
- Rodar testes com TMPDIR=$HOME/.cache/bairrin-tmp (o /tmp tem cota). Worktree/cópia com "bairrin" no caminho quebra
  smtp.adaptador.test.ts (procura /bairrin/ na pilha) — não é bug.
