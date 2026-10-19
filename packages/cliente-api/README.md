# @bairrin/cliente-api

Cliente HTTP dos apps e do painel, tipado pelos contratos de `@bairrin/contratos`. Usa o `fetch` global (React Native, navegador e Node 22), que os testes podem trocar por um falso. O pacote é privado ao monorepo.

## Uso

```ts
import { criarClienteApi, ehErroSemConexao } from '@bairrin/cliente-api';

const cliente = criarClienteApi({ baseUrl: 'https://api.exemplo.com.br' });

try {
  await cliente.consultarSaude();
} catch (erro) {
  if (ehErroSemConexao(erro)) {
    // mostrar "Sem conexão"
  }
}
```

- `criarClienteApi({ baseUrl, fetch?, tempoLimiteMs? })`. A `baseUrl` vem de `EXPO_PUBLIC_API_URL` (apps) ou `VITE_API_URL` (painel), sem o prefixo de versão.
- `cliente.consultarSaude()` chama `GET /v1/saude`.
- `cliente.requisitar({ caminho, esquema, metodo?, corpo?, cabecalhos?, sinal? })` é a chamada genérica: valida a resposta 2xx com o esquema zod e devolve o corpo tipado.
- Tempo limite padrão de 10 s, cobrindo a resposta inteira, corpo incluído.
- O chamador cancela com `sinal` (troca de tela, por exemplo).

## Sessão autenticada

`criarClienteAutenticado` envolve o cliente base e cuida do token de acesso (ADR-012, plano 01b, etapa 5):

```ts
import { criarClienteApi, criarClienteAutenticado } from '@bairrin/cliente-api';

const base = criarClienteApi({ baseUrl });
const autenticado = criarClienteAutenticado({
  cliente: base,
  armazenamento, // ArmazenamentoDeSessao: SecureStore nos apps, memória no painel
  revogacaoPendente, // ArmazenamentoDeRevogacao: SecureStore (outra chave) nos apps, localStorage no painel
  modoDeRenovacao: 'token', // 'cookie' no painel
  clienteDoApp: 'app_consumidor', // ou 'app_lojista'; obrigatório no modo 'token', não usado no painel
  aoEncerrarSessao: (motivo) => limparCaches(motivo), // 'logout' | 'renovacao_recusada'
  aoFalharEmSegundoPlano: ({ origem }) => registrar(origem), // opcional; ver "Falhas em segundo plano"
});
```

- `autenticado.requisitar(...)` aceita as mesmas opções do cliente base, mais `renovarEm401`, e manda `Authorization: Bearer <tokenAcesso>`. Sem sessão, a requisição vai sem o cabeçalho. Qualquer `Authorization` passado pelo chamador é trocado pelo da sessão.
- **Renovação em 401:** a requisição que levou token e recebeu 401 renova uma vez (`POST /v1/sessoes/renovacao`) e repete com o token novo, mantendo método, corpo e `Idempotency-Key`. Repetir é seguro mesmo numa escrita, porque o 401 sai da guarda, antes de qualquer efeito.
  - **Fila única:** requisições concorrentes que recebem 401 esperam a mesma renovação. Um 401 que chega depois de a renovação terminar repete com o token novo sem renovar de novo. Toda decisão da fila é tomada sobre a sessão em memória, sem esperar o armazenamento.
  - **Uma vez só:** se a repetição falhar, ela devolve o próprio erro, sem nova renovação e sem encerrar a sessão.
  - **Recusa encerra:** se a API recusar a renovação (400, 401 ou 403), o cliente limpa o armazenamento, chama `aoEncerrarSessao('renovacao_recusada')` uma vez e devolve a cada requisição da fila o 401 original. Nos apps, sessão sem `tokenRenovacao` também é encerrada, e nesse caso a API nem é chamada.
  - **Falha sem recusa mantém a sessão:** com rede, tempo esgotado, 429, 5xx ou 2xx fora do contrato, a fila recebe esse erro e a sessão continua; a próxima requisição tenta de novo (a API tolera por 60 s o token recém-trocado, S16).
  - **`renovarEm401: false` (S9):** o 401 volta direto ao chamador, sem renovar, sem repetir e sem encerrar a sessão. Todo polling passa `false`: no painel, só a interação do usuário pode estender a inatividade de 30 min, e a renovação conta como atividade no servidor. O padrão é `true`. A opção fica no cliente autenticado e não chega ao cliente base.
- `modoDeRenovacao`: `token` (apps) manda `{ tokenRenovacao, cliente }` no corpo; `cookie` (painel) manda corpo vazio e `X-Cliente: painel`, e nunca guarda `tokenRenovacao`. No painel, o cookie só chega à API se o `fetch` injetado no cliente base enviar credenciais (`credentials: 'include'`).
- `clienteDoApp` (`app_consumidor` ou `app_lojista`) é obrigatório no modo `token`: vai como `cliente` no corpo de toda renovação, inclusive a da revogação pendente. A API compara o `cliente` da requisição para devolver o par da tolerância de 60 s (S16) e responde 400 ao corpo sem ele; como 400 conta como recusa, uma renovação sem o `cliente` encerraria a sessão ou daria por revogada uma pendência ainda viva no servidor. Sem um valor válido, `criarClienteAutenticado` lança `TypeError`. No modo `cookie`, não é usado.
- `iniciarSessao(sessao)` guarda a sessão recebida ao entrar. A chamada de entrar é pública e vai pelo cliente base, com `respostaDeEntrarSchema`. No painel, também apaga a marca de logout pendente: o login trocou o cookie, e a marca passaria a apontar para a sessão nova.
- `renovarSessao()` renova agora, na mesma fila. O painel chama ao abrir, porque o token de acesso só existe em memória. Devolve `null` quando não há como renovar ou quando a API recusou (ao abrir, sem sessão, não chama `aoEncerrarSessao`). No painel, com marca de logout pendente, tenta o logout e devolve `null` sem renovar, tenha a API confirmado ou não.
- `encerrarSessao()` é o logout e devolve `{ revogadaNoServidor }`. Limpa o armazenamento da sessão e chama `aoEncerrarSessao('logout')` sem esperar a rede, registra a revogação pendente e só depois de gravá-la pede a revogação à API (no painel, a marca é registrada antes até de limpar a sessão; nos apps, antes vem a leitura das pendências anteriores). A pendência só sai quando a API confirma. Rejeita só se não conseguir limpar o armazenamento da sessão.
  - **Apps:** `DELETE /v1/sessoes/atual` com o Bearer. Se a API recusar o token de acesso (401 ou 403), renova com o token de renovação e repete com o token novo, para revogar mesmo com o acesso vencido. Sem sessão, só refaz as revogações pendentes, se houver.
  - **Painel:** `DELETE /v1/sessoes/renovacao` com `X-Cliente: painel` e o cookie, sem Bearer, sem corpo e sem renovar antes (a API responde 204 sempre e apaga o cookie). Vai mesmo sem sessão em memória, porque o cookie pode estar vivo depois de recarregar.
  - `revogadaNoServidor` é `true` quando nada do que ficou no aparelho reabre a sessão encerrada agora: a API confirmou (2xx) ou, nos apps, recusou o token de acesso e a renovação. É `false` com rede, tempo esgotado, 429, 5xx ou 2xx fora do contrato; aí o app avisa o usuário (S80). Nos apps, sem sessão, vale para as pendências anteriores: `true` só se não sobrou nenhuma.
- `obterSessao()` devolve a sessão atual (`emailVerificado` serve só para a interface).
- **Troca de conta:** depois de `iniciarSessao` ou `encerrarSessao`, o resultado de uma renovação da sessão anterior é descartado, e uma requisição enviada com o token antigo não é repetida com o da conta nova.

`ArmazenamentoDeSessao` tem `ler`, `gravar` e `limpar`. O cliente lê uma vez, na primeira requisição (um valor fora do formato conta como sem sessão; uma leitura que falha devolve o erro e é tentada de novo na próxima), e depois mantém a sessão em memória. É o único que escreve: as escritas chegam em ordem, uma por vez, e só com os campos do contrato.

### Revogação pendente (S80)

O logout que a API não confirmou fica guardado em `ArmazenamentoDeRevogacao` (`ler`, `gravar`, `limpar`), separado da sessão, e o cliente tenta de novo:

- **Painel:** a marca é sempre `{}`, sem token nem id (P14); o `localStorage` serve, porque a marca precisa sobreviver a fechar a aba. Qualquer valor guardado conta como marca. Com a marca, `renovarSessao()` não restaura a sessão pelo cookie: tenta o logout primeiro. Uma leitura da marca que falha faz `renovarSessao()` rejeitar, sem renovar.
- **Apps:** guarda o par de tokens da sessão encerrada no SecureStore, numa chave diferente da do par em uso. Toda `requisitar` e `renovarSessao` retomam a revogação, sem esperar por ela e sem que o erro dela chegue à chamada; só uma tentativa corre por vez. Se a tentativa precisou renovar (com o `clienteDoApp` no corpo, como qualquer renovação), o par trocado substitui o guardado. Um valor fora do formato conta como sem pendência.
- **Várias pendências nos apps (Q21):** um logout sem confirmação não apaga os anteriores. O valor guardado traz o par mais novo no topo e os anteriores, do mais novo para o mais antigo, em `anteriores`, que só aparece quando há algum: `{ tokenAcesso, tokenRenovacao, anteriores?: [{ tokenAcesso, tokenRenovacao }] }`. Cabem até `MAXIMO_DE_REVOGACOES_PENDENTES` (5) pares; passando disso, sai o mais antigo, cuja credencial já não está em nenhum outro lugar do aparelho. Cada tentativa revoga todos em paralelo e tira só os confirmados. O logout com sessão espera só a revogação da sessão atual; os anteriores ficam para a próxima tentativa. Um item de `anteriores` fora do formato é ignorado.
- O armazenamento só precisa guardar e devolver o objeto como recebeu (a etapa 12 grava o JSON numa chave do SecureStore). No painel, o valor continua sempre `{}`: o login apaga a marca, então nunca há marca anterior.
- Uma tentativa antiga que termina depois de um logout ou login mais novo tira da lista só o que ela mesma confirmou: a marca nova do painel e a pendência mais nova nunca saem por engano.
- Se a leitura das pendências falhar, o logout segue: com sessão, revoga a sessão atual e grava só ela (a gravação substitui as pendências anteriores que não deu para ler, e essas sessões vivem no servidor até vencer); sem sessão, devolve `{ revogadaNoServidor: false }`. Nos dois casos a falha vai para `aoFalharEmSegundoPlano` (`revogacao_pendente`), sem rejeitar.

### Falhas em segundo plano (Q18)

O que falha no armazenamento ou no aviso não troca o resultado da requisição. A falha vai para `aoFalharEmSegundoPlano({ origem, erro })`; registre só a `origem` e o nome do erro. Um erro lançado por essa função é descartado.

| `origem`                | Quando                                                                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gravar_sessao`         | Gravar o par renovado. A requisição repete com o token novo, que segue em memória, e o cliente limpa o armazenamento: o par antigo, lido na próxima abertura, pareceria reuso e derrubaria a família (S16). Sem sessão guardada, a próxima abertura pede login. |
| `limpar_sessao`         | Limpar depois de uma renovação recusada (a requisição devolve o 401 original) ou depois de um `gravar_sessao`.                                                                                                                                                  |
| `revogacao_pendente`    | Ler, gravar ou limpar a revogação pendente. A decisão em memória vale até o app fechar.                                                                                                                                                                         |
| `aviso_de_encerramento` | O `aoEncerrarSessao` lançou. A sessão já foi encerrada.                                                                                                                                                                                                         |

## Erros tipados

Todos os erros têm um campo `tipo`:

| Classe                 | `tipo`              | Quando                                                                                                                                                 |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ErroDeApi`            | `api`               | A API respondeu com erro HTTP. Traz `status`, `codigo`, `campos` e `idRequisicao` do Problem Details; sem Problem Details, `codigo` é `erro_generico`. |
| `ErroSemConexao`       | `sem_conexao`       | Falha de rede (`motivo: 'rede'`) ou tempo esgotado (`'tempo_esgotado'`).                                                                               |
| `ErroRespostaInvalida` | `resposta_invalida` | 2xx com corpo fora do contrato (app antigo, API nova).                                                                                                 |
| `ErroCancelado`        | `cancelado`         | O chamador cancelou. Não é falha de rede.                                                                                                              |

`ehErroSemConexao` e `ehErroDeApi` ajudam a distinguir.

- `campos[].codigo` é texto livre na leitura: uma API mais nova pode mandar um código que o app não conhece, e o `ErroDeApi` mantém `campos` e `idRequisicao` (ADR-010). Sem texto para `erro.<campo>.<codigo>`, mostre o `motivo`.
- `ErroSemConexao` não garante que a API não recebeu o pedido. Repetir uma leitura é seguro; repetir uma escrita só é seguro se ela foi enviada com `Idempotency-Key` e a nova tentativa reusa a mesma chave (ADR-009).

## Dado pessoal

O cliente não registra nada em log, e nenhuma mensagem de erro inclui URL, corpo ou cabeçalhos, porque podem carregar dado pessoal e token. Mantenha assim. O cliente autenticado segue a mesma regra: os tokens só aparecem no cabeçalho `Authorization`, no corpo da renovação e nos armazenamentos (nos apps, também na revogação pendente; a marca do painel não leva token), e um teste confere que nenhum erro devolvido os carrega.

## Tipos sem DOM

O pacote compila sem os tipos de DOM nem de Node. `src/cliente.ts` declara só as interfaces mínimas de que precisa (`fetch`, `AbortController`, `setTimeout`); um teste ou módulo novo que use esses globais faz o mesmo.

## Comandos

```bash
pnpm --filter @bairrin/cliente-api test
pnpm --filter @bairrin/cliente-api typecheck
pnpm --filter @bairrin/cliente-api build
```

Exporta o fonte pela condição `@bairrin/fonte` e `react-native`, e o `dist` por `default`. O `vitest.config.ts` liga `@bairrin/fonte`: os testes leem `@bairrin/contratos` pelo fonte e passam sem build prévio.
