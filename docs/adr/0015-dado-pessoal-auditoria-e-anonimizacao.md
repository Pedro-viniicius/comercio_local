# ADR-015: Dado pessoal, auditoria sem dado pessoal e anonimização por módulo

- Situação: aceita (decisão do dono, 2026-10-16). O núcleo (auditoria e porta de anonimização) existe; cada módulo entrega a sua implementação nos planos seguintes.
- Origem: `docs/produto/planos/00-arquitetura.md`, seções "Segurança e LGPD transversais" e "Requisitos de segurança para os próximos planos" (S4, S5 e S10).

## Contexto

O produto guarda dado pessoal (LGPD) em vários contextos. A auditoria é imutável por desenho, então um dado pessoal gravado nela não pode ser apagado depois. A anonimização de um titular precisa alcançar todos os módulos, não só Identidade.

## Decisão

- Dado pessoal mora em `identidade.contas`, `lojistas.lojas`, `dados_recebimento` (cifrados) e nas cópias de endereço e telefone em `pedidos`. Dados bancários e segredo TOTP são cifrados com AES-256-GCM, com chave em segredo de ambiente.
- **Auditoria sem dado pessoal (S4):** `antes` e `depois` guardam ids, nomes de campo e valores não pessoais. Campo pessoal vira `{"alterado": true}`. O repositório de auditoria rejeita chaves conhecidas de dado pessoal (`apps/api/src/compartilhado/titular/dado-pessoal.ts`) com qualquer outro valor, exceto booleano e `null` (`emailVerificado: true`, `telefone: null`), que dizem que o dado existe, foi conferido ou foi apagado, nunca qual é; texto, número, lista e outro objeto continuam recusados. Se um caso exigir reconstituir o valor, cifra-se com chave por titular e destrói-se a chave na anonimização. Na auditoria e nas configurações (versionadas), a aplicação só tem `SELECT` e `INSERT`, com uma política RLS por comando (`FOR SELECT` e `FOR INSERT`): um `GRANT` de `UPDATE` ou `DELETE` dado por engano não alcança nenhuma linha (S28, S29).
- O mesmo vale para o payload da outbox (ADR-011), para logs, erros, URLs e Sentry. A mesma lista de chaves redige os logs e o Sentry (`apps/api/src/compartilhado/log/redator.ts`), que acrescenta trechos só dele (`mail`, e `cpf` e `cnpj` dentro de outra palavra) e redige também instâncias de classe, erros fora da chave `err` e os vínculos de logger filho (`child`, `assign` do nestjs-pino).
- **Anonimização (S5):** porta `AnonimizadorDeTitular`, com registro por módulo. Todo módulo que guarda dado pessoal entrega a sua implementação e o teste (pedidos, dispositivos de push, autor de avaliação, convites).
- **Retenções:** `idempotencia` 7 dias; `outbox` publicada 30 dias; jobs concluídos do pg-boss 7 dias; exportações do titular 7 dias; backups 7 dias.
- **Operadores de dado pessoal** (tabela para o advogado):

| Operador         | O que recebe            | Onde                  |
| ---------------- | ----------------------- | --------------------- |
| Supabase         | todos os dados          | São Paulo             |
| Fly.io           | processamento           | São Paulo             |
| Resend           | e-mail e nome           | país não verificado   |
| Expo Push        | token e texto do aviso  | EUA, não verificado   |
| Sentry           | erros, sem dado pessoal | região não verificada |
| Google Geocoding | endereço                | EUA, não verificado   |
| ViaCEP           | CEP                     | Brasil                |
| Gateway          | pagamento               | Brasil                |

## Consequências

- Revisão do advogado antes do piloto (política de privacidade, tabela de operadores e retenções).
- Cada plano de módulo inclui o seu `AnonimizadorDeTitular`; o `seguranca` confere.
- Sem dado pessoal na auditoria, o admin não consegue "ver quem era" depois de uma anonimização, só o id. É intencional.
- Push e e-mail não levam endereço nem dado de terceiros.
