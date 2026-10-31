# App Consumidor (`apps/consumidor`)

App Expo (React Native) em que o consumidor descobre lojas e produtos da cidade, compra e acompanha o pedido. Faz parte do Bairrin; veja a visão em `docs/produto/visao.md`.

## Situação

Mínimo pronto (plano 01a, etapa 8): Expo SDK 58 (`expo` 58.0.17, React Native 0.88.0), Expo Router e uma tela inicial que consulta `GET /v1/saude` e mostra "API disponível", "Sem conexão" ou "A API respondeu com erro". Ainda não há login, sessão nem telas de negócio: elas vêm com o plano 01b (trilha mobile) e os planos seguintes.

## O que o app tem

| Item                           | Valor                                                                   |
| ------------------------------ | ----------------------------------------------------------------------- |
| Nome                           | "Bairrin"                                                               |
| `bundleIdentifier` e `package` | `br.com.bairrin.consumidor`                                             |
| `scheme`                       | `bairrin`                                                               |
| Navegação                      | Expo Router, em `src/app`                                               |
| Configuração                   | `app.config.ts` e `eas.json` (perfis development, preview e production) |
| Tela inicial                   | `src/app/index.tsx` (rota) e `src/telas/EstadoDaApi.tsx` (a tela)       |
| Tema                           | `@bairrin/tokens` (só o tema claro, o único do MVP)                     |
| Textos                         | `src/textos/pt-BR.ts`                                                   |
| Testes                         | `jest-expo` e Testing Library (`@testing-library/react-native`)         |

O identificador é permanente nas lojas. O prefixo `br.com.bairrin` segue o domínio `bairrin.com.br` (a registrar). Decisões: ADR-001 e ADR-002.

### Pastas

```
src/app/       só rotas do Expo Router (_layout.tsx e index.tsx). Nada de teste aqui:
               todo arquivo desta pasta vira rota
src/telas/     telas e seus testes (EstadoDaApi.tsx e EstadoDaApi.test.tsx)
src/textos/    texto de interface
src/testes/    testes que montam o Expo Router inteiro (rotas.test.tsx)
```

### `eas.json`

- `development`: cliente de desenvolvimento (`developmentClient`), distribuição interna, APK no Android e simulador no iOS. O endereço da API vem do seu `.env`. Este perfil exige o `expo-dev-client`, que ainda não está instalado: instale-o na versão do SDK (`bundledNativeModules.json` do `expo`, sem `^`) quando o primeiro build de desenvolvimento for preciso; sem ele, `eas build --profile development` falha em modo não interativo.
- `preview`: distribuição interna (APK), com `EXPO_PUBLIC_API_URL=https://api.bairrin.com.br`.
- `production`: build para as lojas, com o mesmo endereço e `autoIncrement` do número de versão (a versão fica no EAS, `appVersionSource: remote`).
- Sem canal nem `expo-updates`: EAS Update fica fora até haver o plano pago (`docs/produto/decisoes.md`, P2). O endereço da API não é segredo; segredo nunca entra em `env` do `eas.json` nem em `EXPO_PUBLIC_*`.

## Variáveis

Copie `.env.example` para `.env` (fora do git).

| Variável              | Uso                                                              |
| --------------------- | ---------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL` | Endereço da API. Vai embutida no app: **nunca coloque segredo.** |

No emulador Android use `http://10.0.2.2:3000`; no celular físico, o IP da sua máquina na rede local; `127.0.0.1` serve ao simulador iOS e à web.

## Comandos

```bash
pnpm --filter consumidor start                       # Expo (Metro); abra no Expo Go ou no cliente de desenvolvimento
pnpm --filter consumidor test
pnpm --filter consumidor exec jest <caminho>
pnpm --filter consumidor typecheck
pnpm --filter consumidor exec expo export --platform android
pnpm --filter consumidor exec expo export --platform ios
```

`expo export` dos dois apps roda no CI de PR (saída em `dist/`, fora do git). O build Android nativo roda na `main` (`expo prebuild` e Gradle); o iOS é manual pelo EAS Build (ADR-013). `expo prebuild` cria `android/` e `ios/` (fora do git) e reescreve os scripts `android` e `ios` do `package.json`: se rodar local, desfaça essa mudança.

## Regras que valem desde já

- Texto de interface em `src/textos/pt-BR.ts`, nunca solto no componente.
- Regra de negócio fora do componente. Tokens vêm de `@bairrin/tokens`; sessão e fila offline virão de `@bairrin/mobile-base` (já nas dependências; hoje um esqueleto, plano 01b, etapas 12 em diante). Até a etapa 12a, que leva a tela para o pacote, `EstadoDaApi` e os textos existem em cópia nos dois apps.
- Cache de leitura só com consultas públicas; fila offline cifrada (ADR-009).
- Antes de publicar atualizações, ligar a assinatura de código do EAS Update (`docs/operacao/checklist-deploy.md`).
- Permissão sensível deste app: localização. Peça só o que o app usa.
