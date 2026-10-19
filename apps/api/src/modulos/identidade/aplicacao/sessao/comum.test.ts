// Chave do freio por origem do login (CA-04, S14): sem IP válido, todas as
// requisições dividem um freio só (falha fechada). A chave por e-mail e o hash
// do token estão em `aplicacao/comum/chaves.test.ts`.
import { describe, expect, it } from 'vitest';
import { CifradorFalso } from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { chaveDoFreioPorOrigem, ORIGEM_DESCONHECIDA } from './comum.ts';

const cifrador = new CifradorFalso();

describe('chaveDoFreioPorOrigem', () => {
  const desconhecida = cifrador.hmac('bloqueio_ip', [ORIGEM_DESCONHECIDA]);

  it.each([[''], ['x'], ['   '], ['999.1.1.1'], [null], [undefined]])(
    'IP ausente ou inválido (%j) usa a chave fixa da origem desconhecida (falha fechada)',
    (ip) => {
      expect(chaveDoFreioPorOrigem(cifrador, ip)).toBe(desconhecida);
    },
  );

  it('IP válido tem a sua chave, diferente da origem desconhecida', () => {
    const chave = chaveDoFreioPorOrigem(cifrador, '203.0.113.5');
    expect(chave).toBe(cifrador.hmac('bloqueio_ip', ['ipv4:203.0.113.5']));
    expect(chave).not.toBe(desconhecida);
    expect(chave).not.toBe(chaveDoFreioPorOrigem(cifrador, '203.0.113.6'));
  });

  it('IPv6 do mesmo /64 dá a mesma chave; IPv4 mapeado conta como o IPv4 (S14)', () => {
    expect(chaveDoFreioPorOrigem(cifrador, '2001:db8:0:1::1')).toBe(
      chaveDoFreioPorOrigem(cifrador, '2001:db8:0:1:ffff:ffff:ffff:ffff'),
    );
    expect(chaveDoFreioPorOrigem(cifrador, '2001:db8:0:1::1')).not.toBe(
      chaveDoFreioPorOrigem(cifrador, '2001:db8:0:2::1'),
    );
    expect(chaveDoFreioPorOrigem(cifrador, '::ffff:203.0.113.5')).toBe(
      chaveDoFreioPorOrigem(cifrador, '203.0.113.5'),
    );
  });
});
