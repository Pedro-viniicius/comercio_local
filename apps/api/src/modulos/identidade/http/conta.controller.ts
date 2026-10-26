// Dados da conta da sessão (plano 01b, etapa 19; spec A5; CA-07, S8).
//
// - `GET /v1/conta` (com sessão): 200 `{ nome, emailMascarado, perfis }`
//   (`contaSchema`), sem `admin` fora da sessão do painel com segundo fator.
//   Confere a sessão do `sid` (`@ConfereSessao()`): o token de acesso de uma
//   sessão encerrada não lê mais o nome. Corpo, se vier, só `{}` (CA-13).
//   `conta_indisponivel` → 401 (exceção registrada ao "401 só da guarda": a
//   conta saiu de `ativa` entre a guarda e o caso de uso).
import { Body, Controller, Get, UnauthorizedException } from '@nestjs/common';
import { type Conta, corpoVazioSchema } from '@bairrin/contratos';
import type { ContaAutenticada } from '../../../compartilhado/autenticacao/verificador-de-acesso.ts';
import { ConfereSessao } from '../../../compartilhado/http/autenticacao/confere-sessao.decorator.ts';
import { ContaAtual } from '../../../compartilhado/http/autenticacao/conta-atual.decorator.ts';
import { ValidacaoZodPipe } from '../../../compartilhado/http/validacao-zod.pipe.ts';
import { ConsultarContaCasoDeUso } from '../aplicacao/conta/consultar-conta.caso-de-uso.ts';

/** A conta da sessão como as rotas a devolvem; `conta_indisponivel` vira 401. */
export async function contaDaSessao(
  consultar: ConsultarContaCasoDeUso,
  conta: ContaAutenticada,
): Promise<Conta> {
  const resultado = await consultar.executar({
    contaId: conta.contaId,
    sessaoComAdmin: conta.perfis.includes('admin'),
  });
  if (resultado.tipo === 'conta_indisponivel') throw new UnauthorizedException();
  return resultado.conta;
}

@Controller('v1/conta')
export class ContaController {
  constructor(private readonly consultarConta: ConsultarContaCasoDeUso) {}

  @Get()
  @ConfereSessao()
  ver(
    @ContaAtual() conta: ContaAutenticada,
    @Body(new ValidacaoZodPipe(corpoVazioSchema)) _corpo: unknown,
  ): Promise<Conta> {
    return contaDaSessao(this.consultarConta, conta);
  }
}
