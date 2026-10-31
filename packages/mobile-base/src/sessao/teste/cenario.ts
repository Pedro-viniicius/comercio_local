// Cenário comum dos testes da sessão do app: sessões de duas contas, relógio fixo, persister e
// fila espiões, e a sessão do app montada com a API falsa.
import type { Sessao } from '@bairrin/contratos';
import { QueryClient } from '@tanstack/react-query';
import { criarPersisterPermitido, type CachePersistido } from '../persistencia-permitida.ts';
import {
  criarSessaoDoApp,
  type EstadoDaSessao,
  type FilaOfflineDaConta,
  type OpcoesDaSessaoDoApp,
  type SessaoDoApp,
} from '../sessao-do-app.ts';
import { criarApiFalsa, type ApiFalsa } from './api-falsa.ts';
import { espiao } from './espiao.ts';

export const AGORA = Date.parse('2026-10-27T12:00:00.000Z');
export const DAQUI_A_15_MIN = '2026-10-27T12:15:00.000Z';
export const HA_UMA_HORA = '2026-10-27T11:00:00.000Z';

export const SESSAO_A: Sessao = {
  tokenAcesso: 'eyJhbGciOiJIUzI1NiJ9.acesso-da-conta-a.assinatura-a',
  tokenRenovacao: 'renovacao-da-conta-a-0123456789abcdefghij',
  expiraEm: DAQUI_A_15_MIN,
  emailVerificado: false,
};

export const SESSAO_A_RENOVADA: Sessao = {
  tokenAcesso: 'eyJhbGciOiJIUzI1NiJ9.acesso-renovado-a.assinatura-a2',
  tokenRenovacao: 'renovacao-trocada-a-9876543210zyxwvutsrq',
  expiraEm: DAQUI_A_15_MIN,
  emailVerificado: false,
};

export const SESSAO_B: Sessao = {
  tokenAcesso: 'eyJhbGciOiJIUzI1NiJ9.acesso-da-conta-b.assinatura-b',
  tokenRenovacao: 'renovacao-da-conta-b-abcdefghij0123456789',
  expiraEm: DAQUI_A_15_MIN,
  emailVerificado: true,
};

/** Todos os segredos das sessões acima e o prefixo do cabeçalho. */
export const SEGREDOS = [
  ...[SESSAO_A, SESSAO_A_RENOVADA, SESSAO_B].flatMap((s) => [
    s.tokenAcesso,
    s.tokenRenovacao ?? '',
  ]),
  'Bearer',
];

export const CREDENCIAIS = { email: 'maria@exemplo.com', senha: 'uma senha qualquer 123' };

export interface PersisterEspiao {
  gravados: CachePersistido[];
  remocoes: number;
  falharRemocao: boolean;
  persistClient(cache: CachePersistido): void;
  restoreClient(): undefined;
  removeClient(): Promise<void>;
}

export function criarPersisterEspiao(): PersisterEspiao {
  const persister: PersisterEspiao = {
    gravados: [],
    remocoes: 0,
    falharRemocao: false,
    persistClient(cache) {
      persister.gravados.push(cache);
    },
    restoreClient: () => undefined,
    removeClient() {
      persister.remocoes += 1;
      return persister.falharRemocao ? Promise.reject(new Error('sem acesso')) : Promise.resolve();
    },
  };
  return persister;
}

export interface Cenario {
  api: ApiFalsa;
  queryClient: QueryClient;
  persister: PersisterEspiao;
  fila: FilaOfflineDaConta;
  /** Argumentos de cada chamada a `registrarFalha`. */
  falhas: unknown[][];
  opcoes: OpcoesDaSessaoDoApp;
}

/** Monta as opções da sessão do app; `extra` troca qualquer uma. */
export function criarCenario(extra: Partial<OpcoesDaSessaoDoApp> = {}): Cenario {
  const api = criarApiFalsa();
  // Sem o timer de coleta (5 min por padrão), que seguraria o Jest depois do teste.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  const persister = criarPersisterEspiao();
  const fila = espiao('fila-offline') as FilaOfflineDaConta;
  const falhas: unknown[][] = [];
  const opcoes: OpcoesDaSessaoDoApp = {
    cliente: api.cliente,
    clienteDoApp: 'app_consumidor',
    queryClient,
    persister: criarPersisterPermitido(persister, ['vitrine']),
    filaOffline: fila,
    registrarFalha: (...argumentos: unknown[]) => {
      falhas.push(argumentos);
    },
    agora: () => AGORA,
    ...extra,
  };
  return { api, queryClient, persister, fila, falhas, opcoes };
}

export function montarSessao(cenario: Cenario): SessaoDoApp {
  return criarSessaoDoApp(cenario.opcoes);
}

/** Resolve quando a sessão chega ao estado. */
export function esperarEstado(sessao: SessaoDoApp, estado: EstadoDaSessao): Promise<void> {
  return new Promise((resolve) => {
    if (sessao.obterSituacao().estado === estado) {
      resolve();
      return;
    }
    const parar = sessao.assinar(() => {
      if (sessao.obterSituacao().estado === estado) {
        parar();
        resolve();
      }
    });
  });
}

/** Deixa rodar os timers e microtarefas pendentes (o `setTimeout(0)` da expiração). */
export function umaVoltaDoRelogio(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
