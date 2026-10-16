// Controle: a infra de um módulo importa o client gerado e o adaptador do núcleo.
import { AdaptadorDoNucleo } from '../../../compartilhado/infra/adaptador.ts';
import { PrismaClient } from '../../../compartilhado/infra/gerado/prisma/client.ts';

export const infra = { AdaptadorDoNucleo, PrismaClient };
