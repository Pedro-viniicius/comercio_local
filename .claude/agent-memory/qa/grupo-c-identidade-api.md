---
name: grupo-c-identidade-api
description: Grupo C do 01b (API: etapas 6 a 11), rodada 2 em 2026-10-19: testes de integração dos casos de uso com Prisma e cripto reais, Q22/Q23/Q24 fechados, S91/S94/S95/S97/S99/A-R7/A-R8 provados e mutados
metadata:
  type: project
---

Testes do qa (todos em `apps/api/test/integracao/identidade/`, rodam com `pnpm --filter api test:integracao -- <trecho>`; suíte inteira 353 na rodada 2, 3 execuções estáveis):
- `pilha-de-casos-de-uso.ts` (ajuda, não é teste): `montarPilha()` liga os casos de uso aos repositórios Prisma, Argon2/HMAC/AES/JWT/TOTP reais e ao publicador da outbox, com `RelogioFixo` (T0 = 2026-10-19T12:00Z). Duas pilhas = dois pools = duas requisições. `pausarAntes(repo,'metodo')` / `pausarDepois` / `pausarAntesDaChamada(repo,'metodo',n)` (n-ésima chamada) param a requisição DENTRO da transação (o que ela travou segue travado); `esperarAlguemNaTrava(dono)` confere `pg_locks NOT granted`. `semearDocumentos`, `prepararAdmin`, `apagarContasDoTeste` (já trata conta anonimizada/desativada).
- `ciclo-de-vida-da-conta.int.test.ts` (38), `corridas-de-casos-de-uso.int.test.ts` (21), `atomicidade-e-reserva.int.test.ts` (27: CA-04 exato com a reserva, estorno na origem, senha trocada durante o Argon2 (login e exclusão), portas `gravarSenhaRedefinida`/`gravarDesativacao`/`gravarSenhaRemovida` com `false` desfazendo tudo, A-R8 (verificar e confirmar 2FA), S94 (inclui deadlock), CLI S97/S99, A-R7 teto de 12 h, Q23 trava da conta, Q24, e "freio zerado não sobra").
- `reserva-da-tentativa.int.test.ts` e `repositorios.int.test.ts`/`concorrencia.int.test.ts` são do dev (não mexer sem avisar).

Armadilhas aprendidas:
- Reproduzir Q22 (P2025) exige pausar ANTES do `salvar` que zera o freio (3ª chamada de `bloqueios.salvar` no login: as 2 primeiras são da reserva), com o 2º login esperando o FOR UPDATE de uma linha ainda viva. Pausar depois do delete não reproduz: o `INSERT ... ON CONFLICT DO NOTHING` espera a transação que apagou. O teste antigo (pausa no 1º `salvar`) deixou de provar o Q22 depois do S91 (agora só prova reserva×reserva); o novo é "login certo que vai apagar a linha do freio...".
- Conta dos testes precisa ir para `contasDoTeste`; freios (e-mail, origem, 2FA) para `freiosDoTeste`; `ipNovo()` do arquivo novo já marca a chave da origem. Tirar a conta de `ativa` no meio: `UPDATE ... status='desativada'` como dono (o caso de uso lê a conta sem trava).
- Argon2 fora da transação: `segurarOHashDe(pilha)` (troca `hasher.verificar` por uma versão que avisa e espera) é o ponto de pausa de "senha trocada no meio".

Mutação (31 mutantes numa cópia, rodada 2): todos mortos, menos M20 (exclusão reserva sem reler a conta: equivalente, a conclusão tem a segunda guarda `senhaHash !== reserva.conta.senhaHash`). Procedimento em "como-rodar-testes".

Lacunas e riscos conhecidos: tempo de resposta (CA-02/CA-04/S23) não medido; HTTP e assinantes (etapas 13, 16, 19) fora; a CLI `reconfigurar-segundo-fator` não roda de ponta a ponta (o `IdentidadeModule` ainda não existe, só o caso de uso é testado); 49 falhas de uma origem + login certo deixam a espera de 1 min na origem (falha fechada, documentada no domínio); consulta de pendências que falha na exclusão deixa a falha reservada no freio; `gravarUltimoLogin` `false` no login devolve credenciais_invalidas mas confirma o zeramento do freio (sem efeito prático).

**How to apply:** na próxima rodada, `pnpm --filter api test:integracao -- atomicidade corridas ciclo-de-vida` e a suíte inteira; o revisor pode estar rodando a integração ao mesmo tempo (banco de teste único: repita se colidir).

## Rodada 3 (2026-10-19)
A-R13 (CLI trava o freio por e-mail primeiro) e A-R11 provados; sem bug. Integração 357 (3 testes novos em `corridas-de-casos-de-uso.int.test.ts`, describe "CLI de reconfiguração do 2FA × login"): CLI já em andamento x login (login espera, relê conta sem senha, `credenciais_invalidas`), login do painel parado antes de `invalidarVigentes` x CLI (o desafio emitido morre: `desafio_invalido` até com TOTP certo), redefinição x CLI (sem deadlock; senha termina nula). `prepararAdmin` já grava `ultimo_login_em`: compare com o valor de antes, não com null.
Mutação (cópia `mutapi3`): CLI sem a trava do freio por e-mail mata 4 testes; Q22 antigo REAL (INSERT DO NOTHING + SELECT FOR UPDATE em dois comandos; só `DO NOTHING RETURNING` mata tudo, é grosso) mata os 2 testes de "freio do login" (o do `buscarPorId`, A-R11, e o Q22-api): o teste antigo ainda prova o Q22 porque `buscarPorId` só roda na conclusão, com o freio travado e antes do `salvar` que apaga a linha.
