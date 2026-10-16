---
name: reference-fontes-lojas
description: Onde conferir custos e regras de publicação (Expo/EAS, GitHub Actions, Apple, Google Play) e o que estava valendo ou sem confirmação em 2026-10-16
metadata:
  type: reference
---

Conferido em 2026-10-16 (reconferir antes de usar):
- Expo: expo.dev/pricing (Free com 15 builds Android e 15 iOS por mês, baixa prioridade, timeout de 45 min, 1 macOS; Submit incluso; assinatura do Update só no Production, US$ 199). Cota esgotada: espera o dia 1º (docs.expo.dev/billing/faq.md).
- GitHub: docs.github.com/en/billing/reference/actions-runner-pricing (macOS a US$ 0,062/min); repositório privado no Free tem 2.000 min. O multiplicador do macOS **não está na doc atual**. **Environments não existem em repositório privado no Free** (manage-environments).
- Google Play: answer/14151465 (12 testadores por 14 dias, só conta pessoal criada depois de 2023-11-13); answer/13628312 (pessoal × organização, D-U-N-S); answer/13327111 (exclusão de conta pelo link na web); verificação de desenvolvedor no Brasil desde 2026-09-30 (developer.android.com/developer-verification/guides).
- Apple: developer.apple.com/support/enrollment (empresário individual entra como pessoa física, com o nome civil como vendedor; conversão só pelo suporte); transferência de app mantém avaliações e bundle ID.
- Sem confirmação: `--no-wait` com `--auto-submit`; `eas submit --path`; preço da Apple em reais; robô do Expo no Free; se o papel Developer do App Store Connect envia ao TestFlight; se "Release apps to testing tracks" da Play inclui o teste aberto (só fonte de terceiros, via `seguranca`); se o EAS lê o `.easignore` da raiz em monorepo (`eas build:inspect --stage archive` confere); nome da opção de sessão no Sentry React Native.
- Conhecido (via `seguranca`, 2026-10-16): `eas credentials` só gera chave ASC Admin ou App Manager; o `.easignore` substitui o `.gitignore` no envio.

Relacionado: [[project-arquitetura-mvp]], [[reference-fontes-gateways]]
