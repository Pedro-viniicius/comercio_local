// Freio de tentativas (CA-04, S1, S14): limiares por e-mail, IP e segundo
// fator, esperas de 1, 5 e 15 min, zerar por sucesso conforme o tipo e chave
// de origem com IPv6 agrupado por /64.
import { describe, expect, it } from 'vitest';
import {
  BloqueioDeLogin,
  type DadosDoBloqueioDeLogin,
  LIMIAR_DE_FALHAS,
  maiorEspera,
  type TipoDeBloqueio,
  valorDaChaveDeOrigem,
} from './bloqueio-de-login.ts';

const AGORA = new Date('2026-10-17T12:00:00.000Z');
const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;

function depois(ms: number): Date {
  return new Date(AGORA.getTime() + ms);
}

function falhar(bloqueio: BloqueioDeLogin, vezes: number, inicio: number, passo = SEGUNDO): number {
  let instante = inicio;
  for (let i = 0; i < vezes; i += 1) {
    bloqueio.registrarFalha(depois(instante));
    instante += passo;
  }
  return instante - passo;
}

describe('BloqueioDeLogin: por e-mail (CA-04)', () => {
  it('quatro falhas não freiam; a quinta em 15 min freia por 1 min', () => {
    const bloqueio = BloqueioDeLogin.novo('chave', 'email', AGORA);
    falhar(bloqueio, 4, 0);
    expect(bloqueio.estaBloqueado(depois(4 * SEGUNDO))).toBe(false);
    bloqueio.registrarFalha(depois(10 * MINUTO));
    expect(bloqueio.estaBloqueado(depois(10 * MINUTO))).toBe(true);
    expect(bloqueio.segundosDeEspera(depois(10 * MINUTO))).toBe(60);
    expect(bloqueio.estaBloqueado(depois(11 * MINUTO))).toBe(false);
  });

  it('cinco falhas espalhadas por mais de 15 min não freiam', () => {
    const bloqueio = BloqueioDeLogin.novo('chave', 'email', AGORA);
    falhar(bloqueio, 5, 0, 4 * MINUTO);
    expect(bloqueio.estaBloqueado(depois(16 * MINUTO))).toBe(false);
  });

  it('a espera cresce 1, 5, 15 min e fica em 15 min, nunca definitiva', () => {
    const bloqueio = BloqueioDeLogin.novo('chave', 'email', AGORA);
    let instante = falhar(bloqueio, 5, 0);
    expect(bloqueio.segundosDeEspera(depois(instante))).toBe(60);
    for (const esperaEsperada of [5 * 60, 15 * 60, 15 * 60]) {
      instante += bloqueio.segundosDeEspera(depois(instante)) * SEGUNDO;
      instante = falhar(bloqueio, 5, instante);
      expect(bloqueio.segundosDeEspera(depois(instante))).toBe(esperaEsperada);
    }
    expect(bloqueio.nivel).toBe(3);
  });

  it('falha durante a espera não conta nem estende a espera', () => {
    const bloqueio = BloqueioDeLogin.novo('chave', 'email', AGORA);
    const instante = falhar(bloqueio, 5, 0);
    const antes = bloqueio.dados;
    falhar(bloqueio, 10, instante + SEGUNDO);
    expect(bloqueio.dados).toEqual(antes);
  });

  it('o nível volta a zero depois de 15 min sem espera', () => {
    const bloqueio = BloqueioDeLogin.novo('chave', 'email', AGORA);
    falhar(bloqueio, 5, 0);
    expect(bloqueio.nivel).toBe(1);
    const fimDaEspera = 4 * SEGUNDO + MINUTO;
    falhar(bloqueio, 5, fimDaEspera + 15 * MINUTO);
    expect(bloqueio.nivel).toBe(1);
    expect(bloqueio.segundosDeEspera(depois(fimDaEspera + 15 * MINUTO + 4 * SEGUNDO))).toBe(60);
  });

  it('a senha certa zera o freio por e-mail', () => {
    const bloqueio = BloqueioDeLogin.novo('chave', 'email', AGORA);
    falhar(bloqueio, 4, 0);
    bloqueio.registrarSucesso('senha');
    expect(bloqueio.estaZerado).toBe(true);
    falhar(bloqueio, 4, 10 * SEGUNDO);
    expect(bloqueio.estaBloqueado(depois(14 * SEGUNDO))).toBe(false);
  });
});

describe('BloqueioDeLogin: por IP e por segundo fator (S14, S1)', () => {
  it('por IP, o limiar é 50 em 15 min', () => {
    const bloqueio = BloqueioDeLogin.novo('chave', 'ip', AGORA);
    falhar(bloqueio, 49, 0, 100);
    expect(bloqueio.estaBloqueado(depois(4900))).toBe(false);
    bloqueio.registrarFalha(depois(5000));
    expect(bloqueio.segundosDeEspera(depois(5000))).toBe(60);
  });

  it('o freio por IP não zera com sucesso (uma conta própria não limpa a origem)', () => {
    const bloqueio = BloqueioDeLogin.novo('chave', 'ip', AGORA);
    falhar(bloqueio, 10, 0);
    const antes = bloqueio.dados;
    bloqueio.registrarSucesso('senha');
    bloqueio.registrarSucesso('segundo_fator');
    expect(bloqueio.dados).toEqual(antes);
  });

  it('o de segundo fator não zera com a senha certa, só com o segundo fator concluído', () => {
    const bloqueio = BloqueioDeLogin.novo('chave', 'segundo_fator', AGORA);
    falhar(bloqueio, 4, 0);
    bloqueio.registrarSucesso('senha');
    bloqueio.registrarFalha(depois(5 * SEGUNDO));
    expect(bloqueio.estaBloqueado(depois(5 * SEGUNDO))).toBe(true);
    bloqueio.registrarSucesso('segundo_fator');
    expect(bloqueio.estaZerado).toBe(true);
  });

  it.each(Object.entries(LIMIAR_DE_FALHAS))('limiar de %s: %i', (tipo, limiar) => {
    expect({ email: 5, ip: 50, segundo_fator: 5 }[tipo as TipoDeBloqueio]).toBe(limiar);
  });

  it('a maior espera entre os freios consultados vai para o Retry-After', () => {
    const email = BloqueioDeLogin.novo('a', 'email', AGORA);
    const ip = BloqueioDeLogin.novo('b', 'ip', AGORA);
    expect(maiorEspera([email, ip], AGORA)).toBe(0);
    falhar(email, 5, 0);
    expect(maiorEspera([email, ip], depois(34 * SEGUNDO))).toBe(30);
  });
});

describe('BloqueioDeLogin: estorno da falha reservada (S91)', () => {
  it('a falha reservada sai no sucesso: 10 falhas, uma reserva e o estorno deixam 10', () => {
    const bloqueio = BloqueioDeLogin.novo('chave', 'ip', AGORA);
    falhar(bloqueio, 10, 0);
    const antes = bloqueio.dados;
    bloqueio.registrarFalha(depois(20 * SEGUNDO));
    expect(bloqueio.dados.falhas).toBe(11);
    bloqueio.estornarFalha(depois(20 * SEGUNDO));
    expect(bloqueio.dados).toEqual(antes);
  });

  it('a reserva que abriu a janela, estornada, deixa o freio sem falha', () => {
    const bloqueio = BloqueioDeLogin.novo('chave', 'ip', AGORA);
    bloqueio.registrarFalha(AGORA);
    bloqueio.estornarFalha(AGORA);
    expect(bloqueio.dados.falhas).toBe(0);
    expect(bloqueio.estaZerado).toBe(true);
  });

  it('sem falha contada, o estorno não deixa a contagem negativa', () => {
    const bloqueio = BloqueioDeLogin.novo('chave', 'ip', AGORA);
    bloqueio.estornarFalha(AGORA);
    expect(bloqueio.dados.falhas).toBe(0);
  });

  it('a janela recomeçou depois da reserva: a falha dela não conta mais e nada sai', () => {
    const bloqueio = BloqueioDeLogin.novo('chave', 'ip', AGORA);
    bloqueio.registrarFalha(AGORA);
    // Outra requisição falhou 16 min depois e abriu uma janela nova.
    bloqueio.registrarFalha(depois(16 * MINUTO));
    bloqueio.estornarFalha(AGORA);
    expect(bloqueio.dados.falhas).toBe(1);
  });

  it('a reserva que acionou a espera não é desfeita: a espera fica (falha fechada)', () => {
    const bloqueio = BloqueioDeLogin.novo('chave', 'ip', AGORA);
    falhar(bloqueio, 50, 0, 100);
    expect(bloqueio.estaBloqueado(depois(4_900))).toBe(true);
    const antes = bloqueio.dados;
    bloqueio.estornarFalha(depois(4_900));
    expect(bloqueio.dados).toEqual(antes);
  });
});

describe('estados recusados pelos CHECKs de identidade.bloqueios_login', () => {
  const base: DadosDoBloqueioDeLogin = BloqueioDeLogin.novo('chave', 'email', AGORA).dados;

  it('janela_inicio sempre preenchida, inclusive no freio novo e depois de zerar', () => {
    const bloqueio = BloqueioDeLogin.novo('chave', 'email', AGORA);
    expect(bloqueio.dados.janelaInicio).toEqual(AGORA);
    falhar(bloqueio, 5, 0);
    expect(bloqueio.dados.janelaInicio).toBeInstanceOf(Date);
    bloqueio.registrarSucesso('senha');
    expect(bloqueio.dados.janelaInicio).toBeInstanceOf(Date);
  });

  it.each<[string, Partial<DadosDoBloqueioDeLogin>]>([
    ['falhas negativas', { falhas: -1 }],
    ['nível negativo', { nivel: -1 }],
    ['falhas fracionárias', { falhas: 1.5 }],
    ['chave vazia', { chaveHmac: '' }],
  ])('não remonta freio com %s', (_caso, extra) => {
    expect(() => BloqueioDeLogin.reconstituir({ ...base, ...extra })).toThrow();
  });
});

describe('valorDaChaveDeOrigem (S14)', () => {
  it.each([
    ['203.0.113.5', 'ipv4:203.0.113.5'],
    [' 203.0.113.5 ', 'ipv4:203.0.113.5'],
    ['::ffff:203.0.113.5', 'ipv4:203.0.113.5'],
    ['::FFFF:cb00:7105', 'ipv4:203.0.113.5'],
    ['2001:db8:0:1::5', 'ipv6:2001:db8:0:1::/64'],
    ['2001:0DB8:0000:0001:aaaa:bbbb:cccc:dddd', 'ipv6:2001:db8:0:1::/64'],
    ['2001:db8::1', 'ipv6:2001:db8:0:0::/64'],
    ['fe80::1%eth0', 'ipv6:fe80:0:0:0::/64'],
    ['::1', 'ipv6:0:0:0:0::/64'],
    ['64:ff9b::203.0.113.5', 'ipv6:64:ff9b:0:0::/64'],
  ])('%s → %s', (ip, chave) => {
    expect(valorDaChaveDeOrigem(ip)).toBe(chave);
  });

  it('todo o bloco /64 vira a mesma chave', () => {
    expect(valorDaChaveDeOrigem('2001:db8:0:1:1::1')).toBe(
      valorDaChaveDeOrigem('2001:db8:0:1:ffff:ffff:ffff:ffff'),
    );
    expect(valorDaChaveDeOrigem('2001:db8:0:1::1')).not.toBe(
      valorDaChaveDeOrigem('2001:db8:0:2::1'),
    );
  });

  it.each([
    '',
    'localhost',
    '256.0.0.1',
    '01.2.3.4',
    '1.2.3',
    '1::2::3',
    '1:2:3:4:5:6:7:8:9',
    '1:2:3:4:5:6:7',
    '12345::1',
    '1.2.3.4::1',
    ':1::',
    '2001:db8::g',
  ])('recusa "%s"', (ip) => {
    expect(valorDaChaveDeOrigem(ip)).toBeNull();
  });
});
