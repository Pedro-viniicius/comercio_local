// Recuperação e redefinição de senha (plano 01b, etapa 16; CA-05, CA-06;
// P1-dono, S14, S74, S82, S93).
//
// - `POST /v1/senha/recuperacao` (público): 202 sem corpo, o mesmo exista ou
//   não conta com o e-mail (CA-06). Limites de 10 por hora por IP e 3 por
//   hora por e-mail, nessa ordem (S109): estourados, 429 com `Retry-After`.
// - `POST /v1/senha/redefinicao` (público): 204 (senha trocada, e-mail
//   verificado e todas as sessões revogadas, CA-05); código que não confere →
//   400 `campos[codigo].invalido`; freio por e-mail ou por origem → 429 com
//   `Retry-After`. A senha nova passa pela lista pública de senhas comuns
//   (5b) no pipe, e o `ip` da requisição vai para o freio por origem (S93; sem
//   ele, todas as falhas cairiam em `origem:desconhecida`).
// São, com o cadastro, as únicas rotas que gravam senha (P2).
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import {
  redefinirSenhaSchema,
  type SolicitarRecuperacao,
  solicitarRecuperacaoSchema,
  type z,
} from '@bairrin/contratos';
import { MOTIVO_CODIGO_INVALIDO } from '@bairrin/contratos/validadores';
import type { Request } from 'express';
import { Publico } from '../../../compartilhado/http/autenticacao/publico.decorator.ts';
import { ErroComCodigo } from '../../../compartilhado/http/filtro-de-erros.ts';
import { LimitarRota } from '../../../compartilhado/http/limite-por-rota.guard.ts';
import {
  ErroDeValidacao,
  ValidacaoZodPipe,
} from '../../../compartilhado/http/validacao-zod.pipe.ts';
import { RedefinirSenhaCasoDeUso } from '../aplicacao/sessao/redefinir-senha.caso-de-uso.ts';
import { SolicitarRecuperacaoCasoDeUso } from '../aplicacao/sessao/solicitar-recuperacao.caso-de-uso.ts';
import { LIMITES_DA_IDENTIDADE } from './limites.ts';
import { comSenhaForaDaListaPublica } from './senha-fora-da-lista-publica.ts';

/** O corpo da redefinição com a lista pública de senhas comuns na senha nova (S74). */
export const corpoDaRedefinicaoSchema = comSenhaForaDaListaPublica(
  redefinirSenhaSchema,
  'novaSenha',
);

@Publico()
@Controller('v1/senha')
export class SenhaController {
  constructor(
    private readonly solicitarRecuperacao: SolicitarRecuperacaoCasoDeUso,
    private readonly redefinirSenha: RedefinirSenhaCasoDeUso,
  ) {}

  @Post('recuperacao')
  @HttpCode(202)
  @LimitarRota(LIMITES_DA_IDENTIDADE.recuperacaoPorIp, LIMITES_DA_IDENTIDADE.recuperacaoPorEmail)
  async recuperar(
    @Body(new ValidacaoZodPipe(solicitarRecuperacaoSchema)) corpo: SolicitarRecuperacao,
  ): Promise<void> {
    await this.solicitarRecuperacao.executar(corpo);
  }

  @Post('redefinicao')
  @HttpCode(204)
  @LimitarRota(LIMITES_DA_IDENTIDADE.redefinicaoPorIp)
  async redefinir(
    @Body(new ValidacaoZodPipe(corpoDaRedefinicaoSchema))
    corpo: z.output<typeof corpoDaRedefinicaoSchema>,
    @Req() req: Request,
  ): Promise<void> {
    const resultado = await this.redefinirSenha.executar({ ...corpo, ip: req.ip });
    switch (resultado.tipo) {
      case 'redefinida':
        return;
      case 'codigo_invalido':
        throw new ErroDeValidacao([
          { campo: 'codigo', codigo: 'invalido', motivo: MOTIVO_CODIGO_INVALIDO },
        ]);
      case 'freado':
        throw new ErroComCodigo('limite_excedido', {
          esperaEmSegundos: resultado.segundosDeEspera,
        });
    }
  }
}
