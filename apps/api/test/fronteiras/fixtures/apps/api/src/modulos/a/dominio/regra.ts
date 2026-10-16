// Controle: domínio importa o próprio domínio e o núcleo compartilhado.
import { nucleo } from '../../../compartilhado/nucleo.ts';
import { Entidade } from './entidade.ts';

export const criar = (id: string): Entidade => new Entidade(`${nucleo}:${id}`);
