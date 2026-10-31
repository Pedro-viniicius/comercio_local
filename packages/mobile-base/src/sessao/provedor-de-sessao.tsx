// Provedor de sessão dos apps (plano 01b, etapa 12). Cria a sessão do app uma vez, na montagem, e
// entrega às telas só o estado, `emailVerificado` e as ações; o token nunca chega às telas. Envolve
// o `QueryClientProvider` com o mesmo `queryClient` que a sessão limpa no logout, para as telas
// nunca usarem outro (S11).
//
// As propriedades são lidas só na montagem; para trocar o cliente ou o `queryClient`, monte de
// novo (`key`).
import { QueryClientProvider } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  criarSessaoDoApp,
  type OpcoesDaSessaoDoApp,
  type SessaoDoApp,
  type SituacaoDaSessao,
} from './sessao-do-app.ts';

export interface ValorDaSessao extends SituacaoDaSessao {
  entrar: SessaoDoApp['entrar'];
  sair: SessaoDoApp['sair'];
  requisitar: SessaoDoApp['requisitar'];
}

const ContextoDaSessao = createContext<ValorDaSessao | null>(null);

export interface PropriedadesDoProvedorDeSessao extends OpcoesDaSessaoDoApp {
  children: ReactNode;
}

export function ProvedorDeSessao({ children, ...opcoes }: PropriedadesDoProvedorDeSessao) {
  const [{ sessaoDoApp, queryClient }] = useState(() => ({
    sessaoDoApp: criarSessaoDoApp(opcoes),
    queryClient: opcoes.queryClient,
  }));
  const situacao = useSyncExternalStore(sessaoDoApp.assinar, sessaoDoApp.obterSituacao);

  useEffect(() => {
    void sessaoDoApp.iniciar();
  }, [sessaoDoApp]);

  const valor = useMemo<ValorDaSessao>(
    () => ({
      ...situacao,
      entrar: sessaoDoApp.entrar,
      sair: sessaoDoApp.sair,
      requisitar: sessaoDoApp.requisitar,
    }),
    [situacao, sessaoDoApp],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ContextoDaSessao value={valor}>{children}</ContextoDaSessao>
    </QueryClientProvider>
  );
}

/** A sessão do app. Só dentro do `ProvedorDeSessao`. */
export function useSessao(): ValorDaSessao {
  const valor = useContext(ContextoDaSessao);
  if (valor === null) throw new Error('useSessao precisa do ProvedorDeSessao.');
  return valor;
}
