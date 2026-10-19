// Título da aba por tela: "<Tela> · Bairrin Painel" (wireframes do painel).
import { useEffect } from 'react';
import { textos } from '../textos/pt-BR.ts';

export function useTituloDaPagina(tela: string) {
  useEffect(() => {
    document.title = textos.autenticacao.tituloDaAba(tela);
  }, [tela]);
}
