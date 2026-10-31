# Rodada 1 de correção do M2 — dev (opus)

Fechados: R8 (= S131 = Q36), R9, R10, S127 (= R13), S128, Q37, Q38, R15 (= D15), R16, R17, R19. Os 3 `it.failing` viraram `it`.

- `sessao/sessao-do-app.ts`: (R8) quando a fila não é apagada na troca de conta (ou login), a sessão recebida B é revogada (`iniciarSessao(nova)` + `encerrarSessao()`: com rede sai o DELETE com o Bearer de B; sem rede, B vira revogação pendente), estado → `sem_sessao` (com checagem de `versao`) e `entrar` rejeita com `ErroAoLimparDadosDaConta`. (R9) `substituirSessao(pedido)` + tipo `PedidoDeSessaoSubstituta`: recebe a requisição (não a sessão), valida com `sessaoSchema`, troca o par sem limpar dados e atualiza `emailVerificado`; se a sessão sumiu no meio (logout/expiração) a recebida é revogada; se outra conta entrou no meio, a dela fica (a recebida vence no servidor sem ninguém com o token — caso aceito).
- `sessao/provedor-de-sessao.tsx`: `useSessao` entrega `substituirSessao`.
- `sessao/armazenamento-seguro.ts` (S127): na 1ª abertura lê as duas chaves (tolerando erro/JSON quebrado), junta `[par da sessão, pendência, ...anteriores]` sem repetir, no máximo 5, grava a pendência antes de apagar a sessão e só depois marca a instalação.
- `sessao/index.ts` (S128): saem `criarCofreDaSessao`, `CHAVE_DA_SESSAO`, `CHAVE_DA_REVOGACAO_PENDENTE`, `criarSessaoDoApp`, `OpcoesDoCofreDaSessao`.
- `eslint.config.mjs`: `expo-secure-store` e a marca de instalação só em `sessao/armazenamento-seguro.ts` (S128); bloco novo para `src/instalacao/**` com `noInlineConfig`, só `expo-file-system` e arquivos da pasta, sem `import()`/`require` (R10).
- `componentes/mascara-de-telefone.ts` (Q37): com `+` e código ≠ 55 fica `+` e até 13 algarismos, sem DDD; `digitosDoCelular` devolve vazio.
- `componentes/texto-legal.ts` (Q38): data conferida no calendário, também com hora.
- `textos/mensagem-do-campo.ts` (mobile-base e painel) (R15): `tela?: TelaComTextoProprio` (= `keyof typeof textos.erroPorTela`); `apps/painel/src/autenticacao/erros-da-tela.ts` usa o mesmo tipo.
- `apps/api/package.json` (R16): `test:integracao` com `--fsModuleCachePath=node_modules/.vitest-cache-integracao`; `scripts/vitest-cache-por-pacote.test.mjs` confere todo script com vitest (lê `--config`).
- `assets/brand/gerar-png.sh` (R17): apaga cada PNG antes, mostra log do Chrome se falhar, confere com Pillow existência e tamanho; README da pasta atualizado. O teste de cabeçalho IHDR/tamanho/alfa já existia (`scripts/assets-brand.test.mjs`).
- `.github/workflows/android-nativo.yml` (R19): `actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9` (v6.1.0) entre o `expo prebuild` e o Gradle, chave por app; `scripts/workflows-apps-expo.test.mjs` ganhou teste e passou a aceitar `hashFiles` só na linha `key:` de cache.
- Testes: `sessao-do-app.test.ts` (R8 ×2, R9 ×4, S127 ponta a ponta), `sessao-do-app.corridas.test.ts` (Q36 `it`), `armazenamento-seguro*.test.ts` (3 novos, 5 ajustados pela S127), `provedor-de-sessao.bordas.test.tsx`, `src/testes/indice-publico.test.ts` (novo), `mascara-de-telefone.bordas.test.ts` e `texto-legal.bordas.test.ts` (`it`), testes de `mensagemDoCampo` (4º argumento hostil com `as TelaComTextoProprio`), `scripts/regra-de-sessao.test.mjs` (S128 e marca de instalação, 18 casos).
- Docs: `packages/mobile-base/README.md` (Sessão e Regra de lint); plano 01b linha 65 (S127 e R8). Lead registrou no plano a pendência das props `cofre`/`agora` do `ProvedorDeSessao`.

Riscos relatados: `entrar` no caminho de erro espera o DELETE de B (até 10 s); se fila e apagamento do SecureStore falharem juntos, B pode ficar na chave até a próxima abertura.

Verificação do dev: mobile-base 453, consumidor 21, lojista 21, painel 479, scripts 573; lint, typecheck e deps ok. Testes novos falham no HEAD (24) e passam agora.
