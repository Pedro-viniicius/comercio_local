import { describe, expect, it } from 'vitest';
import {
  CAMPO_RAIZ,
  campoComErroSchema,
  camposDoErroZod,
  criarProblema,
  ERROS,
  objetoEstrito,
  problemaSchema,
  prontidaoSchema,
  saudeSchema,
  z,
} from './index.ts';

const cadastro = objetoEstrito({
  nome: z.string().min(1),
  email: z.email(),
  idade: z.number().int(),
  senha: z.string().refine((valor) => valor !== 'senha123', {
    error: 'Escolha uma senha menos comum.',
    params: { codigo: 'comum' },
  }),
  endereco: objetoEstrito({ cep: z.string() }).optional(),
});

function validar(entrada: unknown) {
  const resultado = cadastro.safeParse(entrada);
  if (resultado.success) throw new Error('esperava falha de validação');
  return camposDoErroZod(resultado.error);
}

const valido = { nome: 'Ana', email: 'ana@exemplo.com', idade: 30, senha: 'outra-senha' };

describe('objetoEstrito e locale ptBR', () => {
  it('aceita o corpo válido', () => {
    expect(cadastro.safeParse(valido).success).toBe(true);
  });

  it('recusa campo desconhecido com código desconhecido e motivo em português', () => {
    expect(validar({ ...valido, admin: true, outro: 1 })).toEqual([
      { campo: 'admin', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
      { campo: 'outro', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
    ]);
  });

  it('nomeia o campo desconhecido de objeto aninhado pelo caminho', () => {
    expect(validar({ ...valido, endereco: { cep: '37950', ruim: 1 } })).toEqual([
      { campo: 'endereco.ruim', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
    ]);
  });

  it('trata campo ausente e texto vazio como obrigatório', () => {
    const campos = validar({ email: valido.email, idade: 30, senha: 'x', nome: '' });
    expect(campos).toEqual([
      { campo: 'nome', codigo: 'obrigatorio', motivo: 'Campo obrigatório.' },
    ]);
    const ausente = validar({ ...valido, nome: undefined });
    expect(ausente).toEqual([
      { campo: 'nome', codigo: 'obrigatorio', motivo: 'Campo obrigatório.' },
    ]);
  });

  it('usa o motivo do zod em português para valor inválido', () => {
    const [campo, ...resto] = validar({ ...valido, email: 'sem-arroba', idade: 'trinta' }).sort(
      (a, b) => a.campo.localeCompare(b.campo),
    );
    expect(resto).toHaveLength(1);
    expect(campo).toEqual({
      campo: 'email',
      codigo: 'invalido',
      motivo: 'Formato do endereço de e-mail inválido',
    });
    expect(resto[0]).toMatchObject({
      campo: 'idade',
      codigo: 'invalido',
      motivo: 'Entrada inválida: esperava um número, recebeu um texto',
    });
  });

  it('respeita o código escolhido pelo validador próprio', () => {
    expect(validar({ ...valido, senha: 'senha123' })).toEqual([
      { campo: 'senha', codigo: 'comum', motivo: 'Escolha uma senha menos comum.' },
    ]);
  });

  it('ignora código de validador fora da lista', () => {
    const esquema = z.string().refine(() => false, { params: { codigo: 'qualquer' } });
    const resultado = esquema.safeParse('x');
    if (resultado.success) throw new Error('esperava falha');
    expect(camposDoErroZod(resultado.error)[0]?.codigo).toBe('invalido');
  });

  it('nomeia o corpo que não é objeto e não devolve o valor recebido', () => {
    const campos = validar('segredo-do-cliente');
    expect(campos).toHaveLength(1);
    expect(campos[0]?.campo).toBe(CAMPO_RAIZ);
    expect(JSON.stringify(campos)).not.toContain('segredo-do-cliente');
  });

  it('nomeia item de lista pelo índice', () => {
    const esquema = objetoEstrito({ itens: z.array(objetoEstrito({ quantidade: z.number() })) });
    const resultado = esquema.safeParse({ itens: [{ quantidade: 1 }, { quantidade: 'x' }] });
    if (resultado.success) throw new Error('esperava falha');
    expect(camposDoErroZod(resultado.error).map((c) => c.campo)).toEqual(['itens.1.quantidade']);
  });

  it('limita o tamanho do nome do campo desconhecido', () => {
    const [campo] = validar({ ...valido, ['a'.repeat(500)]: 1 });
    expect(campo?.campo).toHaveLength(100);
  });
});

describe('Problema', () => {
  it('monta o Problema de um código com status e título em português', () => {
    const campos = validar({ ...valido, admin: true });
    const problema = criarProblema({ codigo: 'validacao', idRequisicao: 'req-1', campos });
    expect(problema).toEqual({
      type: 'urn:bairrin:erro:validacao',
      title: 'Dados inválidos',
      status: 400,
      codigo: 'validacao',
      campos,
      idRequisicao: 'req-1',
    });
    expect(problemaSchema.safeParse(problema).success).toBe(true);
  });

  it('omite campos quando não há', () => {
    const problema = criarProblema({ codigo: 'erro_interno', idRequisicao: 'req-2' });
    expect('campos' in problema).toBe(false);
    expect(problema.status).toBe(500);
  });

  it.each([
    ['sem_acesso_painel', 403, 'Esta conta não tem acesso ao painel'],
    ['exclusao_com_pendencias', 409, 'A conta tem pendências que adiam a exclusão'],
  ] as const)('o código %s do 01b sai com status %i (S23, CA-11, R28)', (codigo, status, title) => {
    expect(criarProblema({ codigo, idRequisicao: 'req-3' })).toEqual({
      type: `urn:bairrin:erro:${codigo}`,
      title,
      status,
      codigo,
      idRequisicao: 'req-3',
    });
  });

  it('todo código tem status de erro e título', () => {
    for (const [codigo, { status, title }] of Object.entries(ERROS)) {
      expect(status, codigo).toBeGreaterThanOrEqual(400);
      expect(title, codigo).not.toBe('');
    }
  });

  it('o cliente tolera código e campo novos que ele não conhece', () => {
    const resposta = {
      type: 'urn:bairrin:erro:novo',
      title: 'Novo',
      status: 422,
      codigo: 'codigo_do_futuro',
      idRequisicao: 'req-3',
      extra: 1,
    };
    expect(problemaSchema.safeParse(resposta).success).toBe(true);
  });

  it('o cliente tolera código de campo que ele não conhece, mas exige campo e motivo', () => {
    const base = { type: 't', title: 't', status: 400, codigo: 'validacao', idRequisicao: 'r' };
    const campoNovo = { campo: 'telefone', codigo: 'codigo_do_futuro', motivo: 'Já usado' };
    const lido = problemaSchema.safeParse({ ...base, campos: [campoNovo] });
    expect(lido.success && lido.data.campos).toEqual([campoNovo]);
    for (const campo of [
      { campo: 'a', motivo: 'm' },
      { codigo: 'x', motivo: 'm' },
      { campo: 'a', codigo: 'x' },
    ]) {
      expect(
        problemaSchema.safeParse({ ...base, campos: [campo] }).success,
        JSON.stringify(campo),
      ).toBe(false);
    }
  });

  it('o que a API produz continua restrito aos códigos de campo conhecidos', () => {
    const campo = { campo: 'telefone', codigo: 'codigo_do_futuro', motivo: 'Já usado' };
    expect(campoComErroSchema.safeParse(campo).success).toBe(false);
    expect(campoComErroSchema.safeParse({ ...campo, codigo: 'comum' }).success).toBe(true);
  });

  it('recusa Problema sem idRequisicao', () => {
    expect(
      problemaSchema.safeParse({ type: 't', title: 't', status: 400, codigo: 'c' }).success,
    ).toBe(false);
  });
});

describe('saúde', () => {
  it('aceita com e sem versão e recusa status diferente de ok', () => {
    expect(saudeSchema.safeParse({ status: 'ok' }).success).toBe(true);
    expect(saudeSchema.safeParse({ status: 'ok', versao: '1.2.3' }).success).toBe(true);
    expect(saudeSchema.safeParse({ status: 'falha' }).success).toBe(false);
    expect(prontidaoSchema.safeParse({ status: 'ok' }).success).toBe(true);
  });
});
