// Exclusão com senha (CA-11, S8, S14, S91, S95): desativa e revoga as sessões
// na mesma transação; senha errada soma exatamente uma falha no freio por
// e-mail e devolve `senha_incorreta` (400, nunca 401); freio ativo devolve
// `freado` sem conferir a senha; pendências adiam sem mexer na conta. A senha é
// conferida fora da transação, com a falha já reservada.
import { describe, expect, it } from 'vitest';
import {
  type EventoDeDominio,
  PublicadorDeEventos,
} from '../../../../compartilhado/eventos/publicador.ts';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  ContasEmMemoria,
  criarIdentidadeEmMemoria,
  type IdentidadeEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import {
  CifradorFalso,
  GeradorDeSegredosFalso,
  HasherFalso,
  VerificadorDePendenciasFalso,
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { Conta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import { Sessao } from '../../dominio/sessao.ts';
import { Telefone } from '../../dominio/telefone.ts';
import type { RepositorioDeContas } from '../../dominio/repositorios.ts';
import { SolicitarExclusaoCasoDeUso } from './solicitar-exclusao.ts';

const AGORA = new Date('2026-10-18T12:00:00.000Z');
const CONTA = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';
const OUTRA = '7a2e4d3b-2c3d-4e4f-9a01-23456789abcd';
const EMAIL = 'ana@exemplo.com';
const SENHA = 'senha-certa-da-ana';
const UM_MINUTO_EM_MS = 60 * 1000;

class PublicadorQueFalha extends PublicadorDeEventos {
  override publicar(..._eventos: readonly EventoDeDominio[]): Promise<void> {
    return Promise.reject(new Error('outbox fora do ar'));
  }
}

interface Cenario {
  identidade: IdentidadeEmMemoria;
  relogio: RelogioFixo;
  hasher: HasherFalso;
  cifrador: CifradorFalso;
  pendencias: VerificadorDePendenciasFalso;
  caso: SolicitarExclusaoCasoDeUso;
}

function montar(
  publicador?: PublicadorDeEventos,
  contasDoCenario?: (identidade: IdentidadeEmMemoria) => RepositorioDeContas,
): Cenario {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  // O hasher rejeita chamada com a transação aberta (S91).
  const hasher = new HasherFalso(identidade.unidade);
  const cifrador = new CifradorFalso();
  const pendencias = new VerificadorDePendenciasFalso();
  const caso = new SolicitarExclusaoCasoDeUso(
    identidade.unidade,
    contasDoCenario?.(identidade) ?? identidade.contas,
    identidade.sessoes,
    identidade.bloqueios,
    identidade.solicitacoes,
    pendencias,
    publicador ?? identidade.publicador,
    hasher,
    cifrador,
    new GeradorDeSegredosFalso(),
    relogio,
  );
  return { identidade, relogio, hasher, cifrador, pendencias, caso };
}

async function inserirConta(
  identidade: IdentidadeEmMemoria,
  id = CONTA,
  email = EMAIL,
): Promise<void> {
  await identidade.contas.inserir(
    Conta.criar({
      id,
      nome: 'Ana Souza',
      email: Email.criar(email),
      telefone: Telefone.criar('35999991234'),
      senhaHash: HasherFalso.hashDe(SENHA),
      agora: AGORA,
    }),
  );
}

async function abrirSessoes(identidade: IdentidadeEmMemoria, contaId: string, prefixo: string) {
  const clientes = ['app_consumidor', 'app_lojista', 'painel'] as const;
  for (const [indice, cliente] of clientes.entries()) {
    await identidade.sessoes.inserir(
      Sessao.criar({
        id: `${prefixo}-${indice}`,
        contaId,
        cliente,
        tokenHash: `token-${prefixo}-${indice}`,
        mfa: false,
        agora: AGORA,
      }),
    );
  }
}

function freioDoEmail({ identidade, cifrador }: Cenario, email = EMAIL) {
  const chave = cifrador.hmac('bloqueio_email', [email]);
  return identidade.bloqueios.todos().find((b) => b.tipo === 'email' && b.chaveHmac === chave);
}

describe('SolicitarExclusaoCasoDeUso', () => {
  it('senha certa: desativa na hora, revoga todas as sessões e grava a solicitação pendente (CA-11, S8)', async () => {
    const cenario = montar();
    const { identidade, caso } = cenario;
    await inserirConta(identidade);
    await abrirSessoes(identidade, CONTA, 'ana');

    await expect(caso.executar({ contaId: CONTA, senha: SENHA })).resolves.toEqual({
      tipo: 'desativada',
    });

    const conta = identidade.contas.dadosDe(CONTA);
    expect(conta?.status).toBe('desativada');
    expect(conta?.desativadaEm).toEqual(AGORA);
    // Desativar não apaga nada: a anonimização é depois.
    expect(conta?.nome).toBe('Ana Souza');
    const sessoes = identidade.sessoes.todas();
    expect(sessoes).toHaveLength(3);
    for (const sessao of sessoes) {
      expect(sessao.revogadaEm).toEqual(AGORA);
      expect(sessao.motivoRevogacao).toBe('conta_desativada');
    }
    expect(identidade.solicitacoes.todas()).toEqual([
      {
        id: expect.any(String) as string,
        contaId: CONTA,
        tipo: 'exclusao',
        status: 'pendente',
        solicitadaEm: AGORA,
        concluidaEm: null,
      },
    ]);
    expect(identidade.publicador.publicados).toEqual([
      {
        tipo: 'identidade.ContaDesativada',
        versao: 1,
        agregadoId: CONTA,
        payload: { contaId: CONTA },
      },
    ]);
  });

  it('não toca nas sessões nem na conta de outra pessoa', async () => {
    const { identidade, caso } = montar();
    await inserirConta(identidade);
    await inserirConta(identidade, OUTRA, 'bia@exemplo.com');
    await abrirSessoes(identidade, CONTA, 'ana');
    await abrirSessoes(identidade, OUTRA, 'bia');

    await caso.executar({ contaId: CONTA, senha: SENHA });

    expect(identidade.contas.dadosDe(OUTRA)?.status).toBe('ativa');
    const daOutra = identidade.sessoes.todas().filter((s) => s.contaId === OUTRA);
    expect(daOutra.map((s) => s.revogadaEm)).toEqual([null, null, null]);
  });

  it('desativação, revogação e solicitação ficam juntas: se o evento falha, nada fica (S8)', async () => {
    const { identidade, caso } = montar(new PublicadorQueFalha());
    await inserirConta(identidade);
    await abrirSessoes(identidade, CONTA, 'ana');

    await expect(caso.executar({ contaId: CONTA, senha: SENHA })).rejects.toThrow(
      'outbox fora do ar',
    );

    expect(identidade.contas.dadosDe(CONTA)?.status).toBe('ativa');
    expect(identidade.sessoes.todas().map((s) => s.revogadaEm)).toEqual([null, null, null]);
    expect(identidade.solicitacoes.todas()).toEqual([]);
  });

  describe('senha errada e freio por e-mail (S14)', () => {
    it('uma senha errada soma exatamente uma falha e devolve senha_incorreta, sem mexer na conta', async () => {
      const cenario = montar();
      const { identidade, caso, hasher } = cenario;
      await inserirConta(identidade);
      await abrirSessoes(identidade, CONTA, 'ana');

      await expect(caso.executar({ contaId: CONTA, senha: 'senha-errada' })).resolves.toEqual({
        tipo: 'senha_incorreta',
      });

      expect(freioDoEmail(cenario)?.falhas).toBe(1);
      expect(hasher.chamadas.verificar).toBe(1);
      expect(identidade.contas.dadosDe(CONTA)?.status).toBe('ativa');
      expect(identidade.sessoes.todas().map((s) => s.revogadaEm)).toEqual([null, null, null]);
      expect(identidade.solicitacoes.todas()).toEqual([]);
      expect(identidade.publicador.publicados).toEqual([]);

      await caso.executar({ contaId: CONTA, senha: 'outra-errada' });
      expect(freioDoEmail(cenario)?.falhas).toBe(2);
    });

    it('depois de 5 erradas, até a senha certa recebe freado, sem conferir a senha', async () => {
      const cenario = montar();
      const { identidade, caso, hasher } = cenario;
      await inserirConta(identidade);
      for (let i = 0; i < 5; i += 1) {
        await expect(caso.executar({ contaId: CONTA, senha: 'senha-errada' })).resolves.toEqual({
          tipo: 'senha_incorreta',
        });
      }

      await expect(caso.executar({ contaId: CONTA, senha: SENHA })).resolves.toEqual({
        tipo: 'freado',
        segundosDeEspera: 60,
      });
      expect(hasher.chamadas.verificar).toBe(5);
      expect(identidade.contas.dadosDe(CONTA)?.status).toBe('ativa');

      // Passada a espera de 1 min, a senha certa exclui.
      cenario.relogio.avancar(UM_MINUTO_EM_MS);
      await expect(caso.executar({ contaId: CONTA, senha: SENHA })).resolves.toEqual({
        tipo: 'desativada',
      });
    });

    it('usa o mesmo freio do login: o HMAC do e-mail normalizado com a finalidade bloqueio_email', async () => {
      const cenario = montar();
      const { identidade, caso, cifrador, relogio } = cenario;
      await inserirConta(identidade);
      // Cinco falhas de login gravadas por outro caso de uso, na mesma chave.
      await identidade.unidade.executar(async () => {
        const freio = await identidade.bloqueios.buscarParaAtualizar(
          cifrador.hmac('bloqueio_email', [EMAIL]),
          'email',
          relogio.agora(),
        );
        for (let i = 0; i < 5; i += 1) freio.registrarFalha(relogio.agora());
        await identidade.bloqueios.salvar(freio);
      });

      await expect(caso.executar({ contaId: CONTA, senha: SENHA })).resolves.toMatchObject({
        tipo: 'freado',
      });
    });

    it('a senha certa zera o freio por e-mail, como no login', async () => {
      const cenario = montar();
      const { identidade, caso } = cenario;
      await inserirConta(identidade);
      cenario.pendencias.definir(CONTA, [{ modulo: 'pedidos', tipo: 'pedido_em_andamento' }]);
      await caso.executar({ contaId: CONTA, senha: 'senha-errada' });
      await caso.executar({ contaId: CONTA, senha: 'senha-errada' });
      expect(freioDoEmail(cenario)?.falhas).toBe(2);

      await caso.executar({ contaId: CONTA, senha: SENHA });

      expect(freioDoEmail(cenario)).toBeUndefined();
    });

    it('exclusões simultâneas com a senha errada: a senha é conferida só 5 vezes, o resto é freado (S91)', async () => {
      const cenario = montar();
      await inserirConta(cenario.identidade);

      const resultados = await Promise.all(
        Array.from({ length: 8 }, () =>
          cenario.caso.executar({ contaId: CONTA, senha: 'senha-errada' }),
        ),
      );

      expect(resultados.filter((r) => r.tipo === 'senha_incorreta')).toHaveLength(5);
      expect(resultados.filter((r) => r.tipo === 'freado')).toHaveLength(3);
      expect(cenario.hasher.chamadas.verificar).toBe(5);
    });

    it('senha redefinida entre a conferência e a exclusão: a conferida era a antiga, senha_incorreta e a conta segue ativa', async () => {
      const cenario = montar();
      const { identidade, caso, hasher } = cenario;
      await inserirConta(identidade);
      await abrirSessoes(identidade, CONTA, 'ana');
      const verificar = hasher.verificar.bind(hasher);
      hasher.verificar = async (senha, hash) => {
        const confere = await verificar(senha, hash);
        await identidade.contas.gravarSenhaRedefinida(CONTA, HasherFalso.hashDe('nova'), AGORA);
        return confere;
      };

      await expect(caso.executar({ contaId: CONTA, senha: SENHA })).resolves.toEqual({
        tipo: 'senha_incorreta',
      });
      expect(identidade.contas.dadosDe(CONTA)?.status).toBe('ativa');
      expect(identidade.sessoes.todas().map((s) => s.revogadaEm)).toEqual([null, null, null]);
      expect(freioDoEmail(cenario)?.falhas).toBe(1);
    });

    it('conta sem senha (admin antes da redefinição): gasta o tempo do hash, não confere e soma a falha', async () => {
      const cenario = montar();
      const { identidade, caso, hasher } = cenario;
      await inserirConta(identidade);
      const dados = identidade.contas.dadosDe(CONTA);
      if (dados === undefined) throw new Error('conta não inserida');
      await identidade.contas.atualizar(Conta.reconstituir({ ...dados, senhaHash: null }));

      await expect(caso.executar({ contaId: CONTA, senha: SENHA })).resolves.toEqual({
        tipo: 'senha_incorreta',
      });
      expect(hasher.chamadas.simularVerificacao).toBe(1);
      expect(freioDoEmail(cenario)?.falhas).toBe(1);
      expect(identidade.contas.dadosDe(CONTA)?.status).toBe('ativa');
    });
  });

  describe('pendências (CA-11)', () => {
    it('com pendência, a conta continua ativa, a solicitação aguarda e o aviso traz só módulo e tipo', async () => {
      const { identidade, caso, pendencias } = montar();
      await inserirConta(identidade);
      await abrirSessoes(identidade, CONTA, 'ana');
      pendencias.definir(CONTA, [
        { modulo: 'pedidos', tipo: 'pedido_em_andamento' },
        { modulo: 'repasses', tipo: 'saldo_a_repassar' },
      ]);

      await expect(caso.executar({ contaId: CONTA, senha: SENHA })).resolves.toEqual({
        tipo: 'com_pendencias',
        pendencias: [
          { modulo: 'pedidos', tipo: 'pedido_em_andamento' },
          { modulo: 'repasses', tipo: 'saldo_a_repassar' },
        ],
      });

      expect(identidade.contas.dadosDe(CONTA)?.status).toBe('ativa');
      expect(identidade.sessoes.todas().map((s) => s.revogadaEm)).toEqual([null, null, null]);
      expect(identidade.solicitacoes.todas()).toMatchObject([
        { contaId: CONTA, tipo: 'exclusao', status: 'aguardando_pendencias', concluidaEm: null },
      ]);
      expect(identidade.publicador.publicados).toEqual([]);
    });

    it('pedido repetido reaproveita a solicitação, e ela vira pendente quando a exclusão acontece', async () => {
      const { identidade, caso, pendencias, relogio } = montar();
      await inserirConta(identidade);
      pendencias.definir(CONTA, [{ modulo: 'pedidos', tipo: 'pedido_em_andamento' }]);
      await caso.executar({ contaId: CONTA, senha: SENHA });
      relogio.avancar(60 * UM_MINUTO_EM_MS);
      await caso.executar({ contaId: CONTA, senha: SENHA });
      expect(identidade.solicitacoes.todas()).toHaveLength(1);
      const [aguardando] = identidade.solicitacoes.todas();

      pendencias.definir(CONTA, []);
      relogio.avancar(60 * UM_MINUTO_EM_MS);
      await expect(caso.executar({ contaId: CONTA, senha: SENHA })).resolves.toEqual({
        tipo: 'desativada',
      });

      expect(identidade.solicitacoes.todas()).toEqual([{ ...aguardando, status: 'pendente' }]);
      expect(identidade.contas.dadosDe(CONTA)?.status).toBe('desativada');
    });

    it('consulta de pendências que falha rejeita e não desativa nada (na dúvida, não exclui)', async () => {
      const { identidade, caso, pendencias } = montar();
      await inserirConta(identidade);
      await abrirSessoes(identidade, CONTA, 'ana');
      pendencias.falharNaProxima();

      await expect(caso.executar({ contaId: CONTA, senha: SENHA })).rejects.toThrow(
        'Falha simulada',
      );

      expect(identidade.contas.dadosDe(CONTA)?.status).toBe('ativa');
      expect(identidade.sessoes.todas().map((s) => s.revogadaEm)).toEqual([null, null, null]);
      expect(identidade.solicitacoes.todas()).toEqual([]);
    });

    it('com a senha errada, as pendências nem são consultadas', async () => {
      const { identidade, caso, pendencias } = montar();
      await inserirConta(identidade);
      pendencias.falharNaProxima();

      await expect(caso.executar({ contaId: CONTA, senha: 'senha-errada' })).resolves.toEqual({
        tipo: 'senha_incorreta',
      });
    });
  });

  it('conta desativada entre a conferência e a exclusão: conta_indisponivel, sem revogar nem gravar nada', async () => {
    const cenario = montar();
    const { identidade, caso, hasher } = cenario;
    await inserirConta(identidade);
    const verificar = hasher.verificar.bind(hasher);
    hasher.verificar = async (senha, hash) => {
      const confere = await verificar(senha, hash);
      await identidade.contas.gravarDesativacao(CONTA, AGORA);
      return confere;
    };

    await expect(caso.executar({ contaId: CONTA, senha: SENHA })).resolves.toEqual({
      tipo: 'conta_indisponivel',
    });
    expect(identidade.solicitacoes.todas()).toEqual([]);
    expect(identidade.publicador.publicados).toEqual([]);
  });

  it('a desativação não acha a conta ativa (gravarDesativacao devolve false): desfaz tudo e responde conta_indisponivel (S95)', async () => {
    class ContasQueNaoDesativam extends ContasEmMemoria {
      override gravarDesativacao(): Promise<boolean> {
        return Promise.resolve(false);
      }
    }
    let contas: ContasQueNaoDesativam | undefined;
    const cenario = montar(undefined, (identidade) => {
      contas = new ContasQueNaoDesativam(identidade.unidade);
      return contas;
    });
    if (contas === undefined) throw new Error('repositório de contas não montado');
    const { identidade, caso } = cenario;
    await contas.inserir(
      Conta.criar({
        id: CONTA,
        nome: 'Ana Souza',
        email: Email.criar(EMAIL),
        telefone: Telefone.criar('35999991234'),
        senhaHash: HasherFalso.hashDe(SENHA),
        agora: AGORA,
      }),
    );
    await abrirSessoes(identidade, CONTA, 'ana');

    await expect(caso.executar({ contaId: CONTA, senha: SENHA })).resolves.toEqual({
      tipo: 'conta_indisponivel',
    });
    expect(identidade.sessoes.todas().map((s) => s.revogadaEm)).toEqual([null, null, null]);
    expect(identidade.solicitacoes.todas()).toEqual([]);
    expect(identidade.publicador.publicados).toEqual([]);
    // O zerar do freio foi desfeito junto: a falha reservada fica.
    expect(freioDoEmail(cenario)?.falhas).toBe(1);
  });

  it('conta que já não está ativa (corrida com outra exclusão): conta_indisponivel, sem conferir a senha', async () => {
    const { identidade, caso, hasher } = montar();
    await inserirConta(identidade);
    await caso.executar({ contaId: CONTA, senha: SENHA });

    await expect(caso.executar({ contaId: CONTA, senha: SENHA })).resolves.toEqual({
      tipo: 'conta_indisponivel',
    });
    await expect(caso.executar({ contaId: OUTRA, senha: SENHA })).resolves.toEqual({
      tipo: 'conta_indisponivel',
    });
    expect(hasher.chamadas.verificar).toBe(1);
    expect(identidade.solicitacoes.todas()).toHaveLength(1);
  });
});
