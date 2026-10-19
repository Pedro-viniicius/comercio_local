// Sinais entre as abas do painel (R2, S89). Todas as abas abertas usam o mesmo cookie de
// renovação, então a sessão é uma só: uma aba ociosa não pode encerrar a sessão de outra que a
// pessoa está usando, e um "Sair" numa aba precisa levar as outras a P1.
//
// Os sinais são só duas palavras, sem dado algum (nem token, nem id, nem hora):
// - `atividade`: a pessoa interagiu em outra aba. Quem recebe conta a hora do recebimento como a
//   interação mais recente;
// - `saiu`: a sessão terminou em outra aba (logout ou renovação recusada). Quem recebe vai a P1
//   sem esperar um 401.
//
// Canal: `BroadcastChannel('bairrin.painel.atividade')`. Sem ele (navegador antigo), a reserva é
// o evento `storage` da marca de logout pendente (`CHAVE_DO_LOGOUT_PENDENTE`), que vira `saiu`;
// nesse caso a `atividade` não chega às outras abas.

export const NOME_DO_CANAL_DAS_ABAS = 'bairrin.painel.atividade';

export type SinalEntreAbas = 'atividade' | 'saiu';

const SINAIS: readonly SinalEntreAbas[] = ['atividade', 'saiu'];

export interface SinaisEntreAbas {
  /** Avisa as outras abas. Falha do navegador é engolida: o sinal é só um reforço. */
  enviar(sinal: SinalEntreAbas): void;
  /** Recebe os sinais das outras abas (nunca os desta). Devolve o cancelamento. */
  ouvir(ouvinte: (sinal: SinalEntreAbas) => void): () => void;
}

/** O que o painel usa do `BroadcastChannel` (injetável nos testes). */
export interface CanalEntreAbas {
  postMessage(mensagem: SinalEntreAbas): void;
  close(): void;
  onmessage: ((evento: { data: unknown }) => void) | null;
}

/** O que o painel usa da janela para a reserva pelo evento `storage`. */
export interface JanelaComArmazenamento {
  addEventListener(tipo: 'storage', ouvinte: (evento: StorageEvent) => void): void;
  removeEventListener(tipo: 'storage', ouvinte: (evento: StorageEvent) => void): void;
}

export interface OpcoesDosSinaisEntreAbas {
  /** Chave da marca de logout pendente no `localStorage`, para a reserva pelo evento `storage`. */
  chaveDaMarca: string;
  /** Padrão: `BroadcastChannel` do navegador. `null` = sem canal (usa a reserva). */
  criarCanal?: ((nome: string) => CanalEntreAbas) | null;
  /** Padrão: `window`. */
  janela?: JanelaComArmazenamento;
}

function ehSinal(valor: unknown): valor is SinalEntreAbas {
  return SINAIS.some((sinal) => sinal === valor);
}

function canalDoNavegador(): ((nome: string) => CanalEntreAbas) | null {
  if (typeof BroadcastChannel !== 'function') return null;
  return (nome) => new BroadcastChannel(nome) as unknown as CanalEntreAbas;
}

/**
 * Sinais pelo navegador. O canal só fica aberto enquanto alguém ouve (a área autenticada
 * montada), e fecha quando o último ouvinte sai.
 */
export function sinaisEntreAbasNoNavegador(opcoes: OpcoesDosSinaisEntreAbas): SinaisEntreAbas {
  const criarCanal = opcoes.criarCanal === undefined ? canalDoNavegador() : opcoes.criarCanal;
  const ouvintes = new Set<(sinal: SinalEntreAbas) => void>();
  let canal: CanalEntreAbas | undefined;
  let janelaOuvida: JanelaComArmazenamento | undefined;

  const repassar = (sinal: SinalEntreAbas) => {
    for (const ouvinte of [...ouvintes]) {
      try {
        ouvinte(sinal);
      } catch {
        // Um ouvinte com defeito não impede os outros.
      }
    }
  };

  // Reserva sem canal: a marca de logout pendente gravada em outra aba (o `storage` não dispara
  // na aba que gravou). Apagar a marca (logout confirmado ou login) não é sinal.
  const aoMudarArmazenamento = (evento: StorageEvent) => {
    if (evento.key === opcoes.chaveDaMarca && evento.newValue !== null) repassar('saiu');
  };

  const abrir = (): CanalEntreAbas | undefined => {
    if (canal || !criarCanal) return canal;
    try {
      const aberto = criarCanal(NOME_DO_CANAL_DAS_ABAS);
      // Só as duas palavras passam; qualquer outra mensagem é descartada.
      aberto.onmessage = (evento) => {
        if (ehSinal(evento.data)) repassar(evento.data);
      };
      canal = aberto;
    } catch {
      canal = undefined;
    }
    return canal;
  };

  const fecharSeNinguemOuve = () => {
    if (ouvintes.size > 0) return;
    if (canal) {
      canal.onmessage = null;
      try {
        canal.close();
      } catch {
        // Fechar é só limpeza.
      }
      canal = undefined;
    }
    if (janelaOuvida) {
      janelaOuvida.removeEventListener('storage', aoMudarArmazenamento);
      janelaOuvida = undefined;
    }
  };

  return {
    enviar(sinal) {
      try {
        abrir()?.postMessage(sinal);
      } catch {
        // O sinal é reforço: a aba que falhou em avisar segue a própria regra.
      } finally {
        fecharSeNinguemOuve();
      }
    },

    ouvir(ouvinte) {
      ouvintes.add(ouvinte);
      if (!abrir() && !janelaOuvida) {
        const janela: JanelaComArmazenamento | undefined =
          opcoes.janela ?? (typeof window === 'undefined' ? undefined : window);
        if (janela) {
          janela.addEventListener('storage', aoMudarArmazenamento);
          janelaOuvida = janela;
        }
      }
      return () => {
        ouvintes.delete(ouvinte);
        fecharSeNinguemOuve();
      };
    },
  };
}
