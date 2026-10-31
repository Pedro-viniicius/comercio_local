// Endereço da API dos apps (plano 01b, etapa 12; S125).
import { urlDaApiConfigurada } from './url-da-api.ts';

describe('urlDaApiConfigurada (S125)', () => {
  it('fora do desenvolvimento, só aceita https://', () => {
    expect(urlDaApiConfigurada('https://api.bairrin.com.br', false)).toBe(
      'https://api.bairrin.com.br',
    );
    expect(urlDaApiConfigurada('  https://api.bairrin.com.br/  ', false)).toBe(
      'https://api.bairrin.com.br/',
    );
    for (const valor of [
      'http://api.bairrin.com.br',
      'http://10.0.2.2:3000',
      'api.bairrin.com.br',
      'ftp://api.bairrin.com.br',
      'https://',
      'https:///caminho',
      'https:// espaco.com.br',
      ' HTTP://api.bairrin.com.br',
    ]) {
      expect(urlDaApiConfigurada(valor, false)).toBeNull();
    }
  });

  it('em desenvolvimento, aceita o http:// da máquina local', () => {
    expect(urlDaApiConfigurada('http://10.0.2.2:3000', true)).toBe('http://10.0.2.2:3000');
    expect(urlDaApiConfigurada('https://api.bairrin.com.br', true)).toBe(
      'https://api.bairrin.com.br',
    );
  });

  it('vazio ou ausente é "sem configuração" nos dois modos', () => {
    for (const emDesenvolvimento of [true, false]) {
      expect(urlDaApiConfigurada(undefined, emDesenvolvimento)).toBeNull();
      expect(urlDaApiConfigurada('', emDesenvolvimento)).toBeNull();
      expect(urlDaApiConfigurada('   ', emDesenvolvimento)).toBeNull();
    }
  });
});
