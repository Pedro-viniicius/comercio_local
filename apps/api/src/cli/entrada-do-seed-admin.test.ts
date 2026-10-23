// Entrada da CLI `seed:admin` (CA-07; plano 01b, etapa 13; S106, S108): o único
// argumento é `--operador`; o e-mail (duas vezes), o nome e o telefone vêm da
// entrada padrão, uma linha cada, e são conferidos antes de qualquer conexão.
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  lerArgumentosDoSeedAdmin,
  lerDadosDoSeedAdmin,
  PERGUNTAS_DO_SEED_ADMIN,
} from './entrada-do-seed-admin.ts';

const OPERADOR = 'a1a1a1a1-0000-4000-8000-000000000001';

/** A entrada padrão com as linhas dadas, como o pipe entrega. */
function entrada(...linhas: string[]): Readable {
  return Readable.from([linhas.map((linha) => `${linha}\n`).join('')]);
}

describe('lerArgumentosDoSeedAdmin', () => {
  it('sem argumentos: o primeiro admin, sem operador', () => {
    expect(lerArgumentosDoSeedAdmin([])).toEqual({ tipo: 'argumentos', operadorId: null });
  });

  it('--operador: o id de quem roda', () => {
    expect(lerArgumentosDoSeedAdmin(['--operador', ` ${OPERADOR} `])).toEqual({
      tipo: 'argumentos',
      operadorId: OPERADOR,
    });
  });

  it.each([
    [['--operador', '  ']],
    [['--nome', 'Ana']],
    [['--telefone', '35999991234']],
    [['--email', 'ana@exemplo.com']],
    [['--operador', OPERADOR, 'ana@exemplo.com']],
  ])('%j: uso (nenhum dado pessoal vem por argumento)', (argumentos) => {
    expect(lerArgumentosDoSeedAdmin(argumentos)).toEqual({ tipo: 'uso' });
  });
});

describe('lerDadosDoSeedAdmin', () => {
  it('e-mail duas vezes, nome e telefone: o telefone sai em E.164', async () => {
    await expect(
      lerDadosDoSeedAdmin(
        entrada(' Ana@Exemplo.com ', 'ana@exemplo.com', ' Ana Admin ', '(35) 99999-1234'),
      ),
    ).resolves.toEqual({
      tipo: 'dados',
      email: 'Ana@Exemplo.com',
      nome: 'Ana Admin',
      telefone: '+5535999991234',
    });
  });

  it('aceita o fim de linha do Windows (\\r\\n)', async () => {
    const comCr = Readable.from(['ana@exemplo.com\r\nana@exemplo.com\r\nAna\r\n35999991234\r\n']);
    await expect(lerDadosDoSeedAdmin(comCr)).resolves.toMatchObject({ tipo: 'dados', nome: 'Ana' });
  });

  it('e-mails diferentes: emails_diferentes, sem trazer nenhum dos dois', async () => {
    const resultado = await lerDadosDoSeedAdmin(
      entrada('ana@exemplo.com', 'ana@exemplo.com.br', 'Ana', '35999991234'),
    );
    expect(resultado).toEqual({ tipo: 'emails_diferentes' });
  });

  it.each([['123'], ['(35) 3531-1234'], ['+1 202 555 0101'], ['(00) 99999-1234']])(
    'telefone %s: telefone_invalido, sem tentar criar nada',
    async (telefone) => {
      await expect(
        lerDadosDoSeedAdmin(entrada('ana@exemplo.com', 'ana@exemplo.com', 'Ana', telefone)),
      ).resolves.toEqual({ tipo: 'telefone_invalido' });
    },
  );

  it.each([
    ['nenhuma linha', []],
    ['só o e-mail', ['ana@exemplo.com']],
    ['sem o telefone', ['ana@exemplo.com', 'ana@exemplo.com', 'Ana']],
    ['nome vazio', ['ana@exemplo.com', 'ana@exemplo.com', '   ', '35999991234']],
    ['linha longa demais', ['a'.repeat(321), 'a'.repeat(321), 'Ana', '35999991234']],
  ])('%s: entrada_incompleta', async (_caso, linhas) => {
    await expect(lerDadosDoSeedAdmin(entrada(...linhas))).resolves.toEqual({
      tipo: 'entrada_incompleta',
    });
  });

  it('no terminal, pergunta cada linha antes de ler', async () => {
    const perguntas: string[] = [];
    await lerDadosDoSeedAdmin(
      entrada('ana@exemplo.com', 'ana@exemplo.com', 'Ana', '35999991234'),
      (texto) => perguntas.push(texto),
    );
    expect(perguntas).toEqual([...PERGUNTAS_DO_SEED_ADMIN]);
  });
});
