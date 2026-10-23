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
  HasherFalso,
  passoTotp,
  VerificadorTotpFalso,
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { criarIdentidadeEmMemoria } from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import { BloqueioDeLogin } from '../../dominio/bloqueio-de-login.ts';
import { CodigoDeVerificacao } from '../../dominio/codigo-de-verificacao.ts';
import { Conta } from '../../dominio/conta.ts';
import {
  DesafioDeSegundoFator,
  LIMITE_DE_ERROS_DE_SEGUNDO_FATOR_POR_DIA,
  TENTATIVAS_POR_DESAFIO,
} from '../../dominio/desafio-de-segundo-fator.ts';
import { Email } from '../../dominio/email.ts';
import { Sessao } from '../../dominio/sessao.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { chaveDoFreioPorEmail } from '../comum/chaves.ts';
import {
  chaveDoFreioDeSegundoFator,
  emitirDesafioDeSegundoFator,
  NIVEL_MAXIMO_DO_FREIO,
} from './comum.ts';
import { RedefinirSenhaCasoDeUso } from '../sessao/redefinir-senha.caso-de-uso.ts';
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
    identidade.publicador,
    identidade.auditoria,
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

describe('VerificarSegundoFatorCasoDeUso: freio em espera avisa e, no máximo, apaga a senha (S92, P16)', () => {
  const UM_MINUTO = 60_000;

  /** Freio da conta parado no `nivel`, fora de espera, com `falhas` na janela aberta agora. */
  async function freioNoNivel(
    identidade: ReturnType<typeof criarIdentidadeEmMemoria>,
    cifrador: CifradorFalso,
    nivel: number,
    falhas: number,
  ): Promise<void> {
    await identidade.bloqueios.salvar(
      BloqueioDeLogin.reconstituir({
        chaveHmac: chaveDoFreioDeSegundoFator(cifrador, CONTA),
        tipo: 'segundo_fator',
        falhas,
        nivel,
        janelaInicio: AGORA,
        // A espera anterior acabou há 1 min: dentro da calma de 15 min, o nível fica.
        bloqueadoAte: new Date(AGORA.getTime() - UM_MINUTO),
      }),
    );
  }

  it('a falha que põe o freio em espera publica SegundoFatorFreado só com o id; a senha fica', async () => {
    const { identidade, verificar, emitir } = await cenario();
    const desafio = await emitir();

    for (let i = 0; i < 4; i += 1) await verificar.executar({ desafio, codigo: ERRADO });
    expect(identidade.publicador.tipos).toEqual([]);
    await verificar.executar({ desafio, codigo: ERRADO });

    expect(identidade.publicador.publicados).toEqual([
      expect.objectContaining({
        tipo: 'identidade.SegundoFatorFreado',
        agregadoId: CONTA,
        payload: { contaId: CONTA },
      }),
    ]);
    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBe('hash-falso:senha');
  });

  it('a primeira chegada ao nível máximo (de 2 para 3) avisa, mas não apaga a senha', async () => {
    const { identidade, verificar, emitir, cifrador, freio } = await cenario();
    await freioNoNivel(identidade, cifrador, NIVEL_MAXIMO_DO_FREIO - 1, 4);
    const desafio = await emitir();

    await verificar.executar({ desafio, codigo: ERRADO });

    expect(freio()).toMatchObject({ nivel: NIVEL_MAXIMO_DO_FREIO });
    expect(identidade.publicador.tipos).toEqual(['identidade.SegundoFatorFreado']);
    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBe('hash-falso:senha');
  });

  it('acionado de novo já no nível máximo: apaga a senha, avisa, e nem o código certo conclui depois', async () => {
    const { identidade, verificar, emitir, cifrador, relogio, totp, freio } = await cenario();
    await freioNoNivel(identidade, cifrador, NIVEL_MAXIMO_DO_FREIO, 4);
    const desafio = await emitir();

    await expect(verificar.executar({ desafio, codigo: ERRADO })).resolves.toEqual({
      tipo: 'codigo_errado',
      campo: 'codigo',
    });

    expect(freio()).toMatchObject({ nivel: NIVEL_MAXIMO_DO_FREIO });
    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBeNull();
    expect(identidade.contas.dadosDe(CONTA)?.status).toBe('ativa');
    expect(identidade.publicador.publicados).toEqual([
      expect.objectContaining({
        tipo: 'identidade.SegundoFatorFreado',
        payload: { contaId: CONTA },
      }),
    ]);
    // Passada a espera de 15 min, o desafio ainda vivo não serve: a conta não tem senha.
    relogio.definir(new Date(AGORA.getTime() + 4 * UM_MINUTO));
    const novo = await emitir();
    relogio.definir(new Date(AGORA.getTime() + 16 * UM_MINUTO));
    await expect(verificar.executar({ desafio: novo, codigo: totp.codigoCerto })).resolves.toEqual({
      tipo: 'desafio_invalido',
    });
    expect(identidade.sessoes.todas()).toEqual([]);
  });

  it('nível máximo, mas depois da calma de 15 min: o nível zera, a espera é de 1 min e a senha fica', async () => {
    const { identidade, verificar, emitir, cifrador, relogio, freio } = await cenario();
    await freioNoNivel(identidade, cifrador, NIVEL_MAXIMO_DO_FREIO, 0);
    relogio.definir(new Date(AGORA.getTime() + 15 * UM_MINUTO));
    const desafio = await emitir();
    for (let i = 0; i < 4; i += 1) await verificar.executar({ desafio, codigo: ERRADO });
    // A emissão invalida o desafio anterior: a quinta falha vem num desafio novo.
    const outro = await emitir();
    await verificar.executar({ desafio: outro, codigo: ERRADO });

    expect(freio()).toMatchObject({ nivel: 1 });
    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBe('hash-falso:senha');
    expect(identidade.publicador.tipos).toEqual(['identidade.SegundoFatorFreado']);
  });

  it('a falha que não põe o freio em espera não publica nada', async () => {
    const { identidade, verificar, emitir } = await cenario();
    const desafio = await emitir();

    await verificar.executar({ desafio, codigoRecuperacao: 'ZZZZZZZZZZ' });

    expect(identidade.publicador.tipos).toEqual([]);
  });

  it('a outra conta não é tocada', async () => {
    const { identidade, verificar, emitir, cifrador } = await cenario();
    await freioNoNivel(identidade, cifrador, NIVEL_MAXIMO_DO_FREIO, 4);
    const desafio = await emitir();

    await verificar.executar({ desafio, codigo: ERRADO });

    expect(identidade.contas.dadosDe(OUTRA_CONTA)?.senhaHash).toBe('hash-falso:senha');
    expect(identidade.publicador.publicados.map((e) => e.agregadoId)).toEqual([CONTA]);
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
  it('trava o freio por e-mail, o desafio e o freio da conta, nessa ordem, e só então lê o segundo fator e os códigos (S104)', async () => {
    const { identidade, verificar, emitir } = await cenario();
    const desafio = await emitir();
    const travaDesafio = vi.spyOn(identidade.desafios, 'buscarPorIdParaAtualizar');
    const travaFreio = vi.spyOn(identidade.bloqueios, 'buscarParaAtualizar');
    const leSegundoFator = vi.spyOn(identidade.segundoFator, 'buscar');
    const leCodigos = vi.spyOn(identidade.segundoFator, 'listarCodigosDeRecuperacaoNaoUsados');

    await verificar.executar({ desafio, codigoRecuperacao: RECUPERACAO[0] ?? '' });

    expect(travaFreio.mock.calls.map(([, tipo]) => tipo)).toEqual(['email', 'segundo_fator']);
    const [freioDoEmail, freioDepois] = travaFreio.mock.invocationCallOrder;
    const [desafioNoMeio] = travaDesafio.mock.invocationCallOrder;
    expect(freioDoEmail).toBeLessThan(desafioNoMeio ?? 0);
    expect(desafioNoMeio).toBeLessThan(freioDepois ?? 0);
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

describe('VerificarSegundoFatorCasoDeUso: senha apagada revoga as sessões e audita (S104) e teto diário (S103)', () => {
  const UM_MINUTO = 60_000;
  const UM_DIA = 24 * 60 * UM_MINUTO;
  const SESSAO_DO_APP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  /** Sessão do app aberta antes (quem tem a senha entra no app sem segundo fator). */
  async function sessaoDoApp(identidade: ReturnType<typeof criarIdentidadeEmMemoria>) {
    await identidade.sessoes.inserir(
      Sessao.criar({
        id: SESSAO_DO_APP,
        contaId: CONTA,
        cliente: 'app_consumidor',
        tokenHash: 'hash-do-app',
        mfa: false,
        agora: AGORA,
      }),
    );
  }

  async function freioNoMaximo(
    identidade: ReturnType<typeof criarIdentidadeEmMemoria>,
    cifrador: CifradorFalso,
  ) {
    await identidade.bloqueios.salvar(
      BloqueioDeLogin.reconstituir({
        chaveHmac: chaveDoFreioDeSegundoFator(cifrador, CONTA),
        tipo: 'segundo_fator',
        falhas: 4,
        nivel: NIVEL_MAXIMO_DO_FREIO,
        janelaInicio: AGORA,
        bloqueadoAte: new Date(AGORA.getTime() - UM_MINUTO),
      }),
    );
  }

  it('nível máximo de novo: senha apagada, sessões da conta revogadas e auditoria só com ids', async () => {
    const { identidade, verificar, emitir, cifrador } = await cenario();
    await sessaoDoApp(identidade);
    await freioNoMaximo(identidade, cifrador);
    const desafio = await emitir();

    await verificar.executar({ desafio, codigo: ERRADO });

    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBeNull();
    expect(identidade.sessoes.todas()).toEqual([
      expect.objectContaining({
        id: SESSAO_DO_APP,
        revogadaEm: AGORA,
        motivoRevogacao: 'segundo_fator_freado',
      }),
    ]);
    expect(identidade.auditoria.entradas).toEqual([
      {
        atorTipo: 'sistema',
        atorId: null,
        acao: 'senha_removida_pelo_freio',
        recurso: 'conta',
        recursoId: CONTA,
        depois: { causa: 'nivel_maximo', sessoesRevogadas: 1, senhaRemovida: true },
        origem: 'painel',
      },
    ]);
    // A falha conta uma vez só: a tentativa roda numa unidade só, sem refazer.
    expect(
      identidade.desafios.todos().find((d) => d.id === desafio.split('.')[0])?.tentativas,
    ).toBe(1);
    expect(identidade.publicador.tipos).toEqual(['identidade.SegundoFatorFreado']);
  });

  it('a senha só é apagada com o freio por e-mail da conta travado antes do desafio (ordem das travas, A-R13)', async () => {
    const { identidade, verificar, emitir, cifrador } = await cenario();
    await freioNoMaximo(identidade, cifrador);
    const desafio = await emitir();
    const ordem: string[] = [];
    const chaveDoEmail = chaveDoFreioPorEmail(cifrador, Email.criar('ana.admin@exemplo.com'));
    const travarFreio = identidade.bloqueios.buscarParaAtualizar.bind(identidade.bloqueios);
    vi.spyOn(identidade.bloqueios, 'buscarParaAtualizar').mockImplementation(
      (chave, tipo, agora) => {
        ordem.push(chave === chaveDoEmail ? 'freio_email' : `freio_${tipo}`);
        return travarFreio(chave, tipo, agora);
      },
    );
    const travarDesafio = identidade.desafios.buscarPorIdParaAtualizar.bind(identidade.desafios);
    vi.spyOn(identidade.desafios, 'buscarPorIdParaAtualizar').mockImplementation((id) => {
      ordem.push('desafio');
      return travarDesafio(id);
    });
    const removerSenha = identidade.contas.gravarSenhaRemovida.bind(identidade.contas);
    vi.spyOn(identidade.contas, 'gravarSenhaRemovida').mockImplementation((id) => {
      ordem.push('senha');
      return removerSenha(id);
    });
    const revogar = identidade.sessoes.revogarDaConta.bind(identidade.sessoes);
    vi.spyOn(identidade.sessoes, 'revogarDaConta').mockImplementation((id, motivo, agora) => {
      ordem.push('sessoes');
      return revogar(id, motivo, agora);
    });

    await verificar.executar({ desafio, codigo: ERRADO });

    // Uma passada só, com o freio por e-mail travado antes de tudo.
    expect(ordem).toEqual(['freio_email', 'desafio', 'freio_segundo_fator', 'senha', 'sessoes']);
    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBeNull();
  });

  it('4 erros a cada 15 min, sem nunca pôr o freio em espera: 20 no dia não apagam, o 21º apaga (S103)', async () => {
    const { identidade, verificar, emitir, relogio, freio } = await cenario();
    await sessaoDoApp(identidade);
    const rodadas = LIMITE_DE_ERROS_DE_SEGUNDO_FATOR_POR_DIA / 4;
    for (let rodada = 0; rodada < rodadas; rodada += 1) {
      relogio.definir(new Date(AGORA.getTime() + rodada * 15 * UM_MINUTO));
      const desafio = await emitir();
      for (let i = 0; i < 4; i += 1) {
        await expect(verificar.executar({ desafio, codigo: ERRADO })).resolves.toEqual({
          tipo: 'codigo_errado',
          campo: 'codigo',
        });
      }
      expect(freio()?.bloqueadoAte ?? null).toBeNull();
    }

    // 20 exatos: nada muda.
    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBe('hash-falso:senha');
    expect(identidade.publicador.tipos).toEqual([]);
    expect(identidade.auditoria.entradas).toEqual([]);
    expect(identidade.sessoes.todas()[0]?.revogadaEm).toBeNull();

    relogio.definir(new Date(AGORA.getTime() + rodadas * 15 * UM_MINUTO));
    const desafio = await emitir();
    await verificar.executar({ desafio, codigo: ERRADO });

    expect(freio()?.bloqueadoAte ?? null).toBeNull();
    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBeNull();
    expect(identidade.sessoes.todas()[0]).toMatchObject({
      motivoRevogacao: 'segundo_fator_freado',
    });
    expect(identidade.auditoria.entradas).toEqual([
      expect.objectContaining({
        acao: 'senha_removida_pelo_freio',
        depois: { causa: 'limite_diario', sessoesRevogadas: 1, senhaRemovida: true },
      }),
    ]);
    expect(identidade.publicador.tipos).toEqual(['identidade.SegundoFatorFreado']);
  });

  it('os erros de mais de 24 h atrás saem da conta do teto diário', async () => {
    const { identidade, verificar, emitir, relogio } = await cenario();
    const rodadas = LIMITE_DE_ERROS_DE_SEGUNDO_FATOR_POR_DIA / 4;
    for (let rodada = 0; rodada < rodadas; rodada += 1) {
      relogio.definir(new Date(AGORA.getTime() + rodada * 15 * UM_MINUTO));
      const desafio = await emitir();
      for (let i = 0; i < 4; i += 1) await verificar.executar({ desafio, codigo: ERRADO });
    }
    // O primeiro desafio (4 erros) foi emitido exatamente 24 h antes: já não conta.
    relogio.definir(new Date(AGORA.getTime() + UM_DIA));
    const desafio = await emitir();
    for (let i = 0; i < 4; i += 1) await verificar.executar({ desafio, codigo: ERRADO });

    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBe('hash-falso:senha');
    expect(identidade.auditoria.entradas).toEqual([]);
  });

  it('a redefinição da senha recomeça a contagem: 21 erros, redefinição, 1 erro, e a senha nova fica (Q29)', async () => {
    const { identidade, verificar, emitir, relogio, cifrador } = await cenario();
    const rodadas = LIMITE_DE_ERROS_DE_SEGUNDO_FATOR_POR_DIA / 4;
    for (let rodada = 0; rodada < rodadas; rodada += 1) {
      relogio.definir(new Date(AGORA.getTime() + rodada * 15 * UM_MINUTO));
      const desafio = await emitir();
      for (let i = 0; i < 4; i += 1) await verificar.executar({ desafio, codigo: ERRADO });
    }
    relogio.definir(new Date(AGORA.getTime() + rodadas * 15 * UM_MINUTO));
    await verificar.executar({ desafio: await emitir(), codigo: ERRADO });
    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBeNull();
    // A outra conta tem os seus erros, que a redefinição desta não apaga.
    await verificar.executar({ desafio: await emitir(OUTRA_CONTA), codigo: ERRADO });

    relogio.definir(new Date(AGORA.getTime() + 6 * 60 * UM_MINUTO));
    await identidade.codigos.inserir(
      CodigoDeVerificacao.emitir({
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        contaId: CONTA,
        finalidade: 'recuperacao_senha',
        codigoHmac: cifrador.hmac('recuperacao_senha', [CONTA, '135790']),
        agora: relogio.agora(),
      }),
    );
    const redefinir = new RedefinirSenhaCasoDeUso(
      identidade.unidade,
      relogio,
      identidade.contas,
      identidade.sessoes,
      identidade.codigos,
      identidade.desafios,
      identidade.bloqueios,
      identidade.publicador,
      new HasherFalso(identidade.unidade),
      cifrador,
    );
    await expect(
      redefinir.executar({
        email: 'ana.admin@exemplo.com',
        codigo: '135790',
        novaSenha: 'senha-nova-da-ana',
        ip: '198.51.100.7',
      }),
    ).resolves.toEqual({ tipo: 'redefinida' });
    expect(identidade.desafios.todos().every((d) => d.contaId === OUTRA_CONTA)).toBe(true);

    await expect(verificar.executar({ desafio: await emitir(), codigo: ERRADO })).resolves.toEqual({
      tipo: 'codigo_errado',
      campo: 'codigo',
    });
    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBe(
      HasherFalso.hashDe('senha-nova-da-ana'),
    );
    expect(
      identidade.auditoria.entradas.filter((e) => e.acao === 'senha_removida_pelo_freio'),
    ).toHaveLength(1);
  });

  it('o código certo depois de 20 erros no dia conclui normalmente', async () => {
    const { identidade, verificar, emitir, relogio, totp } = await cenario();
    const rodadas = LIMITE_DE_ERROS_DE_SEGUNDO_FATOR_POR_DIA / 4;
    for (let rodada = 0; rodada < rodadas; rodada += 1) {
      relogio.definir(new Date(AGORA.getTime() + rodada * 15 * UM_MINUTO));
      const desafio = await emitir();
      for (let i = 0; i < 4; i += 1) await verificar.executar({ desafio, codigo: ERRADO });
    }
    relogio.definir(new Date(AGORA.getTime() + rodadas * 15 * UM_MINUTO));
    const desafio = await emitir();

    await expect(verificar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toMatchObject({
      tipo: 'concluido',
    });
    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBe('hash-falso:senha');
  });
});
