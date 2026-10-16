# ADR-008: Serviços de apoio atrás de portas, com falsos para teste

- Situação: aceita (decisão do dono, 2026-10-16). Da lista abaixo, só o e-mail por SMTP existe no código.
- Origem: `docs/produto/planos/00-arquitetura.md`, abordagem 6.

## Contexto

Push, mapas, geocodificação, imagens, e-mail e deep links dependem de fornecedores externos. O desenvolvimento e o CI não podem depender de nenhum deles nem gastar cota.

## Decisão

| Necessidade      | Escolha                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Push             | Expo Push Service atrás da porta `EnviadorDePush` (prioridade alta, `channelId` Android, recibos)                                       |
| Mapas            | `react-native-maps`                                                                                                                     |
| Geocodificação   | Google Geocoding no servidor (chave nunca no app) e ViaCEP para CEP, com cache                                                          |
| Imagens          | upload pela API, bucket privado, worker valida, remove EXIF e gera WEBP com `sharp`, bucket público do Supabase Storage                 |
| E-mail           | SMTP com `nodemailer`; Mailpit em desenvolvimento e nos testes; Resend em produção, remetente em `bairrin.com.br` com SPF, DKIM e DMARC |
| Links para o app | Expo Router, App Links e Universal Links em `https://bairrin.com.br` (após o registro)                                                  |

Cada serviço fica atrás de uma porta (classe abstrata) com um adaptador real e um falso.

## Consequências

- Testes e CI usam falsos (`GatewayFalso`, `EnviadorDePushFalso`, geocodificador falso, Mailpit); nada sai para a internet.
- Hoje existe a porta `EnviadorDeEmail` com o adaptador SMTP e o falso em memória (`apps/api/src/compartilhado/email/`).
- Cada fornecedor estrangeiro é operador de dado pessoal e consta na tabela do ADR-015.
- Pontos não verificados no plano: preço do Expo Push, SMTP do Resend, provedor de mapas no iOS.
