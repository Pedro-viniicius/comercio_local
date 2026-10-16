// Repositório de auditoria (S4): recusa dado pessoal e segredo em `antes` e
// `depois`, grava com a hora do `Relogio` pelo client da unidade de trabalho.
// A gravação no Postgres real está em test/integracao/outbox.int.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { RepositorioDeAuditoriaPrisma } from '../infra/repositorio-de-auditoria-prisma.ts';
import type { UnidadeDeTrabalhoPrisma } from '../infra/unidade-de-trabalho-prisma.ts';
import { RelogioFixo } from '../tempo/relogio.ts';
import { DadoPessoalRecusado, type ObjetoJson } from '../titular/dado-pessoal.ts';
import { type EntradaDeAuditoria, EntradaDeAuditoriaInvalida } from './repositorio-de-auditoria.ts';

const AGORA = new Date('2026-10-16T12:00:00.000Z');
const CONTA = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';

function montar() {
  const create = vi.fn().mockResolvedValue({ id: 'x' });
  const unidade = {
    cliente: () => ({ auditoria: { create } }),
  } as unknown as UnidadeDeTrabalhoPrisma;
  const repositorio = new RepositorioDeAuditoriaPrisma(unidade, new RelogioFixo(AGORA));
  return { repositorio, create };
}

function entrada(extra: Partial<EntradaDeAuditoria> = {}): EntradaDeAuditoria {
  return {
    atorTipo: 'admin',
    atorId: CONTA,
    acao: 'loja_aprovada',
    recurso: 'loja',
    recursoId: '0b8e7a6c-5d4e-4f3a-9b2c-1d0e9f8a7b6c',
    origem: 'painel',
    ...extra,
  };
}

async function recusa(repositorio: RepositorioDeAuditoriaPrisma, valor: EntradaDeAuditoria) {
  try {
    await repositorio.registrar(valor);
  } catch (erro) {
    return erro;
  }
  throw new Error('deveria ter recusado');
}

describe('RepositorioDeAuditoriaPrisma.registrar', () => {
  it('grava a entrada com a hora do relógio, sem antes nem depois quando ausentes', async () => {
    const { repositorio, create } = montar();
    await repositorio.registrar(entrada());
    expect(create).toHaveBeenCalledWith({
      data: {
        atorTipo: 'admin',
        atorId: CONTA,
        acao: 'loja_aprovada',
        recurso: 'loja',
        recursoId: '0b8e7a6c-5d4e-4f3a-9b2c-1d0e9f8a7b6c',
        origem: 'painel',
        ocorridoEm: AGORA,
      },
      select: { id: true },
    });
  });

  it('aceita ids, estados e valores não pessoais em antes e depois', async () => {
    const { repositorio, create } = montar();
    const antes = { status: 'pendente', lojaId: CONTA, taxaEmCentavos: 300, tipo: 'loja' };
    const depois = { status: 'aprovada', campos: ['nome', 'telefone'], motivoId: null };
    await repositorio.registrar(entrada({ antes, depois }));
    const [argumentos] = create.mock.calls[0] as [{ data: { antes: unknown; depois: unknown } }];
    expect(argumentos.data.antes).toEqual(antes);
    expect(argumentos.data.depois).toEqual(depois);
  });

  it('aceita campo pessoal só como marca de alteração', async () => {
    const { repositorio, create } = montar();
    const depois = {
      email: { alterado: true },
      telefone: { alterado: true },
      senha: { alterado: true },
    };
    await repositorio.registrar(entrada({ depois }));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each<[string, ObjetoJson, string]>([
    ['e-mail', { email: 'maria@exemplo.com.br' }, 'antes.email'],
    ['telefone', { telefoneE164: '+5535999990000' }, 'antes.telefoneE164'],
    ['nome', { nomeCompleto: 'Maria da Silva' }, 'antes.nomeCompleto'],
    ['CPF', { cpf_titular: '12345678909' }, 'antes.cpf_titular'],
    ['endereço aninhado', { loja: { endereco: { logradouro: 'Rua A' } } }, 'antes.loja.endereco'],
    ['dentro de lista', { contatos: [{ celular: '35999990000' }] }, 'antes.contatos[0].celular'],
    ['IP', { ip: '200.1.2.3' }, 'antes.ip'],
    ['chave pix', { chavePix: 'maria@exemplo.com.br' }, 'antes.chavePix'],
    ['senha', { senhaHash: '$argon2id$...' }, 'antes.senhaHash'],
    ['token', { tokenRenovacao: 'abc' }, 'antes.tokenRenovacao'],
    ['código', { codigo: '123456' }, 'antes.codigo'],
    ['marca falsa', { email: { alterado: true, valor: 'maria@exemplo.com.br' } }, 'antes.email'],
  ])('recusa %s em antes, citando só o caminho', async (_caso, antes, caminho) => {
    const { repositorio, create } = montar();
    const erro = await recusa(repositorio, entrada({ antes }));
    expect(erro).toBeInstanceOf(DadoPessoalRecusado);
    expect((erro as DadoPessoalRecusado).problemas).toContainEqual({
      caminho,
      motivo: 'chave-protegida',
    });
    expect((erro as Error).message).toContain(caminho);
    // Nenhum valor no erro.
    for (const valor of [
      'maria',
      'Maria',
      '+5535',
      '12345678909',
      'Rua A',
      '200.1.2.3',
      'abc',
      '123456',
      'argon',
    ]) {
      expect((erro as Error).message).not.toContain(valor);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('recusa dado pessoal em depois', async () => {
    const { repositorio, create } = montar();
    const erro = await recusa(repositorio, entrada({ depois: { whatsapp: '35999990000' } }));
    expect((erro as DadoPessoalRecusado).problemas).toEqual([
      { caminho: 'depois.whatsapp', motivo: 'chave-protegida' },
    ]);
    expect(create).not.toHaveBeenCalled();
  });

  it('recusa valor que não é JSON simples', async () => {
    const { repositorio } = montar();
    const depois = { quando: new Date() } as unknown as ObjetoJson;
    const erro = await recusa(repositorio, entrada({ depois }));
    expect((erro as DadoPessoalRecusado).problemas).toEqual([
      { caminho: 'depois.quando', motivo: 'valor-nao-json' },
    ]);
  });

  it.each<[string, Partial<EntradaDeAuditoria>]>([
    ['ator sem id', { atorId: null }],
    ['ator com id que não é UUID', { atorId: 'maria' }],
    ['sistema com id', { atorTipo: 'sistema', atorId: CONTA }],
    ['ação fora de snake_case', { acao: 'Loja Aprovada' }],
    ['recurso fora de snake_case', { recurso: 'Loja' }],
    ['recursoId vazio', { recursoId: ' ' }],
    ['recursoId com e-mail', { recursoId: 'maria@exemplo.com.br' }],
  ])('recusa entrada mal formada: %s', async (_caso, extra) => {
    const { repositorio, create } = montar();
    const erro = await recusa(repositorio, entrada(extra));
    expect(erro).toBeInstanceOf(EntradaDeAuditoriaInvalida);
    expect((erro as Error).message).not.toContain('maria');
    expect(create).not.toHaveBeenCalled();
  });

  it('aceita o sistema como ator sem id', async () => {
    const { repositorio, create } = montar();
    await repositorio.registrar(entrada({ atorTipo: 'sistema', atorId: null, origem: 'worker' }));
    expect(create).toHaveBeenCalledTimes(1);
  });
});
