// S125 na rota inicial: fora do modo de desenvolvimento (`__DEV__` falso, como no build de
// produção), um endereço sem `https://` conta como "sem configuração" e o app não chama a API;
// em desenvolvimento, o `http://` da máquina local continua valendo. O cliente é o real
// (`@bairrin/cliente-api`) com o `fetch` trocado por um falso.
import { textos as textosComuns } from '@bairrin/mobile-base';
import { renderRouter, screen } from 'expo-router/testing-library';

const ENDERECO = 'EXPO_PUBLIC_API_URL';
const original = process.env[ENDERECO];
const fetchOriginal = globalThis.fetch;
const global_ = globalThis as unknown as { __DEV__: boolean };
const devOriginal = global_.__DEV__;

function resposta(status: number, corpo: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(JSON.stringify(corpo)),
  };
}

async function abrir(endereco: string, emDesenvolvimento: boolean) {
  global_.__DEV__ = emDesenvolvimento;
  process.env[ENDERECO] = endereco;
  await renderRouter('./src/app');
}

afterEach(() => {
  global_.__DEV__ = devOriginal;
  if (original === undefined) delete process.env[ENDERECO];
  else process.env[ENDERECO] = original;
  globalThis.fetch = fetchOriginal;
});

describe('rota inicial, endereço da API fora de __DEV__ (S125)', () => {
  it.each([
    'http://api.exemplo.test',
    'HTTP://api.exemplo.test',
    'http://localhost:3000',
    'http://10.0.2.2:3000',
    'api.exemplo.test',
    'ftp://api.exemplo.test',
    '//api.exemplo.test',
    'https://',
    'https:// api.exemplo.test',
    'javascript:alert(1)',
  ])('"%s" vira "sem configuração" e não chama a API', async (endereco) => {
    const buscar = jest.fn(() => Promise.resolve(resposta(200, { status: 'ok' })));
    globalThis.fetch = buscar as unknown as typeof fetch;

    await abrir(endereco, false);

    expect(await screen.findByText(textosComuns.estadoDaApi.semConfiguracao)).toBeOnTheScreen();
    expect(buscar).not.toHaveBeenCalled();
  });

  it('com https:// chama a API normalmente', async () => {
    const buscar = jest.fn(() => Promise.resolve(resposta(200, { status: 'ok' })));
    globalThis.fetch = buscar as unknown as typeof fetch;

    await abrir('https://api.exemplo.test', false);

    expect(await screen.findByText(textosComuns.estadoDaApi.disponivel)).toBeOnTheScreen();
    expect(buscar).toHaveBeenCalledWith('https://api.exemplo.test/v1/saude', expect.anything());
  });

  it('em desenvolvimento, o http:// da máquina local continua valendo', async () => {
    const buscar = jest.fn(() => Promise.resolve(resposta(200, { status: 'ok' })));
    globalThis.fetch = buscar as unknown as typeof fetch;

    await abrir('http://10.0.2.2:3000', true);

    expect(await screen.findByText(textosComuns.estadoDaApi.disponivel)).toBeOnTheScreen();
    expect(buscar).toHaveBeenCalledWith('http://10.0.2.2:3000/v1/saude', expect.anything());
  });
});
