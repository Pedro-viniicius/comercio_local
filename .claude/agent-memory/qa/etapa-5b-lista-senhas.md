---
name: etapa-5b-lista-senhas
description: Estado da QA da etapa 5b (lista de senhas comuns, nome sem seletor invisível) após a rodada 2 em 2026-10-18: Q17 a Q19 fechados, taxas de falso positivo atuais, testes e mutação
metadata:
  type: project
---

Rodada 1 (2026-10-17): REPROVADO por Q17 da 5b (nome só de U+FE0F/U+FE0E aceito). Rodada 2 (2026-10-18): Q17, Q19 e S83, R2 fechados; Q18 parcial (baixo, aceito). Suíte: contratos 595, API 885, painel 129, scripts 421, tudo verde.

Testes do qa: `senha-fora-da-lista-publica-borda.test.ts` (API: tabela CA5, blocos S83 e "Q18 e Q19", desempenho), `scripts/gerar-senhas-comuns-origem.test.mjs` (CA1/2/3/8), blocos "QA 5b" em `senhas-comuns.test.ts`, "QA da etapa 5b" em `contratos.test.ts`, bloco do nome em `nome.test.ts`, `apps/painel/src/textos/mensagem-do-campo.senha-comum.test.ts` (R2, esquema real até a mensagem).

Falso positivo medido (lista completa, 5 sementes, 100 mil cada): alfabeto completo 8 = 102 a 135 (antes 237); 12 exato = 2 a 10; 14+ = 0; minúsculas, mai+min, base32 e min+dígitos = 0 (1 caso de base32 em uma semente); hex 32 = 0. Hex 12 com ao menos uma letra: 0,27% recusado (núcleos hex `eba`, `cafe`, `bad` cercados de dígitos; só-dígito é recusado por desenho), 14: 0,12%, 18: 0,04%, 22: 0,006%. Tetos nos testes: 8 chars ≤180, 12 exato ≤20, hex12 ≤400, hex18 ≤100, 14+ zero. Frase de 2 palavras recusada (declarado); 3 e 4: 0; 3 nomes/sobrenomes colados recusados (S83, por desenho).

Desempenho: pior caso medido <1 ms por chamada (era 8 ms frio), 100 mil caracteres de entrada em ~5 ms. Em 2026-10-18 22:14 outra frente (S85, `indexarForma`, `senhas-comuns.tempo.test.ts`) reescreveu `senhas-comuns.ts` no meio da rodada: confira `ls -la --time-style=full-iso` antes de snapshot.

Lacunas baixas: `deusteama`, `jesusteama`, `j0a0p3dr0s1lva` (3 nomes disfarçados), `senhaluzsilva` passam; `b12345678` passa; U+0301 sozinho agora recusado.

Mutação (cópia no scratchpad, `--no-fsModuleCache`): todos os mutantes de nome, disfarce, emoji, €, três nomes, volta nas pontas morrem. Sobreviventes equivalentes: guarda `pontaAte>0` no composto de três (os trechos com símbolo não casam com a lista), cache de respostas e `completa` (só desempenho).

**How to apply:** compare falhas por NOME do teste. Ao mexer na regra de forma, rode as sondas de FP (alfabeto completo 8/12/14-24, hex 12/18/32) antes de aceitar.
