// Prova que as dependências do pacote resolvem no Jest do workspace: os pacotes `@bairrin/*`
// chegam como fonte TypeScript e os módulos nativos do Expo, pelos mocks do `jest-expo`.
import { QueryClient } from '@tanstack/react-query';
import * as sistemaDeArquivos from 'expo-file-system';
import * as armazenamentoSeguro from 'expo-secure-store';
import * as compartilhamento from 'expo-sharing';
import { Svg } from 'react-native-svg';

import { criarClienteApi } from '@bairrin/cliente-api';
import * as contratos from '@bairrin/contratos';
import { temaClaro } from '@bairrin/tokens';

describe('dependências do @bairrin/mobile-base', () => {
  it('resolve os pacotes do workspace', () => {
    expect(typeof criarClienteApi).toBe('function');
    expect(Object.keys(contratos).length).toBeGreaterThan(0);
    expect(temaClaro.action.primary).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('resolve o armazenamento seguro e o compartilhamento de arquivos', () => {
    expect(typeof armazenamentoSeguro.getItemAsync).toBe('function');
    expect(typeof armazenamentoSeguro.setItemAsync).toBe('function');
    expect(typeof armazenamentoSeguro.deleteItemAsync).toBe('function');
    expect(typeof compartilhamento.shareAsync).toBe('function');
    expect(typeof sistemaDeArquivos.File).toBe('function');
  });

  it('resolve o React Query e o SVG', () => {
    expect(new QueryClient().getQueryCache().getAll()).toEqual([]);
    expect(Svg).toBeDefined();
  });
});
