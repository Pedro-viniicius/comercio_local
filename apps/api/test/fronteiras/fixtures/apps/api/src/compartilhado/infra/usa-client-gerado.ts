// Controle: a infra do núcleo importa o client gerado.
import { PrismaClient } from './gerado/prisma/client.ts';

export const cliente = PrismaClient;
