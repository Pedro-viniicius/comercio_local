// Login, renovação e logout (plano 01b, etapa 16; CA-03, CA-04, CA-05, CA-07,
// CA-09; S1, S8, S16, S23, S77, S80).
//
// - `POST /v1/sessoes` (público): 200 com a sessão (apps) ou, no painel, com o
//   desafio do segundo fator (`{ etapa, desafio }`); 403 `sem_acesso_painel`
//   (senha certa sem `admin`, sem sessão nem cookie, log só com o id, S23); 401
//   com a mesma resposta para e-mail sem conta, senha errada e conta que não
//   entra (CA-04); 429 com `Retry-After` com o freio ativo. O `ip` é o
//   `req.ip`, que segue o `trust proxy` do Fly.
// - `POST /v1/sessoes/renovacao` (público): nos apps, `{ tokenRenovacao,
//   cliente }` no corpo; no painel, corpo vazio, o cookie e `X-Cliente: painel`,
//   da origem do painel. O `cliente` comparado vem sempre da requisição (5c,
//   S16). 200 com a sessão; 401 com a credencial inválida, vencida, revogada
//   ou reusada (nunca 5xx); 403 com `X-Cliente: painel` fora da origem do
//   painel.
// - `DELETE /v1/sessoes/renovacao` (público, S80): logout do painel pelo
//   cookie, com `X-Cliente: painel` e a origem do painel. 204 com a origem
//   do painel, depois de gravar a revogação (sem cookie ou com cookie
//   desconhecido também), e apaga o cookie; 403 sem `X-Cliente: painel` ou fora da origem do painel,
//   sem revogar.
// - `DELETE /v1/sessoes/atual` (com sessão): revoga a sessão do `sid` inteira;
//   204 também se ela já estava revogada (CA-05).
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  corpoVazioSchema,
  type DesafioDeSegundoFator,
  type Entrar,
  entrarSchema,
  renovarSessaoSchema,
  type Sessao,
} from '@bairrin/contratos';
import type { Cliente } from '@bairrin/contratos/validadores';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import type { ContaAutenticada } from '../../../compartilhado/autenticacao/verificador-de-acesso.ts';
import { AMBIENTE, type Ambiente } from '../../../compartilhado/config/ambiente.ts';
import { ContaAtual } from '../../../compartilhado/http/autenticacao/conta-atual.decorator.ts';
import { Publico } from '../../../compartilhado/http/autenticacao/publico.decorator.ts';
import { ErroComCodigo } from '../../../compartilhado/http/filtro-de-erros.ts';
import { LimitarRota } from '../../../compartilhado/http/limite-por-rota.guard.ts';
import { ValidacaoZodPipe } from '../../../compartilhado/http/validacao-zod.pipe.ts';
import { EncerrarSessaoCasoDeUso } from '../aplicacao/sessao/encerrar-sessao.caso-de-uso.ts';
import { EntrarCasoDeUso } from '../aplicacao/sessao/entrar.caso-de-uso.ts';
import { RenovarSessaoCasoDeUso } from '../aplicacao/sessao/renovar-sessao.caso-de-uso.ts';
import { LIMITES_DA_IDENTIDADE } from './limites.ts';
import {
  apagarCookieDeRenovacao,
  CLIENTE_DO_PAINEL,
  corpoDaSessao,
  dizSerDoPainel,
  origemDoPainel,
  tokenDoCookie,
} from './sessao-no-http.ts';

const corpoVazio = new ValidacaoZodPipe(corpoVazioSchema);
const corpoDaRenovacaoDoApp = new ValidacaoZodPipe(renovarSessaoSchema);

@Controller('v1/sessoes')
export class SessoesController {
  constructor(
    private readonly entrar: EntrarCasoDeUso,
    private readonly renovar: RenovarSessaoCasoDeUso,
    private readonly encerrar: EncerrarSessaoCasoDeUso,
    @Inject(AMBIENTE) private readonly ambiente: Ambiente,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SessoesController.name);
  }

  @Publico()
  @Post()
  @HttpCode(200)
  @LimitarRota(LIMITES_DA_IDENTIDADE.entrarPorIp)
  async criar(
    @Body(new ValidacaoZodPipe(entrarSchema)) corpo: Entrar,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Sessao | DesafioDeSegundoFator> {
    const resultado = await this.entrar.executar({ ...corpo, ip: req.ip });
    switch (resultado.tipo) {
      case 'sessao':
        return corpoDaSessao(res, resultado.sessao, corpo.cliente);
      case 'desafio':
        return { etapa: resultado.desafio.etapa, desafio: resultado.desafio.desafio };
      case 'sem_acesso_painel':
        this.logger.warn({ contaId: resultado.contaId }, 'login no painel sem perfil admin');
        throw new ErroComCodigo('sem_acesso_painel');
      case 'credenciais_invalidas':
        throw new UnauthorizedException();
      case 'freado':
        throw new ErroComCodigo('limite_excedido', {
          esperaEmSegundos: resultado.segundosDeEspera,
        });
    }
  }

  @Publico()
  @Post('renovacao')
  @HttpCode(200)
  async renovarSessao(
    @Body() corpo: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Sessao> {
    let entrada: { tokenRenovacao: string | null; cliente: Cliente };
    if (dizSerDoPainel(req)) {
      this.#exigirOrigemDoPainel(req);
      corpoVazio.transform(corpo);
      entrada = { tokenRenovacao: tokenDoCookie(req), cliente: CLIENTE_DO_PAINEL };
    } else {
      const { tokenRenovacao, cliente } = corpoDaRenovacaoDoApp.transform(corpo);
      entrada = { tokenRenovacao, cliente };
    }
    if (entrada.tokenRenovacao === null) throw new UnauthorizedException();

    const resultado = await this.renovar.executar({
      tokenRenovacao: entrada.tokenRenovacao,
      cliente: entrada.cliente,
    });
    if (resultado.tipo === 'invalida') throw new UnauthorizedException();
    return corpoDaSessao(res, resultado.sessao, entrada.cliente);
  }

  @Publico()
  @Delete('renovacao')
  @HttpCode(204)
  async sairDoPainel(
    @Body() corpo: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (!dizSerDoPainel(req)) throw new ForbiddenException();
    this.#exigirOrigemDoPainel(req);
    corpoVazio.transform(corpo);
    const tokenRenovacao = tokenDoCookie(req);
    // Revoga antes de responder: o 204 só sai com a revogação gravada.
    if (tokenRenovacao !== null) await this.encerrar.executar({ tokenRenovacao });
    apagarCookieDeRenovacao(res);
  }

  @Delete('atual')
  @HttpCode(204)
  async sair(@ContaAtual() conta: ContaAutenticada, @Body() corpo: unknown): Promise<void> {
    corpoVazio.transform(corpo);
    await this.encerrar.executar({ contaId: conta.contaId, sid: conta.sid });
  }

  /** `X-Cliente: painel` só vale da origem do painel (contra CSRF): senão, 403. */
  #exigirOrigemDoPainel(req: Request): void {
    if (!origemDoPainel(req, this.ambiente.CORS_ORIGENS)) throw new ForbiddenException();
  }
}
