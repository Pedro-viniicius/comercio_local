// Indicador de passos do painel (spec 01, "Componentes"): o texto "Passo 1 de 3" e o título do passo,
// sem barra só visual. Para quem usa leitor de tela, ao trocar de passo a tela leva o foco ao título
// (`refDoTitulo`), que por isso é focável por código.
import { useId, type Ref } from 'react';
import { textos } from '../textos/pt-BR.ts';
import './componentes.css';

export interface IndicadorDePassosProps {
  /** Passo atual, a partir de 1. Fora de 1..`total` fica no limite mais próximo. */
  passo: number;
  total: number;
  titulo: string;
  refDoTitulo?: Ref<HTMLHeadingElement>;
  /** Nível do título do passo: 2 (padrão) quando a página tem um h1 antes, 1 quando ele é o título da página. */
  nivelDoTitulo?: 1 | 2;
}

export function IndicadorDePassos({
  passo,
  total,
  titulo,
  refDoTitulo,
  nivelDoTitulo = 2,
}: IndicadorDePassosProps) {
  const idDoTexto = useId();
  const Titulo = nivelDoTitulo === 1 ? 'h1' : 'h2';
  const totalValido = Math.max(1, Math.trunc(total) || 1);
  const passoValido = Math.min(totalValido, Math.max(1, Math.trunc(passo) || 1));
  return (
    <div className="ui-passos">
      <p id={idDoTexto} className="ui-passos__texto">
        {textos.componentes.passo(passoValido, totalValido)}
      </p>
      <Titulo
        className="ui-passos__titulo"
        tabIndex={-1}
        ref={refDoTitulo}
        aria-describedby={idDoTexto}
      >
        {titulo}
      </Titulo>
    </div>
  );
}
