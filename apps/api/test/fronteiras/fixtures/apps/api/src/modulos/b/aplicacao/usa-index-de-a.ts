// Controle: um módulo importa outro só pelo index.ts.
import { CasoDeUso } from '../../a/index.ts';
import { EntidadeB } from '../dominio/entidade.ts';

export const usa = { CasoDeUso, EntidadeB };
