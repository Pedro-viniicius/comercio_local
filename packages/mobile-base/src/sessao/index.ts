// Sessão dos apps (plano 01b, etapa 12). O índice do pacote (`src/index.ts`) reexporta daqui.
// Só o que os apps usam (S128): o provedor, o hook, a URL da API, o persister e os tipos. O cofre
// (`criarCofreDaSessao` e as chaves do SecureStore) e a `criarSessaoDoApp` ficam dentro do pacote:
// nenhuma tela lê o token.
export { type CofreDaSessao, type OrigemDaFalhaNoCofre } from './armazenamento-seguro.ts';
export {
  CONSULTAS_PERSISTIDAS,
  criarPersisterPermitido,
  filtrarCache,
  podePersistir,
  type CachePersistido,
  type PersisterDoCache,
} from './persistencia-permitida.ts';
export {
  ProvedorDeSessao,
  useSessao,
  type PropriedadesDoProvedorDeSessao,
  type ValorDaSessao,
} from './provedor-de-sessao.tsx';
export {
  CAMINHO_DE_ENTRAR,
  ErroAoLimparDadosDaConta,
  type CredenciaisDeEntrada,
  type EstadoDaSessao,
  type FilaOfflineDaConta,
  type OpcoesDaSessaoDoApp,
  type OrigemDaFalhaDaSessao,
  type PedidoDeSessaoSubstituta,
  type SessaoDoApp,
  type SituacaoDaSessao,
} from './sessao-do-app.ts';
export { urlDaApiConfigurada } from './url-da-api.ts';
