# Identidade visual do Bairrin

Desenhos oficiais da marca. A spec (cores, regras de uso, área de respiro) está em `docs/produto/specs/00-nome-e-identidade.md`, seções 2.5 e 2.7. Os SVGs não têm texto nem fonte: o wordmark é desenhado em caminhos. Não têm `width`/`height`, só `viewBox`; defina o tamanho no componente.

## Arquivos

| Arquivo                                                                                        | Uso                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bairrin-logo-horizontal.svg` (`-branco`, `-mono`)                                             | Cabeçalho de marca dos apps e do painel, login, e-mails. `viewBox` 197×66. O `-branco` é para fundo `blue.600` ou `blue.900`; o `-mono`, para impressão de uma cor |
| `bairrin-logo-empilhado.svg` (`-branco`, `-mono`)                                              | Materiais quadrados, adesivo da vitrine. `viewBox` 160×120                                                                                                         |
| `bairrin-simbolo.svg`                                                                          | Só o pino: avatar, carregamento, marcadores                                                                                                                        |
| `bairrin-icone-ios-1024.svg`                                                                   | Ícone do app do consumidor (iOS e Play). Quadrado, sem cantos: o sistema arredonda                                                                                 |
| `bairrin-icone-android-fundo.svg`, `-frente.svg`, `-mono.svg`                                  | Ícone adaptativo do Android do consumidor; o mono serve também ao lojista                                                                                          |
| `bairrin-lojista-icone-ios-1024.svg`, `bairrin-lojista-icone-android-fundo.svg`, `-frente.svg` | Ícone do app do lojista                                                                                                                                            |
| `bairrin-splash.svg`                                                                           | Tela de abertura: fundo `blue.900`, logo empilhado branco e slogan                                                                                                 |
| `bairrin-favicon-32.svg`                                                                       | Favicon do painel (sem ponto verde nem listras)                                                                                                                    |
| `gerar-png.sh`                                                                                 | Gera os PNG em `png/` (veja abaixo)                                                                                                                                |

## Cores

- Fundo do ícone adaptativo do consumidor: `#1F5BD1` (`blue.600`).
- Fundo do splash: `#18336B` (`blue.900`). Use a mesma cor em `backgroundColor` do `expo-splash-screen`.

## Variação do lojista

Mesmo símbolo do consumidor, com fundo `#18336B` (`blue.900`) no lugar de `#1F5BD1` e toldo `#1F5BD1`. Fundo do ícone adaptativo do lojista: `#18336B`. A justificativa e os contrastes estão na spec.

## PNG

`./assets/brand/gerar-png.sh` usa o Chrome headless e o Pillow (sem instalar nada) e grava em `assets/brand/png/`: ícone iOS 1024 sem transparência, frente e mono do Android em 1024 (transparentes), splash 1024 e ícone da Google Play 512, para consumidor e lojista. Refaça os PNG sempre que um SVG mudar. O script apaga cada PNG antes de gerar e para com erro se o Chrome falhar ou se o arquivo não sair com o tamanho pedido. Os PNG ficam no git, porque o CI não tem Chrome e o antialiasing muda com a versão dele; `scripts/assets-brand.test.mjs` confere no CI o tamanho e o canal alfa de cada um.
