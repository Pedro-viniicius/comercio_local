// Bordas do provedor de sessão (plano 01b, etapa 12; CA-03, CA-05, Q18): dupla montagem do
// StrictMode, desmontagem no meio da renovação, o que as telas recebem e erro de login.
import { ErroDeApi } from '@bairrin/cliente-api';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { StrictMode, type ReactNode } from 'react';
import { CHAVE_DA_SESSAO } from './armazenamento-seguro.ts';
import { ProvedorDeSessao, useSessao } from './provedor-de-sessao.tsx';
import { CAMINHO_DE_ENTRAR } from './sessao-do-app.ts';
import { adiada, type RespostaFalsa } from './teste/api-falsa.ts';
import {
  CREDENCIAIS,
  criarCenario,
  HA_UMA_HORA,
  SEGREDOS,
  SESSAO_A,
  SESSAO_A_RENOVADA,
  type Cenario,
} from './teste/cenario.ts';
import { reiniciarEspioes } from './teste/espiao.ts';
import { secureStoreFalso } from './teste/secure-store-falso.ts';

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

function montar(cenario: Cenario, estrito = false) {
  function Envoltorio({ children }: { children: ReactNode }) {
    const provedor = <ProvedorDeSessao {...cenario.opcoes}>{children}</ProvedorDeSessao>;
    return estrito ? <StrictMode>{provedor}</StrictMode> : provedor;
  }
  return renderHook(() => useSessao(), { wrapper: Envoltorio });
}

function sessaoVencida(): string {
  return JSON.stringify({ ...SESSAO_A, expiraEm: HA_UMA_HORA });
}

beforeEach(() => {
  secureStoreFalso.reiniciar();
  reiniciarEspioes();
});

describe('ProvedorDeSessao, bordas', () => {
  it('no StrictMode (efeito duas vezes), a renovação ao abrir sai uma vez só e o token novo é guardado', async () => {
    secureStoreFalso.itens.set(CHAVE_DA_SESSAO, sessaoVencida());
    const cenario = criarCenario();
    cenario.api.responder('POST /v1/sessoes/renovacao', () => ({
      status: 200,
      corpo: SESSAO_A_RENOVADA,
    }));

    const { result } = await montar(cenario, true);
    await waitFor(() => expect(result.current.estado).toBe('com_sessao'));

    expect(cenario.api.pedidos.filter((p) => p.caminho === '/v1/sessoes/renovacao')).toHaveLength(
      1,
    );
    expect(JSON.parse(secureStoreFalso.itens.get(CHAVE_DA_SESSAO) ?? '{}')).toEqual(
      SESSAO_A_RENOVADA,
    );
  });

  it('desmontar no meio da renovação não gera erro, e a sessão renovada continua guardada', async () => {
    secureStoreFalso.itens.set(CHAVE_DA_SESSAO, sessaoVencida());
    const cenario = criarCenario();
    const renovacao = adiada<RespostaFalsa>();
    cenario.api.responder('POST /v1/sessoes/renovacao', () => renovacao.promessa);
    const erros = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result, unmount } = await montar(cenario);
    expect(result.current.estado).toBe('carregando');
    await unmount();
    renovacao.resolver({ status: 200, corpo: SESSAO_A_RENOVADA });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(erros).not.toHaveBeenCalled();
    expect(JSON.parse(secureStoreFalso.itens.get(CHAVE_DA_SESSAO) ?? '{}')).toEqual(
      SESSAO_A_RENOVADA,
    );
    erros.mockRestore();
  });

  it('as telas recebem só o estado, emailVerificado e as ações, e nenhum valor tem token', async () => {
    const cenario = criarCenario();
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_A }));
    const { result } = await montar(cenario);
    await waitFor(() => expect(result.current.estado).toBe('sem_sessao'));
    await act(() => result.current.entrar(CREDENCIAIS));

    expect(Object.keys(result.current).sort()).toEqual([
      'emailVerificado',
      'entrar',
      'estado',
      'requisitar',
      'sair',
    ]);
    expect(result.current.emailVerificado).toBe(false);
    for (const [, valor] of Object.entries(result.current)) {
      if (typeof valor === 'function') continue;
      for (const segredo of SEGREDOS) expect(JSON.stringify(valor) ?? '').not.toContain(segredo);
    }
  });

  it('login recusado chega à tela como ErroDeApi, sem token, e o estado segue sem sessão', async () => {
    const cenario = criarCenario();
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({
      status: 401,
      corpo: {
        type: 'urn:bairrin:erro:credenciais_invalidas',
        title: 'Credenciais inválidas',
        status: 401,
        codigo: 'credenciais_invalidas',
        idRequisicao: 'req-1',
      },
    }));
    const { result } = await montar(cenario);
    await waitFor(() => expect(result.current.estado).toBe('sem_sessao'));

    let erro: unknown;
    await act(async () => {
      erro = await result.current.entrar(CREDENCIAIS).catch((e: unknown) => e);
    });

    expect(erro).toBeInstanceOf(ErroDeApi);
    expect((erro as ErroDeApi).status).toBe(401);
    expect(result.current.estado).toBe('sem_sessao');
    expect(secureStoreFalso.itens.size).toBe(0);
    expect(JSON.stringify(erro, Object.getOwnPropertyNames(erro))).not.toContain(CREDENCIAIS.senha);
  });
});
