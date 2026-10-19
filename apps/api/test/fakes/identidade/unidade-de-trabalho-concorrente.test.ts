// A `UnidadeDeTrabalhoFalsa` precisa se comportar como a real (`UnidadeDeTrabalhoPrisma`,
// AsyncLocalStorage): duas execuções concorrentes são duas transações independentes.
// Os casos de uso das etapas 8 a 11 dependem disso para testar a corrida do cadastro com o
// mesmo e-mail (`EmailJaCadastrado`) e as renovações simultâneas.
import { describe, expect, it } from 'vitest';
import { RelogioFixo } from '../../../src/compartilhado/tempo/relogio.ts';
import { eventoDeIdentidade } from '../../../src/modulos/identidade/aplicacao/eventos.ts';
import { Conta } from '../../../src/modulos/identidade/dominio/conta.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import { Telefone } from '../../../src/modulos/identidade/dominio/telefone.ts';
import { criarIdentidadeEmMemoria } from './repositorios-em-memoria.ts';

const relogio = new RelogioFixo(new Date('2026-10-17T12:00:00.000Z'));
const ID_A = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';
const ID_B = '7a2e4d3b-2c3d-4e4f-9a01-23456789abcd';

const proximaVolta = () => new Promise<void>((resolver) => setImmediate(resolver));

function conta(id: string, email: string): Conta {
  return Conta.criar({
    id,
    nome: 'Ana',
    email: Email.criar(email),
    telefone: Telefone.criar('35999991234'),
    senhaHash: 'hash',
    agora: relogio.agora(),
  });
}

describe('UnidadeDeTrabalhoFalsa com execuções concorrentes', () => {
  it('duas unidades abertas ao mesmo tempo publicam os dois eventos, sem confundir "estou em transação"', async () => {
    const identidade = criarIdentidadeEmMemoria();
    const primeira = identidade.unidade.executar(async () => {
      await proximaVolta();
      await identidade.publicador.publicar(eventoDeIdentidade('ContaCriada', { contaId: ID_A }));
    });
    const segunda = identidade.unidade.executar(async () => {
      await proximaVolta();
      await proximaVolta();
      await proximaVolta();
      await identidade.publicador.publicar(eventoDeIdentidade('ContaCriada', { contaId: ID_B }));
    });

    await expect(Promise.all([primeira, segunda])).resolves.toBeDefined();

    expect(identidade.publicador.publicados.map((evento) => evento.agregadoId).sort()).toEqual(
      [ID_A, ID_B].sort(),
    );
  });

  it('a unidade que falha desfaz só o que ela gravou; a que termina bem mantém o seu', async () => {
    const identidade = criarIdentidadeEmMemoria();
    const quemFica = identidade.unidade.executar(async () => {
      await identidade.contas.inserir(conta(ID_A, 'ana@exemplo.com'));
      await proximaVolta();
      await proximaVolta();
      await proximaVolta();
    });
    const quemFalha = identidade.unidade.executar(async () => {
      await proximaVolta();
      await identidade.contas.inserir(conta(ID_B, 'bia@exemplo.com'));
      throw new Error('falha depois de gravar');
    });

    const [resultadoA, resultadoB] = await Promise.allSettled([quemFica, quemFalha]);

    expect(resultadoA.status).toBe('fulfilled');
    expect(resultadoB.status).toBe('rejected');
    expect(identidade.contas.todas().map((c) => c.id)).toEqual([ID_A]);
  });
});
