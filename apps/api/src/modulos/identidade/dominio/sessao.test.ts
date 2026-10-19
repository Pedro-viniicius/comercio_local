// Sessão (CA-05, CA-07; S1, S8, S9, S16, S77): prazos por cliente, rotação,
// tolerância de 60 s ao token recém-trocado, reuso (inclusive de token antigo
// da família, pelo histórico), revogação, `mfa` herdado,
// `admin` só no painel com segundo fator e os estados que os CHECKs de
// `identidade.sessoes` recusam.
import { describe, expect, it } from 'vitest';
import { Conta } from './conta.ts';
import { Email } from './email.ts';
import {
  avaliarTokenJaUsado,
  type DadosDaSessao,
  DURACAO_MAXIMA_NO_PAINEL_EM_MS,
  INATIVIDADE_MAXIMA_NO_PAINEL_EM_MS,
  JANELA_DA_SESSAO_NOS_APPS_EM_MS,
  type NovaSessao,
  OperacaoInvalidaNaSessao,
  podeUsarOPainel,
  reivindicacoesDoToken,
  SEGUNDOS_DE_TOLERANCIA_DA_RENOVACAO,
  SEGUNDOS_DO_TOKEN_DE_ACESSO,
  Sessao,
  type TokenDeRenovacaoUsado,
} from './sessao.ts';
import { Telefone } from './telefone.ts';

const CONTA = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';
const SID = '0b8e1f2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const FAMILIA = '1c9f2a3b-4d5e-4f6a-9b0c-1d2e3f4a5b6c';
const AGORA = new Date('2026-10-17T12:00:00.000Z');
const MINUTO = 60 * 1000;
const TOLERANCIA = SEGUNDOS_DE_TOLERANCIA_DA_RENOVACAO * 1000;

function depois(ms: number): Date {
  return new Date(AGORA.getTime() + ms);
}

function novaSessao(extra: Partial<NovaSessao> = {}): Sessao {
  return Sessao.criar({
    id: SID,
    contaId: CONTA,
    cliente: 'app_consumidor',
    tokenHash: 'hash-1',
    mfa: false,
    agora: AGORA,
    ...extra,
  });
}

function conta(...perfis: ('lojista' | 'admin')[]): Conta {
  const nova = Conta.criar({
    id: CONTA,
    nome: 'Ana',
    email: Email.criar('ana@exemplo.com'),
    telefone: Telefone.criar('35999991234'),
    senhaHash: 'hash',
    agora: AGORA,
  });
  for (const perfil of perfis) {
    if (perfil === 'admin') nova.concederAdmin(AGORA);
    else nova.concederPerfil(perfil, AGORA);
  }
  return nova;
}

describe('Sessao.criar', () => {
  it('nos apps: 30 dias deslizantes, sem teto, família = a própria sessão', () => {
    expect(novaSessao().dados).toEqual({
      id: SID,
      contaId: CONTA,
      familiaId: SID,
      cliente: 'app_consumidor',
      tokenHash: 'hash-1',
      tokenAnteriorHash: null,
      parNovoCifrado: null,
      parNovoExpiraEm: null,
      trocadoEm: null,
      expiraEm: depois(JANELA_DA_SESSAO_NOS_APPS_EM_MS),
      expiraAbsolutoEm: null,
      ultimoUsoEm: AGORA,
      mfa: false,
      revogadaEm: null,
      motivoRevogacao: null,
      criadaEm: AGORA,
    } satisfies DadosDaSessao);
  });

  it('no painel: 30 min de inatividade e teto de 12 h (S9)', () => {
    const sessao = novaSessao({ cliente: 'painel', mfa: true });
    expect(sessao.dados.expiraEm).toEqual(depois(INATIVIDADE_MAXIMA_NO_PAINEL_EM_MS));
    expect(sessao.dados.expiraAbsolutoEm).toEqual(depois(DURACAO_MAXIMA_NO_PAINEL_EM_MS));
  });

  it('no painel, a substituta herda o teto da sessão anterior e não vive além dele (S101)', () => {
    const teto = depois(2 * MINUTO);
    const sessao = novaSessao({ cliente: 'painel', mfa: false, tetoHerdado: teto });
    expect(sessao.dados.expiraAbsolutoEm).toEqual(teto);
    expect(sessao.dados.expiraEm).toEqual(teto);
  });

  it('teto herdado depois das 12 h a partir de agora: fica o de agora', () => {
    const sessao = novaSessao({
      cliente: 'painel',
      tetoHerdado: depois(DURACAO_MAXIMA_NO_PAINEL_EM_MS + MINUTO),
    });
    expect(sessao.dados.expiraAbsolutoEm).toEqual(depois(DURACAO_MAXIMA_NO_PAINEL_EM_MS));
  });

  it('teto herdado nulo: o teto conta de agora, nos apps e no painel', () => {
    expect(novaSessao({ tetoHerdado: null }).dados.expiraAbsolutoEm).toBeNull();
    expect(novaSessao({ cliente: 'painel', tetoHerdado: null }).dados.expiraAbsolutoEm).toEqual(
      depois(DURACAO_MAXIMA_NO_PAINEL_EM_MS),
    );
  });

  it.each(['app_consumidor', 'app_lojista'] as const)(
    'teto herdado só existe no painel: recusa em %s',
    (cliente) => {
      expect(() => novaSessao({ cliente, tetoHerdado: depois(MINUTO) })).toThrow(
        OperacaoInvalidaNaSessao,
      );
    },
  );

  it('aceita a família de uma sessão anterior', () => {
    expect(novaSessao({ familiaId: FAMILIA }).familiaId).toBe(FAMILIA);
  });

  it.each(['app_consumidor', 'app_lojista'] as const)(
    'mfa só existe no painel: recusa em %s',
    (cliente) => {
      expect(() => novaSessao({ cliente, mfa: true })).toThrow(OperacaoInvalidaNaSessao);
    },
  );

  it('recusa hash de token vazio', () => {
    expect(() => novaSessao({ tokenHash: '' })).toThrow(OperacaoInvalidaNaSessao);
  });

  it('o token de acesso dura 15 min (ADR-012)', () => {
    expect(SEGUNDOS_DO_TOKEN_DE_ACESSO).toBe(900);
  });
});

describe('renovação rotativa (CA-05)', () => {
  it('token atual e sessão válida: rotacionar', () => {
    expect(novaSessao().avaliarRenovacao('hash-1', 'app_consumidor', depois(MINUTO))).toEqual({
      tipo: 'rotacionar',
    });
  });

  it('rotacionar troca o token, guarda o anterior e o par novo por 60 s e desliza o prazo', () => {
    const sessao = novaSessao();
    sessao.rotacionar('hash-2', 'par-cifrado', depois(MINUTO));
    expect(sessao.dados).toMatchObject({
      id: SID,
      tokenHash: 'hash-2',
      tokenAnteriorHash: 'hash-1',
      parNovoCifrado: 'par-cifrado',
      parNovoExpiraEm: depois(MINUTO + TOLERANCIA),
      trocadoEm: depois(MINUTO),
      ultimoUsoEm: depois(MINUTO),
      expiraEm: depois(MINUTO + JANELA_DA_SESSAO_NOS_APPS_EM_MS),
      criadaEm: AGORA,
    });
    expect(sessao.avaliarRenovacao('hash-2', 'app_consumidor', depois(2 * MINUTO))).toEqual({
      tipo: 'rotacionar',
    });
  });

  it('no painel, a renovação desliza 30 min, mas nunca passa do teto de 12 h', () => {
    const sessao = novaSessao({ cliente: 'painel', mfa: true });
    sessao.rotacionar('hash-2', 'par', depois(20 * MINUTO));
    expect(sessao.expiraEm).toEqual(depois(50 * MINUTO));
    // Uso contínuo: renova a cada 25 min até faltar menos de 30 min para o teto.
    let instante = 20 * MINUTO;
    let token = 2;
    while (instante + 25 * MINUTO < DURACAO_MAXIMA_NO_PAINEL_EM_MS - 10 * MINUTO) {
      instante += 25 * MINUTO;
      token += 1;
      sessao.rotacionar(`hash-${token}`, 'par', depois(instante));
    }
    sessao.rotacionar('hash-final', 'par', depois(DURACAO_MAXIMA_NO_PAINEL_EM_MS - 10 * MINUTO));
    expect(sessao.expiraEm).toEqual(depois(DURACAO_MAXIMA_NO_PAINEL_EM_MS));
    expect(sessao.estaAtiva(depois(DURACAO_MAXIMA_NO_PAINEL_EM_MS))).toBe(false);
  });

  it('a renovação herda o mfa da sessão (S1)', () => {
    const sessao = novaSessao({ cliente: 'painel', mfa: true });
    sessao.rotacionar('hash-2', 'par', depois(MINUTO));
    expect(sessao.mfa).toBe(true);
  });

  it('painel parado por 30 min vence (inatividade, S9)', () => {
    const sessao = novaSessao({ cliente: 'painel', mfa: true });
    const fim = depois(INATIVIDADE_MAXIMA_NO_PAINEL_EM_MS);
    expect(sessao.avaliarRenovacao('hash-1', 'painel', fim)).toEqual({ tipo: 'invalida' });
  });

  it('app sem renovar por 30 dias vence', () => {
    const sessao = novaSessao();
    const fim = depois(JANELA_DA_SESSAO_NOS_APPS_EM_MS);
    expect(sessao.estaAtiva(fim)).toBe(false);
    expect(sessao.avaliarRenovacao('hash-1', 'app_consumidor', fim)).toEqual({ tipo: 'invalida' });
  });

  it('token de outra sessão ou cliente trocado: invalida', () => {
    const sessao = novaSessao();
    expect(sessao.avaliarRenovacao('outro', 'app_consumidor', AGORA)).toEqual({ tipo: 'invalida' });
    expect(sessao.avaliarRenovacao('hash-1', 'painel', AGORA)).toEqual({ tipo: 'invalida' });
  });

  it('não rotaciona sessão vencida, nem com token igual ou par vazio', () => {
    const sessao = novaSessao();
    expect(() => sessao.rotacionar('hash-1', 'par', AGORA)).toThrow(OperacaoInvalidaNaSessao);
    expect(() => sessao.rotacionar('hash-2', '', AGORA)).toThrow(OperacaoInvalidaNaSessao);
    expect(() =>
      sessao.rotacionar('hash-2', 'par', depois(JANELA_DA_SESSAO_NOS_APPS_EM_MS)),
    ).toThrow(OperacaoInvalidaNaSessao);
    expect(sessao.dados.tokenHash).toBe('hash-1');
  });
});

describe('tolerância e reuso (S16)', () => {
  function rotacionada(): Sessao {
    const sessao = novaSessao();
    sessao.rotacionar('hash-2', 'par-cifrado', AGORA);
    return sessao;
  }

  it('token recém-trocado, dentro de 60 s e do mesmo cliente: devolve o par já emitido', () => {
    expect(
      rotacionada().avaliarRenovacao('hash-1', 'app_consumidor', depois(TOLERANCIA - 1)),
    ).toEqual({ tipo: 'tolerancia', parNovoCifrado: 'par-cifrado' });
  });

  it('token recém-trocado depois de 60 s: reuso', () => {
    expect(rotacionada().avaliarRenovacao('hash-1', 'app_consumidor', depois(TOLERANCIA))).toEqual({
      tipo: 'reuso',
    });
  });

  it('token recém-trocado apresentado por outro cliente, mesmo dentro de 60 s: reuso', () => {
    expect(rotacionada().avaliarRenovacao('hash-1', 'painel', depois(1000))).toEqual({
      tipo: 'reuso',
    });
  });

  it('reuso leva a revogar a família; a sessão revogada não renova mais', () => {
    const sessao = rotacionada();
    expect(sessao.avaliarRenovacao('hash-1', 'app_consumidor', depois(TOLERANCIA)).tipo).toBe(
      'reuso',
    );
    sessao.revogar('reuso_detectado', depois(TOLERANCIA));
    expect(sessao.avaliarRenovacao('hash-2', 'app_consumidor', depois(TOLERANCIA))).toEqual({
      tipo: 'invalida',
    });
    expect(sessao.avaliarRenovacao('hash-1', 'app_consumidor', depois(1000))).toEqual({
      tipo: 'invalida',
    });
  });

  it('avaliar não altera a sessão', () => {
    const sessao = rotacionada();
    const antes = sessao.dados;
    sessao.avaliarRenovacao('hash-1', 'app_consumidor', depois(1000));
    sessao.avaliarRenovacao('hash-1', 'app_consumidor', depois(TOLERANCIA));
    expect(sessao.dados).toEqual(antes);
  });
});

describe('histórico de tokens trocados e reuso de token antigo (S77)', () => {
  /**
   * O caminho da renovação na aplicação: a sessão pelo token atual ou anterior
   * imediato; senão, o histórico da família. `historico` faz o papel de
   * `tokens_de_renovacao_usados`.
   */
  function avaliar(
    sessao: Sessao,
    historico: readonly TokenDeRenovacaoUsado[],
    tokenHash: string,
    agora: Date,
  ) {
    const { tokenHash: atual, tokenAnteriorHash: anterior } = sessao.dados;
    if (tokenHash === atual || tokenHash === anterior) {
      return sessao.avaliarRenovacao(tokenHash, 'app_consumidor', agora);
    }
    return avaliarTokenJaUsado(historico.find((uso) => uso.tokenHash === tokenHash) ?? null);
  }

  /** T1→T2 em AGORA e T2→T3 dez segundos depois, guardando cada trocado. */
  function t1t2t3(): { sessao: Sessao; historico: TokenDeRenovacaoUsado[] } {
    const sessao = novaSessao({ familiaId: FAMILIA });
    const historico: TokenDeRenovacaoUsado[] = [];
    sessao.rotacionar('hash-2', 'par-2', AGORA);
    historico.push(sessao.ultimoTokenTrocado as TokenDeRenovacaoUsado);
    sessao.rotacionar('hash-3', 'par-3', depois(10_000));
    historico.push(sessao.ultimoTokenTrocado as TokenDeRenovacaoUsado);
    return { sessao, historico };
  }

  it('a sessão nova não tem token trocado; cada rotação expõe o trocado, com família, sessão e data', () => {
    const sessao = novaSessao({ familiaId: FAMILIA });
    expect(sessao.ultimoTokenTrocado).toBeNull();
    sessao.rotacionar('hash-2', 'par-2', depois(MINUTO));
    expect(sessao.ultimoTokenTrocado).toEqual({
      tokenHash: 'hash-1',
      familiaId: FAMILIA,
      sessaoId: SID,
      usadoEm: depois(MINUTO),
    });
  });

  it('T1→T2→T3: apresentar T1 é reuso mesmo dentro de 60 s; revogada a família, T3 dá 401', () => {
    const { sessao, historico } = t1t2t3();
    const agora = depois(20_000);
    expect(avaliar(sessao, historico, 'hash-1', agora)).toEqual({ tipo: 'reuso' });
    expect(historico.find((uso) => uso.tokenHash === 'hash-1')?.familiaId).toBe(FAMILIA);

    sessao.revogar('reuso_detectado', agora);
    expect(avaliar(sessao, historico, 'hash-3', agora)).toEqual({ tipo: 'invalida' });
  });

  it('T1→T2→T3: a tolerância de 60 s continua valendo para o anterior imediato (T2)', () => {
    const { sessao, historico } = t1t2t3();
    expect(avaliar(sessao, historico, 'hash-2', depois(10_000 + TOLERANCIA - 1))).toEqual({
      tipo: 'tolerancia',
      parNovoCifrado: 'par-3',
    });
    expect(avaliar(sessao, historico, 'hash-2', depois(10_000 + TOLERANCIA))).toEqual({
      tipo: 'reuso',
    });
    expect(avaliar(sessao, historico, 'hash-3', depois(20_000))).toEqual({ tipo: 'rotacionar' });
  });

  it('token que nunca foi usado nem é de sessão nenhuma: invalida', () => {
    expect(avaliarTokenJaUsado(null)).toEqual({ tipo: 'invalida' });
  });
});

describe('revogação (CA-05, S8)', () => {
  it('logout revoga com data e motivo e apaga o par novo', () => {
    const sessao = novaSessao();
    sessao.rotacionar('hash-2', 'par', AGORA);
    sessao.revogar('logout', depois(1000));
    expect(sessao.dados).toMatchObject({
      revogadaEm: depois(1000),
      motivoRevogacao: 'logout',
      parNovoCifrado: null,
      parNovoExpiraEm: null,
    });
    expect(sessao.estaAtiva(depois(1000))).toBe(false);
    expect(sessao.revogada).toBe(true);
  });

  it('a primeira revogação fica (idempotente)', () => {
    const sessao = novaSessao();
    sessao.revogar('senha_redefinida', depois(1000));
    sessao.revogar('logout', depois(2000));
    expect(sessao.motivoRevogacao).toBe('senha_redefinida');
    expect(sessao.dados.revogadaEm).toEqual(depois(1000));
  });
});

describe('claims do token (S1, CA-07)', () => {
  it('admin entra no token só no painel com mfa', () => {
    const admin = conta('admin');
    const painel = novaSessao({ cliente: 'painel', mfa: true });
    expect(reivindicacoesDoToken(admin, painel)).toEqual({
      contaId: CONTA,
      sid: SID,
      perfis: ['consumidor', 'admin'],
      mfa: true,
      emailVerificado: false,
    });
  });

  it.each([
    ['app_consumidor', false],
    ['app_lojista', false],
    ['painel', false],
  ] as const)('conta admin em %s sem mfa entra sem poderes de admin', (cliente, mfa) => {
    const sessao = novaSessao({ cliente, mfa });
    expect(reivindicacoesDoToken(conta('admin'), sessao).perfis).toEqual(['consumidor']);
  });

  it('a mesma conta tem os mesmos perfis nos dois apps (CA-07)', () => {
    const lojista = conta('lojista');
    for (const cliente of ['app_consumidor', 'app_lojista'] as const) {
      expect(reivindicacoesDoToken(lojista, novaSessao({ cliente })).perfis).toEqual([
        'consumidor',
        'lojista',
      ]);
    }
  });

  it('emailVerificado acompanha a conta (P1-dono)', () => {
    const verificada = conta();
    verificada.verificarEmail(AGORA);
    expect(reivindicacoesDoToken(verificada, novaSessao()).emailVerificado).toBe(true);
  });

  it('recusa montar o token com sessão de outra conta', () => {
    const outra = novaSessao({ contaId: '7a2e4d3b-2c3d-4e4f-9a01-23456789abcd' });
    expect(() => reivindicacoesDoToken(conta(), outra)).toThrow(OperacaoInvalidaNaSessao);
  });

  it('o painel só abre para conta admin (S23)', () => {
    expect(podeUsarOPainel(conta('admin'))).toBe(true);
    expect(podeUsarOPainel(conta('lojista'))).toBe(false);
  });
});

describe('estados recusados pelos CHECKs de identidade.sessoes', () => {
  const app = novaSessao().dados;
  const painel = novaSessao({ cliente: 'painel', mfa: true }).dados;

  it.each<[string, DadosDaSessao]>([
    ['mfa fora do painel', { ...app, mfa: true }],
    ['painel sem fim absoluto', { ...painel, expiraAbsolutoEm: null }],
    ['par novo sem prazo', { ...app, parNovoCifrado: 'par' }],
    ['prazo sem par novo', { ...app, parNovoExpiraEm: AGORA }],
    ['revogada sem motivo', { ...app, revogadaEm: AGORA }],
    ['token vazio', { ...app, tokenHash: '' }],
  ])('não remonta sessão com %s', (_caso, dados) => {
    expect(() => Sessao.reconstituir(dados)).toThrow(OperacaoInvalidaNaSessao);
  });

  it('remonta igual ao que foi gravado', () => {
    const sessao = novaSessao();
    sessao.rotacionar('hash-2', 'par', AGORA);
    expect(Sessao.reconstituir(sessao.dados).dados).toEqual(sessao.dados);
  });
});
