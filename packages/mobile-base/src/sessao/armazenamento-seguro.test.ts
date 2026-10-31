// Armazenamentos da sessão no SecureStore (plano 01b, etapa 12; CA-03, S18, S80, S127).
import { MAXIMO_DE_REVOGACOES_PENDENTES } from '@bairrin/cliente-api';
import type { Sessao } from '@bairrin/contratos';
import {
  CHAVE_DA_REVOGACAO_PENDENTE,
  CHAVE_DA_SESSAO,
  criarCofreDaSessao,
  type OrigemDaFalhaNoCofre,
} from './armazenamento-seguro.ts';
import { adiada } from './teste/api-falsa.ts';
import { WHEN_UNLOCKED_THIS_DEVICE_ONLY, secureStoreFalso } from './teste/secure-store-falso.ts';

jest.mock('expo-secure-store', () =>
  jest.requireActual<typeof import('./teste/secure-store-falso.ts')>(
    './teste/secure-store-falso.ts',
  ),
);

const SESSAO: Sessao = {
  tokenAcesso: 'eyJhbGciOiJIUzI1NiJ9.acesso-guardado.assinatura',
  tokenRenovacao: 'renovacao-guardada-0123456789abcdef',
  expiraEm: '2026-10-27T15:00:00.000Z',
  emailVerificado: true,
};

interface MarcaFalsa {
  instalada: boolean;
  falharExiste: boolean;
  falharMarcar: boolean;
  existe: jest.Mock<Promise<boolean>, []>;
  marcar: jest.Mock<Promise<void>, []>;
}

function marcaFalsa(instalada = true): MarcaFalsa {
  const marca: MarcaFalsa = {
    instalada,
    falharExiste: false,
    falharMarcar: false,
    existe: jest.fn(() =>
      marca.falharExiste
        ? Promise.reject(new Error('sem acesso'))
        : Promise.resolve(marca.instalada),
    ),
    marcar: jest.fn(() => {
      if (marca.falharMarcar) return Promise.reject(new Error('sem acesso'));
      marca.instalada = true;
      return Promise.resolve();
    }),
  };
  return marca;
}

beforeEach(() => {
  secureStoreFalso.reiniciar();
});

describe('cofre da sessão no SecureStore', () => {
  it('grava, lê e limpa a sessão só na chave dela, sempre com WHEN_UNLOCKED_THIS_DEVICE_ONLY', async () => {
    const { sessao } = criarCofreDaSessao({ marca: marcaFalsa() });

    await sessao.gravar(SESSAO);
    expect(await sessao.ler()).toEqual(SESSAO);
    await sessao.limpar();
    expect(await sessao.ler()).toBeNull();

    expect(secureStoreFalso.chamadas.map((c) => `${c.metodo}:${c.chave}`)).toEqual([
      `gravar:${CHAVE_DA_SESSAO}`,
      `ler:${CHAVE_DA_SESSAO}`,
      `apagar:${CHAVE_DA_SESSAO}`,
      `ler:${CHAVE_DA_SESSAO}`,
    ]);
    for (const chamada of secureStoreFalso.chamadas) {
      expect(chamada.opcoes).toEqual({ keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    }
    expect(JSON.parse(secureStoreFalso.chamadas[0]?.valor ?? '')).toEqual(SESSAO);
  });

  it('guarda a revogação pendente numa chave própria: limpar uma não apaga a outra (S80)', async () => {
    const { sessao, revogacaoPendente } = criarCofreDaSessao({ marca: marcaFalsa() });
    const pendente = {
      tokenAcesso: 'a1',
      tokenRenovacao: 'r1',
      anteriores: [{ tokenAcesso: 'a0' }],
    };

    await sessao.gravar(SESSAO);
    await revogacaoPendente.gravar(pendente);
    expect(CHAVE_DA_REVOGACAO_PENDENTE).not.toBe(CHAVE_DA_SESSAO);

    await sessao.limpar();
    expect(await revogacaoPendente.ler()).toEqual(pendente);

    await sessao.gravar(SESSAO);
    await revogacaoPendente.limpar();
    expect(await sessao.ler()).toEqual(SESSAO);
    expect(await revogacaoPendente.ler()).toBeNull();
    for (const chamada of secureStoreFalso.chamadas) {
      expect(chamada.opcoes).toEqual({ keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    }
  });

  it('conta como ausente o valor fora do formato: JSON quebrado, sessão incompleta, revogação que não é objeto', async () => {
    const { sessao, revogacaoPendente } = criarCofreDaSessao({ marca: marcaFalsa() });

    for (const valor of ['{quebrado', '"texto"', JSON.stringify({ tokenAcesso: 'só isto' })]) {
      secureStoreFalso.itens.set(CHAVE_DA_SESSAO, valor);
      expect(await sessao.ler()).toBeNull();
    }
    for (const valor of ['{quebrado', '"texto"', '[1,2]', 'null', '7']) {
      secureStoreFalso.itens.set(CHAVE_DA_REVOGACAO_PENDENTE, valor);
      expect(await revogacaoPendente.ler()).toBeNull();
    }
  });

  it('troca o erro nativo por um sem detalhe (a mensagem nativa pode citar a chave)', async () => {
    const { sessao, revogacaoPendente } = criarCofreDaSessao({ marca: marcaFalsa() });
    secureStoreFalso.falhas.add(`gravar:${CHAVE_DA_SESSAO}`);
    secureStoreFalso.falhas.add(`ler:${CHAVE_DA_REVOGACAO_PENDENTE}`);
    secureStoreFalso.falhas.add(`apagar:${CHAVE_DA_SESSAO}`);

    const erros = await Promise.all([
      sessao.gravar(SESSAO).catch((erro: unknown) => erro),
      revogacaoPendente.ler().catch((erro: unknown) => erro),
      sessao.limpar().catch((erro: unknown) => erro),
    ]);
    for (const erro of erros) {
      expect(erro).toBeInstanceOf(Error);
      expect((erro as Error).message).toMatch(/^Não foi possível \w+ no armazenamento seguro\.$/);
      expect((erro as Error).message).not.toContain('bairrin');
    }
  });

  describe('primeira abertura depois de instalar (S18, S127)', () => {
    it('sem a marca, o par e a pendência da instalação anterior viram uma revogação pendente, a sessão sai antes de qualquer uso, e depois marca (S127)', async () => {
      secureStoreFalso.itens.set(CHAVE_DA_SESSAO, JSON.stringify(SESSAO));
      secureStoreFalso.itens.set(
        CHAVE_DA_REVOGACAO_PENDENTE,
        JSON.stringify({ tokenAcesso: 'acesso-de-um-logout-sem-rede' }),
      );
      const marca = marcaFalsa(false);
      const { sessao, revogacaoPendente } = criarCofreDaSessao({ marca });

      expect(await sessao.ler()).toBeNull();
      // Só os tokens: o par da sessão é o mais novo, e a pendência anterior vem depois.
      expect(await revogacaoPendente.ler()).toEqual({
        tokenAcesso: SESSAO.tokenAcesso,
        tokenRenovacao: SESSAO.tokenRenovacao,
        anteriores: [{ tokenAcesso: 'acesso-de-um-logout-sem-rede' }],
      });
      expect(secureStoreFalso.itens.has(CHAVE_DA_SESSAO)).toBe(false);

      const preparo = secureStoreFalso.chamadas.slice(0, 4).map((c) => `${c.metodo}:${c.chave}`);
      expect(preparo.slice(0, 2).sort()).toEqual([
        `ler:${CHAVE_DA_REVOGACAO_PENDENTE}`,
        `ler:${CHAVE_DA_SESSAO}`,
      ]);
      // A pendência é gravada antes de a sessão sair.
      expect(preparo.slice(2)).toEqual([
        `gravar:${CHAVE_DA_REVOGACAO_PENDENTE}`,
        `apagar:${CHAVE_DA_SESSAO}`,
      ]);
      for (const chamada of secureStoreFalso.chamadas) {
        expect(chamada.opcoes).toEqual({ keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      }
      expect(marca.marcar).toHaveBeenCalledTimes(1);
      // Uma vez só por abertura, e nada vai para a chave da sessão.
      expect(secureStoreFalso.chamadas.filter((c) => c.metodo === 'apagar')).toHaveLength(1);
      expect(
        secureStoreFalso.chamadas.some((c) => c.metodo === 'gravar' && c.chave === CHAVE_DA_SESSAO),
      ).toBe(false);
    });

    it('sem nada da instalação anterior, apaga as duas chaves (um valor quebrado não fica)', async () => {
      secureStoreFalso.itens.set(CHAVE_DA_SESSAO, '{quebrado');
      secureStoreFalso.itens.set(CHAVE_DA_REVOGACAO_PENDENTE, JSON.stringify({ outro: 1 }));
      const { sessao, revogacaoPendente } = criarCofreDaSessao({ marca: marcaFalsa(false) });

      expect(await sessao.ler()).toBeNull();
      expect(await revogacaoPendente.ler()).toBeNull();
      expect(secureStoreFalso.itens.size).toBe(0);
      expect(secureStoreFalso.chamadas.some((c) => c.metodo === 'gravar')).toBe(false);
    });

    it('a revogação da instalação anterior não repete par e guarda no máximo MAXIMO_DE_REVOGACOES_PENDENTES', async () => {
      const par = (n: number) => ({ tokenAcesso: `acesso-${n}`, tokenRenovacao: `renovacao-${n}` });
      secureStoreFalso.itens.set(CHAVE_DA_SESSAO, JSON.stringify({ ...SESSAO, ...par(0) }));
      secureStoreFalso.itens.set(
        CHAVE_DA_REVOGACAO_PENDENTE,
        JSON.stringify({
          ...par(0),
          anteriores: [par(1), 'texto', { tokenAcesso: 7 }, par(1), par(2), par(3), par(4), par(5)],
        }),
      );
      const { revogacaoPendente } = criarCofreDaSessao({ marca: marcaFalsa(false) });

      expect(MAXIMO_DE_REVOGACOES_PENDENTES).toBe(5);
      expect(await revogacaoPendente.ler()).toEqual({
        ...par(0),
        anteriores: [par(1), par(2), par(3), par(4)],
      });
    });

    it('sem conseguir ler a sessão antiga, ela não é revogada, mas a chave sai mesmo assim', async () => {
      secureStoreFalso.itens.set(CHAVE_DA_SESSAO, JSON.stringify(SESSAO));
      secureStoreFalso.itens.set(CHAVE_DA_REVOGACAO_PENDENTE, JSON.stringify({ tokenAcesso: 'x' }));
      secureStoreFalso.falhas.add(`ler:${CHAVE_DA_SESSAO}`);
      const { revogacaoPendente } = criarCofreDaSessao({ marca: marcaFalsa(false) });

      expect(await revogacaoPendente.ler()).toEqual({ tokenAcesso: 'x' });
      expect(secureStoreFalso.itens.has(CHAVE_DA_SESSAO)).toBe(false);
    });

    it('com a marca, não apaga nada: a sessão da instalação atual continua', async () => {
      secureStoreFalso.itens.set(CHAVE_DA_SESSAO, JSON.stringify(SESSAO));
      const marca = marcaFalsa(true);

      expect(await criarCofreDaSessao({ marca }).sessao.ler()).toEqual(SESSAO);
      expect(secureStoreFalso.chamadas.some((c) => c.metodo === 'apagar')).toBe(false);
      expect(marca.marcar).not.toHaveBeenCalled();
    });

    it('a sessão gravada enquanto a limpeza corre não é apagada por ela', async () => {
      const marca = marcaFalsa(false);
      const existe = adiada<boolean>();
      marca.existe.mockImplementationOnce(() => existe.promessa);
      const { sessao } = criarCofreDaSessao({ marca });

      const gravacao = sessao.gravar(SESSAO);
      existe.resolver(false);
      await gravacao;

      expect(await sessao.ler()).toEqual(SESSAO);
      expect(secureStoreFalso.chamadas.map((c) => c.metodo)).toEqual([
        'ler',
        'ler',
        'apagar',
        'apagar',
        'gravar',
        'ler',
      ]);
    });

    it('se apagar falhar, a operação rejeita sem marcar, e a próxima tenta de novo', async () => {
      secureStoreFalso.itens.set(CHAVE_DA_SESSAO, JSON.stringify(SESSAO));
      secureStoreFalso.falhas.add(`apagar:${CHAVE_DA_SESSAO}`);
      const marca = marcaFalsa(false);
      const { sessao, revogacaoPendente } = criarCofreDaSessao({ marca });

      await expect(sessao.ler()).rejects.toThrow(
        'Não foi possível apagar no armazenamento seguro.',
      );
      expect(marca.marcar).not.toHaveBeenCalled();

      secureStoreFalso.falhas.clear();
      // A sessão da instalação anterior nunca é entregue, e o par entra na pendência uma vez só.
      expect(await sessao.ler()).toBeNull();
      expect(marca.marcar).toHaveBeenCalledTimes(1);
      expect(await revogacaoPendente.ler()).toEqual({
        tokenAcesso: SESSAO.tokenAcesso,
        tokenRenovacao: SESSAO.tokenRenovacao,
      });
    });

    it('sem conseguir ler a marca, trata como instalação nova e avisa só a origem', async () => {
      secureStoreFalso.itens.set(CHAVE_DA_SESSAO, JSON.stringify(SESSAO));
      const marca = marcaFalsa(true);
      marca.falharExiste = true;
      const avisos: unknown[][] = [];
      const { sessao } = criarCofreDaSessao({
        marca,
        aoFalhar: (...argumentos: [OrigemDaFalhaNoCofre]) => {
          avisos.push(argumentos);
        },
      });

      expect(await sessao.ler()).toBeNull();
      expect(avisos).toEqual([['marca_de_instalacao']]);
    });

    it('sem conseguir marcar, segue nesta abertura e avisa só a origem', async () => {
      const marca = marcaFalsa(false);
      marca.falharMarcar = true;
      const avisos: unknown[][] = [];
      const { sessao } = criarCofreDaSessao({
        marca,
        aoFalhar: (...argumentos: [OrigemDaFalhaNoCofre]) => {
          avisos.push(argumentos);
        },
      });

      await sessao.gravar(SESSAO);
      expect(await sessao.ler()).toEqual(SESSAO);
      expect(avisos).toEqual([['marca_de_instalacao']]);
    });
  });
});
