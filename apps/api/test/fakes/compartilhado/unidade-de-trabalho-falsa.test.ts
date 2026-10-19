// A `UnidadeDeTrabalhoFalsa` imita a real no que os casos de uso sentem: unidade aninhada
// participa da externa, a que falha desfaz só o que gravou (em ordem inversa) e a trava
// (`FOR UPDATE`) faz a segunda unidade esperar a primeira terminar (R1, Q17).
import { describe, expect, it } from 'vitest';
import { ForaDaUnidadeDeTrabalho, UnidadeDeTrabalhoFalsa } from './unidade-de-trabalho-falsa.ts';

const proximaVolta = () => new Promise<void>((resolver) => setImmediate(resolver));

describe('UnidadeDeTrabalhoFalsa', () => {
  it('unidade aninhada participa da externa: a falha da externa desfaz o que a interna gravou', async () => {
    const unidade = new UnidadeDeTrabalhoFalsa();
    const gravados: string[] = [];
    const gravar = (valor: string) => {
      gravados.push(valor);
      unidade.registrarDesfazer(() => gravados.splice(gravados.indexOf(valor), 1));
    };
    const falha = unidade.executar(async () => {
      gravar('externa');
      await unidade.executar(() => {
        gravar('interna');
        return Promise.resolve();
      });
      throw new Error('falha da externa');
    });
    await expect(falha).rejects.toThrow('falha da externa');
    expect(gravados).toEqual([]);
    expect(unidade.execucoes).toBe(1);
  });

  it('desfaz na ordem inversa e, fora de uma unidade, não registra nada (autocommit)', async () => {
    const unidade = new UnidadeDeTrabalhoFalsa();
    const ordem: number[] = [];
    unidade.registrarDesfazer(() => ordem.push(0));
    await expect(
      unidade.executar(() => {
        unidade.registrarDesfazer(() => ordem.push(1));
        unidade.registrarDesfazer(() => ordem.push(2));
        return Promise.reject(new Error('falha'));
      }),
    ).rejects.toThrow('falha');
    expect(ordem).toEqual([2, 1]);
    expect(unidade.emTransacao).toBe(false);
  });

  it('travar fora de uma unidade rejeita', async () => {
    const unidade = new UnidadeDeTrabalhoFalsa();
    await expect(unidade.travar('linha')).rejects.toThrow(ForaDaUnidadeDeTrabalho);
    expect(() => unidade.exigirTransacao('Gravação')).toThrow(ForaDaUnidadeDeTrabalho);
  });

  it('a segunda unidade que trava a mesma chave espera a primeira terminar; a mesma unidade não espera', async () => {
    const unidade = new UnidadeDeTrabalhoFalsa();
    const eventos: string[] = [];
    const primeira = unidade.executar(async () => {
      await unidade.travar('linha');
      await unidade.travar('linha');
      eventos.push('primeira travou');
      await proximaVolta();
      await proximaVolta();
      eventos.push('primeira terminou');
    });
    const segunda = unidade.executar(async () => {
      await proximaVolta();
      await unidade.travar('linha');
      eventos.push('segunda travou');
    });
    await Promise.all([primeira, segunda]);
    expect(eventos).toEqual(['primeira travou', 'primeira terminou', 'segunda travou']);
  });

  it('a trava acaba também quando a unidade falha, e chaves diferentes não se esperam', async () => {
    const unidade = new UnidadeDeTrabalhoFalsa();
    const eventos: string[] = [];
    const falha = unidade.executar(async () => {
      await unidade.travar('a');
      await proximaVolta();
      throw new Error('falha');
    });
    const outraChave = unidade.executar(async () => {
      await unidade.travar('b');
      eventos.push('b');
    });
    const mesmaChave = unidade.executar(async () => {
      await proximaVolta();
      await unidade.travar('a');
      eventos.push('a depois da falha');
    });
    const resultados = await Promise.allSettled([falha, outraChave, mesmaChave]);
    expect(resultados.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
    expect(eventos).toEqual(['b', 'a depois da falha']);
  });
});
