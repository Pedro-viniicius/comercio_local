// Cache persistido do React Query restrito à lista permitida (plano 01b, etapa 12; ADR-009, S11).
// Só consultas públicas, sem dado pessoal, vão para o aparelho; mutações nunca vão (o corpo pode
// levar dado pessoal ou token). O filtro fica na borda do persister, e não só nas opções do
// `dehydrate`: um `shouldDehydrateQuery` mal configurado continua sem gravar o que está fora da
// lista. A leitura passa pelo mesmo filtro, para um cache gravado por outra versão do app não
// entrar no `queryClient`.
//
// A interface é a do `Persister` do `@tanstack/query-persist-client-core` (mesmos nomes e tipos),
// que entra junto com a vitrine e o armazenamento do cache (planos 02 e 03): lá, o persister real
// passa por `criarPersisterPermitido` antes de chegar ao `PersistQueryClientProvider`.
import type { DehydratedState, QueryKey } from '@tanstack/react-query';

/**
 * Raízes de `queryKey` que podem ir para o cache persistido: só consultas públicas, sem dado
 * pessoal (vitrine). Vazia até os planos 02 e 03; quem acrescentar uma raiz confere que a
 * resposta não traz dado pessoal nem depende da conta.
 */
export const CONSULTAS_PERSISTIDAS: readonly string[] = Object.freeze([]);

/** Igual ao `PersistedClient` do TanStack. */
export interface CachePersistido {
  timestamp: number;
  buster: string;
  clientState: DehydratedState;
}

/** Igual ao `Persister` do TanStack. */
export interface PersisterDoCache {
  persistClient(cache: CachePersistido): Promise<void> | void;
  restoreClient(): Promise<CachePersistido | undefined> | CachePersistido | undefined;
  removeClient(): Promise<void> | void;
}

/** Se a consulta pode ir para o aparelho: a raiz da chave está na lista. */
export function podePersistir(
  queryKey: QueryKey,
  lista: readonly string[] = CONSULTAS_PERSISTIDAS,
): boolean {
  const raiz = queryKey[0];
  return typeof raiz === 'string' && lista.includes(raiz);
}

/**
 * Só as consultas da lista que terminaram com sucesso, sem `meta`, sem promessa pendente e sem
 * erro; nenhuma mutação.
 */
export function filtrarCache(
  cache: CachePersistido,
  lista: readonly string[] = CONSULTAS_PERSISTIDAS,
): CachePersistido {
  const queries = cache.clientState.queries
    .filter(
      (consulta) => consulta.state.status === 'success' && podePersistir(consulta.queryKey, lista),
    )
    .map((consulta) => ({
      queryHash: consulta.queryHash,
      queryKey: consulta.queryKey,
      dehydratedAt: consulta.dehydratedAt,
      ...(consulta.queryType === undefined ? {} : { queryType: consulta.queryType }),
      state: { ...consulta.state, error: null, fetchFailureReason: null },
    }));
  return {
    timestamp: cache.timestamp,
    buster: cache.buster,
    clientState: { queries, mutations: [] },
  };
}

/** Envolve o persister real: grava e devolve só o que está na lista. */
export function criarPersisterPermitido(
  persister: PersisterDoCache,
  lista: readonly string[] = CONSULTAS_PERSISTIDAS,
): PersisterDoCache {
  return {
    persistClient: (cache) => persister.persistClient(filtrarCache(cache, lista)),
    async restoreClient() {
      const guardado = await persister.restoreClient();
      return guardado === undefined ? undefined : filtrarCache(guardado, lista);
    },
    removeClient: () => persister.removeClient(),
  };
}
