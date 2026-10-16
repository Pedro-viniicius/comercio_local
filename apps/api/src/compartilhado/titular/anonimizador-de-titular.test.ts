// Registro de `AnonimizadorDeTitular` (S5): cada módulo registra o seu e a
// anonimização passa por todos, em ordem, parando no primeiro que falhar.
import { describe, expect, it, vi } from 'vitest';
import {
  type AnonimizadorDeTitular,
  FalhaNaAnonimizacao,
  RegistroDeAnonimizadores,
} from './anonimizador-de-titular.ts';

const CONTA = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';

function anonimizador(modulo: string, chamadas: string[], falha?: Error): AnonimizadorDeTitular {
  return {
    modulo,
    anonimizar: vi.fn((contaId: string) => {
      chamadas.push(`${modulo}:${contaId}`);
      return falha ? Promise.reject(falha) : Promise.resolve();
    }),
  };
}

describe('RegistroDeAnonimizadores', () => {
  it('registra por módulo e lista na ordem de registro', () => {
    const registro = new RegistroDeAnonimizadores();
    registro.registrar(anonimizador('identidade', []));
    registro.registrar(anonimizador('pedidos', []));
    expect(registro.modulos()).toEqual(['identidade', 'pedidos']);
  });

  it('recusa um segundo anonimizador do mesmo módulo', () => {
    const registro = new RegistroDeAnonimizadores();
    registro.registrar(anonimizador('identidade', []));
    expect(() => registro.registrar(anonimizador('identidade', []))).toThrow(/já registrou/);
    expect(registro.modulos()).toEqual(['identidade']);
  });

  it.each(['', 'Identidade', 'modulo com espaço', '1pedidos'])(
    'recusa nome de módulo inválido: "%s"',
    (modulo) => {
      expect(() => new RegistroDeAnonimizadores().registrar(anonimizador(modulo, []))).toThrow(
        /inválido/,
      );
    },
  );

  it('anonimiza o titular em todos os módulos, na ordem de registro', async () => {
    const chamadas: string[] = [];
    const registro = new RegistroDeAnonimizadores();
    registro.registrar(anonimizador('identidade', chamadas));
    registro.registrar(anonimizador('pedidos', chamadas));
    registro.registrar(anonimizador('avaliacoes', chamadas));
    await registro.anonimizarTitular(CONTA);
    expect(chamadas).toEqual([`identidade:${CONTA}`, `pedidos:${CONTA}`, `avaliacoes:${CONTA}`]);
  });

  it('para no primeiro que falha e diz qual módulo, sem a mensagem da causa', async () => {
    const chamadas: string[] = [];
    const causa = Object.assign(new Error('duplicate key (email)=(maria@exemplo.com.br)'), {
      code: 'P2002',
    });
    const registro = new RegistroDeAnonimizadores();
    registro.registrar(anonimizador('identidade', chamadas));
    registro.registrar(anonimizador('pedidos', chamadas, causa));
    registro.registrar(anonimizador('avaliacoes', chamadas));

    const erro: unknown = await registro.anonimizarTitular(CONTA).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(FalhaNaAnonimizacao);
    expect(erro).toMatchObject({ modulo: 'pedidos', tipoDaCausa: 'Error', codigoDaCausa: 'P2002' });
    expect((erro as Error).message).not.toContain('maria');
    expect(chamadas).toEqual([`identidade:${CONTA}`, `pedidos:${CONTA}`]);
  });

  it('uma nova tentativa depois da falha passa de novo por todos (anonimizadores idempotentes)', async () => {
    const chamadas: string[] = [];
    let falhar = true;
    const instavel: AnonimizadorDeTitular = {
      modulo: 'pedidos',
      anonimizar: () => {
        chamadas.push('pedidos');
        if (falhar) {
          falhar = false;
          return Promise.reject(new Error('fora do ar'));
        }
        return Promise.resolve();
      },
    };
    const registro = new RegistroDeAnonimizadores();
    registro.registrar(anonimizador('identidade', chamadas));
    registro.registrar(instavel);
    await expect(registro.anonimizarTitular(CONTA)).rejects.toBeInstanceOf(FalhaNaAnonimizacao);
    await registro.anonimizarTitular(CONTA);
    expect(chamadas).toEqual([`identidade:${CONTA}`, 'pedidos', `identidade:${CONTA}`, 'pedidos']);
  });

  it('recusa id de conta que não é UUID, sem chamar ninguém', async () => {
    const chamadas: string[] = [];
    const registro = new RegistroDeAnonimizadores();
    registro.registrar(anonimizador('identidade', chamadas));
    await expect(registro.anonimizarTitular('maria@exemplo.com.br')).rejects.toThrow(/UUID/);
    expect(chamadas).toEqual([]);
  });

  it('sem anonimizadores registrados, não faz nada', async () => {
    await expect(new RegistroDeAnonimizadores().anonimizarTitular(CONTA)).resolves.toBeUndefined();
  });
});
