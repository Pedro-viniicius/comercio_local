// Provedor de sessão (plano 01b, etapa 12; CA-03, S18, S11, S121). O teste central: fazer login
// pelo provedor e provar que o par de tokens só chegou ao SecureStore. AsyncStorage, FileSystem
// (API nova e `legacy`) e SQLite são trocados por espiões que registram toda chamada; nenhum deles,
// nem a fila offline nem o persister do cache, recebe o token ou o `Authorization`.
import { z } from '@bairrin/contratos';
import { dehydrate, MutationObserver } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { CHAVE_DA_SESSAO } from './armazenamento-seguro.ts';
import { ProvedorDeSessao, useSessao } from './provedor-de-sessao.tsx';
import { CAMINHO_DE_ENTRAR } from './sessao-do-app.ts';
import { CREDENCIAIS, criarCenario, SEGREDOS, SESSAO_A, type Cenario } from './teste/cenario.ts';
import { reiniciarEspioes, textoDasChamadasEspionadas } from './teste/espiao.ts';
import { secureStoreFalso, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from './teste/secure-store-falso.ts';

jest.mock('expo-secure-store', () =>
  jest.requireActual<typeof import('./teste/secure-store-falso.ts')>(
    './teste/secure-store-falso.ts',
  ),
);
jest.mock('expo-file-system', () =>
  jest
    .requireActual<typeof import('./teste/espiao.ts')>('./teste/espiao.ts')
    .espiao('expo-file-system'),
);
jest.mock('expo-file-system/legacy', () =>
  jest
    .requireActual<typeof import('./teste/espiao.ts')>('./teste/espiao.ts')
    .espiao('expo-file-system/legacy'),
);
// Não instalados no repositório: os espiões ficam no caminho de quem os importar um dia.
jest.mock(
  '@react-native-async-storage/async-storage',
  () =>
    jest
      .requireActual<typeof import('./teste/espiao.ts')>('./teste/espiao.ts')
      .espiao('async-storage'),
  { virtual: true },
);
jest.mock(
  'expo-sqlite',
  () =>
    jest
      .requireActual<typeof import('./teste/espiao.ts')>('./teste/espiao.ts')
      .espiao('expo-sqlite'),
  { virtual: true },
);
jest.mock(
  'expo-sqlite/kv-store',
  () =>
    jest
      .requireActual<typeof import('./teste/espiao.ts')>('./teste/espiao.ts')
      .espiao('expo-sqlite/kv-store'),
  { virtual: true },
);

async function montar(cenario: Cenario) {
  function Envoltorio({ children }: { children: ReactNode }) {
    return <ProvedorDeSessao {...cenario.opcoes}>{children}</ProvedorDeSessao>;
  }
  return renderHook(() => useSessao(), { wrapper: Envoltorio });
}

beforeEach(() => {
  secureStoreFalso.reiniciar();
  reiniciarEspioes();
});

describe('ProvedorDeSessao', () => {
  it('login: o token só chega ao SecureStore; nada em AsyncStorage, arquivos, SQLite, fila ou persister (CA-03, S18, S121)', async () => {
    const cenario = criarCenario();
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_A }));
    cenario.api.responder('GET /v1/conta', () => ({ status: 200, corpo: { nome: 'Maria' } }));
    const { result } = await montar(cenario);
    await waitFor(() => expect(result.current.estado).toBe('sem_sessao'));

    await act(() => result.current.entrar(CREDENCIAIS));
    expect(result.current.estado).toBe('com_sessao');
    const conta = await result.current.requisitar({ caminho: '/v1/conta', esquema: z.unknown() });

    // O app guarda dados no cache, inclusive por engano a sessão e uma mutação com o cabeçalho, e
    // o persister recebe o cache inteiro, como um `dehydrate` mal configurado mandaria.
    cenario.queryClient.setQueryData(['vitrine'], { lojas: ['Padaria do Zé'] });
    cenario.queryClient.setQueryData(['conta'], conta);
    cenario.queryClient.setQueryData(['sessao'], SESSAO_A);
    await new MutationObserver(cenario.queryClient, {
      mutationKey: ['pedido'],
      mutationFn: (variaveis: unknown) => Promise.resolve(variaveis),
    }).mutate({ Authorization: `Bearer ${SESSAO_A.tokenAcesso}` });
    await cenario.opcoes.persister?.persistClient({
      timestamp: 1,
      buster: '',
      clientState: dehydrate(cenario.queryClient, {
        shouldDehydrateQuery: () => true,
        shouldDehydrateMutation: () => true,
      }),
    });

    // O token foi à API (a rede é o destino dele) e ao SecureStore, na chave da sessão.
    expect(cenario.api.pedidos.at(-1)?.cabecalhos.Authorization).toBe(
      `Bearer ${SESSAO_A.tokenAcesso}`,
    );
    const gravacoes = secureStoreFalso.chamadas.filter((c) => c.metodo === 'gravar');
    expect(gravacoes.map((c) => c.chave)).toEqual([CHAVE_DA_SESSAO]);
    expect(JSON.parse(gravacoes[0]?.valor ?? '')).toEqual(SESSAO_A);
    expect(gravacoes[0]?.opcoes).toEqual({ keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY });

    // Em nenhum outro lugar: espiões (AsyncStorage, FileSystem, SQLite e a fila), persister e telas.
    const persistido = cenario.persister.gravados;
    expect(persistido).toHaveLength(1);
    expect(persistido[0]?.clientState.queries.map((q) => q.queryKey)).toEqual([['vitrine']]);
    expect(persistido[0]?.clientState.mutations).toEqual([]);
    const foraDoCofre = [
      textoDasChamadasEspionadas(),
      JSON.stringify(persistido),
      JSON.stringify(result.current),
    ].join('\n');
    for (const segredo of SEGREDOS) expect(foraDoCofre).not.toContain(segredo);
  });

  it('os espiões pegam uma gravação com o token (controle do teste acima)', () => {
    const asyncStorage = jest.requireMock<{
      default: { setItem(chave: string, valor: string): unknown };
    }>('@react-native-async-storage/async-storage');
    const sqlite = jest.requireMock<{
      openDatabaseSync(nome: string): { runSync(sql: string, valor: string): unknown };
    }>('expo-sqlite');
    const arquivos = jest.requireMock<{
      File: new (...partes: string[]) => { write(texto: string): unknown };
    }>('expo-file-system');

    asyncStorage.default.setItem('sessao', SESSAO_A.tokenAcesso);
    sqlite.openDatabaseSync('cache.db').runSync('INSERT ...', SESSAO_A.tokenRenovacao ?? '');
    new arquivos.File('documentos', 'x').write('Bearer y');

    const texto = textoDasChamadasEspionadas();
    expect(texto).toContain(SESSAO_A.tokenAcesso);
    expect(texto).toContain(SESSAO_A.tokenRenovacao);
    expect(texto).toContain('Bearer');
  });

  it('logout pelo provedor: a tela de login só aparece depois do encerrarSessao', async () => {
    const cenario = criarCenario();
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_A }));
    cenario.api.responder('DELETE /v1/sessoes/atual', () => ({ status: 204 }));
    const { result } = await montar(cenario);
    await waitFor(() => expect(result.current.estado).toBe('sem_sessao'));
    await act(() => result.current.entrar(CREDENCIAIS));
    cenario.queryClient.setQueryData(['conta'], { nome: 'Maria' });

    const estados: string[] = [];
    await act(async () => {
      const saida = result.current.sair();
      estados.push(result.current.estado);
      await expect(saida).resolves.toEqual({ revogadaNoServidor: true });
    });

    expect(result.current.estado).toBe('sem_sessao');
    expect(estados).not.toContain('sem_sessao');
    expect(cenario.queryClient.getQueryCache().getAll()).toEqual([]);
    expect(secureStoreFalso.itens.has(CHAVE_DA_SESSAO)).toBe(false);
  });

  it('fornece às telas o mesmo queryClient que a sessão limpa', async () => {
    const cenario = criarCenario();
    const { useQueryClient } =
      jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
    function Envoltorio({ children }: { children: ReactNode }) {
      return <ProvedorDeSessao {...cenario.opcoes}>{children}</ProvedorDeSessao>;
    }
    const { result } = await renderHook(() => useQueryClient(), { wrapper: Envoltorio });

    expect(result.current).toBe(cenario.queryClient);
  });

  it('useSessao fora do provedor lança', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderHook(() => useSessao())).rejects.toThrow(
      'useSessao precisa do ProvedorDeSessao.',
    );
  });
});
