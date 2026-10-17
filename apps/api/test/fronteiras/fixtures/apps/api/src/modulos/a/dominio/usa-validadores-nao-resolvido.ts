// Controle: `@bairrin/contratos/validadores` é a exceção da regra
// `dominio-so-importa-validadores`. O import pelo nome do pacote resolve para o
// fonte real (`packages/contratos/src/validadores/index.ts`, condição
// `@bairrin/fonte`). O nome do arquivo é de quando o subcaminho não existia.
import '@bairrin/contratos/validadores';
