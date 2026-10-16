// Controle: infra importa aplicação, domínio e Prisma.
import type { PrismaPg } from '@prisma/adapter-pg';
import { executar } from '../aplicacao/caso-de-uso.ts';
import { Entidade } from '../dominio/entidade.ts';

export const Repositorio = { executar, Entidade };
export type Banco = PrismaPg;
