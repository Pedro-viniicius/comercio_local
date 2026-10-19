// Verificação do 2FA no login do painel (01b, etapa 10; S1, CA-09): TOTP ou
// código de recuperação, respostas na ordem de "Respostas do 2FA", freio por
// conta, sem reuso de passo nem de código, e R8 (segundo fator lido só depois
// do freio travado: dois desafios com o mesmo código ao mesmo tempo, um só
// conclui).
import { describe, expect, it, vi } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  CifradorFalso,
  EmissorDeJwtFalso,
  GeradorDeSegredosFalso,
  passoTotp,
  VerificadorTotpFalso,
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { criarIdentidadeEmMemoria } from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import { BloqueioDeLogin } from '../../dominio/bloqueio-de-login.ts';
import { Conta } from '../../dominio/conta.ts';
import {
  DesafioDeSegundoFator,
  TENTATIVAS_POR_DESAFIO,
} from '../../dominio/desafio-de-segundo-fator.ts';
import { Email } from '../../dominio/email.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { chaveDoFreioDeSegundoFator, emitirDesafioDeSegundoFator } from './comum.ts';
import { VerificarSegundoFatorCasoDeUso } from './verificar-segundo-fator.caso-de-uso.ts';

const AGORA = new Date('2026-10-18T12:00:00.000Z');
const CONTA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OUTRA_CONTA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ERRADO = '000000';
const RECUPERACAO = ['ABCDEFGHIJ', 'KLMNOPQRST', 'UVWXYZ2345'];

function admin(id: string, email: string): Conta {
  const conta = Conta.criar({
    id,
    nome: 'Ana Admin',
    email: Email.criar(email),
    telefone: Telefone.criar('35999991234'),
    senhaHash: 'hash-falso:senha',
    agora: AGORA,
  });
  conta.concederAdmin(AGORA);
  return conta;
}

async function cenario() {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  const cifrador = new CifradorFalso();
  const gerador = new GeradorDeSegredosFalso();
  const totp = new VerificadorTotpFalso();
  const emissor = new EmissorDeJwtFalso();

  for (const [id, email] of [
    [CONTA, 'ana.admin@exemplo.com'],
    [OUTRA_CONTA, 'bia.admin@exemplo.com'],
  ] as const) {
    await identidade.contas.inserir(admin(id, email));
    await identidade.segundoFator.salvar({
      contaId: id,
      segredoCifrado: cifrador.cifrar('segredo_totp', totp.segredoBase32, id),
      confirmadoEm: new Date(AGORA.getTime() - 24 * 60 * 60 * 1000),
      ultimoPassoUsado: null,
    });
  }
  await identidade.segundoFator.substituirCodigosDeRecuperacao(
    CONTA,
    RECUPERACAO.map((codigo, i) => ({
      id: `cccccccc-cccc-4ccc-8ccc-00000000000${i}`,
      contaId: CONTA,
      codigoHmac: cifrador.hmac('codigo_recuperacao_segundo_fator', [CONTA, codigo]),
      usadoEm: null,
    })),
  );

  const verificar = new VerificarSegundoFatorCasoDeUso(
    identidade.unidade,
    relogio,
    identidade.contas,
    identidade.desafios,
    identidade.bloqueios,
    identidade.segundoFator,
    identidade.sessoes,
    cifrador,
    gerador,
    totp,
    emissor,
  );
  /** O que o `entrar` (etapa 9) faz depois da senha certa no painel. */
  const emitir = async (contaId = CONTA) =>
    (
      await identidade.unidade.executar(() =>
        emitirDesafioDeSegundoFator(
          {
            desafios: identidade.desafios,
            segundoFator: identidade.segundoFator,
            cifrador,
            gerador,
          },
          contaId,
          relogio.agora(),
        ),
      )
    ).desafio;
  /**
   * Desafio `verificar` gravado direto, sem invalidar os outros da conta (a
   * emissão invalida): dois desafios vivos ao mesmo tempo para o teste do R8.
   */
  const desafioDireto = async (id: string) => {
    await identidade.desafios.inserir(
      DesafioDeSegundoFator.emitir({
        id,
        contaId: CONTA,
        etapa: 'verificar',
        tokenHmac: cifrador.hmac('desafio_verificar', [CONTA, 'segredo']),
        agora: relogio.agora(),
      }),
    );
    return `${id}.segredo`;
  };
  const freio = () =>
    identidade.bloqueios
      .todos()
      .find((b) => b.chaveHmac === chaveDoFreioDeSegundoFator(cifrador, CONTA));
  const desafioGravado = (token: string) =>
    identidade.desafios.todos().find((d) => d.id === token.split('.')[0]);
  return {
    identidade,
    relogio,
    cifrador,
    totp,
    emissor,
    verificar,
    emitir,
    desafioDireto,
    freio,
    desafioGravado,
  };
}

describe('VerificarSegundoFatorCasoDeUso: TOTP', () => {
  it('código certo abre a sessão do painel com mfa e admin, gasta o desafio e o passo e zera o freio', async () => {
    const { identidade, verificar, emitir, totp, emissor, freio, desafioGravado } = await cenario();
    const desafio = await emitir();
    await verificar.executar({ desafio, codigo: ERRADO });

    const resultado = await verificar.executar({ desafio, codigo: totp.codigoCerto });

    if (resultado.tipo !== 'concluido') throw new Error('deveria concluir');
    const reivindicacoes = await emissor.verificar(resultado.sessao.tokenAcesso, AGORA);
    expect(reivindicacoes).toMatchObject({ contaId: CONTA, mfa: true });
    expect(reivindicacoes?.perfis).toContain('admin');
    expect(identidade.sessoes.todas()[0]).toMatchObject({ cliente: 'painel', mfa: true });
    expect((await identidade.segundoFator.buscar(CONTA))?.ultimoPassoUsado).toBe(passoTotp(AGORA));
    expect(desafioGravado(desafio)?.usadoEm).toEqual(AGORA);
    expect(freio()).toBeUndefined();
  });

  it('o mesmo TOTP não vale de novo no mesmo passo, nem num desafio novo (sem reuso de passo)', async () => {
    const { verificar, emitir, totp } = await cenario();
    await verificar.executar({ desafio: await emitir(), codigo: totp.codigoCerto });
    await expect(
      verificar.executar({ desafio: await emitir(), codigo: totp.codigoCerto }),
    ).resolves.toEqual({ tipo: 'codigo_errado', campo: 'codigo' });
  });

  it('o código certo de outra conta não serve: o segredo é da conta do desafio', async () => {
    const { identidade, verificar, emitir, totp, cifrador } = await cenario();
    await identidade.segundoFator.salvar({
      contaId: CONTA,
      segredoCifrado: cifrador.cifrar('segredo_totp', 'OUTROSEGREDO2345', CONTA),
      confirmadoEm: AGORA,
      ultimoPassoUsado: null,
    });
    await expect(
      verificar.executar({ desafio: await emitir(), codigo: totp.codigoCerto }),
    ).resolves.toEqual({ tipo: 'codigo_errado', campo: 'codigo' });
  });
});

describe('VerificarSegundoFatorCasoDeUso: código de recuperação', () => {
  it('código certo conclui e marca só ele como usado', async () => {
    const { identidade, verificar, emitir } = await cenario();
    const resultado = await verificar.executar({
      desafio: await emitir(),
      codigoRecuperacao: RECUPERACAO[1] ?? '',
    });

    expect(resultado.tipo).toBe('concluido');
    const usados = identidade.segundoFator
      .codigosDeRecuperacao()
      .filter((codigo) => codigo.usadoEm !== null);
    expect(usados.map((codigo) => codigo.id)).toEqual(['cccccccc-cccc-4ccc-8ccc-000000000001']);
    expect((await identidade.segundoFator.buscar(CONTA))?.ultimoPassoUsado).toBeNull();
  });

  it('aceita minúsculas e hífen (normaliza como o contrato)', async () => {
    const { verificar, emitir } = await cenario();
    await expect(
      verificar.executar({ desafio: await emitir(), codigoRecuperacao: 'abcde-fghij' }),
    ).resolves.toMatchObject({ tipo: 'concluido' });
  });

  it('uso único: o mesmo código num desafio novo é codigo_errado no campo codigoRecuperacao', async () => {
    const { verificar, emitir } = await cenario();
    const codigo = RECUPERACAO[0] ?? '';
    await verificar.executar({ desafio: await emitir(), codigoRecuperacao: codigo });
    await expect(
      verificar.executar({ desafio: await emitir(), codigoRecuperacao: codigo }),
    ).resolves.toEqual({ tipo: 'codigo_errado', campo: 'codigoRecuperacao' });
  });

  it('código de recuperação de outra conta não confere', async () => {
    const { verificar, emitir } = await cenario();
    await expect(
      verificar.executar({
        desafio: await emitir(OUTRA_CONTA),
        codigoRecuperacao: RECUPERACAO[0] ?? '',
      }),
    ).resolves.toEqual({ tipo: 'codigo_errado', campo: 'codigoRecuperacao' });
  });

  it('código mal formado conta como errado, sem erro', async () => {
    const { verificar, emitir, freio } = await cenario();
    await expect(
      verificar.executar({ desafio: await emitir(), codigoRecuperacao: '!!' }),
    ).resolves.toEqual({ tipo: 'codigo_errado', campo: 'codigoRecuperacao' });
    expect(freio()?.falhas).toBe(1);
  });
});

describe('VerificarSegundoFatorCasoDeUso: ordem de "Respostas do 2FA" (P3)', () => {
  it('quatro erradas dão codigo_errado; a quinta, desafio_invalido; a sexta, mesmo certa, desafio_invalido', async () => {
    const { identidade, verificar, emitir, totp, desafioGravado } = await cenario();
    const desafio = await emitir();

    for (let tentativa = 1; tentativa < TENTATIVAS_POR_DESAFIO; tentativa += 1) {
      await expect(verificar.executar({ desafio, codigo: ERRADO })).resolves.toEqual({
        tipo: 'codigo_errado',
        campo: 'codigo',
      });
      expect(desafioGravado(desafio)?.tentativas).toBe(tentativa);
    }
    await expect(verificar.executar({ desafio, codigoRecuperacao: 'ZZZZZZZZZZ' })).resolves.toEqual(
      { tipo: 'desafio_invalido' },
    );
    await expect(verificar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toEqual({
      tipo: 'desafio_invalido',
    });
    expect(identidade.sessoes.todas()).toEqual([]);
  });

  it('a certa depois de quatro erradas conclui', async () => {
    const { verificar, emitir, totp, freio } = await cenario();
    const desafio = await emitir();
    for (let i = 1; i < TENTATIVAS_POR_DESAFIO; i += 1) {
      await verificar.executar({ desafio, codigo: ERRADO });
    }
    await expect(verificar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toMatchObject({
      tipo: 'concluido',
    });
    expect(freio()).toBeUndefined();
  });

  it('freio ativo: freado com a espera, sem gastar tentativa nem conferir o código', async () => {
    const { identidade, verificar, emitir, totp, cifrador, desafioGravado } = await cenario();
    const desafio = await emitir();
    const ativo = BloqueioDeLogin.reconstituir({
      chaveHmac: chaveDoFreioDeSegundoFator(cifrador, CONTA),
      tipo: 'segundo_fator',
      falhas: 0,
      nivel: 2,
      janelaInicio: AGORA,
      bloqueadoAte: new Date(AGORA.getTime() + 5 * 60_000 - 500),
    });
    await identidade.bloqueios.salvar(ativo);
    const conferiuTotp = vi.spyOn(totp, 'verificar');
    const listouCodigos = vi.spyOn(identidade.segundoFator, 'listarCodigosDeRecuperacaoNaoUsados');

    await expect(verificar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toEqual({
      tipo: 'freado',
      segundosDeEspera: 300,
    });
    await expect(
      verificar.executar({ desafio, codigoRecuperacao: RECUPERACAO[0] ?? '' }),
    ).resolves.toMatchObject({ tipo: 'freado' });
    expect(desafioGravado(desafio)?.tentativas).toBe(0);
    expect(identidade.bloqueios.todos()).toEqual([ativo.dados]);
    expect(conferiuTotp).not.toHaveBeenCalled();
    expect(listouCodigos).not.toHaveBeenCalled();
    expect(identidade.segundoFator.codigosDeRecuperacao().every((c) => c.usadoEm === null)).toBe(
      true,
    );
  });

  it('a quinta falha da conta, somando desafios, freia os seguintes', async () => {
    const { verificar, emitir, totp } = await cenario();
    const primeiro = await emitir();
    for (let i = 0; i < 4; i += 1) await verificar.executar({ desafio: primeiro, codigo: ERRADO });
    const segundo = await emitir();
    await expect(verificar.executar({ desafio: segundo, codigo: ERRADO })).resolves.toEqual({
      tipo: 'codigo_errado',
      campo: 'codigo',
    });
    await expect(
      verificar.executar({ desafio: segundo, codigo: totp.codigoCerto }),
    ).resolves.toEqual({ tipo: 'freado', segundosDeEspera: 60 });
  });

  it('desafio configurar, vencido, adulterado ou de conta desativada: desafio_invalido sem tocar no freio', async () => {
    const { identidade, verificar, emitir, totp, relogio } = await cenario();
    await identidade.segundoFator.apagar(OUTRA_CONTA);
    const configurar = await emitir(OUTRA_CONTA);
    await expect(
      verificar.executar({ desafio: configurar, codigo: totp.codigoCerto }),
    ).resolves.toEqual({ tipo: 'desafio_invalido' });

    const desafio = await emitir();
    const [id] = desafio.split('.');
    await expect(
      verificar.executar({ desafio: `${id ?? ''}.adulterado`, codigo: totp.codigoCerto }),
    ).resolves.toEqual({ tipo: 'desafio_invalido' });
    await expect(verificar.executar({ desafio: 'sem-ponto', codigo: ERRADO })).resolves.toEqual({
      tipo: 'desafio_invalido',
    });

    const conta = await identidade.contas.buscarPorId(CONTA);
    conta?.desativar(AGORA);
    if (conta) await identidade.contas.atualizar(conta);
    await expect(verificar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toEqual({
      tipo: 'desafio_invalido',
    });

    relogio.avancar(5 * 60 * 1000);
    await expect(verificar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toEqual({
      tipo: 'desafio_invalido',
    });
    expect(identidade.bloqueios.todos()).toEqual([]);
  });

  it('segundo fator apagado pela CLI depois da emissão: desafio_invalido', async () => {
    const { identidade, verificar, emitir, totp, desafioGravado } = await cenario();
    const desafio = await emitir();
    await identidade.segundoFator.apagar(CONTA);
    await expect(verificar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toEqual({
      tipo: 'desafio_invalido',
    });
    expect(desafioGravado(desafio)?.tentativas).toBe(0);
    expect(identidade.bloqueios.todos()).toEqual([]);
  });

  it('os dois códigos ou nenhum: erro de quem chama (o contrato exige exatamente um)', async () => {
    const { verificar, emitir, totp } = await cenario();
    const desafio = await emitir();
    await expect(verificar.executar({ desafio })).rejects.toThrow(/exatamente um/);
    await expect(
      verificar.executar({ desafio, codigo: totp.codigoCerto, codigoRecuperacao: 'ABCDEFGHIJ' }),
    ).rejects.toThrow(/exatamente um/);
  });
});

describe('VerificarSegundoFatorCasoDeUso: conta desativada no meio', () => {
  it('a exclusão confirmada entre a leitura da conta e a sessão: desafio_invalido, sem sessão', async () => {
    const { identidade, verificar, emitir, totp } = await cenario();
    const desafio = await emitir();
    // `gravarUltimoLogin` só muda conta ativa: o UPDATE viu a exclusão já confirmada.
    const desafiosAntes = identidade.desafios.todos();
    const fatorAntes = await identidade.segundoFator.buscar(CONTA);
    vi.spyOn(identidade.contas, 'gravarUltimoLogin').mockResolvedValue(false);

    await expect(verificar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toEqual({
      tipo: 'desafio_invalido',
    });
    expect(identidade.sessoes.todas()).toEqual([]);
    // A unidade foi desfeita (A-R8): o passo do TOTP e o desafio não ficam gastos.
    expect(await identidade.segundoFator.buscar(CONTA)).toEqual(fatorAntes);
    expect(identidade.desafios.todos()).toEqual(desafiosAntes);
  });

  it('no sucesso, grava o login da conta', async () => {
    const { identidade, verificar, emitir, totp } = await cenario();
    await verificar.executar({ desafio: await emitir(), codigo: totp.codigoCerto });
    expect(identidade.contas.dadosDe(CONTA)?.ultimoLoginEm).toEqual(AGORA);
  });
});

describe('VerificarSegundoFatorCasoDeUso: travas (R8)', () => {
  it('lê o segundo fator e os códigos só depois de travar o desafio e o freio da conta', async () => {
    const { identidade, verificar, emitir } = await cenario();
    const desafio = await emitir();
    const travaDesafio = vi.spyOn(identidade.desafios, 'buscarPorIdParaAtualizar');
    const travaFreio = vi.spyOn(identidade.bloqueios, 'buscarParaAtualizar');
    const leSegundoFator = vi.spyOn(identidade.segundoFator, 'buscar');
    const leCodigos = vi.spyOn(identidade.segundoFator, 'listarCodigosDeRecuperacaoNaoUsados');

    await verificar.executar({ desafio, codigoRecuperacao: RECUPERACAO[0] ?? '' });

    const [desafioPrimeiro] = travaDesafio.mock.invocationCallOrder;
    const [freioDepois] = travaFreio.mock.invocationCallOrder;
    expect(desafioPrimeiro).toBeLessThan(freioDepois ?? 0);
    expect(freioDepois).toBeLessThan(leSegundoFator.mock.invocationCallOrder[0] ?? 0);
    expect(freioDepois).toBeLessThan(leCodigos.mock.invocationCallOrder[0] ?? 0);
  });

  it('dois desafios da mesma conta com o mesmo TOTP ao mesmo tempo: um conclui, o outro não', async () => {
    const { identidade, verificar, desafioDireto, totp } = await cenario();
    const primeiro = await desafioDireto('dddddddd-dddd-4ddd-8ddd-000000000001');
    const segundo = await desafioDireto('dddddddd-dddd-4ddd-8ddd-000000000002');

    const resultados = await Promise.all([
      verificar.executar({ desafio: primeiro, codigo: totp.codigoCerto }),
      verificar.executar({ desafio: segundo, codigo: totp.codigoCerto }),
    ]);

    expect(resultados.map((r) => r.tipo).sort()).toEqual(['codigo_errado', 'concluido']);
    expect(identidade.sessoes.todas()).toHaveLength(1);
  });

  it('dois desafios da mesma conta com o mesmo código de recuperação ao mesmo tempo: um conclui, o outro não', async () => {
    const { identidade, verificar, desafioDireto } = await cenario();
    const primeiro = await desafioDireto('dddddddd-dddd-4ddd-8ddd-000000000001');
    const segundo = await desafioDireto('dddddddd-dddd-4ddd-8ddd-000000000002');
    const codigo = RECUPERACAO[2] ?? '';

    const resultados = await Promise.all([
      verificar.executar({ desafio: primeiro, codigoRecuperacao: codigo }),
      verificar.executar({ desafio: segundo, codigoRecuperacao: codigo }),
    ]);

    expect(resultados.map((r) => r.tipo).sort()).toEqual(['codigo_errado', 'concluido']);
    expect(identidade.sessoes.todas()).toHaveLength(1);
    expect(identidade.segundoFator.codigosDeRecuperacao().filter((c) => c.usadoEm)).toHaveLength(1);
  });
});
