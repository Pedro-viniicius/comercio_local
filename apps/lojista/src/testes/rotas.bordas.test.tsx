// Bordas da rota inicial (QA, M1): endereço com espaços, endereço em branco e respostas ruins da
// API pelo cliente real (`@bairrin/cliente-api`) com o `fetch` trocado por um falso.
import { renderRouter, screen } from 'expo-router/testing-library';
import { textos as textosComuns } from '@bairrin/mobile-base';

const ENDERECO = 'EXPO_PUBLIC_API_URL';
const original = process.env[ENDERECO];
const fetchOriginal = globalThis.fetch;

function resposta(status: number, corpo: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(JSON.stringify(corpo)),
  };
}

async function abrir(endereco: string) {
  process.env[ENDERECO] = endereco;
  await renderRouter('./src/app');
}

afterEach(() => {
  if (original === undefined) delete process.env[ENDERECO];
  else process.env[ENDERECO] = original;
  globalThis.fetch = fetchOriginal;
});

describe('rota inicial, bordas', () => {
  it('ignora espaços em volta do endereço configurado', async () => {
    const buscar = jest.fn(() => Promise.resolve(resposta(200, { status: 'ok' })));
    globalThis.fetch = buscar as unknown as typeof fetch;

    await abrir('  https://api.exemplo.test  ');

    expect(await screen.findByText(textosComuns.estadoDaApi.disponivel)).toBeOnTheScreen();
    expect(buscar).toHaveBeenCalledWith('https://api.exemplo.test/v1/saude', expect.anything());
  });

  it.each(['', '   '])(
    'trata o endereço %j como não configurado, sem chamar a rede',
    async (valor) => {
      const buscar = jest.fn();
      globalThis.fetch = buscar;

      await abrir(valor);

      expect(await screen.findByText(textosComuns.estadoDaApi.semConfiguracao)).toBeOnTheScreen();
      expect(buscar).not.toHaveBeenCalled();
    },
  );

  it('mostra erro da API (e não "Sem conexão") quando a API responde 503', async () => {
    globalThis.fetch = jest.fn(() => Promise.resolve(resposta(503, {}))) as unknown as typeof fetch;

    await abrir('https://api.exemplo.test');

    expect(await screen.findByText(textosComuns.estadoDaApi.erroDaApi)).toBeOnTheScreen();
    expect(screen.queryByText(textosComuns.estadoDaApi.semConexao)).toBeNull();
  });

  it('mostra erro da API quando a resposta 200 foge do contrato', async () => {
    globalThis.fetch = jest.fn(() =>
      Promise.resolve(resposta(200, { status: 'quebrado' })),
    ) as unknown as typeof fetch;

    await abrir('https://api.exemplo.test');

    expect(await screen.findByText(textosComuns.estadoDaApi.erroDaApi)).toBeOnTheScreen();
  });
});
