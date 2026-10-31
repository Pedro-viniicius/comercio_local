# Rodada 2 da revisão do M2 (2026-10-31)

| Agente | Veredito | Achados novos |
|---|---|---|
| qa | APROVADO | nenhum; 16 testes novos (corridas do R8/R9, Toast, Campo, CampoDeCodigo, Modal, `scripts/gerar-png.test.mjs`); mutação 48/50 mortos (2 equivalentes/depois mortos) |
| revisor | APROVADO COM RESSALVAS | R20 (SUGESTÃO, fila do plano 02 só envia com `com_sessao`: registrado no plano), R21 (SUGESTÃO, `.catch` no `isScreenReaderEnabled` do Toast: feito pelo lead) |
| seguranca | SEM BLOQUEIOS | nenhum ID novo; recomendações registradas no plano: fila com id da conta, lint global de `expo-secure-store`, `indice-publico` com lista exata, S130 na etapa 14/1º prebuild iOS |
| designer | APROVADO COM RESSALVAS | D21 (SUGESTÃO, quebra de linha do comentário do Toast: feito pelo lead) |

Riscos baixos aceitos (relatados, sem ação): corrida estreita no `substituirSessao` (logout + login entre `iniciarSessao` e `encerrarSessao` do revogar), `entrar` espera o DELETE de B (até 10 s) no caminho de erro, falha dupla fila + SecureStore deixa B na chave até a próxima abertura, sessão órfã se outra conta entrar durante a verificação de e-mail. `scripts/gerar-png.test.mjs` pula 4 casos sem Pillow (o CI não tem).
