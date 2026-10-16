import { objetoEstrito, z } from '@bairrin/contratos';
import { describe, expect, it } from 'vitest';
import { ErroDeValidacao, ValidacaoZodPipe } from './validacao-zod.pipe.ts';

const esquema = objetoEstrito({
  nome: z.string().min(1),
  idade: z.number().int().min(18),
});
const pipe = new ValidacaoZodPipe(esquema);

function errosDe(valor: unknown): ErroDeValidacao {
  try {
    pipe.transform(valor);
  } catch (erro) {
    if (erro instanceof ErroDeValidacao) return erro;
    throw erro;
  }
  throw new Error('O pipe deveria ter recusado o valor.');
}

describe('ValidacaoZodPipe', () => {
  it('devolve o valor convertido quando é válido', () => {
    expect(pipe.transform({ nome: 'Ana', idade: 30 })).toEqual({ nome: 'Ana', idade: 30 });
  });

  it('recusa campo inválido com motivo em português e código `invalido`', () => {
    const erro = errosDe({ nome: 'Ana', idade: 10 });
    expect(erro.getStatus()).toBe(400);
    expect(erro.campos).toHaveLength(1);
    expect(erro.campos[0]).toMatchObject({ campo: 'idade', codigo: 'invalido' });
    expect(erro.campos[0]?.motivo).toMatch(/Muito pequeno|esperado|esperava/i);
  });

  it('recusa campo desconhecido, um item por chave', () => {
    const erro = errosDe({ nome: 'Ana', idade: 30, admin: true, papel: 'x' });
    expect(erro.campos).toEqual([
      { campo: 'admin', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
      { campo: 'papel', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
    ]);
  });

  it('marca campo ausente como `obrigatorio`', () => {
    const erro = errosDe({ idade: 30 });
    expect(erro.campos).toEqual([
      { campo: 'nome', codigo: 'obrigatorio', motivo: 'Campo obrigatório.' },
    ]);
  });

  it('recusa corpo ausente apontando para o campo raiz', () => {
    const erro = errosDe(undefined);
    expect(erro.campos[0]).toMatchObject({ campo: 'corpo', codigo: 'obrigatorio' });
  });

  it('não devolve o valor recebido nos campos', () => {
    const erro = errosDe({ nome: 'Ana', idade: 'fulano@exemplo.com' });
    expect(JSON.stringify(erro.campos)).not.toContain('fulano@exemplo.com');
  });
});
