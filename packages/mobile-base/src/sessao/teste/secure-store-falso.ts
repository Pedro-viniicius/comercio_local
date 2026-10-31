// SecureStore falso dos testes da sessão: guarda em memória e registra cada chamada com as opções.
// Os testes o ligam com `jest.mock('expo-secure-store', () => jest.requireActual(...))`.

/** Valor falso, diferente das outras constantes, para o teste ver qual foi usada. */
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 6;
export const WHEN_UNLOCKED = 5;
export const AFTER_FIRST_UNLOCK = 0;

export interface ChamadaAoSecureStore {
  metodo: 'ler' | 'gravar' | 'apagar';
  chave: string;
  valor?: string;
  opcoes: unknown;
}

export const secureStoreFalso = {
  itens: new Map<string, string>(),
  chamadas: [] as ChamadaAoSecureStore[],
  /** `<metodo>:<chave>` que rejeitam, com uma mensagem que cita a chave (como a nativa). */
  falhas: new Set<string>(),
  reiniciar(): void {
    this.itens.clear();
    this.chamadas.length = 0;
    this.falhas.clear();
  },
};

function registrar(chamada: ChamadaAoSecureStore): void {
  secureStoreFalso.chamadas.push(chamada);
  if (secureStoreFalso.falhas.has(`${chamada.metodo}:${chamada.chave}`)) {
    throw new Error(`falha nativa em ${chamada.chave}`);
  }
}

export function getItemAsync(chave: string, opcoes?: unknown): Promise<string | null> {
  return Promise.resolve().then(() => {
    registrar({ metodo: 'ler', chave, opcoes });
    return secureStoreFalso.itens.get(chave) ?? null;
  });
}

export function setItemAsync(chave: string, valor: string, opcoes?: unknown): Promise<void> {
  return Promise.resolve().then(() => {
    registrar({ metodo: 'gravar', chave, valor, opcoes });
    secureStoreFalso.itens.set(chave, valor);
  });
}

export function deleteItemAsync(chave: string, opcoes?: unknown): Promise<void> {
  return Promise.resolve().then(() => {
    registrar({ metodo: 'apagar', chave, opcoes });
    secureStoreFalso.itens.delete(chave);
  });
}
