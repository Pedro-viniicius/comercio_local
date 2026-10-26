// Privacidade da conta da sessão (plano 01b, etapa 19; CA-10, CA-11, S8, S10,
// S14). Todas as rotas exigem sessão e valem só para a conta dela.
//
// - `GET /v1/privacidade`: 200 com a política vigente (versão e texto), a
//   versão dos termos, a data do aceite da política vigente e até quando a
//   cópia pronta pode ser baixada (`privacidadeSchema`).
// - `POST /v1/privacidade/exportacao`: 202; o assinante gera a cópia (prazo de
//   48 h do CA-10) e o e-mail só avisa (S10). Um pedido por 24 h: o repetido
//   recebe 429 com `Retry-After` até a hora em que pode pedir de novo.
// - `GET /v1/privacidade/exportacao/arquivo`: 200 com o arquivo JSON, uma vez
//   só e até 7 dias (S10); sem cópia disponível (não pedida, ainda não pronta,
//   vencida ou já baixada), 404. O download é marcado antes de a resposta
//   chegar ao cliente (S115). `HEAD` → 405 `metodo_nao_permitido` com `Allow:
//   GET`, sem decifrar nem gastar o uso único (Q31).
// - `POST /v1/privacidade/exclusao` `{ senha }`: 202 (conta desativada na hora
//   e sessões revogadas; anonimização em até 30 dias, CA-11); conta com perfil
//   `admin` fora da sessão do painel com segundo fator → 403
//   `exclusao_de_admin_so_pelo_painel`, antes da senha e sem gastar o freio
//   (S113); senha errada → 400 `campos[senha].invalido` (nunca 401: o
//   `cliente-api` renova e repete todo 401, e a senha contaria duas vezes no
//   freio); freio por e-mail ativo → 429 com `Retry-After`; pendências → 409
//   `exclusao_com_pendencias`;
//   `conta_indisponivel` → 401 (exceção registrada na etapa 16: a conta saiu
//   de `ativa` entre a guarda e o caso de uso).
//
// As duas rotas da cópia dos dados conferem também a sessão do `sid`
// (`@ConfereSessao()`, vindo do grupo D): sem senha, o token de acesso de uma
// sessão encerrada por logout ou redefinição não pede nem baixa a cópia. A
// exclusão pede a senha, e a guarda já recusa conta fora de `ativa`.
// Corpo: só `{}` (ou nenhum) nas rotas sem corpo (CA-13).
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  corpoVazioSchema,
  MOTIVO_SENHA_INCORRETA,
  type Privacidade,
  type SolicitarExclusao,
  solicitarExclusaoSchema,
} from '@bairrin/contratos';
import type { Request, Response } from 'express';
import type { ContaAutenticada } from '../../../compartilhado/autenticacao/verificador-de-acesso.ts';
import { ConfereSessao } from '../../../compartilhado/http/autenticacao/confere-sessao.decorator.ts';
import { ContaAtual } from '../../../compartilhado/http/autenticacao/conta-atual.decorator.ts';
import { ErroComCodigo } from '../../../compartilhado/http/filtro-de-erros.ts';
import {
  ErroDeValidacao,
  ValidacaoZodPipe,
} from '../../../compartilhado/http/validacao-zod.pipe.ts';
import { Relogio } from '../../../compartilhado/tempo/relogio.ts';
import { BaixarExportacaoCasoDeUso } from '../aplicacao/privacidade/baixar-exportacao.ts';
import { ConsultarPrivacidadeCasoDeUso } from '../aplicacao/privacidade/consultar-privacidade.ts';
import { SolicitarExclusaoCasoDeUso } from '../aplicacao/privacidade/solicitar-exclusao.ts';
import { SolicitarExportacaoCasoDeUso } from '../aplicacao/privacidade/solicitar-exportacao.ts';

/** Nome do arquivo da cópia dos dados no download. */
export const NOME_DO_ARQUIVO_DA_EXPORTACAO = 'bairrin-meus-dados.json';

const corpoVazio = new ValidacaoZodPipe(corpoVazioSchema);

@Controller('v1/privacidade')
export class PrivacidadeController {
  constructor(
    private readonly consultar: ConsultarPrivacidadeCasoDeUso,
    private readonly solicitarExportacao: SolicitarExportacaoCasoDeUso,
    private readonly baixarExportacao: BaixarExportacaoCasoDeUso,
    private readonly solicitarExclusao: SolicitarExclusaoCasoDeUso,
    private readonly relogio: Relogio,
  ) {}

  @Get()
  ver(
    @ContaAtual() conta: ContaAutenticada,
    @Body(corpoVazio) _corpo: unknown,
  ): Promise<Privacidade> {
    return this.consultar.executar({ contaId: conta.contaId });
  }

  @Post('exportacao')
  @HttpCode(202)
  @ConfereSessao()
  async exportar(
    @ContaAtual() conta: ContaAutenticada,
    @Body(corpoVazio) _corpo: unknown,
  ): Promise<void> {
    const resultado = await this.solicitarExportacao.executar({ contaId: conta.contaId });
    if (resultado.tipo === 'ja_solicitada') {
      const esperaEmMs = resultado.proximaEm.getTime() - this.relogio.agora().getTime();
      throw new ErroComCodigo('limite_excedido', { esperaEmSegundos: esperaEmMs / 1000 });
    }
  }

  @Get('exportacao/arquivo')
  @ConfereSessao()
  async baixar(
    @ContaAtual() conta: ContaAutenticada,
    @Body(corpoVazio) _corpo: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    // O Express entrega o HEAD a esta rota do GET (Q31). Ele não decifra nem
    // marca: 405 com `Allow: GET`, e o download continua disponível.
    if (req.method === 'HEAD') {
      res.setHeader('Allow', 'GET');
      throw new ErroComCodigo('metodo_nao_permitido');
    }
    const resultado = await this.baixarExportacao.executar({ contaId: conta.contaId });
    if (resultado.tipo === 'indisponivel') throw new ErroComCodigo('nao_encontrado');
    // O arquivo já é JSON em texto: vai como está, sem passar de novo pelo serializador.
    res.type('application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${NOME_DO_ARQUIVO_DA_EXPORTACAO}"`);
    return resultado.json;
  }

  @Post('exclusao')
  @HttpCode(202)
  async excluir(
    @ContaAtual() conta: ContaAutenticada,
    @Body(new ValidacaoZodPipe(solicitarExclusaoSchema)) corpo: SolicitarExclusao,
  ): Promise<void> {
    const resultado = await this.solicitarExclusao.executar({
      contaId: conta.contaId,
      senha: corpo.senha,
      sessaoDeAdminComMfa: conta.mfa && conta.perfis.includes('admin'),
    });
    switch (resultado.tipo) {
      case 'desativada':
        return;
      case 'senha_incorreta':
        throw new ErroDeValidacao([
          { campo: 'senha', codigo: 'invalido', motivo: MOTIVO_SENHA_INCORRETA },
        ]);
      case 'freado':
        throw new ErroComCodigo('limite_excedido', {
          esperaEmSegundos: resultado.segundosDeEspera,
        });
      case 'com_pendencias':
        throw new ErroComCodigo('exclusao_com_pendencias');
      case 'admin_fora_do_painel':
        throw new ErroComCodigo('exclusao_de_admin_so_pelo_painel');
      case 'conta_indisponivel':
        throw new UnauthorizedException();
    }
  }
}
