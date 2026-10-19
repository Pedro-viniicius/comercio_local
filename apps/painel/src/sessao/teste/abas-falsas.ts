// Abas falsas para os testes do painel (R2): um barramento em memória no lugar do
// `BroadcastChannel`. O que uma aba envia chega às outras (nunca a ela mesma), depois de uma
// microtarefa, como o canal do navegador, que entrega numa tarefa à parte. Só testes importam.
import type { SinaisEntreAbas, SinalEntreAbas } from '../entre-abas.ts';

export interface AbaFalsa extends SinaisEntreAbas {
  /** Tudo o que esta aba mandou, em ordem. */
  enviados: SinalEntreAbas[];
  /** Quantos ouvintes esta aba tem agora. */
  ouvintes(): number;
}

export function criarAbasFalsas(): { abrirAba(): AbaFalsa } {
  const abas = new Set<Set<(sinal: SinalEntreAbas) => void>>();
  return {
    abrirAba() {
      const ouvintes = new Set<(sinal: SinalEntreAbas) => void>();
      abas.add(ouvintes);
      const enviados: SinalEntreAbas[] = [];
      return {
        enviados,
        ouvintes: () => ouvintes.size,
        enviar(sinal) {
          enviados.push(sinal);
          for (const outra of abas) {
            if (outra === ouvintes) continue;
            void Promise.resolve().then(() => {
              for (const ouvinte of [...outra]) ouvinte(sinal);
            });
          }
        },
        ouvir(ouvinte) {
          ouvintes.add(ouvinte);
          return () => {
            ouvintes.delete(ouvinte);
          };
        },
      };
    },
  };
}
