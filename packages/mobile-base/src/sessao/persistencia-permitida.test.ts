// Cache persistido só com a lista permitida (plano 01b, etapa 12; ADR-009, S11).
import { dehydrate, MutationObserver, QueryClient } from '@tanstack/react-query';
import {
  CONSULTAS_PERSISTIDAS,
  criarPersisterPermitido,
  filtrarCache,
  podePersistir,
  type CachePersistido,
} from './persistencia-permitida.ts';
import { criarPersisterEspiao } from './teste/cenario.ts';

const LISTA = ['vitrine', 'categorias'];

function clienteComTudo(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity }, mutations: { gcTime: Infinity } },
  });
  queryClient.setQueryData(['vitrine', { bairro: 'centro' }], { lojas: ['Padaria'] });
  queryClient.setQueryData(['categorias'], ['pães']);
  queryClient.setQueryData(['conta'], { nome: 'Maria', telefone: '+5535999990000' });
  queryClient.setQueryData([{ raiz: 'vitrine' }], { lojas: [] });
  return queryClient;
}

function tudo(queryClient: QueryClient): CachePersistido {
  return {
    timestamp: 10,
    buster: 'v1',
    clientState: dehydrate(queryClient, {
      shouldDehydrateQuery: () => true,
      shouldDehydrateMutation: () => true,
    }),
  };
}

describe('persistência permitida (S11)', () => {
  it('a lista do MVP está vazia: nada vai para o aparelho até a vitrine existir', () => {
    expect(CONSULTAS_PERSISTIDAS).toEqual([]);
    expect(Object.isFrozen(CONSULTAS_PERSISTIDAS)).toBe(true);
    expect(podePersistir(['vitrine'])).toBe(false);
  });

  it('só a raiz da chave em texto, e só se estiver na lista', () => {
    expect(podePersistir(['vitrine', { bairro: 'centro' }], LISTA)).toBe(true);
    expect(podePersistir(['conta'], LISTA)).toBe(false);
    expect(podePersistir([{ raiz: 'vitrine' }], LISTA)).toBe(false);
    expect(podePersistir([], LISTA)).toBe(false);
    expect(podePersistir(['vitrine-da-conta'], LISTA)).toBe(false);
  });

  it('filtra consultas fora da lista, consultas sem sucesso e todas as mutações', async () => {
    const queryClient = clienteComTudo();
    await queryClient
      .fetchQuery({
        queryKey: ['vitrine', 'falhou'],
        queryFn: () => Promise.reject(new Error('x')),
      })
      .catch(() => undefined);
    await new MutationObserver(queryClient, {
      mutationFn: (v: unknown) => Promise.resolve(v),
    }).mutate({ nome: 'Maria' });

    const filtrado = filtrarCache(tudo(queryClient), LISTA);

    expect(filtrado.timestamp).toBe(10);
    expect(filtrado.buster).toBe('v1');
    expect(filtrado.clientState.mutations).toEqual([]);
    expect(filtrado.clientState.queries.map((q) => q.queryKey)).toEqual([
      ['vitrine', { bairro: 'centro' }],
      ['categorias'],
    ]);
    expect(JSON.stringify(filtrado)).not.toContain('Maria');
  });

  it('não leva meta nem promessa da consulta, e zera os erros guardados', () => {
    const cache: CachePersistido = {
      timestamp: 1,
      buster: '',
      clientState: {
        mutations: [],
        queries: [
          {
            queryHash: '["vitrine"]',
            queryKey: ['vitrine'],
            dehydratedAt: 5,
            meta: { conta: 'id-da-conta' },
            promise: Promise.resolve(),
            state: {
              ...tudo(clienteComTudo()).clientState.queries[0]!.state,
              fetchFailureReason: new Error('erro antigo'),
            },
          },
        ],
      },
    };

    const [consulta] = filtrarCache(cache, LISTA).clientState.queries;

    expect(consulta).not.toHaveProperty('meta');
    expect(consulta).not.toHaveProperty('promise');
    expect(consulta?.state.error).toBeNull();
    expect(consulta?.state.fetchFailureReason).toBeNull();
    expect(consulta?.dehydratedAt).toBe(5);
  });

  it('o persister permitido grava e devolve só a lista e repassa a remoção', async () => {
    const real = criarPersisterEspiao();
    const persister = criarPersisterPermitido(real, LISTA);

    await persister.persistClient(tudo(clienteComTudo()));
    expect(real.gravados[0]?.clientState.queries.map((q) => q.queryKey[0])).toEqual([
      'vitrine',
      'categorias',
    ]);

    // Um cache gravado por outra versão do app, com consulta fora da lista, não volta.
    const antigo = tudo(clienteComTudo());
    real.restoreClient = () => antigo as unknown as undefined;
    const restaurado = await persister.restoreClient();
    expect(restaurado?.clientState.queries.map((q) => q.queryKey[0])).toEqual([
      'vitrine',
      'categorias',
    ]);

    await persister.removeClient();
    expect(real.remocoes).toBe(1);
  });

  it('restaurar sem nada guardado devolve undefined', async () => {
    const persister = criarPersisterPermitido(criarPersisterEspiao(), LISTA);

    await expect(persister.restoreClient()).resolves.toBeUndefined();
  });
});
