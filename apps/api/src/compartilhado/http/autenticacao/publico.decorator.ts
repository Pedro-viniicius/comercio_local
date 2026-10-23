// `@Publico()`: a rota (ou o controller inteiro) não exige token de acesso
// (S7). Sem ele, a guarda global `Autenticado` exige `Authorization: Bearer`
// em toda rota, inclusive nas novas: esquecer o decorador fecha a rota, nunca a
// abre.
import { SetMetadata } from '@nestjs/common';

/** Chave dos metadados da rota pública. */
export const ROTA_PUBLICA = 'bairrin:rota-publica';

export const Publico = (): MethodDecorator & ClassDecorator => SetMetadata(ROTA_PUBLICA, true);
