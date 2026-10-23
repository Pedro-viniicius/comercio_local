// Confirmação da configuração do 2FA (01b, etapa 10; S1, CA-09): respostas na
// ordem de "Respostas do 2FA" (quatro erradas → codigo_errado, a quinta →
// desafio_invalido, certa depois de quatro erradas → sucesso), 10 códigos de
// recuperação guardados só como HMAC e a sessão do painel com `mfa`.
import { normalizarCodigoDeRecuperacao } from '@bairrin/contratos/validadores';
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
import { ConfirmarConfiguracaoDoSegundoFatorCasoDeUso } from './confirmar-configuracao.caso-de-uso.ts';
import { IniciarConfiguracaoDoSegundoFatorCasoDeUso } from './iniciar-configuracao.caso-de-uso.ts';
import { VerificarSegundoFatorCasoDeUso } from './verificar-segundo-fator.caso-de-uso.ts';

const AGORA = new Date('2026-10-18T12:00:00.000Z');
const CONTA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ERRADO = '000000';

async function cenario() {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  const cifrador = new CifradorFalso();
  const gerador = new GeradorDeSegredosFalso();
  const totp = new VerificadorTotpFalso();
  const emissor = new EmissorDeJwtFalso();
  const conta = Conta.criar({
    id: CONTA,
    nome: 'Ana Admin',
    email: Email.criar('ana.admin@exemplo.com'),
    telefone: Telefone.criar('35999991234'),
    senhaHash: 'hash-falso:senha',
    agora: AGORA,
  });
  conta.concederAdmin(AGORA);
  await identidade.contas.inserir(conta);

  const iniciar = new IniciarConfiguracaoDoSegundoFatorCasoDeUso(
    identidade.unidade,
    relogio,
    identidade.contas,
    identidade.desafios,
    identidade.bloqueios,
    identidade.segundoFator,
    cifrador,
    totp,
  );
  const confirmar = new ConfirmarConfiguracaoDoSegundoFatorCasoDeUso(
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
  const emitir = () =>
    identidade.unidade.executar(() =>
      emitirDesafioDeSegundoFator(
        { desafios: identidade.desafios, segundoFator: identidade.segundoFator, cifrador, gerador },
        CONTA,
        relogio.agora(),
      ),
    );
  /** Desafio `configurar` com a configuração já iniciada. */
  const iniciado = async () => {
    const { desafio } = await emitir();
    await iniciar.executar({ desafio });
    return desafio;
  };
  const freio = () =>
    identidade.bloqueios
      .todos()
      .find((b) => b.chaveHmac === chaveDoFreioDeSegundoFator(cifrador, CONTA));
  return {
    identidade,
    relogio,
    cifrador,
    totp,
    emissor,
    iniciar,
    confirmar,
    verificar,
    emitir,
    iniciado,
    freio,
  };
}

describe('ConfirmarConfiguracaoDoSegundoFatorCasoDeUso: sucesso', () => {
  it('confirma o segundo fator, gasta o desafio e o passo, zera o freio e abre a sessão do painel com mfa', async () => {
    const { identidade, confirmar, iniciado, totp, emissor, freio } = await cenario();
    const desafio = await iniciado();

    const resultado = await confirmar.executar({ desafio, codigo: totp.codigoCerto });

    expect(resultado.tipo).toBe('concluido');
    if (resultado.tipo !== 'concluido') return;
    expect(await identidade.segundoFator.buscar(CONTA)).toMatchObject({
      confirmadoEm: AGORA,
      ultimoPassoUsado: passoTotp(AGORA),
    });
    expect(identidade.desafios.todos()[0]?.usadoEm).toEqual(AGORA);
    expect(freio()).toBeUndefined();
    const [sessao] = identidade.sessoes.todas();
    expect(sessao).toMatchObject({ contaId: CONTA, cliente: 'painel', mfa: true });
    const reivindicacoes = await emissor.verificar(resultado.sessao.tokenAcesso, AGORA);
    expect(reivindicacoes?.perfis).toContain('admin');
    expect(reivindicacoes?.mfa).toBe(true);
  });

  it('devolve 10 códigos de recuperação distintos de 10 caracteres base32, guardados só como HMAC da conta', async () => {
    const { identidade, confirmar, iniciado, totp, cifrador } = await cenario();
    const resultado = await confirmar.executar({
      desafio: await iniciado(),
      codigo: totp.codigoCerto,
    });
    if (resultado.tipo !== 'concluido') throw new Error('deveria concluir');

    const { codigosRecuperacao } = resultado;
    expect(codigosRecuperacao).toHaveLength(10);
    expect(new Set(codigosRecuperacao).size).toBe(10);
    for (const codigo of codigosRecuperacao) {
      expect(normalizarCodigoDeRecuperacao(codigo)).toBe(codigo);
    }
    const guardados = identidade.segundoFator.codigosDeRecuperacao();
    expect(guardados).toHaveLength(10);
    expect(guardados.map((c) => c.codigoHmac).sort()).toEqual(
      codigosRecuperacao
        .map((codigo) => cifrador.hmac('codigo_recuperacao_segundo_fator', [CONTA, codigo]))
        .sort(),
    );
    const textoGuardado = JSON.stringify(guardados);
    for (const codigo of codigosRecuperacao) expect(textoGuardado).not.toContain(codigo);
  });

  it('o desafio não serve duas vezes', async () => {
    const { confirmar, iniciado, totp, relogio } = await cenario();
    const desafio = await iniciado();
    await confirmar.executar({ desafio, codigo: totp.codigoCerto });
    relogio.avancar(30_000);
    await expect(confirmar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toEqual({
      tipo: 'desafio_invalido',
    });
  });
});

describe('ConfirmarConfiguracaoDoSegundoFatorCasoDeUso: ordem de "Respostas do 2FA" (P3)', () => {
  it('quatro erradas dão codigo_errado; a quinta, desafio_invalido; a sexta, mesmo certa, desafio_invalido', async () => {
    const { identidade, confirmar, iniciado, totp } = await cenario();
    const desafio = await iniciado();

    for (let tentativa = 1; tentativa < TENTATIVAS_POR_DESAFIO; tentativa += 1) {
      await expect(confirmar.executar({ desafio, codigo: ERRADO })).resolves.toEqual({
        tipo: 'codigo_errado',
      });
      expect(identidade.desafios.todos()[0]?.tentativas).toBe(tentativa);
    }
    await expect(confirmar.executar({ desafio, codigo: ERRADO })).resolves.toEqual({
      tipo: 'desafio_invalido',
    });
    await expect(confirmar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toEqual({
      tipo: 'desafio_invalido',
    });
    expect((await identidade.segundoFator.buscar(CONTA))?.confirmadoEm).toBeNull();
    expect(identidade.sessoes.todas()).toEqual([]);
  });

  it('a certa depois de quatro erradas conclui e zera o freio', async () => {
    const { confirmar, iniciado, totp, freio } = await cenario();
    const desafio = await iniciado();
    for (let i = 1; i < TENTATIVAS_POR_DESAFIO; i += 1) {
      await confirmar.executar({ desafio, codigo: ERRADO });
    }
    expect(freio()?.falhas).toBe(TENTATIVAS_POR_DESAFIO - 1);

    await expect(confirmar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toMatchObject({
      tipo: 'concluido',
    });
    expect(freio()).toBeUndefined();
  });

  it('freio ativo: freado com a espera, sem gastar tentativa nem conferir o código', async () => {
    const { identidade, confirmar, iniciado, totp, cifrador } = await cenario();
    const desafio = await iniciado();
    const ativo = BloqueioDeLogin.reconstituir({
      chaveHmac: chaveDoFreioDeSegundoFator(cifrador, CONTA),
      tipo: 'segundo_fator',
      falhas: 0,
      nivel: 1,
      janelaInicio: AGORA,
      bloqueadoAte: new Date(AGORA.getTime() + 60_000),
    });
    await identidade.bloqueios.salvar(ativo);
    const conferiu = vi.spyOn(totp, 'verificar');

    await expect(confirmar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toEqual({
      tipo: 'freado',
      segundosDeEspera: 60,
    });
    expect(identidade.desafios.todos()[0]?.tentativas).toBe(0);
    expect(identidade.bloqueios.todos()).toEqual([ativo.dados]);
    expect(conferiu).not.toHaveBeenCalled();
  });

  it('as falhas de desafios diferentes somam no freio da conta, que freia na quinta', async () => {
    const { confirmar, iniciado, totp, freio } = await cenario();
    const primeiro = await iniciado();
    for (let i = 0; i < 3; i += 1) await confirmar.executar({ desafio: primeiro, codigo: ERRADO });
    const segundo = await iniciado();
    await expect(confirmar.executar({ desafio: segundo, codigo: ERRADO })).resolves.toEqual({
      tipo: 'codigo_errado',
    });
    // Quinta falha da conta: o desafio ainda tem tentativa, mas o freio passa a valer.
    await expect(confirmar.executar({ desafio: segundo, codigo: ERRADO })).resolves.toEqual({
      tipo: 'codigo_errado',
    });
    expect(freio()?.bloqueadoAte).toEqual(new Date(AGORA.getTime() + 60_000));
    await expect(
      confirmar.executar({ desafio: segundo, codigo: totp.codigoCerto }),
    ).resolves.toEqual({ tipo: 'freado', segundosDeEspera: 60 });
  });

  it('desafio da etapa verificar não confirma (S1)', async () => {
    const { identidade, confirmar, emitir, totp, cifrador } = await cenario();
    await identidade.segundoFator.salvar({
      contaId: CONTA,
      segredoCifrado: cifrador.cifrar('segredo_totp', totp.segredoBase32, CONTA),
      confirmadoEm: AGORA,
      ultimoPassoUsado: null,
    });
    const { desafio, etapa } = await emitir();
    expect(etapa).toBe('verificar');
    await expect(confirmar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toEqual({
      tipo: 'desafio_invalido',
    });
  });

  it('segundo fator confirmado por outra aba depois da emissão: desafio_invalido, sem trocar nada', async () => {
    const { identidade, confirmar, iniciado, totp, cifrador } = await cenario();
    const desafio = await iniciado();
    const confirmado = {
      contaId: CONTA,
      segredoCifrado: cifrador.cifrar('segredo_totp', totp.segredoBase32, CONTA),
      confirmadoEm: AGORA,
      ultimoPassoUsado: 1,
    };
    await identidade.segundoFator.salvar(confirmado);

    await expect(confirmar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toEqual({
      tipo: 'desafio_invalido',
    });
    expect(await identidade.segundoFator.buscar(CONTA)).toEqual(confirmado);
    expect(identidade.segundoFator.codigosDeRecuperacao()).toEqual([]);
    expect(identidade.desafios.todos()[0]?.tentativas).toBe(0);
  });

  it('configuração não iniciada: o código não confere e conta como tentativa', async () => {
    const { identidade, confirmar, emitir, totp, freio } = await cenario();
    const { desafio } = await emitir();
    await expect(confirmar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toEqual({
      tipo: 'codigo_errado',
    });
    expect(identidade.desafios.todos()[0]?.tentativas).toBe(1);
    expect(freio()?.falhas).toBe(1);
  });

  it('desafio vencido, token adulterado e conta desativada: desafio_invalido sem tocar no freio', async () => {
    const { identidade, confirmar, iniciado, totp, relogio } = await cenario();
    const desafio = await iniciado();
    const [id] = desafio.split('.');
    await expect(
      confirmar.executar({ desafio: `${id ?? ''}.adulterado`, codigo: totp.codigoCerto }),
    ).resolves.toEqual({ tipo: 'desafio_invalido' });

    const conta = await identidade.contas.buscarPorId(CONTA);
    conta?.desativar(AGORA);
    if (conta) await identidade.contas.atualizar(conta);
    await expect(confirmar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toEqual({
      tipo: 'desafio_invalido',
    });

    relogio.avancar(5 * 60 * 1000);
    await expect(confirmar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toEqual({
      tipo: 'desafio_invalido',
    });
    expect(identidade.bloqueios.todos()).toEqual([]);
    expect(identidade.desafios.todos()[0]?.tentativas).toBe(0);
  });

  it('segredo que não decifra é falha do servidor: lança e não grava tentativa', async () => {
    const { identidade, confirmar, emitir, totp } = await cenario();
    const { desafio } = await emitir();
    await identidade.segundoFator.salvar({
      contaId: CONTA,
      segredoCifrado: 'cifrado-de-outra-chave',
      confirmadoEm: null,
      ultimoPassoUsado: null,
    });
    await expect(confirmar.executar({ desafio, codigo: totp.codigoCerto })).rejects.toThrow(
      /não decifra/,
    );
    expect(identidade.desafios.todos()[0]?.tentativas).toBe(0);
    expect(identidade.bloqueios.todos()).toEqual([]);
  });
});

describe('ConfirmarConfiguracaoDoSegundoFatorCasoDeUso: freio em espera (S92, P16)', () => {
  it('a quinta falha da conta publica SegundoFatorFreado só com o id; a senha fica', async () => {
    const { identidade, confirmar, iniciado } = await cenario();
    const desafio = await iniciado();

    for (let i = 0; i < 5; i += 1) await confirmar.executar({ desafio, codigo: ERRADO });

    expect(identidade.publicador.publicados).toEqual([
      expect.objectContaining({
        tipo: 'identidade.SegundoFatorFreado',
        agregadoId: CONTA,
        payload: { contaId: CONTA },
      }),
    ]);
    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBe('hash-falso:senha');
  });

  it('acionado de novo já no nível máximo, sem 2FA concluído: a senha é apagada', async () => {
    const { identidade, confirmar, iniciado, cifrador } = await cenario();
    await identidade.bloqueios.salvar(
      BloqueioDeLogin.reconstituir({
        chaveHmac: chaveDoFreioDeSegundoFator(cifrador, CONTA),
        tipo: 'segundo_fator',
        falhas: 4,
        nivel: NIVEL_MAXIMO_DO_FREIO,
        janelaInicio: AGORA,
        bloqueadoAte: new Date(AGORA.getTime() - 60_000),
      }),
    );
    const desafio = await iniciado();

    await confirmar.executar({ desafio, codigo: ERRADO });

    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBeNull();
    expect(identidade.publicador.tipos).toEqual(['identidade.SegundoFatorFreado']);
  });
});

describe('ConfirmarConfiguracaoDoSegundoFatorCasoDeUso: senha apagada revoga as sessões e audita (S104) e teto diário (S103)', () => {
  const UM_MINUTO = 60_000;

  async function sessaoDoApp(identidade: ReturnType<typeof criarIdentidadeEmMemoria>) {
    await identidade.sessoes.inserir(
      Sessao.criar({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        contaId: CONTA,
        cliente: 'app_consumidor',
        tokenHash: 'hash-do-app',
        mfa: false,
        agora: AGORA,
      }),
    );
  }

  const daSenhaRemovida = (identidade: ReturnType<typeof criarIdentidadeEmMemoria>) =>
    identidade.auditoria.entradas.filter((e) => e.acao === 'senha_removida_pelo_freio');

  it('nível máximo de novo: senha apagada, sessões revogadas e auditoria, com o freio por e-mail travado antes do desafio', async () => {
    const { identidade, confirmar, iniciado, cifrador } = await cenario();
    await sessaoDoApp(identidade);
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
    const desafio = await iniciado();
    const ordem: string[] = [];
    const chaveDoEmail = chaveDoFreioPorEmail(cifrador, Email.criar('ana.admin@exemplo.com'));
    const travarFreio = identidade.bloqueios.buscarParaAtualizar.bind(identidade.bloqueios);
    vi.spyOn(identidade.bloqueios, 'buscarParaAtualizar').mockImplementation(
      (chave, tipo, agora) => {
        if (chave === chaveDoEmail) ordem.push('freio_email');
        return travarFreio(chave, tipo, agora);
      },
    );
    const travarDesafio = identidade.desafios.buscarPorIdParaAtualizar.bind(identidade.desafios);
    vi.spyOn(identidade.desafios, 'buscarPorIdParaAtualizar').mockImplementation((id) => {
      ordem.push('desafio');
      return travarDesafio(id);
    });

    await confirmar.executar({ desafio, codigo: ERRADO });

    // Uma passada só, com o freio por e-mail travado antes do desafio.
    expect(ordem).toEqual(['freio_email', 'desafio']);
    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBeNull();
    expect(identidade.sessoes.todas()).toEqual([
      expect.objectContaining({ revogadaEm: AGORA, motivoRevogacao: 'segundo_fator_freado' }),
    ]);
    expect(daSenhaRemovida(identidade)).toEqual([
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
    expect(
      identidade.desafios.todos().find((d) => d.id === desafio.split('.')[0])?.tentativas,
    ).toBe(1);
  });

  it('4 erros a cada 15 min sem espera: 20 no dia não apagam, o 21º apaga e revoga (S103)', async () => {
    const { identidade, confirmar, iniciado, relogio, freio } = await cenario();
    await sessaoDoApp(identidade);
    const rodadas = LIMITE_DE_ERROS_DE_SEGUNDO_FATOR_POR_DIA / 4;
    for (let rodada = 0; rodada < rodadas; rodada += 1) {
      relogio.definir(new Date(AGORA.getTime() + rodada * 15 * UM_MINUTO));
      const desafio = await iniciado();
      for (let i = 0; i < 4; i += 1) {
        await expect(confirmar.executar({ desafio, codigo: ERRADO })).resolves.toEqual({
          tipo: 'codigo_errado',
        });
      }
      expect(freio()?.bloqueadoAte ?? null).toBeNull();
    }
    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBe('hash-falso:senha');
    expect(daSenhaRemovida(identidade)).toEqual([]);
    expect(identidade.publicador.tipos).toEqual([]);

    relogio.definir(new Date(AGORA.getTime() + rodadas * 15 * UM_MINUTO));
    const desafio = await iniciado();
    await confirmar.executar({ desafio, codigo: ERRADO });

    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBeNull();
    expect(identidade.sessoes.todas()[0]).toMatchObject({
      motivoRevogacao: 'segundo_fator_freado',
    });
    expect(daSenhaRemovida(identidade)).toEqual([
      expect.objectContaining({
        depois: { causa: 'limite_diario', sessoesRevogadas: 1, senhaRemovida: true },
      }),
    ]);
    expect(identidade.publicador.tipos).toEqual(['identidade.SegundoFatorFreado']);
  });
});

describe('ConfirmarConfiguracaoDoSegundoFatorCasoDeUso: conta desativada no meio', () => {
  it('a exclusão confirmada entre a leitura da conta e a sessão: desafio_invalido, sem sessão, e nada fica confirmado (A-R8)', async () => {
    const { identidade, confirmar, iniciado, totp } = await cenario();
    const desafio = await iniciado();
    const desafiosAntes = identidade.desafios.todos();
    const fatorAntes = await identidade.segundoFator.buscar(CONTA);
    vi.spyOn(identidade.contas, 'gravarUltimoLogin').mockResolvedValue(false);

    await expect(confirmar.executar({ desafio, codigo: totp.codigoCerto })).resolves.toEqual({
      tipo: 'desafio_invalido',
    });
    expect(identidade.sessoes.todas()).toEqual([]);
    // A unidade foi desfeita: o 2FA não ficou confirmado e não há códigos de recuperação.
    expect(await identidade.segundoFator.buscar(CONTA)).toEqual(fatorAntes);
    expect(identidade.segundoFator.codigosDeRecuperacao()).toEqual([]);
    expect(identidade.desafios.todos()).toEqual(desafiosAntes);
  });
});

describe('ConfirmarConfiguracaoDoSegundoFatorCasoDeUso: travas (R8)', () => {
  it('trava o freio por e-mail, o desafio e o freio da conta, nessa ordem, e só então lê o segundo fator (S104)', async () => {
    const { identidade, confirmar, iniciado, totp } = await cenario();
    const desafio = await iniciado();
    const travaDesafio = vi.spyOn(identidade.desafios, 'buscarPorIdParaAtualizar');
    const travaFreio = vi.spyOn(identidade.bloqueios, 'buscarParaAtualizar');
    const leSegundoFator = vi.spyOn(identidade.segundoFator, 'buscar');

    await confirmar.executar({ desafio, codigo: totp.codigoCerto });

    expect(travaFreio.mock.calls.map(([, tipo]) => tipo)).toEqual(['email', 'segundo_fator']);
    const [freioDoEmail, freioDepois] = travaFreio.mock.invocationCallOrder;
    const [desafioNoMeio] = travaDesafio.mock.invocationCallOrder;
    const [segundoFatorPorUltimo] = leSegundoFator.mock.invocationCallOrder;
    expect(freioDoEmail).toBeLessThan(desafioNoMeio ?? 0);
    expect(desafioNoMeio).toBeLessThan(freioDepois ?? 0);
    expect(freioDepois).toBeLessThan(segundoFatorPorUltimo ?? 0);
  });
});

describe('CA-09: sem 2FA, configura antes de tudo; depois, entra com senha + TOTP', () => {
  it('configurar → confirmar → no login seguinte, verificar com o TOTP', async () => {
    const { identidade, iniciar, confirmar, verificar, emitir, totp, relogio, emissor } =
      await cenario();

    const primeiro = await emitir();
    expect(primeiro.etapa).toBe('configurar');
    await expect(iniciar.executar({ desafio: primeiro.desafio })).resolves.toMatchObject({
      tipo: 'configuracao',
    });
    const confirmado = await confirmar.executar({
      desafio: primeiro.desafio,
      codigo: totp.codigoCerto,
    });
    expect(confirmado.tipo).toBe('concluido');

    relogio.avancar(60 * 60 * 1000);
    const segundo = await emitir();
    expect(segundo.etapa).toBe('verificar');
    await expect(iniciar.executar({ desafio: segundo.desafio })).resolves.toEqual({
      tipo: 'desafio_invalido',
    });
    const verificado = await verificar.executar({
      desafio: segundo.desafio,
      codigo: totp.codigoCerto,
    });
    if (verificado.tipo !== 'concluido') throw new Error('deveria concluir');
    const reivindicacoes = await emissor.verificar(verificado.sessao.tokenAcesso, relogio.agora());
    expect(reivindicacoes).toMatchObject({ contaId: CONTA, mfa: true });
    expect(identidade.sessoes.todas()).toHaveLength(2);
  });
});
