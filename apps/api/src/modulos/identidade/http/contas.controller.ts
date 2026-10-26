// Cadastro e verificação de e-mail (plano 01b, etapa 16; CA-01, CA-02, P1-dono,
// S24, S74, S93).
//
// - `POST /v1/contas` (público): 202 com a mensagem fixa, exista ou não conta
//   com o e-mail (CA-02); a senha nova passa também pela lista pública de
//   senhas comuns (5b), no pipe, antes de olhar o e-mail. Versão de documento
//   diferente da vigente → 400 `campos[aceites.<tipo>].invalido` (S24).
// - `POST /v1/conta/verificacao-email` (com sessão): 200 com a sessão nova
//   (no painel, pelo cookie); código que não serve → 400
//   `campos[codigo].invalido`; freio por e-mail ativo → 429 com `Retry-After`;
//   `sessao_invalida` → 401 (exceção registrada ao "401 só da guarda": a
//   sessão acabou entre a guarda e o caso de uso).
// - `POST /v1/conta/verificacao-email/reenvio` (com sessão): 202; 3 por hora
//   por conta, conferido antes do limite de 10 por hora por IP (etapa 19): a
//   recusa por conta não gasta a cota do IP, que atrás de CGNAT é dividida
//   com outras pessoas.
import { Body, Controller, HttpCode, Post, Res, UnauthorizedException } from '@nestjs/common';
import {
  type CadastroAceito,
  corpoVazioSchema,
  criarContaSchema,
  MENSAGEM_DE_CADASTRO_ACEITO,
  MOTIVO_VERSAO_INVALIDA,
  type Sessao,
  type VerificarEmail,
  verificarEmailSchema,
  type z,
} from '@bairrin/contratos';
import { MOTIVO_CODIGO_INVALIDO } from '@bairrin/contratos/validadores';
import type { Response } from 'express';
import type { ContaAutenticada } from '../../../compartilhado/autenticacao/verificador-de-acesso.ts';
import { ContaAtual } from '../../../compartilhado/http/autenticacao/conta-atual.decorator.ts';
import { Publico } from '../../../compartilhado/http/autenticacao/publico.decorator.ts';
import { ErroComCodigo } from '../../../compartilhado/http/filtro-de-erros.ts';
import { LimitarRota } from '../../../compartilhado/http/limite-por-rota.guard.ts';
import {
  ErroDeValidacao,
  ValidacaoZodPipe,
} from '../../../compartilhado/http/validacao-zod.pipe.ts';
import { CriarContaCasoDeUso } from '../aplicacao/cadastro/criar-conta.caso-de-uso.ts';
import { ReenviarVerificacaoCasoDeUso } from '../aplicacao/cadastro/reenviar-verificacao.caso-de-uso.ts';
import { VerificarEmailCasoDeUso } from '../aplicacao/cadastro/verificar-email.caso-de-uso.ts';
import { LIMITES_DA_IDENTIDADE } from './limites.ts';
import { comSenhaForaDaListaPublica } from './senha-fora-da-lista-publica.ts';
import { corpoDaSessao } from './sessao-no-http.ts';

/** O corpo do cadastro com a lista pública de senhas comuns na senha (S74). */
export const corpoDoCadastroSchema = comSenhaForaDaListaPublica(criarContaSchema, 'senha');

@Controller('v1')
export class ContasController {
  constructor(
    private readonly criarConta: CriarContaCasoDeUso,
    private readonly verificarEmail: VerificarEmailCasoDeUso,
    private readonly reenviarVerificacao: ReenviarVerificacaoCasoDeUso,
  ) {}

  @Publico()
  @Post('contas')
  @HttpCode(202)
  @LimitarRota(LIMITES_DA_IDENTIDADE.cadastroPorIp)
  async cadastrar(
    @Body(new ValidacaoZodPipe(corpoDoCadastroSchema))
    corpo: z.output<typeof corpoDoCadastroSchema>,
  ): Promise<CadastroAceito> {
    const resultado = await this.criarConta.executar(corpo);
    if (resultado.tipo === 'aceites_divergentes') {
      throw new ErroDeValidacao(
        resultado.documentos.map((documento) => ({
          campo: `aceites.${documento}`,
          codigo: 'invalido' as const,
          motivo: MOTIVO_VERSAO_INVALIDA,
        })),
      );
    }
    return { mensagem: MENSAGEM_DE_CADASTRO_ACEITO };
  }

  @Post('conta/verificacao-email')
  @HttpCode(200)
  async verificar(
    @ContaAtual() conta: ContaAutenticada,
    @Body(new ValidacaoZodPipe(verificarEmailSchema)) corpo: VerificarEmail,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Sessao> {
    const resultado = await this.verificarEmail.executar({
      contaId: conta.contaId,
      sid: conta.sid,
      codigo: corpo.codigo,
    });
    switch (resultado.tipo) {
      case 'verificado':
        return corpoDaSessao(res, resultado.sessao, resultado.cliente);
      case 'codigo_invalido':
        throw new ErroDeValidacao([
          { campo: 'codigo', codigo: 'invalido', motivo: MOTIVO_CODIGO_INVALIDO },
        ]);
      case 'freado':
        throw new ErroComCodigo('limite_excedido', {
          esperaEmSegundos: resultado.segundosDeEspera,
        });
      case 'sessao_invalida':
        throw new UnauthorizedException();
    }
  }

  @Post('conta/verificacao-email/reenvio')
  @HttpCode(202)
  @LimitarRota(LIMITES_DA_IDENTIDADE.reenvioPorConta, LIMITES_DA_IDENTIDADE.reenvioPorIp)
  async reenviar(
    @ContaAtual() conta: ContaAutenticada,
    @Body(new ValidacaoZodPipe(corpoVazioSchema)) _corpo: unknown,
  ): Promise<void> {
    await this.reenviarVerificacao.executar({ contaId: conta.contaId });
  }
}
