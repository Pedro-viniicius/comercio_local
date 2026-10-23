// Redefinição de senha (CA-05, CA-06; P1-dono, S6, S8, S14, S94, S95; plano 01b,
// etapa 9): código de uso único e 30 min; troca a senha, verifica o e-mail,
// invalida os desafios do 2FA vivos e revoga todas as sessões; código errado e
// e-mail sem conta respondem igual e somam no freio por e-mail do login e, desde
// o S93, no freio por origem (IP); a conta é lida só depois do freio travado,
// então não ressuscita uma conta desativada no meio.
import type { RedefinirSenha } from '@bairrin/contratos';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  criarIdentidadeEmMemoria,
  type IdentidadeEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import {
  CifradorFalso,
  EmissorDeJwtFalso,
  GeradorDeSegredosFalso,
  HasherFalso,
  VerificadorTotpFalso,
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import {
  CodigoDeVerificacao,
  VALIDADE_DO_CODIGO_EM_MS,
} from '../../dominio/codigo-de-verificacao.ts';
import { Conta } from '../../dominio/conta.ts';
import {
  DesafioDeSegundoFator,
  finalidadeDoDesafio,
} from '../../dominio/desafio-de-segundo-fator.ts';
import { Email } from '../../dominio/email.ts';
import { Sessao } from '../../dominio/sessao.ts';
import { Telefone } from '../../dominio/telefone.ts';
import {
  type PendenciaDeExclusao,
  VerificadorDePendencias,
} from '../portas/verificador-de-pendencias.ts';
import { LIMIAR_DE_FALHAS } from '../../dominio/bloqueio-de-login.ts';
import { chaveDoFreioPorEmail } from '../comum/chaves.ts';
import { chaveDoFreioPorOrigem } from './comum.ts';
import { SolicitarExclusaoCasoDeUso } from '../privacidade/solicitar-exclusao.ts';
import { VerificarSegundoFatorCasoDeUso } from '../segundo-fator/verificar-segundo-fator.caso-de-uso.ts';
import { EntrarCasoDeUso } from './entrar.caso-de-uso.ts';
import {
  type EntradaDeRedefinirSenha,
  RedefinirSenhaCasoDeUso,
} from './redefinir-senha.caso-de-uso.ts';
import { RenovarSessaoCasoDeUso } from './renovar-sessao.caso-de-uso.ts';

const CRIADA_EM = new Date('2026-10-17T09:00:00.000Z');
const AGORA = new Date('2026-10-18T12:00:00.000Z');
const CONTA = 'abababab-0000-4000-8000-000000000001';
const OUTRA_CONTA = 'abababab-0000-4000-8000-000000000002';
const EMAIL = 'eva@exemplo.com';
const OUTRO_EMAIL = 'leo@exemplo.com';
const SENHA_ANTIGA = 'senha-antiga-da-eva';
const SENHA_NOVA = 'senha-nova-da-eva';
const CODIGO = '482913';
const CODIGO_DA_OUTRA = '730215';
const CODIGO_INVALIDO = { tipo: 'codigo_invalido' };
const IP = '198.51.100.7';

const cifrador = new CifradorFalso();

/** Pendências que seguram a exclusão até o teste liberar (a exclusão fica com o freio travado). */
class PendenciasQueEsperam extends VerificadorDePendencias {
  consultada: Promise<void>;
  #avisarConsulta: () => void = () => undefined;
  #liberar: () => void = () => undefined;
  readonly #liberada: Promise<void>;

  constructor() {
    super();
    this.consultada = new Promise((resolver) => {
      this.#avisarConsulta = resolver;
    });
    this.#liberada = new Promise((resolver) => {
      this.#liberar = resolver;
    });
  }

  liberar(): void {
    this.#liberar();
  }

  override async pendenciasDaConta(_contaId: string): Promise<readonly PendenciaDeExclusao[]> {
    this.#avisarConsulta();
    await this.#liberada;
    return [];
  }
}

interface Cenario {
  identidade: IdentidadeEmMemoria;
  relogio: RelogioFixo;
  hasher: HasherFalso;
  caso: RedefinirSenhaCasoDeUso;
  entrar: EntrarCasoDeUso;
  renovar: RenovarSessaoCasoDeUso;
}

function montar(): Cenario {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  // O hasher rejeita chamada com a transação aberta (S91).
  const hasher = new HasherFalso(identidade.unidade);
  const gerador = new GeradorDeSegredosFalso();
  const emissor = new EmissorDeJwtFalso();
  return {
    identidade,
    relogio,
    hasher,
    caso: new RedefinirSenhaCasoDeUso(
      identidade.unidade,
      relogio,
      identidade.contas,
      identidade.sessoes,
      identidade.codigos,
      identidade.desafios,
      identidade.bloqueios,
      identidade.publicador,
      hasher,
      cifrador,
    ),
    entrar: new EntrarCasoDeUso(
      identidade.unidade,
      relogio,
      identidade.contas,
      identidade.sessoes,
      identidade.bloqueios,
      identidade.desafios,
      identidade.segundoFator,
      hasher,
      cifrador,
      gerador,
      emissor,
    ),
    renovar: new RenovarSessaoCasoDeUso(
      identidade.unidade,
      relogio,
      identidade.contas,
      identidade.sessoes,
      cifrador,
      gerador,
      emissor,
    ),
  };
}

async function inserirConta(
  { identidade }: Cenario,
  { id = CONTA, email = EMAIL, desativada = false } = {},
): Promise<void> {
  const conta = Conta.criar({
    id,
    nome: 'Eva Campos',
    email: Email.criar(email),
    telefone: Telefone.criar('35999991234'),
    senhaHash: HasherFalso.hashDe(SENHA_ANTIGA),
    agora: CRIADA_EM,
  });
  if (desativada) conta.desativar(CRIADA_EM);
  await identidade.contas.inserir(conta);
}

async function emitirCodigo({ identidade }: Cenario, contaId = CONTA, codigo = CODIGO) {
  const registro = CodigoDeVerificacao.emitir({
    id: `0000aaaa-0000-4000-8000-${contaId.slice(-12)}`,
    contaId,
    finalidade: 'recuperacao_senha',
    codigoHmac: cifrador.hmac('recuperacao_senha', [contaId, codigo]),
    agora: AGORA,
  });
  await identidade.codigos.inserir(registro);
  return registro.id;
}

async function abrirSessoes({ identidade }: Cenario): Promise<void> {
  for (const [indice, cliente] of (['app_consumidor', 'app_lojista'] as const).entries()) {
    await identidade.sessoes.inserir(
      Sessao.criar({
        id: `0000bbbb-0000-4000-8000-00000000000${indice + 1}`,
        contaId: CONTA,
        cliente,
        tokenHash: cifrador.hmac('token_renovacao', [`token-${indice}`]),
        mfa: false,
        agora: AGORA,
      }),
    );
  }
}

function entrada(parcial: Partial<EntradaDeRedefinirSenha> = {}): EntradaDeRedefinirSenha {
  return { email: EMAIL, codigo: CODIGO, novaSenha: SENHA_NOVA, ip: IP, ...parcial };
}

function freioDaOrigem({ identidade }: Cenario, ip: string | null = IP) {
  const chave = chaveDoFreioPorOrigem(cifrador, ip);
  return identidade.bloqueios.todos().find((b) => b.tipo === 'ip' && b.chaveHmac === chave);
}

/** Grava `falhas` falhas no freio de origem do `ip`, como fariam outras tentativas. */
async function falhasNaOrigem({ identidade }: Cenario, falhas: number, ip = IP): Promise<void> {
  await identidade.unidade.executar(async () => {
    const freio = await identidade.bloqueios.buscarParaAtualizar(
      chaveDoFreioPorOrigem(cifrador, ip),
      'ip',
      AGORA,
    );
    for (let falha = 0; falha < falhas; falha += 1) freio.registrarFalha(AGORA);
    await identidade.bloqueios.salvar(freio);
  });
}

function freioDoEmail({ identidade }: Cenario, email = EMAIL) {
  const chave = chaveDoFreioPorEmail(cifrador, Email.criar(email));
  return identidade.bloqueios.todos().find((b) => b.tipo === 'email' && b.chaveHmac === chave);
}

describe('RedefinirSenhaCasoDeUso', () => {
  it('o corpo do contrato entra no caso de uso', () => {
    // O `ip` vem do proxy, não do corpo (etapa 16).
    expectTypeOf<RedefinirSenha>().toExtend<Omit<EntradaDeRedefinirSenha, 'ip'>>();
  });

  it('código certo: troca a senha, verifica o e-mail, revoga todas as sessões e publica `SenhaRedefinida` (CA-05, P1-dono)', async () => {
    const cenario = montar();
    const { identidade, caso } = cenario;
    await inserirConta(cenario);
    await abrirSessoes(cenario);
    const codigoId = await emitirCodigo(cenario);

    await expect(caso.executar(entrada())).resolves.toEqual({ tipo: 'redefinida' });

    const conta = identidade.contas.dadosDe(CONTA);
    expect(conta?.senhaHash).toBe(HasherFalso.hashDe(SENHA_NOVA));
    expect(conta?.emailVerificadoEm).toEqual(AGORA);
    expect(conta?.status).toBe('ativa');
    const sessoes = identidade.sessoes.todas();
    expect(sessoes).toHaveLength(2);
    for (const sessao of sessoes) {
      expect(sessao.revogadaEm).toEqual(AGORA);
      expect(sessao.motivoRevogacao).toBe('senha_redefinida');
    }
    expect(identidade.codigos.todos().find((c) => c.id === codigoId)?.usadoEm).toEqual(AGORA);
    expect(identidade.publicador.publicados).toEqual([
      expect.objectContaining({
        tipo: 'identidade.SenhaRedefinida',
        agregadoId: CONTA,
        payload: { contaId: CONTA },
      }),
    ]);
    // Nenhuma sessão nova: a rota responde 204 e a pessoa entra de novo (S1).
    expect(identidade.sessoes.todas().every((s) => s.revogadaEm !== null)).toBe(true);
  });

  it('depois da redefinição, o token de renovação antigo e a senha antiga não valem; a nova entra (CA-05)', async () => {
    const cenario = montar();
    await inserirConta(cenario);
    await abrirSessoes(cenario);
    await emitirCodigo(cenario);
    await cenario.caso.executar(entrada());

    await expect(
      cenario.renovar.executar({ tokenRenovacao: 'token-0', cliente: 'app_consumidor' }),
    ).resolves.toEqual({ tipo: 'invalida' });
    const comum = { email: EMAIL, cliente: 'app_consumidor' as const, ip: '203.0.113.5' };
    await expect(cenario.entrar.executar({ ...comum, senha: SENHA_ANTIGA })).resolves.toEqual({
      tipo: 'credenciais_invalidas',
    });
    await expect(cenario.entrar.executar({ ...comum, senha: SENHA_NOVA })).resolves.toMatchObject({
      tipo: 'sessao',
      sessao: { emailVerificado: true },
    });
  });

  it('o hash da senha nova é calculado também quando o e-mail não tem conta (tempo igual)', async () => {
    const cenario = montar();

    await expect(cenario.caso.executar(entrada())).resolves.toEqual(CODIGO_INVALIDO);

    expect(cenario.hasher.chamadas.gerarHash).toBe(1);
  });

  describe('uso único e 30 min (CA-06)', () => {
    it('o mesmo código não serve duas vezes', async () => {
      const cenario = montar();
      await inserirConta(cenario);
      await emitirCodigo(cenario);
      await cenario.caso.executar(entrada());

      await expect(
        cenario.caso.executar(entrada({ novaSenha: 'outra-senha-qualquer' })),
      ).resolves.toEqual(CODIGO_INVALIDO);

      expect(cenario.identidade.contas.dadosDe(CONTA)?.senhaHash).toBe(
        HasherFalso.hashDe(SENHA_NOVA),
      );
    });

    it('o código vence em 30 min', async () => {
      const cenario = montar();
      await inserirConta(cenario);
      await emitirCodigo(cenario);
      cenario.relogio.avancar(VALIDADE_DO_CODIGO_EM_MS);

      await expect(cenario.caso.executar(entrada())).resolves.toEqual(CODIGO_INVALIDO);

      expect(cenario.identidade.contas.dadosDe(CONTA)?.senhaHash).toBe(
        HasherFalso.hashDe(SENHA_ANTIGA),
      );
    });
  });

  describe('mesma resposta para todo motivo de recusa (CA-06)', () => {
    it.each<[string, (cenario: Cenario) => Promise<void>, Partial<EntradaDeRedefinirSenha>]>([
      [
        'código errado',
        async (c) => {
          await inserirConta(c);
          await emitirCodigo(c);
        },
        { codigo: '000000' },
      ],
      ['e-mail sem conta', () => Promise.resolve(), {}],
      [
        'conta sem código vigente',
        async (c) => {
          await inserirConta(c);
        },
        {},
      ],
      [
        'conta desativada',
        async (c) => {
          await inserirConta(c, { desativada: true });
          await emitirCodigo(c);
        },
        {},
      ],
      [
        'código emitido para outra conta',
        async (c) => {
          await inserirConta(c);
          await emitirCodigo(c);
          await inserirConta(c, { id: OUTRA_CONTA, email: OUTRO_EMAIL });
          await emitirCodigo(c, OUTRA_CONTA, CODIGO_DA_OUTRA);
        },
        { codigo: CODIGO_DA_OUTRA },
      ],
    ])(
      '%s: `codigo_invalido`, uma falha no freio por e-mail, nada muda',
      async (_motivo, preparar, parcial) => {
        const cenario = montar();
        await preparar(cenario);
        const antes = cenario.identidade.contas.dadosDe(CONTA);

        await expect(cenario.caso.executar(entrada(parcial))).resolves.toEqual(CODIGO_INVALIDO);

        expect(cenario.identidade.contas.dadosDe(CONTA)).toEqual(antes);
        expect(freioDoEmail(cenario)?.falhas).toBe(1);
        expect(cenario.identidade.publicador.publicados).toEqual([]);
      },
    );

    it('a tentativa errada fica gravada no código; a quinta mata o código, mesmo com o certo depois', async () => {
      const cenario = montar();
      await inserirConta(cenario);
      const codigoId = await emitirCodigo(cenario);

      await cenario.caso.executar(entrada({ codigo: '000000' }));
      expect(cenario.identidade.codigos.todos().find((c) => c.id === codigoId)?.tentativas).toBe(1);

      for (let falha = 1; falha < 5; falha += 1) {
        await cenario.caso.executar(entrada({ codigo: '000000' }));
      }
      // O freio por e-mail também chegou a 5: espera de 1 min.
      cenario.relogio.avancar(60 * 1000);
      await expect(cenario.caso.executar(entrada())).resolves.toEqual(CODIGO_INVALIDO);
    });
  });

  describe('freio por e-mail (CA-04, S14)', () => {
    it('5 códigos errados freiam: o código certo nem é conferido durante a espera', async () => {
      const cenario = montar();
      await inserirConta(cenario);
      const codigoId = await emitirCodigo(cenario);
      for (let falha = 0; falha < 5; falha += 1) {
        await cenario.caso.executar(entrada({ codigo: '000000' }));
      }

      await expect(cenario.caso.executar(entrada())).resolves.toEqual({
        tipo: 'freado',
        segundosDeEspera: 60,
      });
      const registro = cenario.identidade.codigos.todos().find((c) => c.id === codigoId);
      expect(registro?.tentativas).toBe(5);
      expect(cenario.identidade.contas.dadosDe(CONTA)?.senhaHash).toBe(
        HasherFalso.hashDe(SENHA_ANTIGA),
      );
    });

    it('soma no mesmo freio do login: 4 senhas erradas e 1 código errado freiam o login', async () => {
      const cenario = montar();
      await inserirConta(cenario);
      await emitirCodigo(cenario);
      const login = {
        email: EMAIL,
        senha: 'senha-errada-qualquer',
        cliente: 'app_consumidor' as const,
        ip: '203.0.113.5',
      };
      for (let falha = 0; falha < 4; falha += 1) await cenario.entrar.executar(login);

      await cenario.caso.executar(entrada({ codigo: '000000' }));

      await expect(cenario.entrar.executar({ ...login, senha: SENHA_ANTIGA })).resolves.toEqual({
        tipo: 'freado',
        segundosDeEspera: 60,
      });
    });

    it('o código certo zera o freio por e-mail', async () => {
      const cenario = montar();
      await inserirConta(cenario);
      await emitirCodigo(cenario);
      await cenario.caso.executar(entrada({ codigo: '000000' }));
      expect(freioDoEmail(cenario)?.falhas).toBe(1);

      await expect(cenario.caso.executar(entrada())).resolves.toEqual({ tipo: 'redefinida' });

      expect(freioDoEmail(cenario)).toBeUndefined();
    });
  });

  describe('freio por origem (S93)', () => {
    it('o código errado soma também no freio de IP, com a chave do login', async () => {
      const cenario = montar();
      await inserirConta(cenario);
      await emitirCodigo(cenario);

      await cenario.caso.executar(entrada({ codigo: '000000' }));

      expect(freioDaOrigem(cenario)).toMatchObject({ falhas: 1 });
      expect(freioDoEmail(cenario)).toMatchObject({ falhas: 1 });
    });

    it('e-mail sem conta também soma no freio de IP (quem varre e-mails é freado pela origem)', async () => {
      const cenario = montar();

      await expect(cenario.caso.executar(entrada({ email: OUTRO_EMAIL }))).resolves.toEqual(
        CODIGO_INVALIDO,
      );

      expect(freioDaOrigem(cenario)).toMatchObject({ falhas: 1 });
    });

    it('com o freio de IP ativo: freado, sem conferir o código (o certo não redefine)', async () => {
      const cenario = montar();
      await inserirConta(cenario);
      const codigoId = await emitirCodigo(cenario);
      await falhasNaOrigem(cenario, LIMIAR_DE_FALHAS.ip);

      await expect(cenario.caso.executar(entrada())).resolves.toEqual({
        tipo: 'freado',
        segundosDeEspera: 60,
      });
      const registro = cenario.identidade.codigos.todos().find((c) => c.id === codigoId);
      expect(registro).toMatchObject({ tentativas: 0, usadoEm: null });
      expect(cenario.identidade.contas.dadosDe(CONTA)?.senhaHash).toBe(
        HasherFalso.hashDe(SENHA_ANTIGA),
      );
    });

    it('o freio de IP vale para outro e-mail da mesma origem', async () => {
      const cenario = montar();
      await inserirConta(cenario);
      await falhasNaOrigem(cenario, LIMIAR_DE_FALHAS.ip - 1);

      await cenario.caso.executar(entrada({ email: OUTRO_EMAIL, codigo: '000000' }));

      await expect(cenario.caso.executar(entrada())).resolves.toMatchObject({ tipo: 'freado' });
    });

    it('o código certo não zera o freio de IP, e outra origem não é afetada', async () => {
      const cenario = montar();
      await inserirConta(cenario);
      await emitirCodigo(cenario);
      await falhasNaOrigem(cenario, 3);

      await expect(cenario.caso.executar(entrada())).resolves.toEqual({ tipo: 'redefinida' });

      expect(freioDaOrigem(cenario)).toMatchObject({ falhas: 3 });
      expect(freioDaOrigem(cenario, '203.0.113.9')).toBeUndefined();
    });

    it('sem IP, soma no freio da origem desconhecida (falha fechada)', async () => {
      const cenario = montar();

      await cenario.caso.executar(entrada({ ip: null }));

      expect(freioDaOrigem(cenario, null)).toMatchObject({ falhas: 1 });
      expect(freioDaOrigem(cenario)).toBeUndefined();
    });
  });

  it('os desafios do 2FA emitidos antes da redefinição são apagados e deixam de valer: desafio_invalido (S94, Q29)', async () => {
    const cenario = montar();
    const { identidade } = cenario;
    await inserirConta(cenario);
    await emitirCodigo(cenario);
    const totp = new VerificadorTotpFalso();
    const emitir = async (etapa: 'configurar' | 'verificar', id: string, segredo: string) => {
      await identidade.desafios.inserir(
        DesafioDeSegundoFator.emitir({
          id,
          contaId: CONTA,
          etapa,
          tokenHmac: cifrador.hmac(finalidadeDoDesafio(etapa), [CONTA, segredo]),
          agora: AGORA,
        }),
      );
      return `${id}.${segredo}`;
    };
    const configurar = await emitir('configurar', '0000cccc-0000-4000-8000-000000000001', 's1');
    const verificar = await emitir('verificar', '0000cccc-0000-4000-8000-000000000002', 's2');
    const daOutraConta = DesafioDeSegundoFator.emitir({
      id: '0000cccc-0000-4000-8000-000000000003',
      contaId: OUTRA_CONTA,
      etapa: 'verificar',
      tokenHmac: cifrador.hmac('desafio_verificar', [OUTRA_CONTA, 's3']),
      agora: AGORA,
    });
    await identidade.desafios.inserir(daOutraConta);

    await expect(cenario.caso.executar(entrada())).resolves.toEqual({ tipo: 'redefinida' });

    // Apagados, não só usados: a soma do teto diário do 2FA recomeça (Q29). Os da outra conta
    // e o código de recuperação (já usado) ficam.
    expect(identidade.desafios.todos().map((d) => d.id)).toEqual([daOutraConta.id]);
    expect(identidade.codigos.todos()).toEqual([
      expect.objectContaining({ contaId: CONTA, usadoEm: AGORA }),
    ]);
    const verificarSegundoFator = new VerificarSegundoFatorCasoDeUso(
      identidade.unidade,
      cenario.relogio,
      identidade.contas,
      identidade.desafios,
      identidade.bloqueios,
      identidade.segundoFator,
      identidade.sessoes,
      cifrador,
      new GeradorDeSegredosFalso(),
      totp,
      new EmissorDeJwtFalso(),
      identidade.publicador,
      identidade.auditoria,
    );
    for (const desafio of [configurar, verificar]) {
      await expect(
        verificarSegundoFator.executar({ desafio, codigo: totp.codigoCerto }),
      ).resolves.toEqual({ tipo: 'desafio_invalido' });
    }
  });

  it('a conta sai de ativa entre a leitura e a gravação da senha: desfaz tudo, inclusive o uso do código (S95)', async () => {
    const cenario = montar();
    const { identidade } = cenario;
    await inserirConta(cenario);
    await abrirSessoes(cenario);
    const codigoId = await emitirCodigo(cenario);
    const gravar = identidade.contas.gravarSenhaRedefinida.bind(identidade.contas);
    identidade.contas.gravarSenhaRedefinida = () => Promise.resolve(false);
    try {
      await expect(cenario.caso.executar(entrada())).resolves.toEqual(CODIGO_INVALIDO);
    } finally {
      identidade.contas.gravarSenhaRedefinida = gravar;
    }

    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBe(HasherFalso.hashDe(SENHA_ANTIGA));
    expect(identidade.codigos.todos().find((c) => c.id === codigoId)?.usadoEm).toBeNull();
    expect(identidade.sessoes.todas().every((s) => s.revogadaEm === null)).toBe(true);
    expect(identidade.publicador.publicados).toEqual([]);
  });

  it('corrida com a exclusão: a conta é lida depois do freio, e a redefinição não ressuscita a conta desativada', async () => {
    const cenario = montar();
    const { identidade } = cenario;
    await inserirConta(cenario);
    await abrirSessoes(cenario);
    await emitirCodigo(cenario);
    const pendencias = new PendenciasQueEsperam();
    const exclusao = new SolicitarExclusaoCasoDeUso(
      identidade.unidade,
      identidade.contas,
      identidade.sessoes,
      identidade.bloqueios,
      identidade.solicitacoes,
      pendencias,
      identidade.publicador,
      cenario.hasher,
      cifrador,
      new GeradorDeSegredosFalso(),
      cenario.relogio,
    );

    // A exclusão trava o freio por e-mail e para antes de desativar.
    const excluindo = exclusao.executar({ contaId: CONTA, senha: SENHA_ANTIGA });
    await pendencias.consultada;
    // A redefinição começa com a conta ainda ativa e espera o freio.
    const redefinindo = cenario.caso.executar(entrada());
    pendencias.liberar();

    await expect(excluindo).resolves.toEqual({ tipo: 'desativada' });
    await expect(redefinindo).resolves.toEqual(CODIGO_INVALIDO);
    const conta = identidade.contas.dadosDe(CONTA);
    expect(conta?.status).toBe('desativada');
    expect(conta?.senhaHash).toBe(HasherFalso.hashDe(SENHA_ANTIGA));
    expect(identidade.publicador.tipos).toEqual(['identidade.ContaDesativada']);
  });
});
