# ADR-001: Apps em React Native com Expo

- Situação: aceita (decisão do dono, 2026-10-16).
- Origem: `docs/produto/planos/00-arquitetura.md`, abordagem 1.

## Contexto

O Bairrin precisa de apps para Android e iOS, feitos por uma equipe de 1 a 3 pessoas. A API e o painel já são TypeScript. As alternativas eram Flutter (uma segunda linguagem, Dart, só nos apps) e nativo em Kotlin e Swift (quatro bases de código para dois apps).

## Decisão

Os apps usam React Native com Expo e TypeScript. Versão da fundação: Expo SDK 58 e React Native 0.88. Navegação por Expo Router, tokens guardados no SecureStore (Keychain e Keystore) e builds pelo EAS Build, que gera o iOS sem precisar de um Mac.

## Consequências

- Uma linguagem nos três produtos e esquemas zod compartilhados com a API.
- O desempenho de listas muito pesadas fica abaixo do nativo. Aceito para o MVP.
- Depende do ecossistema Expo. Mitigação: versões fixas e atualização de SDK planejada, uma vez por SDK. Se um SDK quebrar, mantém-se o anterior e corrigem-se erros de JavaScript com EAS Update.
- O pnpm com dependências isoladas é suportado pelo Expo desde o SDK 54. Se o build nativo quebrar no monorepo, o plano B é `nodeLinker: hoisted` no `pnpm-workspace.yaml`.
- EAS Update deve ser publicado com assinatura de código (ver `docs/operacao/checklist-deploy.md`). Segundo a documentação do Expo, esse recurso exige plano pago do EAS, o que o custo inicial estimado no plano 00 (EAS Free) não previa.
- Situação do código: os apps ainda não foram criados. O SDK 58 estável só fica elegível no `minimumReleaseAge` em 2026-10-19 (ver `apps/consumidor/README.md`).
