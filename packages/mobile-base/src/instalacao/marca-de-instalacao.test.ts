// Marca de instalação (plano 01b, etapa 12; S18): arquivo vazio na pasta de documentos.
import {
  ARQUIVO_DA_MARCA_DE_INSTALACAO,
  marcaDeInstalacaoNoAparelho,
} from './marca-de-instalacao.ts';

const mockArquivos = {
  existentes: new Set<string>(),
  criados: [] as { caminho: string; argumentos: unknown[] }[],
  escritas: [] as unknown[],
  falhar: false,
};

jest.mock('expo-file-system', () => {
  class File {
    readonly caminho: string;
    constructor(pasta: string, nome: string) {
      this.caminho = `${pasta}/${nome}`;
    }
    get exists(): boolean {
      if (mockArquivos.falhar) throw new Error('sem acesso');
      return mockArquivos.existentes.has(this.caminho);
    }
    create(...argumentos: unknown[]): void {
      mockArquivos.criados.push({ caminho: this.caminho, argumentos });
      mockArquivos.existentes.add(this.caminho);
    }
    write(...argumentos: unknown[]): void {
      mockArquivos.escritas.push(argumentos);
    }
  }
  return { File, Paths: { document: 'documentos' } };
});

beforeEach(() => {
  mockArquivos.existentes.clear();
  mockArquivos.criados.length = 0;
  mockArquivos.escritas.length = 0;
  mockArquivos.falhar = false;
});

describe('marca de instalação no aparelho', () => {
  it('cria um arquivo vazio na pasta de documentos, sem escrever conteúdo', async () => {
    await expect(marcaDeInstalacaoNoAparelho.existe()).resolves.toBe(false);

    await marcaDeInstalacaoNoAparelho.marcar();

    await expect(marcaDeInstalacaoNoAparelho.existe()).resolves.toBe(true);
    expect(mockArquivos.criados).toEqual([
      { caminho: `documentos/${ARQUIVO_DA_MARCA_DE_INSTALACAO}`, argumentos: [] },
    ]);
    expect(mockArquivos.escritas).toEqual([]);
  });

  it('marcar de novo não recria o arquivo', async () => {
    await marcaDeInstalacaoNoAparelho.marcar();
    await marcaDeInstalacaoNoAparelho.marcar();

    expect(mockArquivos.criados).toHaveLength(1);
  });

  it('a falha do sistema de arquivos vira promessa rejeitada', async () => {
    mockArquivos.falhar = true;

    await expect(marcaDeInstalacaoNoAparelho.existe()).rejects.toThrow('sem acesso');
    await expect(marcaDeInstalacaoNoAparelho.marcar()).rejects.toThrow('sem acesso');
  });
});
