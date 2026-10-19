// Banner em linha do painel (design system, "Toasts e banners"): fundo e texto do tom semântico,
// símbolo (o tom nunca é só cor), título curto opcional, ação opcional e "Fechar" quando dispensável.
// O erro é anunciado de forma assertiva (`role="alert"`); os demais tons, de forma educada
// (`role="status"`). Para o anúncio valer, monte o Banner no momento em que a mensagem aparece.
import type { ReactNode } from 'react';
import { textos } from '../textos/pt-BR.ts';
import { Botao } from './Botao.tsx';
import './componentes.css';

export type TomDoBanner = 'informacao' | 'sucesso' | 'aviso' | 'erro';

/** Reforço do texto para quem não distingue cor; escondido do leitor de tela. */
const SIMBOLOS: Record<TomDoBanner, string> = {
  informacao: 'i',
  sucesso: '✓',
  aviso: '!',
  erro: '✕',
};

export interface BannerProps {
  /** Padrão: `informacao`. */
  tom?: TomDoBanner;
  titulo?: string;
  children: ReactNode;
  /** Botão ou link de ação (por exemplo, "Tentar de novo"). */
  acao?: ReactNode;
  /** Com esta função, o Banner mostra "Fechar". */
  aoFechar?: () => void;
}

export function Banner({ tom = 'informacao', titulo, children, acao, aoFechar }: BannerProps) {
  return (
    <div className={`ui-banner ui-banner--${tom}`} role={tom === 'erro' ? 'alert' : 'status'}>
      <span className="ui-banner__simbolo" aria-hidden="true">
        {SIMBOLOS[tom]}
      </span>
      <div className="ui-banner__corpo">
        {titulo && <p className="ui-banner__titulo">{titulo}</p>}
        <div className="ui-banner__texto">{children}</div>
        {acao && <div className="ui-banner__acao">{acao}</div>}
      </div>
      {aoFechar && (
        <Botao
          variante="terciario"
          onClick={aoFechar}
          aria-label={
            titulo ? textos.componentes.fecharAvisoCom(titulo) : textos.componentes.fecharAviso
          }
        >
          {textos.componentes.fechar}
        </Botao>
      )}
    </div>
  );
}
