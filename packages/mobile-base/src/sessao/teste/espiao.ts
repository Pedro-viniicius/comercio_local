// Espião de módulo para os testes da sessão (S18, S121): no lugar de AsyncStorage, FileSystem e
// SQLite, registra todo acesso que vira chamada ou `new`, em qualquer profundidade
// (`AsyncStorage.setItem(...)`, `openDatabaseSync(...).runSync(...)`, `new File(...).write(...)`).
// Os testes conferem que nenhum argumento registrado traz o token nem o `Authorization`.

export interface ChamadaEspionada {
  caminho: string;
  argumentos: unknown[];
}

const chamadas: ChamadaEspionada[] = [];

/** Um módulo inteiro espionado; cada propriedade é outro espião. */
export function espiao(nome: string): unknown {
  function no(caminho: string): unknown {
    return new Proxy(function espionado() {}, {
      get(_alvo, propriedade) {
        // Sem `then`: o espião não vira promessa ao ser esperado.
        if (propriedade === 'then' || typeof propriedade === 'symbol') return undefined;
        if (propriedade === '__esModule') return true;
        return no(`${caminho}.${propriedade}`);
      },
      apply(_alvo, _this, argumentos: unknown[]) {
        chamadas.push({ caminho, argumentos });
        return no(`${caminho}()`);
      },
      construct(_alvo, argumentos: unknown[]) {
        chamadas.push({ caminho: `new ${caminho}`, argumentos });
        return no(`new ${caminho}`) as object;
      },
    });
  }
  return no(nome);
}

/** Tudo o que os espiões receberam, em texto, para procurar o token. */
export function chamadasEspionadas(): readonly ChamadaEspionada[] {
  return chamadas;
}

export function textoDasChamadasEspionadas(): string {
  return JSON.stringify(chamadas.map(({ caminho, argumentos }) => ({ caminho, argumentos })));
}

export function reiniciarEspioes(): void {
  chamadas.length = 0;
}
