// Segundo fator do admin no painel (plano 01b, etapa 16; CA-09; S1, P3 da
// revisão do grupo A). As três rotas são públicas e recebem o desafio emitido
// pelo login no painel; as respostas seguem o contrato "Respostas do 2FA":
// (1) desafio inexistente, vencido, usado, de outra etapa ou esgotado → 401,
//     o mesmo corpo para todos os motivos (inclusive a quinta tentativa
//     errada);
// (2) freio de segundo fator ativo → 429 com `Retry-After`, sem gastar
//     tentativa;
// (3) código errado com tentativa sobrando → 400
//     `campos[codigo|codigoRecuperacao].invalido` (o campo que veio).
// A configuração só tem o (1), e conta com segundo fator já confirmado também
// recebe 401 (S1: reconfigurar só pela CLI).
//
// - `POST /v1/segundo-fator/configuracao`: 200 com `otpauthUri` e
//   `segredoBase32`, nada além (o QR é gerado no painel).
// - `POST /v1/segundo-fator/confirmacao`: 200 com os 10 códigos de
//   recuperação (mostrados uma vez) e a sessão, cujo token de renovação vai só
//   no cookie.
// - `POST /v1/sessoes/segundo-fator`: 200 com a sessão (cookie no painel).
// Todas com `Cache-Control: no-store` (S17).
import { Body, Controller, HttpCode, Post, Res, UnauthorizedException } from '@nestjs/common';
import {
  type ConfiguracaoDeSegundoFator,
  type ConfirmarConfiguracao,
  confirmarConfiguracaoSchema,
  type IniciarConfiguracao,
  iniciarConfiguracaoSchema,
  type SegundoFatorConfirmado,
  type Sessao,
  type VerificarSegundoFator,
  verificarSegundoFatorSchema,
} from '@bairrin/contratos';
import {
  MOTIVO_CODIGO_DE_RECUPERACAO_INVALIDO,
  MOTIVO_CODIGO_DO_AUTENTICADOR_INVALIDO,
} from '@bairrin/contratos/validadores';
import type { Response } from 'express';
import { Publico } from '../../../compartilhado/http/autenticacao/publico.decorator.ts';
import { ErroComCodigo } from '../../../compartilhado/http/filtro-de-erros.ts';
import {
  ErroDeValidacao,
  ValidacaoZodPipe,
} from '../../../compartilhado/http/validacao-zod.pipe.ts';
import { ConfirmarConfiguracaoDoSegundoFatorCasoDeUso } from '../aplicacao/segundo-fator/confirmar-configuracao.caso-de-uso.ts';
import { IniciarConfiguracaoDoSegundoFatorCasoDeUso } from '../aplicacao/segundo-fator/iniciar-configuracao.caso-de-uso.ts';
import {
  type CampoDoCodigo,
  VerificarSegundoFatorCasoDeUso,
} from '../aplicacao/segundo-fator/verificar-segundo-fator.caso-de-uso.ts';
import { CLIENTE_DO_PAINEL, corpoDaSessao } from './sessao-no-http.ts';

const MOTIVO_DO_CAMPO: Readonly<Record<CampoDoCodigo, string>> = {
  codigo: MOTIVO_CODIGO_DO_AUTENTICADOR_INVALIDO,
  codigoRecuperacao: MOTIVO_CODIGO_DE_RECUPERACAO_INVALIDO,
};

/** 400 com o erro no campo do código que veio (passo 3 das "Respostas do 2FA"). */
function codigoErrado(campo: CampoDoCodigo): ErroDeValidacao {
  return new ErroDeValidacao([{ campo, codigo: 'invalido', motivo: MOTIVO_DO_CAMPO[campo] }]);
}

function freado(segundosDeEspera: number): ErroComCodigo {
  return new ErroComCodigo('limite_excedido', { esperaEmSegundos: segundosDeEspera });
}

@Publico()
@Controller('v1')
export class SegundoFatorController {
  constructor(
    private readonly iniciarConfiguracao: IniciarConfiguracaoDoSegundoFatorCasoDeUso,
    private readonly confirmarConfiguracao: ConfirmarConfiguracaoDoSegundoFatorCasoDeUso,
    private readonly verificarSegundoFator: VerificarSegundoFatorCasoDeUso,
  ) {}

  @Post('segundo-fator/configuracao')
  @HttpCode(200)
  async configurar(
    @Body(new ValidacaoZodPipe(iniciarConfiguracaoSchema)) corpo: IniciarConfiguracao,
  ): Promise<ConfiguracaoDeSegundoFator> {
    const resultado = await this.iniciarConfiguracao.executar(corpo);
    if (resultado.tipo === 'desafio_invalido') throw new UnauthorizedException();
    return { otpauthUri: resultado.otpauthUri, segredoBase32: resultado.segredoBase32 };
  }

  @Post('segundo-fator/confirmacao')
  @HttpCode(200)
  async confirmar(
    @Body(new ValidacaoZodPipe(confirmarConfiguracaoSchema)) corpo: ConfirmarConfiguracao,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SegundoFatorConfirmado> {
    const resultado = await this.confirmarConfiguracao.executar(corpo);
    switch (resultado.tipo) {
      case 'desafio_invalido':
        throw new UnauthorizedException();
      case 'freado':
        throw freado(resultado.segundosDeEspera);
      case 'codigo_errado':
        throw codigoErrado('codigo');
      case 'concluido':
        return {
          codigosRecuperacao: [...resultado.codigosRecuperacao],
          sessao: corpoDaSessao(res, resultado.sessao, CLIENTE_DO_PAINEL),
        };
    }
  }

  @Post('sessoes/segundo-fator')
  @HttpCode(200)
  async verificar(
    @Body(new ValidacaoZodPipe(verificarSegundoFatorSchema)) corpo: VerificarSegundoFator,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Sessao> {
    const resultado = await this.verificarSegundoFator.executar(corpo);
    switch (resultado.tipo) {
      case 'desafio_invalido':
        throw new UnauthorizedException();
      case 'freado':
        throw freado(resultado.segundosDeEspera);
      case 'codigo_errado':
        throw codigoErrado(resultado.campo);
      case 'concluido':
        return corpoDaSessao(res, resultado.sessao, CLIENTE_DO_PAINEL);
    }
  }
}
