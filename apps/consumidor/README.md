# App Consumidor (`apps/consumidor`)

App Expo (React Native) em que o consumidor descobre lojas e produtos da cidade, compra e acompanha o pedido. Faz parte do Bairrin; veja a visão em `docs/produto/visao.md`.

## Situação: ainda não criado

A pasta só tem o `.env.example`. O app não tem `package.json`, então ainda **não entra no workspace** e nenhum comando abaixo funciona hoje.

Motivo: o Expo SDK 58 estável (`expo` 58.0.11, React Native 0.88.0) só fica elegível no `minimumReleaseAge` do `pnpm-workspace.yaml` (3 dias) em **2026-10-19**. As etapas 8 e 9 do plano `docs/produto/planos/01a-fundacao-repositorio.md` criam os dois apps a partir dessa data.

## O que o app terá

| Item                           | Valor                                                                   |
| ------------------------------ | ----------------------------------------------------------------------- |
| Nome                           | "Bairrin"                                                               |
| `bundleIdentifier` e `package` | `br.com.bairrin.consumidor`                                             |
| `scheme`                       | `bairrin`                                                               |
| Navegação                      | Expo Router, em `src/app`                                               |
| Configuração                   | `app.config.ts` e `eas.json` (perfis development, preview e production) |
| Tela inicial                   | "API disponível" ou "Sem conexão", via `@bairrin/cliente-api`           |
| Tema                           | `@bairrin/tokens`                                                       |
| Testes                         | `jest-expo` e Testing Library                                           |

O identificador é permanente nas lojas. O prefixo `br.com.bairrin` segue o domínio `bairrin.com.br` (a registrar). Decisões: ADR-001 e ADR-002.

## Variáveis

Copie `.env.example` para `.env` (fora do git).

| Variável              | Uso                                                              |
| --------------------- | ---------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL` | Endereço da API. Vai embutida no app: **nunca coloque segredo.** |

No emulador Android use `http://10.0.2.2:3000`; no celular físico, o IP da sua máquina na rede local; `127.0.0.1` serve ao simulador iOS e à web.

## Comandos previstos

Depois da criação do app:

```bash
pnpm --filter consumidor start
pnpm --filter consumidor test
pnpm --filter consumidor exec jest <caminho>
pnpm --filter consumidor exec expo export --platform android
pnpm --filter consumidor exec expo export --platform ios
```

`expo export` dos dois apps entra no CI de PR. O build Android nativo roda na `main`; o iOS é manual pelo EAS Build (ADR-013).

## Regras que valem desde já

- Texto de interface em `textos/pt-BR.ts`, nunca solto no componente.
- Regra de negócio fora do componente. Tokens, sessão e fila offline vêm de `packages/` (`@bairrin/mobile-base`, futuro).
- Cache de leitura só com consultas públicas; fila offline cifrada (ADR-009).
- Antes de publicar atualizações, ligar a assinatura de código do EAS Update (`docs/operacao/checklist-deploy.md`).
- Permissão sensível deste app: localização. Peça só o que o app usa.
