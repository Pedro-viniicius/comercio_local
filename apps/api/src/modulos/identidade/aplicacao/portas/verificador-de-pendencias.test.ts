// Registro de pendências que adiam a exclusão (CA-11): vazio responde sem
// pendência; cada módulo registra a sua fonte; fonte que falha faz a consulta
// falhar (a exclusão não segue na dúvida).
import { describe, expect, it } from 'vitest';
import {
  type FonteDePendencias,
  type PendenciaDeExclusao,
  RegistroDePendencias,
} from './verificador-de-pendencias.ts';

const CONTA = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';

function fonte(
  modulo: string,
  pendencias: PendenciaDeExclusao[],
  falha?: Error,
): FonteDePendencias {
  return {
    modulo,
    pendenciasDaConta: () => (falha ? Promise.reject(falha) : Promise.resolve(pendencias)),
  };
}

describe('RegistroDePendencias', () => {
  it('sem fonte registrada (este plano), não há pendência', async () => {
    await expect(new RegistroDePendencias().pendenciasDaConta(CONTA)).resolves.toEqual([]);
  });

  it('junta as pendências das fontes, na ordem de registro', async () => {
    const registro = new RegistroDePendencias();
    registro.registrar(fonte('pedidos', [{ modulo: 'pedidos', tipo: 'pedido_em_andamento' }]));
    registro.registrar(fonte('repasses', [{ modulo: 'repasses', tipo: 'saldo_a_repassar' }]));
    expect(registro.modulos()).toEqual(['pedidos', 'repasses']);
    await expect(registro.pendenciasDaConta(CONTA)).resolves.toEqual([
      { modulo: 'pedidos', tipo: 'pedido_em_andamento' },
      { modulo: 'repasses', tipo: 'saldo_a_repassar' },
    ]);
  });

  it('recusa a segunda fonte do mesmo módulo e nome inválido', () => {
    const registro = new RegistroDePendencias();
    registro.registrar(fonte('pedidos', []));
    expect(() => registro.registrar(fonte('pedidos', []))).toThrow(/já registrou/);
    expect(() => registro.registrar(fonte('Pedidos', []))).toThrow(/inválido/);
  });

  it('fonte que falha faz a consulta falhar', async () => {
    const registro = new RegistroDePendencias();
    registro.registrar(fonte('pedidos', [], new Error('banco fora')));
    await expect(registro.pendenciasDaConta(CONTA)).rejects.toThrow('banco fora');
  });

  it.each<[string, PendenciaDeExclusao]>([
    ['de outro módulo', { modulo: 'outro', tipo: 'pedido_em_andamento' }],
    ['com tipo em texto livre', { modulo: 'pedidos', tipo: 'Pedido de Fulano' }],
  ])(
    'recusa pendência %s (nada de texto livre, que poderia ter dado pessoal)',
    async (_caso, pendencia) => {
      const registro = new RegistroDePendencias();
      registro.registrar(fonte('pedidos', [pendencia]));
      await expect(registro.pendenciasDaConta(CONTA)).rejects.toThrow(/mal formada/);
    },
  );
});
