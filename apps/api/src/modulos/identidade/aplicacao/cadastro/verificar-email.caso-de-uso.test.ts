// Verificação de e-mail da conta da sessão (CA-01; P1-dono, S1; plano 01b, etapa 8):
// código certo verifica e troca a sessão por uma nova sem `admin` nem `mfa`; código
// errado, vencido, esgotado ou de outra conta dá sempre `codigo_invalido`; sessão
// encerrada não gasta tentativa e nunca ganha token de renovação novo.
import { describe, expect, it } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  ContasEmMemoria,
  criarIdentidadeEmMemoria,
  type IdentidadeEmMemoria,
  SessoesEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import {
  CifradorFalso,
  EmissorDeJwtFalso,
  GeradorDeSegredosFalso,
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import {
  CodigoDeVerificacao,
  TENTATIVAS_POR_CODIGO,
  VALIDADE_DO_CODIGO_EM_MS,
} from '../../dominio/codigo-de-verificacao.ts';
import { Conta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import type { RepositorioDeSessoes } from '../../dominio/repositorios.ts';
import {
  type DadosDaSessao,
  DURACAO_MAXIMA_NO_PAINEL_EM_MS,
  type ReivindicacoesDoToken,
  SEGUNDOS_DO_TOKEN_DE_ACESSO,
  Sessao,
} from '../../dominio/sessao.ts';
import { Telefone } from '../../dominio/telefone.ts';
import type { TokenDeAcesso } from '../portas/emissor-de-jwt.ts';
import {
  type ResultadoDeVerificarEmail,
  VerificarEmailCasoDeUso,
} from './verificar-email.caso-de-uso.ts';

const EMITIDO_EM = new Date('2026-10-18T12:00:00.000Z');
const AGORA = new Date('2026-10-18T12:10:00.000Z');
const CONTA = 'cccccccc-0000-4000-8000-000000000001';
const OUTRA_CONTA = 'cccccccc-0000-4000-8000-000000000002';
const SID = 'dddddddd-0000-4000-8000-000000000001';
const SID_DA_OUTRA = 'dddddddd-0000-4000-8000-000000000002';
const CODIGO_CERTO = '482913';
const CODIGO_DA_OUTRA = '730215';

const cifrador = new CifradorFalso();
const emissor = new EmissorDeJwtFalso();

interface Cenario {
  identidade: IdentidadeEmMemoria;
  sessoes: RepositorioDeSessoes & { dadosDe(id: string): DadosDaSessao | undefined };
  relogio: RelogioFixo;
  casoDeUso: VerificarEmailCasoDeUso;
}

function novaConta(id: string, email: string, admin = false): Conta {
  const conta = Conta.criar({
    id,
    nome: 'Ana Souza',
    email: Email.criar(email),
    telefone: Telefone.criar('+5535999991234'),
    senhaHash: 'hash-da-senha',
    agora: EMITIDO_EM,
  });
  if (admin) conta.concederAdmin(EMITIDO_EM);
  return conta;
}

function sessaoDe(contaId: string, id: string, cliente: Sessao['cliente'] = 'app_consumidor') {
  return Sessao.criar({
    id,
    contaId,
    cliente,
    tokenHash: `hash-do-token-${id}`,
    mfa: cliente === 'painel',
    agora: EMITIDO_EM,
  });
}

function codigoDe(contaId: string, codigo: string, id: string): CodigoDeVerificacao {
  return CodigoDeVerificacao.emitir({
    id,
    contaId,
    finalidade: 'verificacao_email',
    codigoHmac: cifrador.hmac('verificacao_email', [contaId, codigo]),
    agora: EMITIDO_EM,
  });
}

async function cenario(
  opcoes: {
    cliente?: Sessao['cliente'];
    admin?: boolean;
    semCodigo?: boolean;
    sessoes?: (identidade: IdentidadeEmMemoria) => SessoesEmMemoria;
    contas?: (identidade: IdentidadeEmMemoria) => ContasEmMemoria;
    emissor?: EmissorDeJwtFalso;
  } = {},
): Promise<Cenario> {
  const identidade = criarIdentidadeEmMemoria();
  const sessoes = opcoes.sessoes?.(identidade) ?? identidade.sessoes;
  const contas = opcoes.contas?.(identidade) ?? identidade.contas;
  await contas.inserir(novaConta(CONTA, 'ana@exemplo.com', opcoes.admin));
  await contas.inserir(novaConta(OUTRA_CONTA, 'bia@exemplo.com'));
  await sessoes.inserir(sessaoDe(CONTA, SID, opcoes.cliente));
  await sessoes.inserir(sessaoDe(OUTRA_CONTA, SID_DA_OUTRA));
  if (opcoes.semCodigo !== true) {
    await identidade.codigos.inserir(
      codigoDe(CONTA, CODIGO_CERTO, 'eeeeeeee-0000-4000-8000-000000000001'),
    );
  }
  await identidade.codigos.inserir(
    codigoDe(OUTRA_CONTA, CODIGO_DA_OUTRA, 'eeeeeeee-0000-4000-8000-000000000002'),
  );
  const relogio = new RelogioFixo(AGORA);
  const casoDeUso = new VerificarEmailCasoDeUso(
    identidade.unidade,
    relogio,
    contas,
    sessoes,
    identidade.codigos,
    cifrador,
    new GeradorDeSegredosFalso(),
    opcoes.emissor ?? emissor,
  );
  return { identidade, sessoes, relogio, casoDeUso };
}

function codigoDaConta(identidade: IdentidadeEmMemoria, contaId: string) {
  return identidade.codigos.todos().find((codigo) => codigo.contaId === contaId);
}

/** Nada mudou: código sem uso, conta não verificada, sessão ativa e nenhuma sessão nova. */
function esperarNadaMudou(cenarioAtual: Cenario, tentativas = 0): void {
  const { identidade, sessoes } = cenarioAtual;
  expect(codigoDaConta(identidade, CONTA)).toMatchObject({ tentativas, usadoEm: null });
  expect(identidade.contas.dadosDe(CONTA)?.emailVerificadoEm).toBeNull();
  expect(sessoes.dadosDe(SID)?.revogadaEm).toBeNull();
  expect(identidade.sessoes.todas().filter((s) => s.contaId === CONTA).length).toBeLessThanOrEqual(
    1,
  );
}

async function reivindicacoes(
  resultado: ResultadoDeVerificarEmail,
): Promise<ReivindicacoesDoToken> {
  if (resultado.tipo !== 'verificado')
    throw new Error(`esperava verificado, veio ${resultado.tipo}`);
  const lidas = await emissor.verificar(resultado.sessao.tokenAcesso, AGORA);
  if (lidas === null) throw new Error('token de acesso recusado');
  return lidas;
}

describe('VerificarEmailCasoDeUso: código certo (CA-01)', () => {
  it('verifica o e-mail e consome o código', async () => {
    const atual = await cenario();

    const resultado = await atual.casoDeUso.executar({
      contaId: CONTA,
      sid: SID,
      codigo: CODIGO_CERTO,
    });

    expect(resultado.tipo).toBe('verificado');
    expect(atual.identidade.contas.dadosDe(CONTA)?.emailVerificadoEm).toEqual(AGORA);
    expect(codigoDaConta(atual.identidade, CONTA)?.usadoEm).toEqual(AGORA);
  });

  it('troca a sessão por uma nova da mesma família e do mesmo cliente, e devolve o par novo', async () => {
    const atual = await cenario();

    const resultado = await atual.casoDeUso.executar({
      contaId: CONTA,
      sid: SID,
      codigo: CODIGO_CERTO,
    });

    if (resultado.tipo !== 'verificado') throw new Error(resultado.tipo);
    const antiga = atual.identidade.sessoes.dadosDe(SID);
    expect(antiga).toMatchObject({ revogadaEm: AGORA, motivoRevogacao: 'substituida' });
    const claims = await reivindicacoes(resultado);
    const nova = atual.identidade.sessoes.dadosDe(claims.sid);
    expect(claims.sid).not.toBe(SID);
    expect(nova).toMatchObject({
      contaId: CONTA,
      familiaId: antiga?.familiaId,
      cliente: 'app_consumidor',
      tokenHash: cifrador.hmac('token_renovacao', [resultado.sessao.tokenRenovacao]),
      mfa: false,
      revogadaEm: null,
    });
    expect(resultado.sessao).toMatchObject({
      emailVerificado: true,
      expiraEm: new Date(AGORA.getTime() + SEGUNDOS_DO_TOKEN_DE_ACESSO * 1000),
    });
    expect(claims).toMatchObject({ contaId: CONTA, emailVerificado: true, mfa: false });
  });

  it('S1: na sessão do painel com segundo fator, a nova sai sem mfa e o token sem admin', async () => {
    const atual = await cenario({ cliente: 'painel', admin: true });

    const resultado = await atual.casoDeUso.executar({
      contaId: CONTA,
      sid: SID,
      codigo: CODIGO_CERTO,
    });

    const claims = await reivindicacoes(resultado);
    expect(claims.mfa).toBe(false);
    expect(claims.perfis).toEqual(['consumidor']);
    expect(atual.identidade.sessoes.dadosDe(claims.sid)).toMatchObject({
      cliente: 'painel',
      mfa: false,
    });
  });

  it('S101: no painel, a sessão nova herda o teto de 12 h da antiga, contado do login', async () => {
    const atual = await cenario({ cliente: 'painel', admin: true });
    const tetoDaAntiga = atual.identidade.sessoes.dadosDe(SID)?.expiraAbsolutoEm;
    expect(tetoDaAntiga).toEqual(new Date(EMITIDO_EM.getTime() + DURACAO_MAXIMA_NO_PAINEL_EM_MS));

    const claims = await reivindicacoes(
      await atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: CODIGO_CERTO }),
    );

    expect(atual.identidade.sessoes.dadosDe(claims.sid)?.expiraAbsolutoEm).toEqual(tetoDaAntiga);
  });

  it('nos apps, a sessão nova continua sem teto', async () => {
    const atual = await cenario();
    const claims = await reivindicacoes(
      await atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: CODIGO_CERTO }),
    );
    expect(atual.identidade.sessoes.dadosDe(claims.sid)?.expiraAbsolutoEm).toBeNull();
  });

  it('conta já verificada continua exigindo o código e guarda a primeira data', async () => {
    const atual = await cenario();
    const conta = await atual.identidade.contas.buscarPorId(CONTA);
    conta?.verificarEmail(EMITIDO_EM);
    if (conta) await atual.identidade.contas.atualizar(conta);

    await expect(
      atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: '000000' }),
    ).resolves.toEqual({ tipo: 'codigo_invalido' });
    const resultado = await atual.casoDeUso.executar({
      contaId: CONTA,
      sid: SID,
      codigo: CODIGO_CERTO,
    });

    expect(resultado.tipo).toBe('verificado');
    expect(atual.identidade.contas.dadosDe(CONTA)?.emailVerificadoEm).toEqual(EMITIDO_EM);
  });

  it('nada de nome, e-mail, telefone ou código nos dados da sessão nem no token (CA-12)', async () => {
    const atual = await cenario();

    const resultado = await atual.casoDeUso.executar({
      contaId: CONTA,
      sid: SID,
      codigo: CODIGO_CERTO,
    });

    const texto = JSON.stringify([
      atual.identidade.sessoes.todas(),
      await reivindicacoes(resultado),
      atual.identidade.publicador.publicados,
    ]);
    for (const valor of ['Ana', 'ana@exemplo.com', '99999', CODIGO_CERTO]) {
      expect(texto).not.toContain(valor);
    }
  });
});

describe('VerificarEmailCasoDeUso: código que não serve (spec 01, A3)', () => {
  it('código errado: codigo_invalido, soma uma tentativa e não mexe em conta nem sessão', async () => {
    const atual = await cenario();

    await expect(
      atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: '000000' }),
    ).resolves.toEqual({ tipo: 'codigo_invalido' });

    esperarNadaMudou(atual, 1);
  });

  it('a quinta errada também dá codigo_invalido, e depois nem o certo serve', async () => {
    const atual = await cenario();

    for (let tentativa = 1; tentativa <= TENTATIVAS_POR_CODIGO; tentativa += 1) {
      await expect(
        atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: '000000' }),
      ).resolves.toEqual({ tipo: 'codigo_invalido' });
    }
    await expect(
      atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: CODIGO_CERTO }),
    ).resolves.toEqual({ tipo: 'codigo_invalido' });

    esperarNadaMudou(atual, TENTATIVAS_POR_CODIGO);
  });

  it('certo depois de quatro erradas ainda verifica', async () => {
    const atual = await cenario();
    for (let tentativa = 1; tentativa < TENTATIVAS_POR_CODIGO; tentativa += 1) {
      await atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: '000000' });
    }

    const resultado = await atual.casoDeUso.executar({
      contaId: CONTA,
      sid: SID,
      codigo: CODIGO_CERTO,
    });

    expect(resultado.tipo).toBe('verificado');
  });

  it('código vencido: codigo_invalido, sem gastar tentativa', async () => {
    const atual = await cenario();
    atual.relogio.definir(new Date(EMITIDO_EM.getTime() + VALIDADE_DO_CODIGO_EM_MS));

    await expect(
      atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: CODIGO_CERTO }),
    ).resolves.toEqual({ tipo: 'codigo_invalido' });

    esperarNadaMudou(atual, 0);
  });

  it('código já usado: o segundo envio do mesmo código dá codigo_invalido', async () => {
    const atual = await cenario();
    const primeira = await atual.casoDeUso.executar({
      contaId: CONTA,
      sid: SID,
      codigo: CODIGO_CERTO,
    });
    const claims = await reivindicacoes(primeira);

    await expect(
      atual.casoDeUso.executar({ contaId: CONTA, sid: claims.sid, codigo: CODIGO_CERTO }),
    ).resolves.toEqual({ tipo: 'codigo_invalido' });
  });

  it('conta sem código emitido: codigo_invalido', async () => {
    const atual = await cenario({ semCodigo: true });

    await expect(
      atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: CODIGO_CERTO }),
    ).resolves.toEqual({ tipo: 'codigo_invalido' });
    expect(atual.identidade.contas.dadosDe(CONTA)?.emailVerificadoEm).toBeNull();
  });
});

describe('VerificarEmailCasoDeUso: o código de uma conta não verifica outra', () => {
  it('o código da outra conta, digitado na sessão desta, não confere e conta como erro desta', async () => {
    const atual = await cenario();

    await expect(
      atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: CODIGO_DA_OUTRA }),
    ).resolves.toEqual({ tipo: 'codigo_invalido' });

    esperarNadaMudou(atual, 1);
    expect(codigoDaConta(atual.identidade, OUTRA_CONTA)).toMatchObject({
      tentativas: 0,
      usadoEm: null,
    });
    expect(atual.identidade.contas.dadosDe(OUTRA_CONTA)?.emailVerificadoEm).toBeNull();
  });

  it('sem código próprio, o da outra conta também não serve e não é tocado', async () => {
    const atual = await cenario({ semCodigo: true });

    await expect(
      atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: CODIGO_DA_OUTRA }),
    ).resolves.toEqual({ tipo: 'codigo_invalido' });

    expect(codigoDaConta(atual.identidade, OUTRA_CONTA)).toMatchObject({
      tentativas: 0,
      usadoEm: null,
    });
    expect(atual.identidade.contas.dadosDe(OUTRA_CONTA)?.emailVerificadoEm).toBeNull();
    expect(atual.identidade.contas.dadosDe(CONTA)?.emailVerificadoEm).toBeNull();
  });

  it('a sessão de outra conta não serve para verificar esta (sessao_invalida, sem tocar no código)', async () => {
    const atual = await cenario();

    await expect(
      atual.casoDeUso.executar({ contaId: CONTA, sid: SID_DA_OUTRA, codigo: CODIGO_CERTO }),
    ).resolves.toEqual({ tipo: 'sessao_invalida' });

    esperarNadaMudou(atual, 0);
    expect(atual.identidade.sessoes.dadosDe(SID_DA_OUTRA)?.revogadaEm).toBeNull();
  });
});

describe('VerificarEmailCasoDeUso: sessão encerrada nunca ganha token novo', () => {
  it('sessão revogada (logout): sessao_invalida, sem gastar tentativa', async () => {
    const atual = await cenario();
    const sessao = await atual.identidade.sessoes.buscarPorId(SID);
    sessao?.revogar('logout', EMITIDO_EM);
    if (sessao) await atual.identidade.sessoes.atualizar(sessao);

    await expect(
      atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: CODIGO_CERTO }),
    ).resolves.toEqual({ tipo: 'sessao_invalida' });

    expect(codigoDaConta(atual.identidade, CONTA)).toMatchObject({ tentativas: 0, usadoEm: null });
    expect(atual.identidade.contas.dadosDe(CONTA)?.emailVerificadoEm).toBeNull();
    expect(atual.identidade.sessoes.todas()).toHaveLength(2);
  });

  it('sessão inexistente: sessao_invalida', async () => {
    const atual = await cenario();

    await expect(
      atual.casoDeUso.executar({
        contaId: CONTA,
        sid: 'dddddddd-0000-4000-8000-0000000000ff',
        codigo: CODIGO_CERTO,
      }),
    ).resolves.toEqual({ tipo: 'sessao_invalida' });
    esperarNadaMudou(atual, 0);
  });

  it('sessão vencida: sessao_invalida', async () => {
    const atual = await cenario({ cliente: 'painel', admin: true });
    atual.relogio.definir(new Date(EMITIDO_EM.getTime() + 31 * 60 * 1000));

    await expect(
      atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: CODIGO_CERTO }),
    ).resolves.toEqual({ tipo: 'sessao_invalida' });
    esperarNadaMudou(atual, 0);
  });

  /** Lê a sessão como estava antes de outra transação (um logout) revogá-la e confirmar. */
  class SessoesLidasAntesDoLogout extends SessoesEmMemoria {
    override async buscarPorId(id: string): Promise<Sessao | null> {
      const sessao = await super.buscarPorId(id);
      if (sessao === null) return null;
      const { revogadaEm: _r, motivoRevogacao: _m, ...resto } = sessao.dados;
      return Sessao.reconstituir({ ...resto, revogadaEm: null, motivoRevogacao: null });
    }
  }

  it('logout confirmado no meio: revogarDaFamilia não revoga nada, e tudo é desfeito', async () => {
    let sessoes: SessoesLidasAntesDoLogout | undefined;
    const atual = await cenario({
      sessoes: (identidade) => {
        sessoes = new SessoesLidasAntesDoLogout(identidade.unidade);
        return sessoes;
      },
    });
    const sessao = await sessoes?.buscarPorId(SID);
    sessao?.revogar('logout', EMITIDO_EM);
    if (sessao) await sessoes?.atualizar(sessao);

    await expect(
      atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: CODIGO_CERTO }),
    ).resolves.toEqual({ tipo: 'sessao_invalida' });

    expect(codigoDaConta(atual.identidade, CONTA)).toMatchObject({ tentativas: 0, usadoEm: null });
    expect(atual.identidade.contas.dadosDe(CONTA)?.emailVerificadoEm).toBeNull();
    expect(sessoes?.todas().filter((s) => s.contaId === CONTA)).toHaveLength(1);
    expect(sessoes?.dadosDe(SID)).toMatchObject({
      motivoRevogacao: 'logout',
      revogadaEm: EMITIDO_EM,
    });
  });

  it('conta desativada: sessao_invalida e tudo desfeito (a desativação fica)', async () => {
    const atual = await cenario();
    const conta = await atual.identidade.contas.buscarPorId(CONTA);
    conta?.desativar(EMITIDO_EM);
    if (conta) await atual.identidade.contas.atualizar(conta);

    await expect(
      atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: CODIGO_CERTO }),
    ).resolves.toEqual({ tipo: 'sessao_invalida' });

    expect(atual.identidade.contas.dadosDe(CONTA)).toMatchObject({
      status: 'desativada',
      emailVerificadoEm: null,
    });
    expect(codigoDaConta(atual.identidade, CONTA)).toMatchObject({ tentativas: 0, usadoEm: null });
    expect(atual.identidade.sessoes.dadosDe(SID)?.revogadaEm).toBeNull();
  });

  /**
   * Uma exclusão desativa a conta e confirma logo antes do UPDATE desta verificação (no
   * Postgres, o UPDATE espera a exclusão e reavalia `status = 'ativa'`).
   */
  class ContasDesativadasNoMeio extends ContasEmMemoria {
    override async gravarEmailVerificado(id: string, quando: Date): Promise<boolean> {
      const conta = await this.buscarPorId(id);
      conta?.desativar(EMITIDO_EM);
      if (conta) await this.atualizar(conta);
      return super.gravarEmailVerificado(id, quando);
    }
  }

  it('conta desativada no meio: gravarEmailVerificado dá false, sessao_invalida e tudo desfeito', async () => {
    let contas: ContasDesativadasNoMeio | undefined;
    const atual = await cenario({
      contas: (identidade) => {
        contas = new ContasDesativadasNoMeio(identidade.unidade);
        return contas;
      },
    });

    await expect(
      atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: CODIGO_CERTO }),
    ).resolves.toEqual({ tipo: 'sessao_invalida' });

    // A desativação é da "outra transação"; a unidade desta foi desfeita por inteiro.
    expect(codigoDaConta(atual.identidade, CONTA)).toMatchObject({ tentativas: 0, usadoEm: null });
    expect(contas?.dadosDe(CONTA)?.emailVerificadoEm ?? null).toBeNull();
    expect(atual.identidade.sessoes.dadosDe(SID)?.revogadaEm).toBeNull();
    expect(atual.identidade.sessoes.todas().filter((s) => s.contaId === CONTA)).toHaveLength(1);
  });

  /** A conta inteira nunca é gravada: `atualizar` aqui falharia. */
  class ContasSemAtualizar extends ContasEmMemoria {
    #liberado = true;

    travarAtualizar(): void {
      this.#liberado = false;
    }

    override atualizar(conta: Conta): Promise<void> {
      return this.#liberado
        ? super.atualizar(conta)
        : Promise.reject(new Error('a verificação não grava a conta inteira'));
    }
  }

  it('grava só email_verificado_em (nunca a conta inteira), e o token sai com o estado relido', async () => {
    let contas: ContasSemAtualizar | undefined;
    const atual = await cenario({
      contas: (identidade) => {
        contas = new ContasSemAtualizar(identidade.unidade);
        return contas;
      },
    });
    contas?.travarAtualizar();

    const resultado = await atual.casoDeUso.executar({
      contaId: CONTA,
      sid: SID,
      codigo: CODIGO_CERTO,
    });

    expect(contas?.dadosDe(CONTA)?.emailVerificadoEm).toEqual(AGORA);
    expect(await reivindicacoes(resultado)).toMatchObject({ emailVerificado: true });
  });
});

describe('VerificarEmailCasoDeUso: concorrência e falhas', () => {
  it('duas verificações simultâneas com o mesmo código: uma verifica, a outra não, uma sessão nova só', async () => {
    const atual = await cenario();
    const entrada = { contaId: CONTA, sid: SID, codigo: CODIGO_CERTO };

    const resultados = await Promise.all([
      atual.casoDeUso.executar(entrada),
      atual.casoDeUso.executar(entrada),
    ]);

    expect(resultados.map(({ tipo }) => tipo).sort()).toEqual(['codigo_invalido', 'verificado']);
    const daConta = atual.identidade.sessoes.todas().filter((s) => s.contaId === CONTA);
    expect(daConta).toHaveLength(2);
    expect(daConta.filter((s) => s.revogadaEm === null)).toHaveLength(1);
  });

  it('falha ao assinar o token: nada fica (código, conta e sessão como antes)', async () => {
    class EmissorQueFalha extends EmissorDeJwtFalso {
      override emitir(): Promise<TokenDeAcesso> {
        return Promise.reject(new Error('Falha simulada ao assinar.'));
      }
    }
    const atual = await cenario({ emissor: new EmissorQueFalha() });

    await expect(
      atual.casoDeUso.executar({ contaId: CONTA, sid: SID, codigo: CODIGO_CERTO }),
    ).rejects.toThrow('Falha simulada');

    esperarNadaMudou(atual, 0);
  });
});
