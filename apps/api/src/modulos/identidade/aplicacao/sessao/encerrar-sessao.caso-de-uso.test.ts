// Logout (CA-05, S8, S80; plano 01b, etapa 9): pelo `sid` do token de acesso ou
// pelo token de renovação do cookie do painel; revoga com `logout` no servidor,
// é idempotente e não erra com token desconhecido.
import { describe, expect, it } from 'vitest';
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
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { Conta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import { Sessao } from '../../dominio/sessao.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { EncerrarSessaoCasoDeUso } from './encerrar-sessao.caso-de-uso.ts';
import { RenovarSessaoCasoDeUso } from './renovar-sessao.caso-de-uso.ts';

const AGORA = new Date('2026-10-18T12:00:00.000Z');
const CONTA = 'cccccccc-0000-4000-8000-000000000001';
const OUTRA_CONTA = 'cccccccc-0000-4000-8000-000000000002';
const SID_DO_APP = 'ffffffff-0000-4000-8000-000000000001';
const SID_DO_PAINEL = 'ffffffff-0000-4000-8000-000000000002';
const SID_DO_OUTRO_APP = 'ffffffff-0000-4000-8000-000000000003';
const UM_MINUTO_EM_MS = 60 * 1000;

const cifrador = new CifradorFalso();

interface Cenario {
  identidade: IdentidadeEmMemoria;
  relogio: RelogioFixo;
  caso: EncerrarSessaoCasoDeUso;
  renovar: RenovarSessaoCasoDeUso;
}

function montar(): Cenario {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  return {
    identidade,
    relogio,
    caso: new EncerrarSessaoCasoDeUso(identidade.unidade, relogio, identidade.sessoes, cifrador),
    renovar: new RenovarSessaoCasoDeUso(
      identidade.unidade,
      relogio,
      identidade.contas,
      identidade.sessoes,
      cifrador,
      new GeradorDeSegredosFalso(),
      new EmissorDeJwtFalso(),
    ),
  };
}

async function preparar({ identidade }: Cenario): Promise<void> {
  const conta = Conta.criar({
    id: CONTA,
    nome: 'Caio Reis',
    email: Email.criar('caio@exemplo.com'),
    telefone: Telefone.criar('35999991234'),
    senhaHash: HasherFalso.hashDe('senha-do-caio'),
    agora: AGORA,
  });
  conta.concederAdmin(AGORA);
  await identidade.contas.inserir(conta);
  const sessoes: [string, 'app_consumidor' | 'app_lojista' | 'painel', boolean][] = [
    [SID_DO_APP, 'app_consumidor', false],
    [SID_DO_PAINEL, 'painel', true],
    [SID_DO_OUTRO_APP, 'app_lojista', false],
  ];
  for (const [id, cliente, mfa] of sessoes) {
    await identidade.sessoes.inserir(
      Sessao.criar({
        id,
        contaId: CONTA,
        cliente,
        tokenHash: cifrador.hmac('token_renovacao', [`token-${id}`]),
        mfa,
        agora: AGORA,
      }),
    );
  }
}

function revogacao({ identidade }: Cenario, sid: string) {
  const dados = identidade.sessoes.dadosDe(sid);
  return { revogadaEm: dados?.revogadaEm, motivo: dados?.motivoRevogacao };
}

describe('EncerrarSessaoCasoDeUso', () => {
  describe('pelo `sid` do token de acesso (apps)', () => {
    it('revoga só a sessão do token com `logout`, e o token de renovação dela deixa de valer (CA-05)', async () => {
      const cenario = montar();
      await preparar(cenario);

      await expect(cenario.caso.executar({ contaId: CONTA, sid: SID_DO_APP })).resolves.toBe(
        undefined,
      );

      expect(revogacao(cenario, SID_DO_APP)).toEqual({ revogadaEm: AGORA, motivo: 'logout' });
      expect(revogacao(cenario, SID_DO_OUTRO_APP).revogadaEm).toBeNull();
      expect(revogacao(cenario, SID_DO_PAINEL).revogadaEm).toBeNull();
      await expect(
        cenario.renovar.executar({
          tokenRenovacao: `token-${SID_DO_APP}`,
          cliente: 'app_consumidor',
        }),
      ).resolves.toEqual({ tipo: 'invalida' });
    });

    it('idempotente: a segunda chamada não muda a data nem o motivo da primeira revogação', async () => {
      const cenario = montar();
      await preparar(cenario);
      await cenario.caso.executar({ contaId: CONTA, sid: SID_DO_APP });
      cenario.relogio.avancar(5 * UM_MINUTO_EM_MS);

      await expect(cenario.caso.executar({ contaId: CONTA, sid: SID_DO_APP })).resolves.toBe(
        undefined,
      );

      expect(revogacao(cenario, SID_DO_APP)).toEqual({ revogadaEm: AGORA, motivo: 'logout' });
    });

    it('sessão revogada antes por outro motivo continua com ele', async () => {
      const cenario = montar();
      await preparar(cenario);
      await cenario.identidade.sessoes.revogarDaConta(CONTA, 'senha_redefinida', AGORA);
      cenario.relogio.avancar(UM_MINUTO_EM_MS);

      await cenario.caso.executar({ contaId: CONTA, sid: SID_DO_APP });

      expect(revogacao(cenario, SID_DO_APP)).toEqual({
        revogadaEm: AGORA,
        motivo: 'senha_redefinida',
      });
    });

    it('`sid` de outra conta ou inexistente: nada muda e não há erro', async () => {
      const cenario = montar();
      await preparar(cenario);

      await expect(
        cenario.caso.executar({ contaId: OUTRA_CONTA, sid: SID_DO_APP }),
      ).resolves.toBeUndefined();
      await expect(
        cenario.caso.executar({ contaId: CONTA, sid: 'ffffffff-0000-4000-8000-0000000000ff' }),
      ).resolves.toBeUndefined();

      expect(cenario.identidade.sessoes.todas().every((s) => s.revogadaEm === null)).toBe(true);
    });
  });

  describe('pelo token de renovação do cookie (painel, S80)', () => {
    it('revoga a sessão do token atual com `logout`', async () => {
      const cenario = montar();
      await preparar(cenario);

      await cenario.caso.executar({ tokenRenovacao: `token-${SID_DO_PAINEL}` });

      expect(revogacao(cenario, SID_DO_PAINEL)).toEqual({ revogadaEm: AGORA, motivo: 'logout' });
      expect(revogacao(cenario, SID_DO_APP).revogadaEm).toBeNull();
    });

    it('com o token recém-trocado (cookie que não chegou a ser atualizado), revoga a mesma sessão', async () => {
      const cenario = montar();
      await preparar(cenario);
      const renovada = await cenario.renovar.executar({
        tokenRenovacao: `token-${SID_DO_PAINEL}`,
        cliente: 'painel',
      });
      expect(renovada.tipo).toBe('renovada');

      await cenario.caso.executar({ tokenRenovacao: `token-${SID_DO_PAINEL}` });

      expect(revogacao(cenario, SID_DO_PAINEL).motivo).toBe('logout');
    });

    it('com um token mais antigo, achado só no histórico (S77), revoga o que vive da família', async () => {
      const cenario = montar();
      await preparar(cenario);
      let token = `token-${SID_DO_PAINEL}`;
      for (let vez = 0; vez < 2; vez += 1) {
        const resultado = await cenario.renovar.executar({
          tokenRenovacao: token,
          cliente: 'painel',
        });
        if (resultado.tipo !== 'renovada') throw new Error('a renovação deveria passar');
        token = resultado.sessao.tokenRenovacao;
      }

      await cenario.caso.executar({ tokenRenovacao: `token-${SID_DO_PAINEL}` });

      expect(revogacao(cenario, SID_DO_PAINEL)).toEqual({ revogadaEm: AGORA, motivo: 'logout' });
      expect(revogacao(cenario, SID_DO_APP).revogadaEm).toBeNull();
    });

    it('token desconhecido: nada muda e não há erro', async () => {
      const cenario = montar();
      await preparar(cenario);

      await expect(
        cenario.caso.executar({ tokenRenovacao: 'token-que-nunca-existiu' }),
      ).resolves.toBeUndefined();

      expect(cenario.identidade.sessoes.todas().every((s) => s.revogadaEm === null)).toBe(true);
    });
  });
});
