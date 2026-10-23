// Limites de requisições por rota (plano 01b, etapa 16, "Limites"; S14, S82,
// S100). O `ThrottlerGuard` global segura todo IP com um teto folgado
// (`LIMITE_PADRAO`); as rotas sensíveis declaram aqui limites próprios, mais
// baixos, por IP, por conta ou por e-mail:
//
//   @LimitarRota({ nome: 'cadastro-ip', por: 'ip', limite: 10, janelaEmMs: UMA_HORA })
//
// É uma guarda global, registrada depois da `Autenticado` (o limite por conta
// usa a conta que ela pôs na requisição): roda antes do pipe de validação, e a
// requisição que já seria recusada com 429 não paga a validação da senha nova
// contra a lista pública (S82). A recusa é 429 `limite_excedido` com
// `Retry-After` em segundos, igual à do `ThrottlerGuard` e à do freio (CA-04).
//
// Chaves:
// - `ip`: o IP do cliente (`req.ip`, que segue o `trust proxy`), com o IPv6
//   agrupado por /64, como no freio e no `ThrottlerGuard` (S14); sem IP, uma
//   chave só para todos (falha fechada);
// - `conta`: a conta autenticada (rota sem `@Publico()`); em rota pública, o
//   limite não se aplica;
// - `email`: o campo `email` do corpo, normalizado como o contrato o
//   normaliza. E-mail ausente ou inválido não conta aqui (o pipe recusa com
//   400 logo depois), mas o limite por IP da mesma rota continua valendo.
// O valor da chave entra só no hash (SHA-256) que indexa o contador em memória.
//
// Ordem (S109): os limites `por: 'ip'` são conferidos primeiro, qualquer que
// seja a ordem no decorador; depois os por conta e por e-mail, na ordem
// declarada. A conferência para no primeiro limite estourado, e o contador já
// estourado não cresce: assim um IP bloqueado não gasta o contador de e-mail
// nenhum (não bloqueia a recuperação de terceiros em massa nem cria chaves
// novas na memória a cada e-mail inventado). O preço é a recusa por conta ou
// por e-mail também contar no limite por IP.
import { createHash } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerStorage,
  normalizeIp,
  ThrottlerException,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { normalizarEmail } from '@bairrin/contratos/validadores';
import {
  contaDaRequisicao,
  type RequisicaoAutenticada,
} from './autenticacao/conta-atual.decorator.ts';

export type ChaveDoLimite = 'ip' | 'conta' | 'email';

export interface LimiteDaRota {
  /** Nome único na rota (ex.: `cadastro-ip`): separa os contadores. */
  readonly nome: string;
  readonly por: ChaveDoLimite;
  /** Requisições aceitas dentro da janela; a seguinte recebe 429. */
  readonly limite: number;
  readonly janelaEmMs: number;
}

/** Chave dos metadados com os limites da rota. */
export const LIMITES_DA_ROTA = 'bairrin:limites-da-rota';

/** Chave do limite por IP quando a requisição não traz IP. */
export const IP_DESCONHECIDO = 'ip:desconhecido';

/** Prefixo do IPv6 agrupado (S14). */
const PREFIXO_DO_IPV6 = 64;

/** Declara os limites da rota: os por IP primeiro, os demais na ordem dada (S109). */
export const LimitarRota = (...limites: LimiteDaRota[]): MethodDecorator =>
  SetMetadata(LIMITES_DA_ROTA, limites);

interface Requisicao extends RequisicaoAutenticada {
  ip?: string | undefined;
  body?: unknown;
}

interface Resposta {
  setHeader(nome: string, valor: string): unknown;
}

/** O valor que identifica quem pede, para o limite dado; `null` quando o limite não se aplica. */
export function valorDaChave(req: Requisicao, por: ChaveDoLimite): string | null {
  switch (por) {
    case 'ip': {
      const ip = typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : null;
      return ip === null ? IP_DESCONHECIDO : `ip:${normalizeIp(ip, PREFIXO_DO_IPV6)}`;
    }
    case 'conta': {
      const conta = contaDaRequisicao(req);
      return conta === undefined ? null : `conta:${conta.contaId}`;
    }
    case 'email': {
      const corpo = req.body;
      if (typeof corpo !== 'object' || corpo === null) return null;
      const email: unknown = (corpo as Record<string, unknown>)['email'];
      if (typeof email !== 'string') return null;
      const normalizado = normalizarEmail(email.trim());
      return normalizado === null ? null : `email:${normalizado}`;
    }
  }
}

/** Os limites por IP primeiro; os demais mantêm a ordem declarada (S109). */
function naOrdemDeConferencia(limites: readonly LimiteDaRota[]): LimiteDaRota[] {
  return [
    ...limites.filter((limite) => limite.por === 'ip'),
    ...limites.filter((limite) => limite.por !== 'ip'),
  ];
}

@Injectable()
export class LimitePorRotaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectThrottlerStorage() private readonly armazenamento: ThrottlerStorage,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const limites = this.reflector.get<readonly LimiteDaRota[] | undefined>(
      LIMITES_DA_ROTA,
      contexto.getHandler(),
    );
    if (limites === undefined || limites.length === 0) return true;
    const http = contexto.switchToHttp();
    const req = http.getRequest<Requisicao>();
    const rota = `${contexto.getClass().name}.${contexto.getHandler().name}`;
    for (const limite of naOrdemDeConferencia(limites)) {
      const valor = valorDaChave(req, limite.por);
      if (valor === null) continue;
      const chave = createHash('sha256')
        .update(`${rota}\u0000${limite.nome}\u0000${valor}`)
        .digest('hex');
      const { isBlocked, timeToBlockExpire } = await this.armazenamento.increment(
        chave,
        limite.janelaEmMs,
        limite.limite,
        limite.janelaEmMs,
        limite.nome,
      );
      if (isBlocked) {
        http
          .getResponse<Resposta>()
          .setHeader('Retry-After', String(Math.max(1, timeToBlockExpire)));
        throw new ThrottlerException();
      }
    }
    return true;
  }
}
