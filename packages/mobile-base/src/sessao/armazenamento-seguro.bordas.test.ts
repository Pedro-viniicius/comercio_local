// Bordas do cofre da sessão (plano 01b, etapa 12; CA-03, S18, S80): a limpeza da primeira abertura
// com falha parcial e nova tentativa, operações em corrida e quem só observa as falhas.
import type { Sessao } from '@bairrin/contratos';
import {
  CHAVE_DA_REVOGACAO_PENDENTE,
  CHAVE_DA_SESSAO,
  criarCofreDaSessao,
} from './armazenamento-seguro.ts';
import { adiada } from './teste/api-falsa.ts';
import { secureStoreFalso, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from './teste/secure-store-falso.ts';

jest.mock('expo-secure-store', () =>
  jest.requireActual<typeof import('./teste/secure-store-falso.ts')>(
    './teste/secure-store-falso.ts',
  ),
);

const ANTIGA: Sessao = {
  tokenAcesso: 'eyJhbGciOiJIUzI1NiJ9.acesso-da-instalacao-anterior.assinatura',
  tokenRenovacao: 'renovacao-da-instalacao-anterior-0123456789',
  expiraEm: '2026-10-27T15:00:00.000Z',
  emailVerificado: true,
};
const NOVA: Sessao = {
  tokenAcesso: 'eyJhbGciOiJIUzI1NiJ9.acesso-da-instalacao-nova.assinatura',
  tokenRenovacao: 'renovacao-da-instalacao-nova-9876543210',
  expiraEm: '2026-10-27T16:00:00.000Z',
  emailVerificado: false,
};

interface MarcaEmMemoria {
  instalada: boolean;
  existe: jest.Mock<Promise<boolean>, []>;
  marcar: jest.Mock<Promise<void>, []>;
}

/** Marca de instalação em memória que sobrevive entre "aberturas" (vários cofres). */
function marcaEmMemoria(instalada: boolean): MarcaEmMemoria {
  const marca: MarcaEmMemoria = {
    instalada,
    existe: jest.fn(() => Promise.resolve(marca.instalada)),
    marcar: jest.fn(() => {
      marca.instalada = true;
      return Promise.resolve();
    }),
  };
  return marca;
}

function guardados(): string[] {
  return [...secureStoreFalso.itens.keys()].sort();
}

beforeEach(() => {
  secureStoreFalso.reiniciar();
});

describe('limpeza da primeira abertura, falha e nova tentativa (S18)', () => {
  it('se só a revogação pendente não for apagada, rejeita, não marca e a nova tentativa apaga as duas', async () => {
    secureStoreFalso.itens.set(CHAVE_DA_SESSAO, JSON.stringify(ANTIGA));
    secureStoreFalso.itens.set(CHAVE_DA_REVOGACAO_PENDENTE, JSON.stringify({ tokenAcesso: 'x' }));
    secureStoreFalso.falhas.add(`apagar:${CHAVE_DA_REVOGACAO_PENDENTE}`);
    const marca = marcaEmMemoria(false);
    const { sessao, revogacaoPendente } = criarCofreDaSessao({ marca });

    await expect(revogacaoPendente.ler()).rejects.toThrow(/armazenamento seguro/);
    expect(marca.marcar).not.toHaveBeenCalled();
    // A sessão antiga nunca é entregue enquanto a limpeza não termina.
    await expect(sessao.ler()).rejects.toThrow(/armazenamento seguro/);
    expect(secureStoreFalso.chamadas.some((c) => c.metodo === 'ler')).toBe(false);

    secureStoreFalso.falhas.clear();
    expect(await sessao.ler()).toBeNull();
    expect(await revogacaoPendente.ler()).toBeNull();
    expect(guardados()).toEqual([]);
    expect(marca.marcar).toHaveBeenCalledTimes(1);
  });

  it('gravar, ler e limpar falham juntos enquanto a limpeza falha, e nada é gravado', async () => {
    secureStoreFalso.itens.set(CHAVE_DA_SESSAO, JSON.stringify(ANTIGA));
    secureStoreFalso.falhas.add(`apagar:${CHAVE_DA_SESSAO}`);
    const { sessao, revogacaoPendente } = criarCofreDaSessao({ marca: marcaEmMemoria(false) });

    const resultados = await Promise.allSettled([
      sessao.ler(),
      sessao.gravar(NOVA),
      revogacaoPendente.gravar({ tokenAcesso: 'y' }),
      sessao.limpar(),
    ]);

    expect(resultados.map((r) => r.status)).toEqual([
      'rejected',
      'rejected',
      'rejected',
      'rejected',
    ]);
    expect(secureStoreFalso.chamadas.some((c) => c.metodo === 'gravar')).toBe(false);
    // A sessão antiga continua lá, sem ser lida nem regravada por ninguém.
    expect(secureStoreFalso.itens.get(CHAVE_DA_SESSAO)).toBe(JSON.stringify(ANTIGA));
  });

  it('a reabertura seguinte, com a marca já gravada, mantém a sessão da instalação atual', async () => {
    const marca = marcaEmMemoria(false);
    secureStoreFalso.itens.set(CHAVE_DA_SESSAO, JSON.stringify(ANTIGA));

    const abertura1 = criarCofreDaSessao({ marca });
    expect(await abertura1.sessao.ler()).toBeNull();
    await abertura1.sessao.gravar(NOVA);

    const abertura2 = criarCofreDaSessao({ marca });
    expect(await abertura2.sessao.ler()).toEqual(NOVA);
    expect(marca.marcar).toHaveBeenCalledTimes(1);
  });

  it('quem só observa as falhas não muda o resultado: aoFalhar que lança', async () => {
    const marca = marcaEmMemoria(false);
    marca.existe.mockRejectedValueOnce(new Error('sem acesso'));
    marca.marcar.mockRejectedValueOnce(new Error('sem acesso'));
    const { sessao } = criarCofreDaSessao({
      marca,
      aoFalhar: () => {
        throw new Error('o observador quebrou');
      },
    });

    await sessao.gravar(NOVA);
    expect(await sessao.ler()).toEqual(NOVA);
  });

  it('uma sessão gravada depois da limpeza não é apagada por uma segunda leitura concorrente', async () => {
    const marca = marcaEmMemoria(false);
    const existe = adiada<boolean>();
    marca.existe.mockImplementationOnce(() => existe.promessa);
    const { sessao } = criarCofreDaSessao({ marca });

    const leituras = [sessao.ler(), sessao.ler(), sessao.ler()];
    existe.resolver(false);
    await Promise.all(leituras);
    await sessao.gravar(NOVA);
    await Promise.all([sessao.ler(), sessao.ler()]);

    expect(await sessao.ler()).toEqual(NOVA);
    // Uma limpeza só: duas chaves apagadas, não seis.
    expect(secureStoreFalso.chamadas.filter((c) => c.metodo === 'apagar')).toHaveLength(2);
  });
});

describe('toda chamada ao SecureStore leva WHEN_UNLOCKED_THIS_DEVICE_ONLY, em qualquer caminho', () => {
  it('limpeza da primeira abertura, gravação, leitura, limpeza e revogação pendente', async () => {
    const { sessao, revogacaoPendente } = criarCofreDaSessao({ marca: marcaEmMemoria(false) });

    await sessao.gravar(NOVA);
    await sessao.ler();
    await sessao.limpar();
    await revogacaoPendente.gravar({ tokenAcesso: 'a', tokenRenovacao: 'b' });
    await revogacaoPendente.ler();
    await revogacaoPendente.limpar();

    expect(secureStoreFalso.chamadas.length).toBeGreaterThanOrEqual(8);
    for (const chamada of secureStoreFalso.chamadas) {
      expect(chamada.opcoes).toEqual({ keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    }
    expect(new Set(secureStoreFalso.chamadas.map((c) => c.metodo))).toEqual(
      new Set(['ler', 'gravar', 'apagar']),
    );
  });
});
