// Entrada do painel: monta o cliente da API com o endereço de VITE_API_URL (embutido no build; não
// é segredo) e renderiza a página. Sem a variável, a página mostra o aviso de configuração.
import { criarClienteApi } from '@bairrin/cliente-api';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'virtual:bairrin-tokens.css';
import App from './App.tsx';
import './estilos/pagina.css';

const raiz = document.getElementById('root');
if (!raiz) {
  throw new Error('Elemento #root não encontrado em index.html');
}

const baseUrl = import.meta.env.VITE_API_URL?.trim();
const cliente = baseUrl ? criarClienteApi({ baseUrl }) : null;

createRoot(raiz).render(
  <StrictMode>
    <App cliente={cliente} />
  </StrictMode>,
);
