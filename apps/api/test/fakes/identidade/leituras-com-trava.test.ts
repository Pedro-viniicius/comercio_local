// Leituras com trava dos fakes da Identidade (R1) e histórico de tokens de renovação (S77):
// os casos de uso das etapas 8 a 11 leem por `...ParaAtualizar` e gravam a rotação por
// `gravarRotacao`; com isso, duas requisições simultâneas não perdem uma atualização.
import { describe, expect, it } from 'vitest';
import { BloqueioDeLogin } from '../../../src/modulos/identidade/dominio/bloqueio-de-login.ts';
import { CodigoDeVerificacao } from '../../../src/modulos/identidade/dominio/codigo-de-verificacao.ts';
import { Conta } from '../../../src/modulos/identidade/dominio/conta.ts';
import { DesafioDeSegundoFator } from '../../../src/modulos/identidade/dominio/desafio-de-segundo-fator.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import {
  avaliarTokenJaUsado,
  type AvaliacaoDaRenovacao,
  Sessao,
} from '../../../src/modulos/identidade/dominio/sessao.ts';
import { Telefone } from '../../../src/modulos/identidade/dominio/telefone.ts';
import { ForaDaUnidadeDeTrabalho } from '../compartilhado/unidade-de-trabalho-falsa.ts';
import { criarIdentidadeEmMemoria, type IdentidadeEmMemoria } from './repositorios-em-memoria.ts';

const AGORA = new Date('2026-10-17T12:00:00.000Z');
const depois = (ms: number) => new Date(AGORA.getTime() + ms);
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const CONTA = uuid(1);
const SID = uuid(2);

const proximaVolta = () => new Promise<void>((resolver) => setImmediate(resolver));

function conta(): Conta {
  return Conta.criar({
    id: CONTA,
    nome: 'Ana',
    email: Email.criar('ana@exemplo.com'),
    telefone: Telefone.criar('35999991234'),
    senhaHash: 'hash',
    agora: AGORA,
  });
}

async function comSessao(): Promise<IdentidadeEmMemoria> {
  const identidade = criarIdentidadeEmMemoria();
  await identidade.contas.inserir(conta());
  await identidade.sessoes.inserir(
    Sessao.criar({
      id: SID,
      contaId: CONTA,
      cliente: 'app_consumidor',
      tokenHash: 't1',
      mfa: false,
      agora: AGORA,
    }),
  );
  return identidade;
}

/**
 * O caminho da renovação que a etapa 9 implementa, reduzido ao que os repositórios fazem:
 * sessão pelo token atual ou anterior; senão, histórico; reuso revoga a família; rotação
 * pelo UPDATE condicionado, relendo e avaliando de novo se outra renovação ganhou.
 */
async function renovar(
  identidade: IdentidadeEmMemoria,
  tokenHash: string,
  novoToken: string,
  agora: Date,
): Promise<AvaliacaoDaRenovacao['tipo']> {
  return identidade.unidade.executar(async () => {
    for (let tentativa = 0; tentativa < 2; tentativa += 1) {
      const sessao = await identidade.sessoes.buscarPorTokenHash(tokenHash);
      if (sessao === null) {
        const uso = await identidade.sessoes.buscarTokenUsado(tokenHash);
        const avaliacao = avaliarTokenJaUsado(uso);
        if (avaliacao.tipo === 'reuso' && uso !== null) {
          await identidade.sessoes.revogarDaFamilia(uso.familiaId, 'reuso_detectado', agora);
        }
        return avaliacao.tipo;
      }
      const avaliacao = sessao.avaliarRenovacao(tokenHash, 'app_consumidor', agora);
      if (avaliacao.tipo === 'reuso') {
        await identidade.sessoes.revogarDaFamilia(sessao.familiaId, 'reuso_detectado', agora);
      }
      if (avaliacao.tipo !== 'rotacionar') return avaliacao.tipo;
      sessao.rotacionar(novoToken, `par-de-${novoToken}`, agora);
      await proximaVolta();
      if (await identidade.sessoes.gravarRotacao(sessao)) return 'rotacionar';
    }
    throw new Error('a releitura deveria cair na tolerância ou no reuso');
  });
}

describe('freio: buscarParaAtualizar (R1)', () => {
  async function falhaSimultanea(identidade: IdentidadeEmMemoria, comTrava: boolean) {
    const falhar = () =>
      identidade.unidade.executar(async () => {
        const freio = comTrava
          ? await identidade.bloqueios.buscarParaAtualizar('chave', 'email', AGORA)
          : ((await identidade.bloqueios.buscar('chave', 'email')) ??
            BloqueioDeLogin.novo('chave', 'email', AGORA));
        await proximaVolta();
        freio.registrarFalha(AGORA);
        await identidade.bloqueios.salvar(freio);
      });
    await Promise.all([falhar(), falhar()]);
    return identidade.bloqueios.todos().map((freio) => freio.falhas);
  }

  it('duas falhas simultâneas na chave nova viram duas', async () => {
    expect(await falhaSimultanea(criarIdentidadeEmMemoria(), true)).toEqual([2]);
  });

  it('sem a trava, a segunda gravação apaga a primeira (o defeito que a porta evita)', async () => {
    expect(await falhaSimultanea(criarIdentidadeEmMemoria(), false)).toEqual([1]);
  });

  it('a linha zerada criada pela leitura some se a unidade falhar', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await expect(
      identidade.unidade.executar(async () => {
        await identidade.bloqueios.buscarParaAtualizar('chave', 'ip', AGORA);
        throw new Error('falha');
      }),
    ).rejects.toThrow('falha');
    expect(identidade.bloqueios.todos()).toEqual([]);
  });
});

describe('tentativas do código e do desafio (R1)', () => {
  it('duas tentativas erradas simultâneas no código por e-mail contam duas', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await identidade.codigos.inserir(
      CodigoDeVerificacao.emitir({
        id: uuid(10),
        contaId: CONTA,
        finalidade: 'verificacao_email',
        codigoHmac: 'hmac',
        agora: AGORA,
      }),
    );
    const errar = () =>
      identidade.unidade.executar(async () => {
        const codigo = await identidade.codigos.buscarVigenteParaAtualizar(
          CONTA,
          'verificacao_email',
          depois(1_000),
        );
        await proximaVolta();
        expect(codigo?.conferir(false, depois(1_000))).toBe('errado');
        if (codigo !== null) await identidade.codigos.atualizar(codigo);
      });
    await Promise.all([errar(), errar()]);
    expect(identidade.codigos.todos().map((codigo) => codigo.tentativas)).toEqual([2]);
  });

  it('o código esgotado por outra unidade enquanto esta esperava volta como null', async () => {
    const identidade = criarIdentidadeEmMemoria();
    const emitido = CodigoDeVerificacao.emitir({
      id: uuid(11),
      contaId: CONTA,
      finalidade: 'recuperacao_senha',
      codigoHmac: 'hmac',
      agora: AGORA,
    });
    for (let i = 0; i < 4; i += 1) emitido.conferir(false, AGORA);
    await identidade.codigos.inserir(emitido);
    const lidos: (CodigoDeVerificacao | null)[] = [];
    const errar = () =>
      identidade.unidade.executar(async () => {
        const codigo = await identidade.codigos.buscarVigenteParaAtualizar(
          CONTA,
          'recuperacao_senha',
          AGORA,
        );
        lidos.push(codigo);
        await proximaVolta();
        codigo?.conferir(false, AGORA);
        if (codigo !== null) await identidade.codigos.atualizar(codigo);
      });
    await Promise.all([errar(), errar()]);
    expect(lidos.map((codigo) => codigo === null)).toEqual([false, true]);
    expect(identidade.codigos.todos().map((codigo) => codigo.tentativas)).toEqual([5]);
  });

  it('duas tentativas erradas simultâneas no desafio contam duas no desafio e no freio', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await identidade.desafios.inserir(
      DesafioDeSegundoFator.emitir({
        id: uuid(12),
        contaId: CONTA,
        etapa: 'verificar',
        tokenHmac: 'hmac-desafio',
        agora: AGORA,
      }),
    );
    const errar = () =>
      identidade.unidade.executar(async () => {
        const desafio = await identidade.desafios.buscarPorIdParaAtualizar(uuid(12));
        const freio = await identidade.bloqueios.buscarParaAtualizar(CONTA, 'segundo_fator', AGORA);
        await proximaVolta();
        const resultado = desafio?.avaliarCodigo({
          etapa: 'verificar',
          freio,
          codigoConfere: false,
          agora: AGORA,
        });
        expect(resultado).toEqual({ tipo: 'codigo_errado' });
        if (desafio !== null) await identidade.desafios.atualizar(desafio);
        await identidade.bloqueios.salvar(freio);
      });
    await Promise.all([errar(), errar()]);
    expect(identidade.desafios.todos().map((desafio) => desafio.tentativas)).toEqual([2]);
    expect(identidade.bloqueios.todos().map((freio) => freio.falhas)).toEqual([2]);
  });

  it.each([
    ['freio', (i: IdentidadeEmMemoria) => i.bloqueios.buscarParaAtualizar('c', 'email', AGORA)],
    [
      'código',
      (i: IdentidadeEmMemoria) =>
        i.codigos.buscarVigenteParaAtualizar(CONTA, 'verificacao_email', AGORA),
    ],
    ['desafio', (i: IdentidadeEmMemoria) => i.desafios.buscarPorIdParaAtualizar(uuid(12))],
  ])('leitura com trava do %s fora da unidade de trabalho rejeita', async (_caso, ler) => {
    await expect(ler(criarIdentidadeEmMemoria())).rejects.toThrow(ForaDaUnidadeDeTrabalho);
  });
});

describe('rotação da sessão: gravarRotacao (R1) e histórico (S77)', () => {
  it('duas renovações simultâneas com o mesmo token: uma rotaciona, a outra recebe o mesmo par pela tolerância', async () => {
    const identidade = await comSessao();
    const resultados = await Promise.all([
      renovar(identidade, 't1', 't2-a', depois(1_000)),
      renovar(identidade, 't1', 't2-b', depois(1_000)),
    ]);
    expect(resultados).toEqual(['rotacionar', 'tolerancia']);
    expect(identidade.sessoes.dadosDe(SID)).toMatchObject({
      tokenHash: 't2-a',
      tokenAnteriorHash: 't1',
      parNovoCifrado: 'par-de-t2-a',
    });
    expect(identidade.sessoes.tokensUsados()).toEqual([
      { tokenHash: 't1', familiaId: SID, sessaoId: SID, usadoEm: depois(1_000) },
    ]);
  });

  it('T1→T2→T3: apresentar T1 revoga a família e T3 passa a dar 401', async () => {
    const identidade = await comSessao();
    expect(await renovar(identidade, 't1', 't2', depois(1_000))).toBe('rotacionar');
    expect(await renovar(identidade, 't2', 't3', depois(2_000))).toBe('rotacionar');
    expect(
      identidade.sessoes
        .tokensUsados()
        .map((uso) => uso.tokenHash)
        .sort(),
    ).toEqual(['t1', 't2']);

    expect(await renovar(identidade, 't1', 'x', depois(3_000))).toBe('reuso');
    expect(identidade.sessoes.dadosDe(SID)).toMatchObject({
      revogadaEm: depois(3_000),
      motivoRevogacao: 'reuso_detectado',
    });
    expect(await renovar(identidade, 't3', 'y', depois(4_000))).toBe('invalida');
  });

  it('a rotação desfeita com a unidade some da sessão e do histórico', async () => {
    const identidade = await comSessao();
    await expect(
      identidade.unidade.executar(async () => {
        const sessao = await identidade.sessoes.buscarPorTokenHash('t1');
        sessao?.rotacionar('t2', 'par', depois(1_000));
        if (sessao !== null) await identidade.sessoes.gravarRotacao(sessao);
        throw new Error('falha depois de rotacionar');
      }),
    ).rejects.toThrow('falha depois de rotacionar');
    expect(identidade.sessoes.dadosDe(SID)?.tokenHash).toBe('t1');
    expect(identidade.sessoes.tokensUsados()).toEqual([]);
  });

  it('atualizar não troca o token, e gravarRotacao fora da unidade rejeita', async () => {
    const identidade = await comSessao();
    const sessao = await identidade.sessoes.buscarPorTokenHash('t1');
    sessao?.rotacionar('t2', 'par', depois(1_000));
    if (sessao === null) throw new Error('sessão não encontrada');
    await expect(identidade.sessoes.atualizar(sessao)).rejects.toThrow(/gravarRotacao/);
    await expect(identidade.sessoes.gravarRotacao(sessao)).rejects.toThrow(ForaDaUnidadeDeTrabalho);
    expect(identidade.sessoes.dadosDe(SID)?.tokenHash).toBe('t1');
  });

  it('logout que confirma enquanto a renovação lia: a rotação devolve false e a sessão fica revogada (R7)', async () => {
    const identidade = await comSessao();
    const renovacao = await identidade.sessoes.buscarPorTokenHash('t1');
    const logout = await identidade.sessoes.buscarPorId(SID);
    if (renovacao === null || logout === null) throw new Error('sessão não encontrada');
    renovacao.rotacionar('t2', 'par-t2', depois(1_000));
    logout.revogar('logout', depois(500));
    await identidade.unidade.executar(() => identidade.sessoes.atualizar(logout));

    await expect(
      identidade.unidade.executar(() => identidade.sessoes.gravarRotacao(renovacao)),
    ).resolves.toBe(false);
    expect(identidade.sessoes.dadosDe(SID)).toMatchObject({
      tokenHash: 't1',
      revogadaEm: depois(500),
      motivoRevogacao: 'logout',
    });
    expect(identidade.sessoes.tokensUsados()).toEqual([]);
  });

  it('atualizar com leitura velha grava só a revogação: não rebaixa a rotação nem troca a primeira revogação (R7)', async () => {
    const identidade = await comSessao();
    const velha = await identidade.sessoes.buscarPorId(SID);
    const outraVelha = await identidade.sessoes.buscarPorId(SID);
    if (velha === null || outraVelha === null) throw new Error('sessão não encontrada');
    expect(await renovar(identidade, 't1', 't2', depois(60_000))).toBe('rotacionar');
    const rotacionada = identidade.sessoes.dadosDe(SID);

    velha.revogar('logout', depois(61_000));
    await identidade.unidade.executar(() => identidade.sessoes.atualizar(velha));
    outraVelha.revogar('senha_redefinida', depois(62_000));
    await identidade.unidade.executar(() => identidade.sessoes.atualizar(outraVelha));

    expect(identidade.sessoes.dadosDe(SID)).toEqual({
      ...rotacionada,
      revogadaEm: depois(61_000),
      motivoRevogacao: 'logout',
      parNovoCifrado: null,
      parNovoExpiraEm: null,
    });
  });

  it('apagar a conta leva o histórico das sessões dela (ON DELETE CASCADE)', async () => {
    const identidade = await comSessao();
    await renovar(identidade, 't1', 't2', depois(1_000));
    await identidade.contas.apagar(CONTA);
    expect(identidade.sessoes.tokensUsados()).toEqual([]);
    await expect(identidade.sessoes.buscarTokenUsado('t1')).resolves.toBeNull();
  });
});

describe('só o expurgo apaga conta (S78)', () => {
  it('a conta verificada não é apagada e nada dela some', async () => {
    const identidade = await comSessao();
    const verificada = await identidade.contas.buscarPorId(CONTA);
    verificada?.verificarEmail(AGORA);
    if (verificada !== null) await identidade.contas.atualizar(verificada);
    await expect(identidade.contas.apagar(CONTA)).rejects.toThrow(/expurgo/);
    expect(identidade.contas.todas()).toHaveLength(1);
    expect(identidade.sessoes.todas()).toHaveLength(1);
  });
});
