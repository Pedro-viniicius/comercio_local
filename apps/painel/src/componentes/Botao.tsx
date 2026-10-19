// Botão do painel (design system, "Botões"): primário, secundário, terciário e destrutivo.
// Carregando não usa `disabled`: o botão continua no DOM e com o foco (como na página de estado da
// API), só ignora o clique e diz "Enviando…" ao leitor de tela, sem mudar de largura.
import type { ComponentPropsWithRef, MouseEvent } from 'react';
import { textos } from '../textos/pt-BR.ts';
import './componentes.css';

export type VarianteDoBotao = 'primario' | 'secundario' | 'terciario' | 'destrutivo';

export interface BotaoProps extends ComponentPropsWithRef<'button'> {
  /** Uma primária por tela. Padrão: `primario`. */
  variante?: VarianteDoBotao;
  /** Enviando: ignora clique e Enter (também não envia o formulário) e fica `aria-busy`. */
  carregando?: boolean;
  /** Dito ao leitor de tela no lugar do rótulo enquanto carrega. Padrão: "Enviando…". */
  textoCarregando?: string;
  /** Ocupa a largura toda do contêiner (formulário do cartão de autenticação). */
  larguraTotal?: boolean;
}

export function Botao({
  variante = 'primario',
  carregando = false,
  textoCarregando = textos.componentes.enviando,
  larguraTotal = false,
  type = 'button',
  className,
  children,
  onClick,
  ...resto
}: BotaoProps) {
  const classes = ['ui-botao', `ui-botao--${variante}`];
  if (larguraTotal) classes.push('ui-botao--total');
  if (carregando) classes.push('ui-botao--carregando');
  if (className) classes.push(className);

  const aoClicar = (evento: MouseEvent<HTMLButtonElement>) => {
    if (carregando) {
      // Botão `submit` ainda enviaria o formulário: o clique é descartado por inteiro.
      evento.preventDefault();
      return;
    }
    onClick?.(evento);
  };

  return (
    <button
      {...resto}
      type={type}
      className={classes.join(' ')}
      aria-disabled={carregando || undefined}
      aria-busy={carregando || undefined}
      onClick={aoClicar}
    >
      {carregando ? (
        <>
          {/* O rótulo fica (invisível) para o botão manter a largura. */}
          <span className="ui-botao__rotulo" aria-hidden="true">
            {children}
          </span>
          <span className="ui-botao__indicador" aria-hidden="true" />
          <span className="ui-oculto-visual">{textoCarregando}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
