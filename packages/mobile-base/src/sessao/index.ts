// Sessão dos apps (plano 01b, etapa 12). O índice do pacote (`src/index.ts`) reexporta daqui.
export {
  CHAVE_DA_REVOGACAO_PENDENTE,
  CHAVE_DA_SESSAO,
  criarCofreDaSessao,
  type CofreDaSessao,
  type OpcoesDoCofreDaSessao,
  type OrigemDaFalhaNoCofre,
} from './armazenamento-seguro.ts';
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
  criarSessaoDoApp,
  ErroAoLimparDadosDaConta,
  type CredenciaisDeEntrada,
  type EstadoDaSessao,
  type FilaOfflineDaConta,
  type OpcoesDaSessaoDoApp,
  type OrigemDaFalhaDaSessao,
  type SessaoDoApp,
  type SituacaoDaSessao,
} from './sessao-do-app.ts';
export { urlDaApiConfigurada } from './url-da-api.ts';
