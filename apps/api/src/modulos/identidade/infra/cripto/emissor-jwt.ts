// Adaptador do `EmissorDeJwt` com o `JwtService` do `@nestjs/jwt` (S17).
//
// O serviço é criado aqui, sem opções de módulo: algoritmo, validade, emissor,
// público e segredo vão em cada chamada, então nenhum padrão do `JwtModule`
// muda o token. A verificação aceita só HS256 (HS512 com o mesmo segredo e
// `alg: none` são recusados), confere `iss`, `aud` e `exp` contra `agora` e a
// forma das claims.
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PERFIS, type Perfil } from '@bairrin/contratos/validadores';
import { AMBIENTE, type Ambiente } from '../../../../compartilhado/config/ambiente.ts';
import { EmissorDeJwt, type TokenDeAcesso } from '../../aplicacao/portas/emissor-de-jwt.ts';
import { type ReivindicacoesDoToken, SEGUNDOS_DO_TOKEN_DE_ACESSO } from '../../dominio/sessao.ts';

/** Emissor e público fixos do token de acesso. */
export const EMISSOR_DO_TOKEN = 'bairrin-api';
export const PUBLICO_DO_TOKEN = 'bairrin-api';

const ALGORITMO = 'HS256';

/** Erros do `jsonwebtoken` que significam "token recusado". */
const ERROS_DE_TOKEN_RECUSADO = new Set([
  'JsonWebTokenError',
  'TokenExpiredError',
  'NotBeforeError',
]);

function emSegundos(instante: Date): number {
  return Math.floor(instante.getTime() / 1000);
}

function ehPerfil(valor: unknown): valor is Perfil {
  return typeof valor === 'string' && (PERFIS as readonly string[]).includes(valor);
}

function textoNaoVazio(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.length > 0;
}

/** As claims do payload já verificado, ou `null` se a forma não é a emitida aqui. */
function lerReivindicacoes(payload: unknown): ReivindicacoesDoToken | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { sub, sid, perfis, mfa, emailVerificado, iat, exp } = payload as Record<string, unknown>;
  if (!textoNaoVazio(sub) || !textoNaoVazio(sid)) return null;
  if (!Array.isArray(perfis) || !perfis.every(ehPerfil)) return null;
  if (typeof mfa !== 'boolean' || typeof emailVerificado !== 'boolean') return null;
  if (typeof iat !== 'number' || typeof exp !== 'number') return null;
  if (exp - iat !== SEGUNDOS_DO_TOKEN_DE_ACESSO) return null;
  return { contaId: sub, sid, perfis: [...perfis], mfa, emailVerificado };
}

@Injectable()
export class EmissorJwt extends EmissorDeJwt {
  readonly #jwt = new JwtService();
  readonly #segredo: Buffer;

  constructor(@Inject(AMBIENTE) ambiente: Pick<Ambiente, 'JWT_SEGREDO'>) {
    super();
    // Já validado pelo `carregarAmbiente`: base64 com 32 bytes ou mais (S17).
    this.#segredo = Buffer.from(ambiente.JWT_SEGREDO, 'base64');
  }

  override async emitir(
    reivindicacoes: ReivindicacoesDoToken,
    agora: Date,
  ): Promise<TokenDeAcesso> {
    const iat = emSegundos(agora);
    const token = await this.#jwt.signAsync(
      {
        sid: reivindicacoes.sid,
        perfis: [...reivindicacoes.perfis],
        mfa: reivindicacoes.mfa,
        emailVerificado: reivindicacoes.emailVerificado,
        // Com `iat` no payload, o `jsonwebtoken` calcula `exp` a partir dele.
        iat,
      },
      {
        secret: this.#segredo,
        algorithm: ALGORITMO,
        expiresIn: SEGUNDOS_DO_TOKEN_DE_ACESSO,
        issuer: EMISSOR_DO_TOKEN,
        audience: PUBLICO_DO_TOKEN,
        subject: reivindicacoes.contaId,
      },
    );
    return { token, expiraEm: new Date((iat + SEGUNDOS_DO_TOKEN_DE_ACESSO) * 1000) };
  }

  override async verificar(token: string, agora: Date): Promise<ReivindicacoesDoToken | null> {
    let payload: unknown;
    try {
      payload = await this.#jwt.verifyAsync<object>(token, {
        secret: this.#segredo,
        algorithms: [ALGORITMO],
        issuer: EMISSOR_DO_TOKEN,
        audience: PUBLICO_DO_TOKEN,
        clockTimestamp: emSegundos(agora),
        clockTolerance: 0,
      });
    } catch (erro) {
      // Recusa esperada vira `null`, sem a mensagem do erro. Outro erro é
      // falha de programação e sobe.
      if (erro instanceof Error && ERROS_DE_TOKEN_RECUSADO.has(erro.name)) return null;
      throw erro;
    }
    return lerReivindicacoes(payload);
  }
}
