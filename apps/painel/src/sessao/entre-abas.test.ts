// Sinais entre abas pelo navegador (R2, S89): só as palavras `atividade` e `saiu` passam, o canal
// só fica aberto enquanto alguém ouve, e sem `BroadcastChannel` a reserva é o evento `storage` da
// marca de logout pendente.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NOME_DO_CANAL_DAS_ABAS,
  sinaisEntreAbasNoNavegador,
  type CanalEntreAbas,
  type SinalEntreAbas,
} from './entre-abas.ts';

const CHAVE = 'bairrin.painel.logoutPendente';

interface CanalFalso extends CanalEntreAbas {
  nome: string;
  postados: unknown[];
  fechado: boolean;
  receber(dado: unknown): void;
}

function fabricaDeCanais() {
  const canais: CanalFalso[] = [];
  const criarCanal = (nome: string): CanalEntreAbas => {
    const canal: CanalFalso = {
      nome,
      postados: [],
      fechado: false,
      onmessage: null,
      postMessage(mensagem) {
        canal.postados.push(mensagem);
      },
      close() {
        canal.fechado = true;
      },
      receber(dado) {
        canal.onmessage?.({ data: dado });
      },
    };
    canais.push(canal);
    return canal;
  };
  return { canais, criarCanal };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('com BroadcastChannel', () => {
  it('abre o canal `bairrin.painel.atividade` ao ouvir e manda só a palavra do sinal', () => {
    const { canais, criarCanal } = fabricaDeCanais();
    const sinais = sinaisEntreAbasNoNavegador({ chaveDaMarca: CHAVE, criarCanal });
    expect(canais).toHaveLength(0);

    sinais.ouvir(() => undefined);
    sinais.enviar('atividade');
    sinais.enviar('saiu');

    expect(canais.map((c) => c.nome)).toEqual([NOME_DO_CANAL_DAS_ABAS]);
    expect(NOME_DO_CANAL_DAS_ABAS).toBe('bairrin.painel.atividade');
    expect(canais[0]?.postados).toEqual(['atividade', 'saiu']);
  });

  it('repassa só `atividade` e `saiu`; qualquer outra mensagem é descartada', () => {
    const { canais, criarCanal } = fabricaDeCanais();
    const sinais = sinaisEntreAbasNoNavegador({ chaveDaMarca: CHAVE, criarCanal });
    const recebidos: SinalEntreAbas[] = [];
    sinais.ouvir((sinal) => recebidos.push(sinal));
    const canal = canais[0];

    for (const dado of [
      'atividade',
      'saiu',
      'SAIU',
      'saiu ',
      { sinal: 'saiu' },
      ['saiu'],
      null,
      undefined,
      42,
      'token-de-acesso-falso.abc',
    ]) {
      canal?.receber(dado);
    }
    expect(recebidos).toEqual(['atividade', 'saiu']);
  });

  it('fecha o canal quando o último ouvinte sai; enviar sem ouvinte abre, manda e fecha', () => {
    const { canais, criarCanal } = fabricaDeCanais();
    const sinais = sinaisEntreAbasNoNavegador({ chaveDaMarca: CHAVE, criarCanal });
    const pararA = sinais.ouvir(() => undefined);
    const pararB = sinais.ouvir(() => undefined);
    pararA();
    expect(canais[0]?.fechado).toBe(false);
    pararB();
    expect(canais[0]?.fechado).toBe(true);
    expect(canais[0]?.onmessage).toBeNull();

    sinais.enviar('saiu');
    expect(canais).toHaveLength(2);
    expect(canais[1]?.postados).toEqual(['saiu']);
    expect(canais[1]?.fechado).toBe(true);
  });

  it('um ouvinte que lança não impede os outros', () => {
    const { canais, criarCanal } = fabricaDeCanais();
    const sinais = sinaisEntreAbasNoNavegador({ chaveDaMarca: CHAVE, criarCanal });
    const segundo = vi.fn();
    sinais.ouvir(() => {
      throw new Error('defeito');
    });
    sinais.ouvir(segundo);
    canais[0]?.receber('saiu');
    expect(segundo).toHaveBeenCalledWith('saiu');
  });

  it('falha do navegador ao criar ou ao mandar não sai daqui', () => {
    const sinais = sinaisEntreAbasNoNavegador({
      chaveDaMarca: CHAVE,
      criarCanal: () => {
        throw new DOMException('negado', 'SecurityError');
      },
    });
    expect(() => sinais.enviar('saiu')).not.toThrow();
    expect(() => sinais.ouvir(() => undefined)).not.toThrow();

    const { criarCanal } = fabricaDeCanais();
    const comDefeito = sinaisEntreAbasNoNavegador({
      chaveDaMarca: CHAVE,
      criarCanal: (nome) => ({
        ...criarCanal(nome),
        postMessage: () => {
          throw new DOMException('fechado', 'InvalidStateError');
        },
      }),
    });
    expect(() => comDefeito.enviar('atividade')).not.toThrow();
  });

  it('com o canal, o evento `storage` não é ouvido', () => {
    const { criarCanal } = fabricaDeCanais();
    const janela = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    sinaisEntreAbasNoNavegador({ chaveDaMarca: CHAVE, criarCanal, janela }).ouvir(() => undefined);
    expect(janela.addEventListener).not.toHaveBeenCalled();
  });
});

describe('sem BroadcastChannel: reserva pelo evento `storage` da marca (S89)', () => {
  const marca = (key: string | null, newValue: string | null) =>
    new StorageEvent('storage', { key, newValue });

  it('a marca gravada em outra aba vira `saiu`; apagar a marca e outras chaves não', () => {
    const sinais = sinaisEntreAbasNoNavegador({ chaveDaMarca: CHAVE, criarCanal: null });
    const recebidos: SinalEntreAbas[] = [];
    const parar = sinais.ouvir((sinal) => recebidos.push(sinal));

    window.dispatchEvent(marca(CHAVE, '{}'));
    window.dispatchEvent(marca(CHAVE, null));
    window.dispatchEvent(marca('outra.chave', '{}'));
    window.dispatchEvent(marca(null, null));
    expect(recebidos).toEqual(['saiu']);

    parar();
    window.dispatchEvent(marca(CHAVE, '{}'));
    expect(recebidos).toEqual(['saiu']);
  });

  it('ouve a janela uma vez só e para quando o último ouvinte sai; enviar não faz nada', () => {
    const janela = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const sinais = sinaisEntreAbasNoNavegador({ chaveDaMarca: CHAVE, criarCanal: null, janela });
    const pararA = sinais.ouvir(() => undefined);
    const pararB = sinais.ouvir(() => undefined);
    expect(janela.addEventListener).toHaveBeenCalledTimes(1);
    expect(() => sinais.enviar('atividade')).not.toThrow();

    pararA();
    expect(janela.removeEventListener).not.toHaveBeenCalled();
    pararB();
    expect(janela.removeEventListener).toHaveBeenCalledTimes(1);
    expect(janela.removeEventListener.mock.calls[0]?.[0]).toBe('storage');
  });
});

describe('no navegador de verdade', () => {
  it('usa o `BroadcastChannel` global quando existe', () => {
    const criados: string[] = [];
    class CanalGlobal {
      onmessage: ((evento: { data: unknown }) => void) | null = null;
      constructor(nome: string) {
        criados.push(nome);
      }
      postMessage() {
        return undefined;
      }
      close() {
        return undefined;
      }
    }
    vi.stubGlobal('BroadcastChannel', CanalGlobal);
    try {
      sinaisEntreAbasNoNavegador({ chaveDaMarca: CHAVE }).enviar('saiu');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(criados).toEqual([NOME_DO_CANAL_DAS_ABAS]);
  });
});
