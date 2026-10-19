// Argon2id com NFKC dentro do adaptador (P2, S75): a mesma senha em formas
// Unicode equivalentes confere, nos três métodos, inclusive no hash fictício.
import * as argon2 from '@node-rs/argon2';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Argon2Hasher, HASH_FICTICIO, OPCOES_DO_ARGON2 } from './argon2.hasher.ts';

// Repassa ao pacote real e grava o que o adaptador mandou, para conferir que a
// senha chega normalizada também no hash fictício.
vi.mock('@node-rs/argon2', async (importOriginal) => {
  const original = await importOriginal<typeof import('@node-rs/argon2')>();
  return { ...original, hash: vi.fn(original.hash), verify: vi.fn(original.verify) };
});

const hasher = new Argon2Hasher();

const CAFE_NFC = 'café com pão';
const CAFE_NFD = 'café com pão';

beforeEach(() => {
  vi.mocked(argon2.hash).mockClear();
  vi.mocked(argon2.verify).mockClear();
});

describe('Argon2Hasher', () => {
  it('gera Argon2id com 19 MiB, t=2 e p=1, e confere a senha certa', async () => {
    const guardado = await hasher.gerarHash('senha-do-teste-1');
    expect(guardado).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(argon2.parseOptions(guardado)).toMatchObject({
      algorithm: OPCOES_DO_ARGON2.algorithm,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    await expect(hasher.verificar('senha-do-teste-1', guardado)).resolves.toBe(true);
    await expect(hasher.verificar('senha-do-teste-2', guardado)).resolves.toBe(false);
  });

  it('usa sal novo a cada hash', async () => {
    const [a, b] = await Promise.all([
      hasher.gerarHash('mesma-senha-1'),
      hasher.gerarHash('mesma-senha-1'),
    ]);
    expect(a).not.toBe(b);
  });

  it('"café" em NFC e em NFD dão a mesma senha, nos dois sentidos', async () => {
    expect(CAFE_NFC).not.toBe(CAFE_NFD);
    const deNfc = await hasher.gerarHash(CAFE_NFC);
    const deNfd = await hasher.gerarHash(CAFE_NFD);
    await expect(hasher.verificar(CAFE_NFD, deNfc)).resolves.toBe(true);
    await expect(hasher.verificar(CAFE_NFC, deNfd)).resolves.toBe(true);
  });

  it('letras de largura cheia conferem com o hash da forma comum, e o contrário', async () => {
    const larguraCheia = 'ｓｅｎｈａ-123'; // ｓｅｎｈａ-123
    const comum = await hasher.gerarHash('senha-123');
    const cheia = await hasher.gerarHash(larguraCheia);
    await expect(hasher.verificar(larguraCheia, comum)).resolves.toBe(true);
    await expect(hasher.verificar('senha-123', cheia)).resolves.toBe(true);
  });

  it('senha de 128 pontos de código que a NFKC expande (U+FDFA) gera e confere hash', async () => {
    const senha = 'ﷺ'.repeat(128);
    expect([...senha]).toHaveLength(128);
    expect(senha.normalize('NFKC').length).toBeGreaterThan(2000);
    const guardado = await hasher.gerarHash(senha);
    await expect(hasher.verificar(senha, guardado)).resolves.toBe(true);
    await expect(hasher.verificar('ﷺ'.repeat(127), guardado)).resolves.toBe(false);
  });

  it('manda ao Argon2 a senha em NFKC nos três métodos, inclusive no hash fictício', async () => {
    const guardado = await hasher.gerarHash(CAFE_NFD);
    await hasher.verificar(CAFE_NFD, guardado);
    await hasher.simularVerificacao(CAFE_NFD);
    const esperada = CAFE_NFD.normalize('NFKC');
    expect(vi.mocked(argon2.hash).mock.calls.map(([senha]) => senha)).toEqual([esperada]);
    expect(vi.mocked(argon2.verify).mock.calls).toEqual([
      [guardado, esperada],
      [HASH_FICTICIO, esperada],
    ]);
  });

  it.each([
    ['vazio', ''],
    ['texto qualquer', 'nao-e-hash'],
    ['PHC com sal e hash inválidos', '$argon2id$v=19$m=19456,t=2,p=1$abc$def'],
    ['PHC com parâmetro fora do limite', '$argon2id$v=19$m=1,t=1,p=1$c2FsdHNhbHRzYWx0$aGFzaA'],
  ])('hash mal formado (%s) dá false, não erro', async (_caso, guardado) => {
    await expect(hasher.verificar('qualquer-senha', guardado)).resolves.toBe(false);
  });

  it('o hash fictício tem os mesmos parâmetros do hash de verdade', async () => {
    const real = argon2.parseOptions(await hasher.gerarHash('senha-do-teste-1'));
    expect(argon2.parseOptions(HASH_FICTICIO)).toEqual(real);
  });

  it('simularVerificacao termina sem erro e sem valor, para qualquer senha', async () => {
    await expect(hasher.simularVerificacao('qualquer-senha')).resolves.toBeUndefined();
    await expect(hasher.simularVerificacao('')).resolves.toBeUndefined();
  });
});
