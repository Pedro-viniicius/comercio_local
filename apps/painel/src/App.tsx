// Raiz do painel. Sem endereço da API (VITE_API_URL), mostra só o aviso de configuração; com ele,
// o fluxo de autenticação do admin (P1 a P1c) e, depois de entrar, a área protegida. A sessão chega
// por propriedade (montada em `main.tsx`) para o teste trocar o `fetch` por um falso.
import type { AutenticacaoDoPainel } from './sessao/autenticacao-do-painel.ts';
import { FluxoDeAutenticacao } from './autenticacao/FluxoDeAutenticacao.tsx';
import { EstadoDaApi } from './EstadoDaApi.tsx';
import { textos } from './textos/pt-BR.ts';

export interface AppProps {
  autenticacao: AutenticacaoDoPainel | null;
}

export default function App({ autenticacao }: AppProps) {
  if (!autenticacao) {
    return (
      <main className="pagina">
        <h1 className="pagina__titulo">{textos.estadoDaApi.titulo}</h1>
        <EstadoDaApi cliente={null} />
      </main>
    );
  }
  return <FluxoDeAutenticacao autenticacao={autenticacao} />;
}
