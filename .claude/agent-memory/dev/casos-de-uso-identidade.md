---
name: casos-de-uso-identidade
description: Casos de uso da Identidade (01b/8 em diante) — ordem das travas conta→sessões, desfazer parcial com sentinela, corrida nos fakes (subclasse, porta que bloqueia), chave do freio por Email, expectTypeOf
metadata:
  type: project
---

Conferido em 2026-10-18 (etapa 8 do 01b, em paralelo com 6, 7, 10 e 11):
- A etapa 7 fixou no cabeçalho de `dominio/repositorios.ts` a ordem **conta antes das sessões** (a exclusão desativa a conta e depois revoga as sessões). Releia o cabeçalho antes de escrever caso de uso: ele mudou durante o grupo C, e a minha primeira versão (sessões antes da conta) cruzaria com a exclusão (40P01).
- `RepositorioDeContas.atualizar` grava a conta inteira lida sem trava: evite em caso de uso concorrente. Há UPDATEs de uma coluna com `WHERE status = 'ativa'` que devolvem `boolean` (`gravarUltimoLogin`, `gravarEmailVerificado`, este desde 2026-10-18, pedido do lead). `revogarDaFamilia`/`revogarDaConta` (UPDATE ... `revogada_em IS NULL`) devolvem quantas linhas mudaram. `false` ou 0 → lança um erro sentinela privado dentro da unidade (desfaz tudo, inclusive o uso do código) e traduz fora para o resultado tipado. Releia a conta depois do UPDATE para montar o token.
- Erro de banco que aborta a transação (`EmailJaCadastrado` no INSERT): pegar FORA de `unidade.executar` e refazer o caminho alternativo numa unidade nova.
- Para simular "li antes da outra transação confirmar" nos fakes sem editar `repositorios-em-memoria.ts`: subclasse no próprio teste (`ContasEmMemoria`/`SessoesEmMemoria`) que devolve cópia velha em `buscarPorId`/`buscarPorEmail`, ligada à mesma `identidade.unidade`. Repositório criado assim fica fora da cascata de `criarIdentidadeEmMemoria`.
- `expectTypeOf<CriarConta>().toExtend<EntradaDeCriarConta>()` (expect-type 1.4 do Vitest 5) prova no typecheck que o corpo do contrato entra no caso de uso.
- Convenções adotadas na 8 (as etapas 9 e 13 precisam casar): HMAC do código = `cifrador.hmac('verificacao_email', [contaId, codigo])`; hash do token de renovação = `cifrador.hmac('token_renovacao', [token])`; classes `<Nome>CasoDeUso` com `@Injectable()` e `executar(entrada)`.

Conferido em 2026-10-19 (etapa 9, sessão, em `aplicacao/sessao/`):
- Desfazer uma parte e manter outra (renovação que gravou `ultimo_login_em` e depois cai em reuso): lançar sentinela com o que manter (`familiaParaRevogar`), pegar fora e refazer só isso numa unidade nova.
- Testar ordem de trava entre dois casos de uso nos fakes: um falso de porta que bloqueia numa promessa (ex.: `VerificadorDePendencias` da exclusão, chamado com o freio já travado) segura a 1ª unidade; aí a 2ª começa, espera a trava, e o teste libera. Mais determinístico que contar microtarefas.
- `chaveDoFreioPorEmail` (privacidade) recebe `Conta`; login e redefinição precisam da chave antes de ler a conta: `chaveDoFreioPorEmailNormalizado(cifrador, Email)` em `sessao/comum.ts`, com teste de igualdade.
- Lint em teste: `async () => undefined` reprova `require-await` (use `() => Promise.resolve()`); `'x' as Tipo` em default de desestruturação reprova `no-unnecessary-type-assertion` (tipar o parâmetro).

**How to apply:** etapas 9 a 13 do 01b e qualquer caso de uso que grave conta e sessão na mesma transação.

Conferido em 2026-10-19 (rodada 1 de correção do grupo C, S91 e outros):
- Reserva da tentativa (S91): login e exclusão contam a falha numa transação curta, conferem a senha FORA de transação e, no sucesso, outra transação trava os freios na mesma ordem, relê a conta e compara `senhaHash` com a conferida (redefinição no meio → `credenciais_invalidas`/`senha_incorreta`, a falha reservada fica). E-mail zera com `registrarSucesso`; origem devolve a falha com `estornarFalha(registradaEm)` (espera já aplicada fica). `HasherFalso(identidade.unidade)` rejeita chamada com transação aberta: passe a unidade nos testes de caso de uso que fazem hash.
- Fonte única (A-R4): `aplicacao/comum/chaves.ts` (`chaveDoFreioPorEmail(cifrador, Email)`, `hashDoTokenDeRenovacao`) e `aplicacao/comum/sessao-emitida.ts`. Não existem mais `chaveDoFreioPorEmailNormalizado` nem a cópia em `solicitar-exclusao.ts`.
- Gravações de uma coluna na conta (S95): `gravarSenhaRedefinida`, `gravarSenhaRemovida`, `gravarDesativacao` (boolean, só em ativa); `atualizar` só para anonimizador e perfis. Redefinição invalida desafios do 2FA ANTES de gravar a senha (o 2FA trava desafio e depois a conta).
- Limite de exportação sem migração (Q23): inserir, travar a conta (`buscarPorIdParaAtualizar`) e recontar com `contarDesde`; >1 → sentinela, desfaz e responde `ja_solicitada` lendo a vencedora fora da unidade. Travar antes da leitura faria o teste do qa (pausa antes de `inserir`) esperar para sempre.
- Todas as classes de caso de uso têm sufixo `CasoDeUso` (A-R5), inclusive privacidade, cujos arquivos não têm `.caso-de-uso` no nome.

- Com o hash fora da transação (S91), todo caso de uso que tira o acesso de uma conta (senha, status) precisa travar o freio por e-mail ANTES de tudo, senão um login já na conclusão relê a conta velha e grava a sessão depois da revogação (A-R13, a CLI de reconfiguração). Teste que prova: pausar o login em `gravarUltimoLogin` e esperar a outra requisição em `pg_locks`.
