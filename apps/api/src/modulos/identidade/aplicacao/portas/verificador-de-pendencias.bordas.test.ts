// Bordas do registro de pendências (CA-11, CA-12): o que a Identidade repassa à resposta de
// exclusão (409 com aviso) é só módulo e tipo, mesmo que a fonte devolva mais.
import { describe, expect, it } from 'vitest';
import { type FonteDePendencias, RegistroDePendencias } from './verificador-de-pendencias.ts';

const CONTA = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';

describe('RegistroDePendencias: só módulo e tipo saem (CA-12)', () => {
  it('campo a mais da fonte (id do pedido, e-mail do cliente) não passa para a resposta', async () => {
    const registro = new RegistroDePendencias();
    const comExtras: FonteDePendencias = {
      modulo: 'pedidos',
      pendenciasDaConta: () =>
        Promise.resolve([
          {
            modulo: 'pedidos',
            tipo: 'pedido_em_andamento',
            pedidoId: 'p-123',
            cliente: 'fulano@exemplo.com',
          } as { modulo: string; tipo: string },
        ]),
    };
    registro.registrar(comExtras);

    const pendencias = await registro.pendenciasDaConta(CONTA);

    expect(pendencias).toEqual([{ modulo: 'pedidos', tipo: 'pedido_em_andamento' }]);
    expect(JSON.stringify(pendencias)).not.toContain('fulano');
    expect(JSON.stringify(pendencias)).not.toContain('p-123');
  });

  it('uma fonte com pendência e outra que falha: a consulta falha (na dúvida, a exclusão não segue)', async () => {
    const registro = new RegistroDePendencias();
    registro.registrar({
      modulo: 'pedidos',
      pendenciasDaConta: () =>
        Promise.resolve([{ modulo: 'pedidos', tipo: 'pedido_em_andamento' }]),
    });
    registro.registrar({
      modulo: 'repasses',
      pendenciasDaConta: () => Promise.reject(new Error('repasses fora do ar')),
    });
    await expect(registro.pendenciasDaConta(CONTA)).rejects.toThrow('repasses fora do ar');
  });

  it('a mensagem de pendência mal formada traz o módulo e nunca o valor do tipo', async () => {
    const registro = new RegistroDePendencias();
    registro.registrar({
      modulo: 'pedidos',
      pendenciasDaConta: () =>
        Promise.resolve([{ modulo: 'pedidos', tipo: 'Pedido de Fulano de Tal' }]),
    });
    const erro = await registro.pendenciasDaConta(CONTA).then(
      () => new Error('deveria falhar'),
      (falha: unknown) => falha as Error,
    );
    expect(erro.message).toContain('mal formada');
    expect(erro.message).toContain('pedidos');
    expect(erro.message).not.toContain('Fulano');
  });
});
