// Bordas do domínio de Identidade (01b, etapa 4) que os testes de cada entidade
// não cobrem: fronteiras exatas dos prazos com os valores do plano escritos por
// extenso (e não pelas constantes do código), propriedades sobre sequências
// aleatórias com semente fixa e a garantia de que nenhuma entidade expõe dado
// pessoal ou segredo ao ser serializada ou inspecionada (CA-12).
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { BloqueioDeLogin, LIMIAR_DE_FALHAS } from './bloqueio-de-login.ts';
import { CodigoDeVerificacao } from './codigo-de-verificacao.ts';
import { Conta } from './conta.ts';
import { DesafioDeSegundoFator } from './desafio-de-segundo-fator.ts';
import { Email } from './email.ts';
import { Sessao } from './sessao.ts';
import { Telefone } from './telefone.ts';

const AGORA = new Date('2026-10-17T12:00:00.000Z');
const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

const depois = (ms: number, base: Date = AGORA) => new Date(base.getTime() + ms);

const CONTA_ID = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';
const OUTRA_CONTA_ID = '7a2e4d3b-2c3d-4e4f-9a01-23456789abcd';

function conta(criadaEm: Date = AGORA, id = CONTA_ID): Conta {
  return Conta.criar({
    id,
    nome: 'Ana Souza',
    email: Email.criar('ana.souza@exemplo.com'),
    telefone: Telefone.criar('(35) 99999-1234'),
    senhaHash: 'hash-secreto',
    agora: criadaEm,
  });
}

/** Gerador pseudoaleatório com semente fixa (LCG): os testes não dependem de sorte. */
function sorteador(semente: number): () => number {
  let estado = semente;
  return () => {
    estado = (estado * 1664525 + 1013904223) % 4294967296;
    return estado / 4294967296;
  };
}

describe('freio de login: fronteiras e rodapés (CA-04)', () => {
  it('a quinta falha exatamente 15 min depois da primeira abre janela nova e não freia; um instante antes, freia', () => {
    const noLimite = BloqueioDeLogin.novo('k', 'email', AGORA);
    noLimite.registrarFalha(AGORA);
    for (const minuto of [1, 2, 3]) noLimite.registrarFalha(depois(minuto * MINUTO));
    noLimite.registrarFalha(depois(15 * MINUTO));
    expect(noLimite.estaBloqueado(depois(15 * MINUTO))).toBe(false);

    const dentro = BloqueioDeLogin.novo('k', 'email', AGORA);
    dentro.registrarFalha(AGORA);
    for (const minuto of [1, 2, 3]) dentro.registrarFalha(depois(minuto * MINUTO));
    dentro.registrarFalha(depois(15 * MINUTO - 1));
    expect(dentro.estaBloqueado(depois(15 * MINUTO - 1))).toBe(true);
    expect(dentro.segundosDeEspera(depois(15 * MINUTO - 1))).toBe(60);
  });

  it('a espera acaba no instante exato: ainda bloqueado 1 ms antes, livre no fim', () => {
    const freio = BloqueioDeLogin.novo('k', 'email', AGORA);
    for (let i = 0; i < 5; i += 1) freio.registrarFalha(depois(i));
    const fim = depois(4 + MINUTO);
    expect(freio.estaBloqueado(new Date(fim.getTime() - 1))).toBe(true);
    expect(freio.estaBloqueado(fim)).toBe(false);
  });

  it('Retry-After arredonda para cima: 59,5 s restantes viram 60', () => {
    const freio = BloqueioDeLogin.novo('k', 'email', AGORA);
    for (let i = 0; i < 5; i += 1) freio.registrarFalha(AGORA);
    expect(freio.segundosDeEspera(depois(500))).toBe(60);
    expect(freio.segundosDeEspera(depois(59_999))).toBe(1);
  });

  it('o segundo fator concluído não zera o freio por e-mail (só a senha certa zera)', () => {
    const freio = BloqueioDeLogin.novo('k', 'email', AGORA);
    for (let i = 0; i < 5; i += 1) freio.registrarFalha(AGORA);
    freio.registrarSucesso('segundo_fator');
    expect(freio.estaBloqueado(depois(SEGUNDO))).toBe(true);
    expect(freio.nivel).toBe(1);
  });

  it('propriedade: com qualquer sequência de falhas, a espera é sempre 1, 5 ou 15 min, nunca passa de 15 min, e o estado gravado e remontado se comporta igual', () => {
    for (let semente = 1; semente <= 200; semente += 1) {
      const sorte = sorteador(semente);
      const tipo = (['email', 'ip', 'segundo_fator'] as const)[semente % 3] ?? 'email';
      const continuo = BloqueioDeLogin.novo('chave', tipo, AGORA);
      let remontado = BloqueioDeLogin.novo('chave', tipo, AGORA);
      let instante = 0;
      for (let passo = 0; passo < 300; passo += 1) {
        instante += Math.floor(sorte() * 3 * MINUTO);
        const agora = depois(instante);
        remontado = BloqueioDeLogin.reconstituir(remontado.dados);
        const estavaBloqueado = continuo.estaBloqueado(agora);
        continuo.registrarFalha(agora);
        remontado.registrarFalha(agora);
        expect(remontado.dados).toEqual(continuo.dados);

        const espera = continuo.segundosDeEspera(agora);
        expect(espera).toBeLessThanOrEqual(15 * 60);
        if (!estavaBloqueado && espera > 0) expect([60, 300, 900]).toContain(espera);
        if (sorte() < 0.03) {
          continuo.registrarSucesso('senha');
          remontado.registrarSucesso('senha');
          expect(remontado.dados).toEqual(continuo.dados);
        }
      }
    }
  });

  it('propriedade: nunca sobra bloqueio definitivo, mesmo depois de milhares de falhas seguidas', () => {
    const freio = BloqueioDeLogin.novo('k', 'email', AGORA);
    let instante = 0;
    for (let i = 0; i < 5_000; i += 1) {
      instante += 10 * SEGUNDO;
      freio.registrarFalha(depois(instante));
    }
    // 15 min depois da última falha possível, a conta volta a aceitar tentativa.
    const fim = freio.dados.bloqueadoAte?.getTime() ?? 0;
    expect(fim - (AGORA.getTime() + instante)).toBeLessThanOrEqual(15 * MINUTO);
    expect(freio.estaBloqueado(new Date(fim))).toBe(false);
  });

  it.each(Object.entries(LIMIAR_DE_FALHAS))(
    'o limiar de %s vale por contagem exata: uma a menos não freia',
    (tipo, limiar) => {
      const freio = BloqueioDeLogin.novo('k', tipo as keyof typeof LIMIAR_DE_FALHAS, AGORA);
      for (let i = 0; i < limiar - 1; i += 1) freio.registrarFalha(depois(i));
      expect(freio.estaBloqueado(depois(limiar))).toBe(false);
      freio.registrarFalha(depois(limiar));
      expect(freio.estaBloqueado(depois(limiar))).toBe(true);
    },
  );
});

describe('sessão: prazos do plano por extenso (S9, S16, CA-05)', () => {
  const novaSessao = (cliente: 'app_consumidor' | 'painel', mfa = false) =>
    Sessao.criar({
      id: '0b8e1f2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
      contaId: CONTA_ID,
      cliente,
      tokenHash: 'hash-1',
      mfa,
      agora: AGORA,
    });

  it('app: 30 dias exatos deslizantes, sem teto', () => {
    const sessao = novaSessao('app_consumidor');
    expect(sessao.expiraEm.getTime() - AGORA.getTime()).toBe(30 * DIA);
    expect(sessao.dados.expiraAbsolutoEm).toBeNull();
  });

  it('painel: 30 min de inatividade e teto absoluto de 12 h exatas', () => {
    const sessao = novaSessao('painel', true);
    expect(sessao.expiraEm.getTime() - AGORA.getTime()).toBe(30 * MINUTO);
    expect(sessao.dados.expiraAbsolutoEm?.getTime()).toBe(AGORA.getTime() + 12 * HORA);
  });

  it('o token anterior apresentado a 60,5 s da troca já é reuso (tolerância é de 60 s, não 61)', () => {
    const sessao = novaSessao('app_consumidor');
    sessao.rotacionar('hash-2', 'cifrado', AGORA);
    expect(sessao.avaliarRenovacao('hash-1', 'app_consumidor', depois(59_999)).tipo).toBe(
      'tolerancia',
    );
    expect(sessao.avaliarRenovacao('hash-1', 'app_consumidor', depois(60_500)).tipo).toBe('reuso');
  });

  it('a tolerância não revive sessão do painel que passou do teto de 12 h (S9)', () => {
    const sessao = novaSessao('painel', true);
    // Uma renovação a cada 25 min mantém a sessão viva; a última cai 10 s antes do teto, então o
    // prazo vira o teto e a tolerância de 60 s corre além dele.
    for (let minuto = 25; minuto <= 700; minuto += 25) {
      sessao.rotacionar(`hash-${minuto}`, 'cifrado', depois(minuto * MINUTO));
    }
    sessao.rotacionar('hash-2', 'cifrado', depois(12 * HORA - 10 * SEGUNDO));
    const anterior = 'hash-700';
    expect(sessao.avaliarRenovacao(anterior, 'painel', depois(12 * HORA - 5 * SEGUNDO)).tipo).toBe(
      'tolerancia',
    );
    // Passou do teto, ainda dentro dos 60 s: não devolve o par novo.
    const aposOTeto = sessao.avaliarRenovacao(anterior, 'painel', depois(12 * HORA + 5 * SEGUNDO));
    expect(aposOTeto.tipo).toBe('reuso');
    expect(sessao.avaliarRenovacao('hash-2', 'painel', depois(12 * HORA + 5 * SEGUNDO)).tipo).toBe(
      'invalida',
    );
  });

  it('propriedade: renovando em instantes aleatórios, o painel nunca passa do teto de 12 h nem a sessão revogada renova', () => {
    for (let semente = 1; semente <= 100; semente += 1) {
      const sorte = sorteador(semente);
      const sessao = novaSessao('painel', true);
      const teto = AGORA.getTime() + 12 * HORA;
      let instante = 0;
      for (let passo = 0; passo < 60; passo += 1) {
        instante += Math.floor(sorte() * 40 * MINUTO);
        const agora = depois(instante);
        const avaliacao = sessao.avaliarRenovacao(sessao.dados.tokenHash, 'painel', agora);
        if (avaliacao.tipo === 'rotacionar') {
          sessao.rotacionar(`hash-${semente}-${passo}`, 'cifrado', agora);
          expect(sessao.expiraEm.getTime()).toBeLessThanOrEqual(teto);
          expect(sessao.expiraEm.getTime()).toBeGreaterThan(agora.getTime());
          expect(sessao.mfa).toBe(true);
        } else {
          expect(sessao.estaAtiva(agora)).toBe(false);
          break;
        }
        if (sorte() < 0.05) {
          sessao.revogar('logout', agora);
          expect(sessao.avaliarRenovacao(sessao.dados.tokenHash, 'painel', agora).tipo).toBe(
            'invalida',
          );
          break;
        }
      }
    }
  });
});

describe('conta: prazos do plano por extenso (P1-dono, CA-11)', () => {
  it('conta não verificada só é expurgada com mais de 7 dias exatos sem login', () => {
    const criada = conta(AGORA);
    expect(criada.deveSerExpurgada(depois(7 * DIA))).toBe(false);
    expect(criada.deveSerExpurgada(depois(7 * DIA + 1))).toBe(true);
    expect(criada.deveSerExpurgada(depois(7 * DIA - 1))).toBe(false);
  });

  it('o prazo de anonimização é de 30 dias exatos depois da desativação', () => {
    const desativada = conta();
    desativada.desativar(depois(DIA));
    expect(desativada.prazoDeAnonimizacao?.getTime()).toBe(depois(DIA).getTime() + 30 * DIA);
  });

  it('o perfil concedido guarda quem concedeu e quando (CA-07)', () => {
    const consumidora = conta();
    consumidora.concederPerfil('lojista', depois(HORA), OUTRA_CONTA_ID);
    expect(consumidora.dados.perfis).toContainEqual({
      perfil: 'lojista',
      concedidoEm: depois(HORA),
      concedidoPor: OUTRA_CONTA_ID,
    });
  });
});

describe('desafio do 2FA: código certo com o freio ativo (S1, P3)', () => {
  it('freio ativo responde `freado` mesmo com o código certo e não consome o desafio nem gasta tentativa', () => {
    const desafio = DesafioDeSegundoFator.emitir({
      id: '3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a',
      contaId: CONTA_ID,
      etapa: 'verificar',
      tokenHmac: 'hmac',
      agora: AGORA,
    });
    const freio = BloqueioDeLogin.novo('conta', 'segundo_fator', AGORA);
    for (let i = 0; i < 5; i += 1) freio.registrarFalha(depois(i));

    const resultado = desafio.avaliarCodigo({
      etapa: 'verificar',
      freio,
      codigoConfere: true,
      agora: depois(SEGUNDO),
    });

    expect(resultado.tipo).toBe('freado');
    expect(desafio.dados.tentativas).toBe(0);
    expect(desafio.dados.usadoEm).toBeNull();
  });
});

describe('nenhuma entidade expõe dado pessoal ou segredo (CA-12)', () => {
  const SEGREDOS = [
    'Ana',
    'Souza',
    'ana.souza',
    '35999991234',
    '99999-1234',
    'hash-secreto',
    'hmac-do-token',
    'hmac-do-codigo',
    'hmac-do-desafio',
    'cifrado-do-par',
    'chave-do-freio',
  ];

  const entidades: Record<string, object> = {
    conta: conta(),
    email: Email.criar('ana.souza@exemplo.com'),
    telefone: Telefone.criar('(35) 99999-1234'),
    sessao: (() => {
      const sessao = Sessao.criar({
        id: '0b8e1f2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
        contaId: CONTA_ID,
        cliente: 'app_consumidor',
        tokenHash: 'hmac-do-token',
        mfa: false,
        agora: AGORA,
      });
      sessao.rotacionar('hmac-do-token-2', 'cifrado-do-par', AGORA);
      return sessao;
    })(),
    codigo: CodigoDeVerificacao.emitir({
      id: '1c9f2a3b-4d5e-4f6a-9b0c-1d2e3f4a5b6c',
      contaId: CONTA_ID,
      finalidade: 'verificacao_email',
      codigoHmac: 'hmac-do-codigo',
      agora: AGORA,
    }),
    desafio: DesafioDeSegundoFator.emitir({
      id: '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a',
      contaId: CONTA_ID,
      etapa: 'verificar',
      tokenHmac: 'hmac-do-desafio',
      agora: AGORA,
    }),
    freio: BloqueioDeLogin.novo('chave-do-freio', 'email', AGORA),
  };

  it.each(Object.entries(entidades))(
    '%s: JSON, inspect (com campos ocultos), String e espalhamento não trazem nada',
    (_nome, entidade) => {
      const formas = [
        JSON.stringify(entidade),
        inspect(entidade, { depth: 6, showHidden: true }),
        Object.prototype.toString.call(entidade),
        JSON.stringify({ ...entidade }),
        JSON.stringify(Object.getOwnPropertyNames(entidade)),
        JSON.stringify(Object.getOwnPropertySymbols(entidade).map(String)),
      ];
      for (const forma of formas) {
        for (const segredo of SEGREDOS) expect(forma).not.toContain(segredo);
      }
    },
  );

  it('as mensagens de erro do domínio nunca repetem o valor recusado', () => {
    const erros: string[] = [];
    const captura = (fn: () => unknown) => {
      try {
        fn();
      } catch (erro) {
        erros.push((erro as Error).message);
      }
    };
    captura(() => Email.criar('fulano@invalido'));
    captura(() => Telefone.criar('(11) 8888-7777'));
    captura(() =>
      Conta.criar({
        id: CONTA_ID,
        nome: '\u0000Fulano Secreto',
        email: Email.criar('fulano@exemplo.com'),
        telefone: Telefone.criar('(11) 98888-7777'),
        senhaHash: 'hash',
        agora: AGORA,
      }),
    );
    captura(() => conta().concederPerfil('admin' as 'lojista', AGORA));
    expect(erros).toHaveLength(4);
    for (const mensagem of erros) {
      for (const proibido of ['fulano', 'Fulano', '8888', '98888', 'invalido@']) {
        expect(mensagem).not.toContain(proibido);
      }
    }
  });
});
