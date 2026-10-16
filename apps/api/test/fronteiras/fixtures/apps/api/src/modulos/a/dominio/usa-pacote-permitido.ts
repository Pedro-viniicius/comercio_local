// Controle: o único caminho de pacote que o domínio pode importar é o de validadores.
import { validar } from '../../../../../../packages/contratos/src/validadores/index.ts';

export const valido = validar('x');
