// Entrada da CLI de reconfiguração do 2FA (S99): a conta pelo id ou o e-mail
// pela entrada padrão, nunca por argumento, e o operador obrigatório.
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { lerArgumentos, lerEmailDaEntrada } from './entrada-da-reconfiguracao.ts';

const CONTA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OPERADOR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('lerArgumentos', () => {
  it('--conta e --operador: a conta pelo id', () => {
    expect(lerArgumentos(['--conta', CONTA, '--operador', OPERADOR])).toEqual({
      contaId: CONTA,
      operadorId: OPERADOR,
    });
  });

  it('só --operador: o e-mail vem da entrada padrão', () => {
    expect(lerArgumentos(['--operador', OPERADOR])).toEqual({
      contaId: null,
      operadorId: OPERADOR,
    });
  });

  it.each([
    [[]],
    [['--conta', CONTA]],
    [['--operador']],
    [['--operador', '  ']],
    [['--operador', OPERADOR, '--conta', '']],
    [['--operador', OPERADOR, '--email', 'ana@exemplo.com']],
    [['--operador', OPERADOR, 'ana@exemplo.com']],
  ])('recusa %j (sem operador, e-mail por argumento ou argumento a mais)', (argumentos) => {
    expect(lerArgumentos(argumentos)).toBeNull();
  });
});

describe('lerEmailDaEntrada', () => {
  it('lê a primeira linha, sem espaços nas pontas', async () => {
    await expect(
      lerEmailDaEntrada(Readable.from([' ana@exemplo.com \r\n', 'resto\n'])),
    ).resolves.toBe('ana@exemplo.com');
  });

  it('aceita a linha sem quebra no fim (pipe de printf)', async () => {
    await expect(lerEmailDaEntrada(Readable.from(['ana@', 'exemplo.com']))).resolves.toBe(
      'ana@exemplo.com',
    );
  });

  it.each([[[]], [['\n']], [['   \n']], [['x'.repeat(400)]]])(
    'entrada vazia, em branco ou longa demais: null (%#)',
    async (pedacos) => {
      await expect(lerEmailDaEntrada(Readable.from(pedacos))).resolves.toBeNull();
    },
  );
});
