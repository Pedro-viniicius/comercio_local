// Retenção da Identidade (S81, P12, S10; plano 01b, etapa 13): cada prazo com
// uma linha logo antes e outra logo depois. Freios: `greatest(bloqueado_ate,
// janela_inicio) < agora - 30 min`; sessões: `coalesce(revogada_em, expira_em)
// < agora - 30 dias`, com o histórico de tokens; códigos e desafios:
// `coalesce(usado_em, expira_em) < agora - 1 dia`.
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  criarIdentidadeEmMemoria,
  type IdentidadeEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import { BloqueioDeLogin } from '../../dominio/bloqueio-de-login.ts';
import {
  CodigoDeVerificacao,
  VALIDADE_DO_CODIGO_EM_MS,
} from '../../dominio/codigo-de-verificacao.ts';
import { Conta } from '../../dominio/conta.ts';
import {
  DesafioDeSegundoFator,
  VALIDADE_DO_DESAFIO_EM_MS,
} from '../../dominio/desafio-de-segundo-fator.ts';
import { Email } from '../../dominio/email.ts';
import { Sessao } from '../../dominio/sessao.ts';
import { Telefone } from '../../dominio/telefone.ts';
import {
  RETENCAO_DAS_SESSOES_EM_MS,
  RETENCAO_DOS_CODIGOS_EM_MS,
  RETENCAO_DOS_FREIOS_EM_MS,
  ReterDadosDaIdentidadeTarefa,
} from './reter-dados.tarefa.ts';

const AGORA = new Date('2026-10-20T03:45:00.000Z');
const CONTA = 'c0c0c0c0-0000-4000-8000-000000000001';
const T = AGORA.getTime();

function id(n: number): string {
  return `d0d0d0d0-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

async function montar() {
  const identidade = criarIdentidadeEmMemoria();
  await identidade.contas.inserir(
    Conta.criar({
      id: CONTA,
      nome: 'Pessoa de Teste',
      email: Email.criar('pessoa@exemplo.com'),
      telefone: Telefone.criar('35999991234'),
      senhaHash: 'hash-falso:senha',
      agora: new Date(T - 90 * 24 * 60 * 60 * 1000),
    }),
  );
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const tarefa = new ReterDadosDaIdentidadeTarefa(
    identidade.unidade,
    new RelogioFixo(AGORA),
    identidade.bloqueios,
    identidade.sessoes,
    identidade.codigos,
    identidade.exportacoes,
    logger as unknown as PinoLogger,
  );
  return { identidade, tarefa };
}

async function freio(
  identidade: IdentidadeEmMemoria,
  chave: string,
  janelaInicio: number,
  bloqueadoAte: number | null,
): Promise<void> {
  await identidade.bloqueios.salvar(
    BloqueioDeLogin.reconstituir({
      chaveHmac: chave,
      tipo: 'email',
      falhas: bloqueadoAte === null ? 1 : 0,
      nivel: bloqueadoAte === null ? 0 : 1,
      janelaInicio: new Date(janelaInicio),
      bloqueadoAte: bloqueadoAte === null ? null : new Date(bloqueadoAte),
    }),
  );
}

describe('ReterDadosDaIdentidadeTarefa: freios (30 min)', () => {
  it('apaga pelo maior entre o fim da espera e o início da janela, com uma linha de cada lado', async () => {
    const { identidade, tarefa } = await montar();
    const limite = T - RETENCAO_DOS_FREIOS_EM_MS;
    await freio(identidade, 'janela-antes', limite - 1, null);
    await freio(identidade, 'janela-no-limite', limite, null);
    await freio(identidade, 'espera-antes', limite - 60_000, limite - 1);
    await freio(identidade, 'espera-depois', limite - 60_000, limite + 1);
    // Espera antiga, mas janela nova aberta depois dela: o `coalesce` do S81 apagaria.
    await freio(identidade, 'janela-nova-depois-de-espera-antiga', limite + 1, null);
    await identidade.bloqueios.salvar(
      BloqueioDeLogin.reconstituir({
        chaveHmac: 'janela-nova-com-espera-antiga',
        tipo: 'ip',
        falhas: 2,
        nivel: 1,
        janelaInicio: new Date(limite + 1),
        bloqueadoAte: new Date(limite - 10 * 60_000),
      }),
    );

    const resultado = await tarefa.executar();

    expect(resultado.freios).toBe(2);
    expect(
      identidade.bloqueios
        .todos()
        .map((b) => b.chaveHmac)
        .sort(),
    ).toEqual([
      'espera-depois',
      'janela-no-limite',
      'janela-nova-com-espera-antiga',
      'janela-nova-depois-de-espera-antiga',
    ]);
  });
});

describe('ReterDadosDaIdentidadeTarefa: sessões (30 dias)', () => {
  function sessao(n: number, criadaEm: number): Sessao {
    return Sessao.criar({
      id: id(n),
      contaId: CONTA,
      cliente: 'app_consumidor',
      tokenHash: `hash-${n}`,
      mfa: false,
      agora: new Date(criadaEm),
    });
  }

  it('apaga a revogada ou vencida antes do prazo, com o histórico de tokens; a do limite fica', async () => {
    const { identidade, tarefa } = await montar();
    const limite = T - RETENCAO_DAS_SESSOES_EM_MS;
    const duracao = 30 * 24 * 60 * 60 * 1000;
    // Vencidas: a sessão dos apps vence 30 dias depois de criada (sem uso).
    await identidade.sessoes.inserir(sessao(1, limite - duracao - 1));
    await identidade.sessoes.inserir(sessao(2, limite - duracao));
    // Revogadas: o momento da revogação conta, não o vencimento.
    const revogadaAntes = sessao(3, limite - 1000);
    revogadaAntes.revogar('logout', new Date(limite - 1));
    await identidade.sessoes.inserir(revogadaAntes);
    const revogadaDepois = sessao(4, limite - 1000);
    revogadaDepois.revogar('logout', new Date(limite + 1));
    await identidade.sessoes.inserir(revogadaDepois);
    // Ativa e recente.
    await identidade.sessoes.inserir(sessao(5, T - 60_000));

    const resultado = await tarefa.executar();

    expect(resultado.sessoes).toBe(2);
    expect(
      identidade.sessoes
        .todas()
        .map((s) => s.id)
        .sort(),
    ).toEqual([id(2), id(4), id(5)]);
  });

  it('o histórico de tokens usados sai com a sessão (FK em cascata)', async () => {
    const { identidade, tarefa } = await montar();
    const UM_DIA = 24 * 60 * 60 * 1000;
    await identidade.sessoes.inserir(sessao(1, T - 120 * UM_DIA));
    await identidade.sessoes.inserir(sessao(2, T - 60_000));
    // Uma renovação há 119 dias: o token trocado vai para o histórico (S77).
    await identidade.unidade.executar(async () => {
      const antiga = await identidade.sessoes.buscarPorId(id(1));
      antiga?.rotacionar('hash-novo', 'par-cifrado', new Date(T - 119 * UM_DIA));
      if (antiga) await identidade.sessoes.gravarRotacao(antiga);
    });
    expect(identidade.sessoes.tokensUsados().map((t) => t.sessaoId)).toEqual([id(1)]);

    await tarefa.executar();

    expect(identidade.sessoes.todas().map((s) => s.id)).toEqual([id(2)]);
    expect(identidade.sessoes.tokensUsados()).toEqual([]);
  });
});

describe('ReterDadosDaIdentidadeTarefa: códigos e desafios (1 dia)', () => {
  it('apaga os usados ou vencidos antes do prazo, das duas famílias; os do limite ficam', async () => {
    const { identidade, tarefa } = await montar();
    const limite = T - RETENCAO_DOS_CODIGOS_EM_MS;
    const codigo = (n: number, emitidoEm: number) =>
      CodigoDeVerificacao.emitir({
        id: id(n),
        contaId: CONTA,
        finalidade: 'recuperacao_senha',
        codigoHmac: `hmac-${n}`,
        agora: new Date(emitidoEm),
      });
    // Não usados: conta o vencimento (30 min depois da emissão).
    await identidade.codigos.inserir(codigo(1, limite - VALIDADE_DO_CODIGO_EM_MS - 1));
    await identidade.codigos.inserir(codigo(2, limite - VALIDADE_DO_CODIGO_EM_MS));
    // Usado: conta o uso, mesmo com o vencimento depois do limite.
    const usadoAntes = codigo(3, limite - 60_000);
    usadoAntes.invalidar(new Date(limite - 1));
    await identidade.codigos.inserir(usadoAntes);
    const usadoDepois = codigo(4, limite - 60_000);
    usadoDepois.invalidar(new Date(limite + 1));
    await identidade.codigos.inserir(usadoDepois);
    // Desafios do 2FA (mesma tabela no banco).
    const desafio = (n: number, emitidoEm: number) =>
      DesafioDeSegundoFator.emitir({
        id: id(n),
        contaId: CONTA,
        etapa: 'verificar',
        tokenHmac: `hmac-${n}`,
        agora: new Date(emitidoEm),
      });
    await identidade.desafios.inserir(desafio(5, limite - VALIDADE_DO_DESAFIO_EM_MS - 1));
    await identidade.desafios.inserir(desafio(6, limite - VALIDADE_DO_DESAFIO_EM_MS));

    const resultado = await tarefa.executar();

    expect(resultado.codigos).toBe(3);
    expect(
      identidade.codigos
        .todos()
        .map((c) => c.id)
        .sort(),
    ).toEqual([id(2), id(4)]);
    expect(identidade.desafios.todos().map((d) => d.id)).toEqual([id(6)]);
  });
});

describe('ReterDadosDaIdentidadeTarefa: cópias dos dados (S10)', () => {
  it('apaga a vencida e a já baixada; a disponível fica', async () => {
    const { identidade, tarefa } = await montar();
    const exportacao = (n: number, expiraEm: number, baixadaEm: number | null) => ({
      id: id(n),
      contaId: CONTA,
      conteudoCifrado: 'cifrado',
      criadaEm: new Date(expiraEm - 7 * 24 * 60 * 60 * 1000),
      expiraEm: new Date(expiraEm),
      baixadaEm: baixadaEm === null ? null : new Date(baixadaEm),
    });
    await identidade.exportacoes.inserir(exportacao(1, T - 1, null));
    await identidade.exportacoes.inserir(exportacao(2, T + 60_000, T - 60_000));
    await identidade.exportacoes.inserir(exportacao(3, T + 60_000, null));

    const resultado = await tarefa.executar();

    expect(resultado.exportacoes).toBe(2);
    expect(identidade.exportacoes.todas().map((e) => e.id)).toEqual([id(3)]);
  });
});
