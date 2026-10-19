// Entrada do painel: monta a sessão do admin com o endereço de VITE_API_URL (embutido no build; não
// é segredo) e renderiza. Sem a variável, a página mostra o aviso de configuração.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'virtual:bairrin-tokens.css';
import App from './App.tsx';
import { criarAutenticacaoDoPainel } from './sessao/autenticacao-do-painel.ts';
import './estilos/pagina.css';

const raiz = document.getElementById('root');
if (!raiz) {
  throw new Error('Elemento #root não encontrado em index.html');
}

const baseUrl = import.meta.env.VITE_API_URL?.trim();
// O painel ainda não tem Sentry: as falhas em segundo plano da sessão (Q18) não vão a lugar nenhum.
// Quando ele entrar, passe `registrarFalha`, que recebe só a `origem` (nunca o erro nem token), e
// acrescente a origem de ingest ao `connect-src` do Caddyfile.
const autenticacao = baseUrl ? criarAutenticacaoDoPainel({ baseUrl }) : null;

createRoot(raiz).render(
  <StrictMode>
    <App autenticacao={autenticacao} />
  </StrictMode>,
);
