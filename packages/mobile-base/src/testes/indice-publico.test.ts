// Superfície pública da sessão no índice do pacote (S128): os apps recebem o provedor, o hook, a
// URL da API, o persister e os tipos. O cofre do SecureStore, as chaves dele e a
// `criarSessaoDoApp` ficam dentro do pacote, para nenhuma tela chegar ao token.
import * as indice from '../index.ts';

describe('índice público do @bairrin/mobile-base', () => {
  it.each(['ProvedorDeSessao', 'useSessao', 'urlDaApiConfigurada', 'criarPersisterPermitido'])(
    'exporta %s, que os apps usam',
    (nome) => {
      expect(Object.keys(indice)).toContain(nome);
    },
  );

  it.each([
    'criarCofreDaSessao',
    'CHAVE_DA_SESSAO',
    'CHAVE_DA_REVOGACAO_PENDENTE',
    'OPCOES_DO_SECURE_STORE',
    'criarSessaoDoApp',
  ])('não exporta %s', (nome) => {
    expect(Object.keys(indice)).not.toContain(nome);
  });
});
