// Rota inicial de ponta a ponta: Expo Router monta `src/app` (layout e tela inicial) e a tela
// fala com a API pelo cliente real (@bairrin/cliente-api), com o `fetch` trocado por um falso.
// Fica fora de `src/app`: o Expo Router trataria um `*.test.tsx` ali dentro como rota.
import { renderRouter, screen } from 'expo-router/testing-library';
import { textos as textosComuns } from '@bairrin/mobile-base';
import { textos } from '../textos/pt-BR.ts';

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

async function abrir(endereco: string | undefined) {
  if (endereco === undefined) delete process.env[ENDERECO];
  else process.env[ENDERECO] = endereco;
  await renderRouter('./src/app');
}

afterEach(() => {
  if (original === undefined) delete process.env[ENDERECO];
  else process.env[ENDERECO] = original;
  globalThis.fetch = fetchOriginal;
});

describe('rota inicial', () => {
  it('com a API no ar mostra "API disponível" e chama GET /v1/saude no endereço configurado', async () => {
    const buscar = jest.fn(() => Promise.resolve(resposta(200, { status: 'ok' })));
    globalThis.fetch = buscar as unknown as typeof fetch;

    await abrir('https://api.exemplo.test/');

    expect(await screen.findByText(textosComuns.estadoDaApi.disponivel)).toBeOnTheScreen();
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(buscar).toHaveBeenCalledWith('https://api.exemplo.test/v1/saude', expect.anything());
  });

  it('sem rede mostra "Sem conexão"', async () => {
    globalThis.fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed')));

    await abrir('https://api.exemplo.test');

    expect(await screen.findByText('Sem conexão')).toBeOnTheScreen();
  });

  it('sem EXPO_PUBLIC_API_URL mostra o aviso de configuração e não chama a rede', async () => {
    const buscar = jest.fn();
    globalThis.fetch = buscar;

    await abrir(undefined);

    expect(await screen.findByText(textosComuns.estadoDaApi.semConfiguracao)).toBeOnTheScreen();
    expect(buscar).not.toHaveBeenCalled();
  });

  it('o cabeçalho nativo leva o nome do app', async () => {
    await abrir(undefined);
    await screen.findByText(textosComuns.estadoDaApi.semConfiguracao);

    // O título do cabeçalho é desenhado pelo sistema: só aparece como propriedade da árvore.
    expect(JSON.stringify(screen.toJSON())).toContain(`"title":"${textos.titulo}"`);
  });
});
