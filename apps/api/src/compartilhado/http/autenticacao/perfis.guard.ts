// `@Perfis(...)`: a rota exige que a conta autenticada tenha ao menos um dos
// perfis (S7; CA-08). Roda depois da guarda global `Autenticado`, que já pôs a
// conta na requisição. Sem o perfil, 403 com log só do id da conta.
//
// No token, `admin` só existe em sessão do painel com segundo fator (S1), então
// `@Perfis('admin')` já recusa a conta admin que entrou pelos apps.
import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Perfil } from '@bairrin/contratos/validadores';
import { PinoLogger } from 'nestjs-pino';
import { contaDaRequisicao, type RequisicaoAutenticada } from './conta-atual.decorator.ts';

/** Chave dos metadados com os perfis aceitos pela rota. */
export const PERFIS_DA_ROTA = 'bairrin:perfis-da-rota';

@Injectable()
export class PerfisGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PerfisGuard.name);
  }

  canActivate(contexto: ExecutionContext): boolean {
    const aceitos =
      this.reflector.getAllAndOverride<readonly Perfil[] | undefined>(PERFIS_DA_ROTA, [
        contexto.getHandler(),
        contexto.getClass(),
      ]) ?? [];
    const conta = contaDaRequisicao(contexto.switchToHttp().getRequest<RequisicaoAutenticada>());
    // Sem conta, a rota é pública: o decorador foi posto onde não devia.
    if (conta === undefined) throw new UnauthorizedException();
    if (aceitos.length > 0 && aceitos.some((perfil) => conta.perfis.includes(perfil))) return true;
    this.logger.warn({ contaId: conta.contaId }, 'acesso negado: perfil ausente');
    throw new ForbiddenException();
  }
}

/** Exige um dos perfis. Sem perfil nenhum, a rota recusa todo mundo. */
export const Perfis = (...perfis: Perfil[]): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(PERFIS_DA_ROTA, perfis), UseGuards(PerfisGuard));
