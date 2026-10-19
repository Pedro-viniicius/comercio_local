// QR code do app autenticador (spec 01, P1b passo 2): 200 px, com texto alternativo. Desenhado no
// próprio DOM a partir do `otpauthUri` (`qr.ts`): sem serviço externo, sem `data:` e sem canvas.
// A chave em texto, ao lado, é sempre a alternativa ao QR.
import type { DesenhoDoQr } from './qr.ts';
import './autenticacao.css';

export interface QrCodeDoAutenticadorProps {
  /** Desenho já calculado (`desenharQr`), fora da renderização: um texto que não cabe não quebra a tela. */
  desenho: DesenhoDoQr;
  rotulo: string;
}

export function QrCodeDoAutenticador({ desenho, rotulo }: QrCodeDoAutenticadorProps) {
  const { lado, caminho } = desenho;
  return (
    <svg
      className="aut-qr"
      role="img"
      aria-label={rotulo}
      viewBox={`0 0 ${lado} ${lado}`}
      shapeRendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect className="aut-qr__fundo" width={lado} height={lado} />
      <path className="aut-qr__modulos" d={caminho} />
    </svg>
  );
}
