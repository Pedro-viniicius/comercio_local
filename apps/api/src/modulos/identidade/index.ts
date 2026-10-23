// API pública do módulo Identidade: o que o resto da aplicação (`app.module.ts`,
// `worker.module.ts` e os outros módulos) pode importar daqui. Qualquer outro
// arquivo de `modulos/identidade/` é interno (`.dependency-cruiser.cjs`,
// `modulo-so-importa-index-de-outro-modulo`).
export { IdentidadeModule, TAREFAS_DIARIAS_DA_IDENTIDADE } from './identidade.module.ts';
// Outro módulo que possa adiar a exclusão de uma conta (pedido em andamento,
// saldo a repassar) registra a sua fonte aqui (CA-11).
export {
  type FonteDePendencias,
  type PendenciaDeExclusao,
  RegistroDePendencias,
} from './aplicacao/portas/verificador-de-pendencias.ts';
