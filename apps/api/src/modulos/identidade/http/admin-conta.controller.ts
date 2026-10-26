// Rota mínima do painel administrativo (plano 01b, etapa 19; CA-08, S7, S8).
//
// - `GET /v1/admin/conta`: 200 `{ nome, emailMascarado, perfis }`
//   (`contaSchema`) da conta admin da sessão. Só conta com `admin` e segundo
//   fator (`@Perfis('admin')`, `@ExigeMfa()`; a guarda global também exige os
//   dois em todo `/v1/admin`); sem eles, 403 com log só do id da conta. A
//   sessão do `sid` é conferida a cada requisição (S8): depois do logout, 401.
//   `conta_indisponivel` → 401 (a mesma exceção registrada de `GET /v1/conta`:
//   a conta saiu de `ativa` entre a guarda e o caso de uso; `contaDaSessao`).
import { Body, Controller, Get } from '@nestjs/common';
import { type Conta, corpoVazioSchema } from '@bairrin/contratos';
import type { ContaAutenticada } from '../../../compartilhado/autenticacao/verificador-de-acesso.ts';
import { ContaAtual } from '../../../compartilhado/http/autenticacao/conta-atual.decorator.ts';
import { ExigeMfa } from '../../../compartilhado/http/autenticacao/exige-mfa.guard.ts';
import { Perfis } from '../../../compartilhado/http/autenticacao/perfis.guard.ts';
import { ValidacaoZodPipe } from '../../../compartilhado/http/validacao-zod.pipe.ts';
import { ConsultarContaCasoDeUso } from '../aplicacao/conta/consultar-conta.caso-de-uso.ts';
import { contaDaSessao } from './conta.controller.ts';

@Perfis('admin')
@ExigeMfa()
@Controller('v1/admin/conta')
export class AdminContaController {
  constructor(private readonly consultarConta: ConsultarContaCasoDeUso) {}

  @Get()
  ver(
    @ContaAtual() conta: ContaAutenticada,
    @Body(new ValidacaoZodPipe(corpoVazioSchema)) _corpo: unknown,
  ): Promise<Conta> {
    return contaDaSessao(this.consultarConta, conta);
  }
}
