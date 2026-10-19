// Inatividade do painel (S9, CA-101): 30 min sem interação da pessoa encerram a sessão, com aviso
// 2 min antes. Só conta interação (tecla, clique, toque, rolagem): requisição e polling não
// estendem. O servidor confere o mesmo limite pela renovação; este relógio só evita deixar a tela
// aberta com a sessão já vencida.
//
// - Com o aviso aberto, interação na página (Tab, clique, tecla) não conta nem fecha o aviso (D2):
//   só `retomar()`, chamado depois que "Continuar conectado" renovou no servidor, recomeça o relógio.
// - `aoInteragir` recebe cada interação contada, para a sessão renovar no servidor e avisar as
//   outras abas (R1, R2).
// - `ouvirOutrasAbas` traz a atividade de outra aba: ela conta como a interação mais recente e
//   fecha o aviso, para a aba ociosa não encerrar a sessão de uma aba em uso (R2).
// - `comAviso: false` (passo 3 da P1b, que não mostra aviso): o relógio vai direto aos 30 min e toda
//   interação conta até o fim (R8). Sem isso, a interação dos últimos 2 min seria ignorada por um
//   aviso que ninguém vê.
import { useCallback, useEffect, useRef } from 'react';

export const LIMITE_DE_INATIVIDADE_MS = 30 * 60_000;
export const AVISO_ANTES_DO_FIM_MS = 2 * 60_000;

const EVENTOS_DE_INTERACAO = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export interface OpcoesDaInatividade {
  /** Desligado fora da área autenticada. */
  ativo: boolean;
  /** Padrão `true`. Com `false`, não há aviso: `aoAvisar` nunca é chamado e toda interação conta. */
  comAviso?: boolean;
  aoAvisar: () => void;
  /** O aviso some: `retomar()` ou atividade em outra aba. */
  aoRetomar: () => void;
  aoExpirar: () => void;
  /** Interação da pessoa nesta aba, fora do aviso, e cada `retomar()`. */
  aoInteragir?: () => void;
  /** Assina a atividade das outras abas; devolve o cancelamento. Lido ao ligar. */
  ouvirOutrasAbas?: (ouvinte: () => void) => () => void;
}

export interface ControleDaInatividade {
  /** "Continuar conectado" renovou no servidor: o aviso some e o relógio recomeça. */
  retomar: () => void;
}

export function useInatividade(opcoes: OpcoesDaInatividade): ControleDaInatividade {
  const { ativo } = opcoes;
  const avisos = useRef(opcoes);
  useEffect(() => {
    avisos.current = opcoes;
  });
  const retomarAtual = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!ativo) return;
    let ultimaInteracao = Date.now();
    let avisado = false;
    let encerrado = false;
    let temporizador: ReturnType<typeof setTimeout> | undefined;

    // O relógio compara datas, não conta disparos: aba em segundo plano atrasa o timer, mas a
    // conta fica certa quando ele dispara.
    const agendar = () => {
      const decorrido = Date.now() - ultimaInteracao;
      const alvo =
        avisado || avisos.current.comAviso === false
          ? LIMITE_DE_INATIVIDADE_MS
          : LIMITE_DE_INATIVIDADE_MS - AVISO_ANTES_DO_FIM_MS;
      temporizador = setTimeout(conferir, Math.max(0, alvo - decorrido));
    };
    const conferir = () => {
      const decorrido = Date.now() - ultimaInteracao;
      if (decorrido >= LIMITE_DE_INATIVIDADE_MS) {
        encerrado = true;
        avisos.current.aoExpirar();
        return;
      }
      if (
        !avisado &&
        avisos.current.comAviso !== false &&
        decorrido >= LIMITE_DE_INATIVIDADE_MS - AVISO_ANTES_DO_FIM_MS
      ) {
        avisado = true;
        avisos.current.aoAvisar();
      }
      agendar();
    };
    /** Recomeça a contagem agora e fecha o aviso, se estiver aberto. */
    const recomecar = () => {
      ultimaInteracao = Date.now();
      if (avisado) {
        avisado = false;
        avisos.current.aoRetomar();
      }
      clearTimeout(temporizador);
      agendar();
    };
    const aoInteragir = () => {
      // Com o aviso aberto, só "Continuar conectado" retoma (D2): o `pointerdown` no próprio botão
      // não pode fechar o aviso antes do clique.
      if (encerrado || avisado) return;
      ultimaInteracao = Date.now();
      avisos.current.aoInteragir?.();
    };
    const aoAtividadeEmOutraAba = () => {
      if (!encerrado) recomecar();
    };
    retomarAtual.current = () => {
      if (encerrado) return;
      recomecar();
      avisos.current.aoInteragir?.();
    };

    agendar();
    for (const evento of EVENTOS_DE_INTERACAO) {
      document.addEventListener(evento, aoInteragir, { capture: true, passive: true });
    }
    const pararDeOuvirAbas = avisos.current.ouvirOutrasAbas?.(aoAtividadeEmOutraAba);
    return () => {
      clearTimeout(temporizador);
      retomarAtual.current = () => undefined;
      pararDeOuvirAbas?.();
      for (const evento of EVENTOS_DE_INTERACAO) {
        document.removeEventListener(evento, aoInteragir, { capture: true });
      }
    };
  }, [ativo]);

  const retomar = useCallback(() => retomarAtual.current(), []);
  return { retomar };
}
