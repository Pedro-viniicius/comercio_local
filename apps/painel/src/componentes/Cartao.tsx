// Cartão de autenticação do painel (spec 01, "Layout"): 400 px, `radius.xl`, `elevation.1` sobre
// `bg.canvas`; abaixo de 432 px ocupa a largura menos `space.4` de cada lado e perde a sombra.
// O título é o cabeçalho da seção e dá o nome a ela para o leitor de tela. O `cabecalho` (D4) fica
// acima do título: o logo e, quando a tela tem, o "Sair" no canto.
import { useId, type ReactNode } from 'react';
import './componentes.css';

export interface CartaoProps {
  titulo: string;
  /** Nível do título: 1 quando é o título da página (padrão), 2 quando há um h1 antes. */
  nivelDoTitulo?: 1 | 2;
  /** Centraliza o cartão na vertical e na horizontal, ocupando a altura da janela. */
  centralizado?: boolean;
  /** Faixa acima do título, dentro da seção (D4): o logo à esquerda e, se houver, "Sair" à direita. */
  cabecalho?: ReactNode;
  children?: ReactNode;
}

export function Cartao({
  titulo,
  nivelDoTitulo = 1,
  centralizado = false,
  cabecalho,
  children,
}: CartaoProps) {
  const idDoTitulo = useId();
  const Titulo = nivelDoTitulo === 1 ? 'h1' : 'h2';
  const cartao = (
    <section className="ui-cartao" aria-labelledby={idDoTitulo}>
      {cabecalho !== undefined && cabecalho !== null && (
        <div className="ui-cartao__cabecalho">{cabecalho}</div>
      )}
      <Titulo id={idDoTitulo} className="ui-cartao__titulo">
        {titulo}
      </Titulo>
      {children}
    </section>
  );
  return centralizado ? <div className="ui-cartao-fundo">{cartao}</div> : cartao;
}
