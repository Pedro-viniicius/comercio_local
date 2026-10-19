// Região `role="status"` para texto de carregamento (D7). Os leitores de tela só anunciam o que
// muda numa região que já existe; por isso a região monta vazia e recebe o texto logo depois,
// quando o elemento já está no DOM (o `ref` roda no commit).
import { useState } from 'react';

export interface RegiaoDeStatusProps {
  texto: string;
  className?: string;
}

export function RegiaoDeStatus({ texto, className }: RegiaoDeStatusProps) {
  const [noDom, setNoDom] = useState(false);
  return (
    <p
      role="status"
      className={className}
      ref={(elemento) => {
        if (elemento) setNoDom(true);
      }}
    >
      {noDom ? texto : ''}
    </p>
  );
}
