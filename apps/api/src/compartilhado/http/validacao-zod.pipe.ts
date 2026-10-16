// Pipe que valida corpo, consulta ou parâmetro com um esquema de
// `@bairrin/contratos`. Uso: `@Body(new ValidacaoZodPipe(meuSchema))`.
import { HttpException, HttpStatus, type PipeTransform } from '@nestjs/common';
import { camposDoErroZod, type CampoComErro, type z } from '@bairrin/contratos';

/**
 * Erro de validação com os campos já em português (locale ptBR do
 * `@bairrin/contratos`). O filtro de erros o converte em Problem Details 400.
 */
export class ErroDeValidacao extends HttpException {
  constructor(readonly campos: CampoComErro[]) {
    super('Dados inválidos', HttpStatus.BAD_REQUEST);
    this.name = 'ErroDeValidacao';
  }
}

export class ValidacaoZodPipe<Esquema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<Esquema>
> {
  constructor(private readonly esquema: Esquema) {}

  transform(valor: unknown): z.output<Esquema> {
    const resultado = this.esquema.safeParse(valor);
    if (!resultado.success) throw new ErroDeValidacao(camposDoErroZod(resultado.error));
    return resultado.data;
  }
}
