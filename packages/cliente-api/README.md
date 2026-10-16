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

O cliente não registra nada em log, e nenhuma mensagem de erro inclui URL, corpo ou cabeçalhos, porque podem carregar dado pessoal e token. Mantenha assim.

## Tipos sem DOM

O pacote compila sem os tipos de DOM nem de Node. `src/cliente.ts` declara só as interfaces mínimas de que precisa (`fetch`, `AbortController`, `setTimeout`); um teste ou módulo novo que use esses globais faz o mesmo.

## Comandos

```bash
pnpm --filter @bairrin/cliente-api test
pnpm --filter @bairrin/cliente-api typecheck
pnpm --filter @bairrin/cliente-api build
```

Exporta o fonte pela condição `@bairrin/fonte` e `react-native`, e o `dist` por `default`. O `vitest.config.ts` liga `@bairrin/fonte`: os testes leem `@bairrin/contratos` pelo fonte e passam sem build prévio.
