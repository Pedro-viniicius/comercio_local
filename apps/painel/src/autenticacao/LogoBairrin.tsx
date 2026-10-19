// Logo horizontal do Bairrin (identidade, seção 2.7), servido como arquivo: `?no-inline` impede o
// Vite de embutir o SVG como `data:`, que a CSP do painel (`img-src 'self'`) bloquearia.
import { textos } from '../textos/pt-BR.ts';
import logo from './bairrin-logo-horizontal.svg?no-inline';
import './autenticacao.css';

export function LogoBairrin() {
  return (
    <img className="aut-logo" src={logo} alt={textos.autenticacao.logo} width={116} height={33} />
  );
}
