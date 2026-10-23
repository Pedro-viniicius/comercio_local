// `@ExigeMfa()`: a rota exige sessão do painel que passou pelo segundo fator
// (S1, S7; CA-09). Roda depois da guarda global `Autenticado`. Sem `mfa`, 403
// com log só do id da conta.
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
import { PinoLogger } from 'nestjs-pino';
import { contaDaRequisicao, type RequisicaoAutenticada } from './conta-atual.decorator.ts';

/** Chave dos metadados: a rota exige segundo fator (lida também pelo teste das rotas, etapa 19). */
export const EXIGE_MFA = 'bairrin:exige-mfa';

@Injectable()
export class ExigeMfaGuard implements CanActivate {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(ExigeMfaGuard.name);
  }

  canActivate(contexto: ExecutionContext): boolean {
    const conta = contaDaRequisicao(contexto.switchToHttp().getRequest<RequisicaoAutenticada>());
    if (conta === undefined) throw new UnauthorizedException();
    if (conta.mfa) return true;
    this.logger.warn({ contaId: conta.contaId }, 'acesso negado: sem segundo fator');
    throw new ForbiddenException();
  }
}

export const ExigeMfa = (): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(EXIGE_MFA, true), UseGuards(ExigeMfaGuard));
