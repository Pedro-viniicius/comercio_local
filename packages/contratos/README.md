# @bairrin/contratos

Esquemas zod compartilhados por API, apps e painel. É a fonte única do formato de requisições, respostas e erros (ADR-010). O pacote é privado ao monorepo.

## O que exporta

| Export                                                                 | Para quê                                                                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `z`                                                                    | O zod 4 já configurado com o locale `ptBR`. **Importe `z` daqui, nunca de `zod`.**                                        |
| `objetoEstrito(forma)`                                                 | Objeto que recusa campo desconhecido. Use em todo corpo e consulta HTTP.                                                  |
| `problemaSchema`, `Problema`, `criarProblema`, `ERROS`, `CodigoDeErro` | Problem Details (RFC 9457) e os códigos de erro da API (no 01b, `sem_acesso_painel` 403 e `exclusao_com_pendencias` 409). |
| `campoComErroSchema`, `CODIGOS_DE_CAMPO`, `camposDoErroZod`            | Erro de campo `{campo, codigo, motivo}` e a conversão de um erro do zod.                                                  |
| `campoDoProblemaSchema`, `CampoDoProblema`                             | Erro de campo como o cliente o lê, com `codigo` em texto livre.                                                           |
| `TIPO_DE_CONTEUDO_PROBLEMA`                                            | `application/problem+json`.                                                                                               |
| `formaDaPaginacao`, `consultaPaginadaSchema`, `paginaSchema`, `Pagina` | Paginação por cursor, com `limite` de no máximo 20.                                                                       |
| `saudeSchema`, `prontidaoSchema`                                       | Contratos de `GET /v1/saude` e `GET /v1/saude/pronto`.                                                                    |
| Esquemas de `src/identidade/`                                          | Contratos das rotas de conta, sessão, senha, 2FA e privacidade (ver abaixo).                                              |
| `EVENTOS_DE_IDENTIDADE`                                                | Eventos v1 da Identidade: `tipo`, `versao` e esquema estrito do payload (só ids).                                         |
| Validadores (também em `@bairrin/contratos/validadores`)               | Funções puras de nome, e-mail, celular, senha e código e as constantes da Identidade (ver abaixo).                        |

## Regras de uso

- **Requisição estrita, resposta tolerante.** Corpo e consulta usam `objetoEstrito` (campo desconhecido gera 400). Resposta lida por cliente usa `z.object`, para que um app antigo entenda uma API mais nova.
- **Códigos de campo.** O Problem Details leva `campos[{campo, codigo, motivo}]`. A API produz `codigo` em `obrigatorio`, `invalido`, `comum` ou `desconhecido` (`CampoComErro`, `z.enum`); o cliente lê `codigo` como texto livre (`CampoDoProblema`), para que um app antigo não descarte o Problema de uma API que criou um código novo. O app mostra o texto por `erro.<campo>.<codigo>` e usa o `motivo` quando não conhece a chave.
- **Campo ausente.** O `obrigatorio` é detectado por um motivo-marcador (`Campo obrigatório.`) devolvido pelo locale: a `issue` final do zod não traz o valor recebido. Um esquema com `{ error: 'texto' }` próprio em campo ausente vira `invalido`.
- **Erros com código próprio.** `refine(fn, { params: { codigo } })` chega ao conversor como `issue.params`.
- Dinheiro em centavos inteiros, datas ISO 8601 em UTC, IDs UUID. A API produz a data em UTC (`Z`); a resposta lida pelo cliente aceita também data com deslocamento (`z.iso.datetime({ offset: true })`). Quantidade e tamanho de lista em resposta são regra do produtor, não do esquema de leitura.
- Nova rota ou novo erro entra aqui primeiro; a API e os clientes só consomem.
- Campo com mensagem própria: a mensagem vai só nos checks (`refine`...), nunca no tipo base, e cada check que reprova encerra o campo (`abort: true`), para o campo ausente continuar `obrigatorio` e cada campo receber um erro só.
- **Texto sem `.min`, `.max` nem `.length` do zod.** Esses checks rodam também em valor que não é texto mas tem `length` (`[]`, `{"length": 0}`), depois do erro de tipo, e o campo sairia com dois erros (Q14). O texto obrigatório usa `.refine(ehTextoPreenchido, CAMPO_OBRIGATORIO)` (`src/zod.ts`) e o limite de tamanho, um `refine` com motivo próprio.

## Validadores (`@bairrin/contratos/validadores`)

Funções puras, sem zod nem outra dependência. É o único caminho de pacote que o domínio da API pode importar (`.dependency-cruiser.cjs`, ADR-003); os esquemas de `src/identidade/` usam as mesmas funções, então app, painel e API validam igual. Também saem pela raiz do pacote.

| Função                                                   | Regra                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalizarNome`, `problemaDoNome`                       | Nome: NFC e sem espaço nas pontas; até 80 pontos de código, sem controle, formatação invisível, separador de linha ou parágrafo, substituto solto, uso privado nem ponto não atribuído. Devolve `vazio`, `longo`, `caractere_proibido` ou `null`.                                                                                                                                       |
| `normalizarEmail`, `ehEmailValido`                       | NFC, sem espaço nas pontas e em minúsculas (inclusive a parte local); pontos e `+` ficam. Até 254 caracteres (64 antes do `@`), só ASCII. Devolve `null` se inválido.                                                                                                                                                                                                                   |
| `normalizarCelular`, `ehCelularValido`, `ehDddValido`    | Celular com DDD da lista da Anatel (`DDDS_VALIDOS`, 67) e 9 dígitos começando por 9; aceita `+55`, `55` e `0` na frente. Devolve E.164 (`+5535999991234`).                                                                                                                                                                                                                              |
| `problemaDaSenha`, `tamanhoDaSenha`, `ehSenhaBemFormada` | Senha nova: 8 a 128 caracteres (pontos de código, um emoji conta um), sem metade de par substituto solta (S75), fora da lista local de comuns. Devolve `curta`, `longa`, `mal_formada`, `comum` ou `null`.                                                                                                                                                                              |
| `ehSenhaComum`, `formaComparavelDaSenha`                 | Lista local escrita à mão (S22, S74): senhas frequentes, trechos de sequência e de teclado, repetições, senha só de dígitos e símbolos e palavra óbvia, nome próprio comum no Brasil ou senha da lista com até 8 dígitos e símbolos em cada ponta (também com letra trocada por dígito, como `passw0rd`). Compara na forma NFKC, sem acento, espaço, caractere invisível nem maiúscula. |
| `PERFIS`, `CLIENTES`, `ETAPAS_DO_DESAFIO`                | Perfis da conta, clientes da sessão e etapas do desafio do 2FA, com os tipos `Perfil`, `Cliente` e `EtapaDoDesafio`.                                                                                                                                                                                                                                                                    |
| `normalizarCodigo`, `normalizarCodigoDeRecuperacao`      | Código de 6 dígitos ASCII (espaços saem) e código de recuperação do 2FA com 10 caracteres base32 (em maiúsculas, sem hífen).                                                                                                                                                                                                                                                            |

A lista de senhas comuns não vem de fonte pública: a licença e a cadeia de suprimentos de uma lista baixada não foram aprovadas.

Os textos `MOTIVO_*` são os `motivo` em português dos erros de campo, com o texto da spec 01 quando ela o define.

## Identidade (`src/identidade/`)

Corpos estritos (`objetoEstrito`); respostas tolerantes (`z.object`). Nome, e-mail, celular e códigos saem do parse já normalizados; a senha sai como foi digitada (o `Hasher` da API aplica NFKC no hash e na verificação).

| Arquivo            | Contratos                                                                                                                                                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contas.ts`        | Campos reaproveitados (`nomeSchema`, `emailSchema`, `telefoneSchema`, `senhaNovaSchema`, `senhaAtualSchema`, `codigoSchema` (e-mail), `codigoDoAutenticadorSchema` (TOTP, motivo da tela P1a), `versaoDeDocumentoSchema`, `corpoVazioSchema`), `criarContaSchema`, `verificarEmailSchema`, `contaSchema` |
| `sessoes.ts`       | `entrarSchema`, `sessaoSchema` (`{tokenAcesso, expiraEm, emailVerificado, tokenRenovacao?}`), `desafioDeSegundoFatorSchema`, `respostaDeEntrarSchema`, `renovarSessaoSchema`, `CABECALHO_DO_CLIENTE`                                                                                                     |
| `senha.ts`         | `solicitarRecuperacaoSchema`, `redefinirSenhaSchema`                                                                                                                                                                                                                                                     |
| `segundo-fator.ts` | `iniciarConfiguracaoSchema`, `configuracaoDeSegundoFatorSchema`, `confirmarConfiguracaoSchema`, `segundoFatorConfirmadoSchema`, `verificarSegundoFatorSchema` (exatamente um código: TOTP ou de recuperação)                                                                                             |
| `privacidade.ts`   | `privacidadeSchema`, `solicitarExclusaoSchema`                                                                                                                                                                                                                                                           |
| `eventos.ts`       | `EVENTOS_DE_IDENTIDADE`: `ContaCriada`, `CadastroRepetidoTentado`, `VerificacaoReenviada`, `RecuperacaoSolicitada`, `SenhaRedefinida`, `ExportacaoSolicitada`, `ContaDesativada`, `ContaAnonimizada` (v1, payload só com ids)                                                                            |

- Senha nova (cadastro e redefinição) usa `senhaNovaSchema`, com o código `comum` para senha da lista. Login e exclusão usam `senhaAtualSchema`, que só exige a senha, limita o tamanho e recusa texto mal formado: a regra nova não vale para conferir a senha guardada.
- Rota sem corpo (reenvio, renovação do painel, exportação) usa `corpoVazioSchema`: ausente ou `{}`; qualquer campo gera 400.

## Como é consumido

O pacote exporta o código-fonte pela condição `@bairrin/fonte` (Vitest, Vite e dependency-cruiser a usam) e o `dist` por `default` (Node e a API compilada), tanto na raiz quanto no subcaminho `./validadores`. Num clone limpo, compile antes de rodar a API (o painel e os testes leem o fonte):

```bash
pnpm --filter @bairrin/contratos run build
```

## Comandos

```bash
pnpm --filter @bairrin/contratos test
pnpm --filter @bairrin/contratos typecheck
pnpm --filter @bairrin/contratos build
```

Não há `lib` de DOM nem de Node neste pacote (`lib: ["ES2023"]`, `types: []`).
