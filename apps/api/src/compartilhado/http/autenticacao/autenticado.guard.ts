// Guarda global de autenticação (plano 01b, etapa 16; S7, S8, CA-07, CA-08).
// Registrada como `APP_GUARD` no `AppModule`: toda rota exige
// `Authorization: Bearer <token de acesso>`, menos as marcadas com
// `@Publico()`.
//
// - Token ausente, mal formado, grande demais (conferido antes da assinatura),
//   inválido, vencido ou de conta fora de `ativa` → 401, sempre o mesmo. Só
//   esta guarda devolve 401 nas rotas autenticadas (revisão do grupo B): o
//   `cliente-api` renova e repete todo 401.
// - Rotas de `/v1/admin` (S7, S8): a sessão do `sid` também é conferida (logout
//   e redefinição valem na hora), e a conta precisa de `admin` com segundo
//   fator (`mfa`), mesmo que o controller esqueça `@Perfis('admin')` e
//   `@ExigeMfa()`; senão, 403 com log só do id da conta. `@Publico()` não
//   abre rota de admin (S110): nela o token é exigido do mesmo jeito. O
//   prefixo sai do caminho declarado no controller e no método e também do
//   caminho da rota que o Express casou (`req.baseUrl` + `req.route.path`,
//   que já trazem o `setGlobalPrefix` e o `RouterModule`), nunca da URL
//   pedida, que o Express casa sem diferenciar maiúsculas.
// - Rotas com `@ConfereSessao()` (etapa 19): a sessão do `sid` também é
//   conferida, como em `/v1/admin`, sem exigir `admin`; sessão revogada ou
//   vencida → 401. Nas demais, só `contas.status` (S8).
// - A conta vai para a requisição (`@ContaAtual()`).
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import {
  type ContaAutenticada,
  VerificadorDeAcesso,
} from '../../autenticacao/verificador-de-acesso.ts';
import { CONFERE_SESSAO } from './confere-sessao.decorator.ts';
import { CONTA_DA_REQUISICAO, type RequisicaoAutenticada } from './conta-atual.decorator.ts';
import { ROTA_PUBLICA } from './publico.decorator.ts';

/**
 * Maior token de acesso aceito. O JWT emitido tem bem menos (~400
 * caracteres); acima disso nem se confere a assinatura.
 */
export const TAMANHO_MAXIMO_DO_TOKEN_DE_ACESSO = 2048;

/** `Bearer <token>`, com o token em base64url e pontos (JWT). */
const CABECALHO_BEARER = /^Bearer ([A-Za-z0-9._-]+)$/i;

/** Prefixo das rotas do painel administrativo (S7). */
const PREFIXO_DE_ADMIN = ['v1', 'admin'] as const;

/** O token do cabeçalho `Authorization`, ou `null` se ausente, mal formado ou grande demais. */
export function tokenDoCabecalho(cabecalho: string | string[] | undefined): string | null {
  if (typeof cabecalho !== 'string') return null;
  // Conferido antes da regex: cabeçalho enorme não chega a ser examinado.
  if (cabecalho.length > TAMANHO_MAXIMO_DO_TOKEN_DE_ACESSO + 'Bearer '.length) return null;
  const token = CABECALHO_BEARER.exec(cabecalho)?.[1];
  return token === undefined || token.length > TAMANHO_MAXIMO_DO_TOKEN_DE_ACESSO ? null : token;
}

function caminhos(valor: unknown): string[] {
  if (typeof valor === 'string') return [valor];
  if (Array.isArray(valor)) return valor.filter((item): item is string => typeof item === 'string');
  return [''];
}

function partes(caminho: string): string[] {
  return caminho
    .split('/')
    .filter((parte) => parte.length > 0)
    .map((parte) => parte.toLowerCase());
}

function comecaComOPrefixoDeAdmin(caminho: readonly string[]): boolean {
  return PREFIXO_DE_ADMIN.every((parte, indice) => caminho[indice] === parte);
}

/** O que a guarda lê da requisição do Express para achar a rota casada. */
interface RotaCasada {
  baseUrl?: unknown;
  route?: { path?: unknown } | undefined;
}

/**
 * O caminho da rota que o Express casou (o padrão declarado, não a URL
 * pedida), com o `baseUrl` do roteador; vazio quando não há rota.
 */
function caminhoDaRotaCasada(req: RotaCasada): string {
  const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  const rota = typeof req.route?.path === 'string' ? req.route.path : '';
  return `${base}/${rota}`;
}

/**
 * A rota fica sob `/v1/admin`. Vale o caminho declarado no controller e no
 * método (metadados do Nest) ou o da rota casada pelo Express, que inclui o
 * `setGlobalPrefix` e o `RouterModule`; os dois sem diferenciar maiúsculas.
 */
export function ehRotaDeAdmin(contexto: ExecutionContext): boolean {
  const doController = caminhos(Reflect.getMetadata(PATH_METADATA, contexto.getClass()));
  const doMetodo = caminhos(Reflect.getMetadata(PATH_METADATA, contexto.getHandler()));
  const pelosMetadados = doController.some((base) =>
    doMetodo.some((metodo) => comecaComOPrefixoDeAdmin([...partes(base), ...partes(metodo)])),
  );
  if (pelosMetadados) return true;
  const req = contexto.switchToHttp().getRequest<RotaCasada>();
  return comecaComOPrefixoDeAdmin(partes(caminhoDaRotaCasada(req)));
}

@Injectable()
export class Autenticado implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verificador: VerificadorDeAcesso,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(Autenticado.name);
  }

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const admin = ehRotaDeAdmin(contexto);
    const publica = this.reflector.getAllAndOverride<boolean | undefined>(ROTA_PUBLICA, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    // `@Publico()` por engano numa rota de admin não a abre (S110).
    if (publica === true && !admin) return true;

    const req = contexto
      .switchToHttp()
      .getRequest<
        RequisicaoAutenticada & { headers: Record<string, string | string[] | undefined> }
      >();
    const token = tokenDoCabecalho(req.headers['authorization']);
    if (token === null) throw new UnauthorizedException();

    const confereSessao =
      admin ||
      this.reflector.getAllAndOverride<boolean | undefined>(CONFERE_SESSAO, [
        contexto.getHandler(),
        contexto.getClass(),
      ]) === true;
    const conta = await this.verificador.verificar(token, { conferirSessao: confereSessao });
    if (conta === null) throw new UnauthorizedException();
    if (admin && !podeUsarAdmin(conta)) {
      this.logger.warn({ contaId: conta.contaId }, 'acesso negado a rota de admin');
      throw new ForbiddenException();
    }
    req[CONTA_DA_REQUISICAO] = conta;
    return true;
  }
}

/** Admin com segundo fator: o único que passa em `/v1/admin` (S1, S7). */
function podeUsarAdmin(conta: ContaAutenticada): boolean {
  return conta.mfa && conta.perfis.includes('admin');
}
