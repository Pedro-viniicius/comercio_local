# Decisões de arquitetura (ADR)

Cada ADR registra uma decisão que muda como o Bairrin é construído: o contexto que a motivou, o que foi decidido e o que isso custa. A discussão completa, com alternativas, tabelas comparativas e fontes, está em `docs/produto/planos/00-arquitetura.md`. Aqui ficam as versões curtas, que acompanham o código.

## Índice

| ADR                                                       | Decisão                                                              | Situação no código                                |
| --------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| [001](0001-apps-react-native-com-expo.md)                 | Apps em React Native com Expo e TypeScript                           | Apps ainda não criados                            |
| [002](0002-dois-apps-consumidor-e-lojista.md)             | Dois apps (consumidor e lojista) com pacotes compartilhados          | Apps ainda não criados; pacotes prontos           |
| [003](0003-api-nestjs-monolito-modular.md)                | API NestJS como monólito modular, fronteiras checadas                | Núcleo e `pnpm deps:verificar` prontos            |
| [004](0004-postgresql-e-prisma.md)                        | PostgreSQL com Prisma; migração destrutiva separada e barrada        | Pronto                                            |
| [005](0005-hospedagem-fly-e-supabase.md)                  | Fly.io (gru) e Supabase (sa-east-1); Data API desligada; dois papéis | Nada publicado; painel e API prontos para deploy  |
| [006](0006-gateway-pagarme-condicionado.md)               | Pagar.me condicionado a um portão de cinco itens                     | Futuro (plano 05)                                 |
| [007](0007-tempo-real-por-polling-com-etag.md)            | Polling curto com ETag para tempo real                               | Futuro (planos 04 e 06)                           |
| [008](0008-servicos-de-apoio-atras-de-portas.md)          | Push, mapas, geocodificação, imagens e e-mail atrás de portas        | Só o e-mail (SMTP e falso)                        |
| [009](0009-conexao-instavel-cache-fila-e-idempotencia.md) | Cache público, fila offline cifrada e `Idempotency-Key`              | Futuro (plano 02 em diante)                       |
| [010](0010-api-rest-v1-e-contratos-zod.md)                | REST `/v1`, contratos zod, Problem Details, cursor                   | Base pronta; autorização é do plano 01b           |
| [011](0011-eventos-com-outbox-e-pg-boss.md)               | Outbox e pg-boss, pelo menos uma vez, assinantes idempotentes        | Pronto                                            |
| [012](0012-sessao-e-autenticacao.md)                      | JWT de 15 minutos com renovação opaca rotativa; TOTP no admin        | Implementado na API e no painel (plano 01b)       |
| [013](0013-piramide-de-testes-e-ci.md)                    | Pirâmide de testes, CI e cadeia de suprimentos                       | Testes e CI prontos; CI ainda não rodou no GitHub |
| [014](0014-observabilidade-backups-e-operacao.md)         | Observabilidade, backups e operação                                  | Saúde e logs prontos; o resto depende do deploy   |
| [015](0015-dado-pessoal-auditoria-e-anonimizacao.md)      | Auditoria sem dado pessoal, anonimização por módulo e retenções      | Núcleo pronto; cada módulo entrega o seu          |

## Formato

Cada arquivo é `docs/adr/NNNN-titulo-em-kebab-case.md` e tem:

```
# ADR-NNN: Título

- Situação: aceita, substituída por ADR-NNN, ou abandonada.
- Origem: de onde vem a decisão.

## Contexto
## Decisão
## Consequências
```

Seja breve: o ADR diz o que foi decidido e o que isso custa, não repete o plano.

## Como mudar uma decisão

1. Decisão nova, de peso parecido com as acima: crie o próximo número (0016, 0017...).
2. Decisão que muda uma existente: não apague o ADR antigo. Marque a situação dele como "substituída por ADR-NNN" e escreva o novo. Correção de detalhe que não muda a decisão (um número, um nome de arquivo) pode ser feita no próprio ADR.
3. Registre no PR o que mudou, para o revisor.

O `CLAUDE.md` pede que `docs/adr/` seja atualizado na mesma mudança que altera uma decisão.
