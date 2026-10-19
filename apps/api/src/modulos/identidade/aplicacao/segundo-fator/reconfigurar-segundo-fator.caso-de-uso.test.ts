// Reconfiguração do 2FA pela CLI (01b, etapa 10; S1, S97, S99): apaga o
// segundo fator e os códigos, invalida os desafios, apaga a senha e pede a
// recuperação pelo e-mail, revoga as sessões e audita com o operador, só com
// ids; o próximo login no painel volta a `configurar` (CA-09), depois da senha
// nova.
import { describe, expect, it, vi } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  CifradorFalso,
  GeradorDeSegredosFalso,
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { criarIdentidadeEmMemoria } from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import { BloqueioDeLogin } from '../../dominio/bloqueio-de-login.ts';
import { Conta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import { Sessao } from '../../dominio/sessao.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { chaveDoFreioPorEmail } from '../comum/chaves.ts';
import { chaveDoFreioDeSegundoFator, emitirDesafioDeSegundoFator } from './comum.ts';
import { ReconfigurarSegundoFatorCasoDeUso } from './reconfigurar-segundo-fator.caso-de-uso.ts';

const AGORA = new Date('2026-10-18T12:00:00.000Z');
const CONTA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OUTRA_CONTA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OPERADOR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EMAIL = 'ana.admin@exemplo.com';

/** Pela entrada padrão da CLI: o e-mail, com o operador. */
function peloEmail(email: string, operadorId = OPERADOR) {
  return { conta: { email }, operadorId };
}

function conta(id: string, email: string, admin: boolean): Conta {
  const nova = Conta.criar({
    id,
    nome: 'Ana Admin',
    email: Email.criar(email),
    telefone: Telefone.criar('35999991234'),
    senhaHash: 'hash-falso:senha',
    agora: AGORA,
  });
  if (admin) nova.concederAdmin(AGORA);
  return nova;
}

async function cenario() {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  const cifrador = new CifradorFalso();
  const gerador = new GeradorDeSegredosFalso();
  await identidade.contas.inserir(conta(CONTA, EMAIL, true));
  await identidade.contas.inserir(conta(OUTRA_CONTA, 'bia.admin@exemplo.com', true));
  await identidade.contas.inserir(conta(OPERADOR, 'dono@exemplo.com', true));
  for (const id of [CONTA, OUTRA_CONTA]) {
    await identidade.segundoFator.salvar({
      contaId: id,
      segredoCifrado: `cifrado-${id}`,
      confirmadoEm: AGORA,
      ultimoPassoUsado: 3,
    });
    await identidade.segundoFator.substituirCodigosDeRecuperacao(id, [
      {
        id: `${id.slice(0, 8)}-0000-4000-8000-000000000001`,
        contaId: id,
        codigoHmac: 'h',
        usadoEm: null,
      },
    ]);
  }
  let sessao = 0;
  const comSessao = async (contaId: string, cliente: 'painel' | 'app_consumidor') => {
    sessao += 1;
    await identidade.sessoes.inserir(
      Sessao.criar({
        id: `eeeeeeee-eeee-4eee-8eee-00000000000${sessao}`,
        contaId,
        cliente,
        tokenHash: `token-${sessao}`,
        mfa: cliente === 'painel',
        agora: AGORA,
      }),
    );
  };
  await comSessao(CONTA, 'painel');
  await comSessao(CONTA, 'app_consumidor');
  await comSessao(OUTRA_CONTA, 'painel');

  const emitir = (contaId = CONTA) =>
    identidade.unidade.executar(() =>
      emitirDesafioDeSegundoFator(
        { desafios: identidade.desafios, segundoFator: identidade.segundoFator, cifrador, gerador },
        contaId,
        relogio.agora(),
      ),
    );
  const reconfigurar = new ReconfigurarSegundoFatorCasoDeUso(
    identidade.unidade,
    relogio,
    identidade.contas,
    identidade.desafios,
    identidade.bloqueios,
    identidade.segundoFator,
    identidade.sessoes,
    identidade.auditoria,
    identidade.publicador,
    cifrador,
  );
  return { identidade, cifrador, reconfigurar, emitir };
}

describe('ReconfigurarSegundoFatorCasoDeUso', () => {
  it('apaga o segundo fator e os códigos, revoga todas as sessões da conta e só dela', async () => {
    const { identidade, reconfigurar } = await cenario();

    const resultado = await reconfigurar.executar(peloEmail('  Ana.Admin@Exemplo.com '));

    expect(resultado).toEqual({ tipo: 'reconfigurado', contaId: CONTA, sessoesRevogadas: 2 });
    expect(await identidade.segundoFator.buscar(CONTA)).toBeNull();
    expect(identidade.segundoFator.codigosDeRecuperacao().map((c) => c.contaId)).toEqual([
      OUTRA_CONTA,
    ]);
    expect(await identidade.segundoFator.buscar(OUTRA_CONTA)).not.toBeNull();
    for (const sessao of identidade.sessoes.todas()) {
      if (sessao.contaId === CONTA) {
        expect(sessao).toMatchObject({
          revogadaEm: AGORA,
          motivoRevogacao: 'segundo_fator_reconfigurado',
        });
      } else {
        expect(sessao.revogadaEm).toBeNull();
      }
    }
  });

  it('invalida os desafios vivos da conta, e o próximo login volta a configurar (CA-09)', async () => {
    const { identidade, reconfigurar, emitir } = await cenario();
    const antes = await emitir();
    const daOutra = await emitir(OUTRA_CONTA);
    expect(antes.etapa).toBe('verificar');

    await reconfigurar.executar(peloEmail(EMAIL));

    const desafios = identidade.desafios.todos();
    expect(desafios.find((d) => d.contaId === CONTA)?.usadoEm).toEqual(AGORA);
    expect(desafios.find((d) => daOutra.desafio.startsWith(d.id))?.usadoEm).toBeNull();
    expect((await emitir()).etapa).toBe('configurar');
  });

  it('registra na auditoria o operador como ator, só com ids e a contagem, nunca o e-mail (S99)', async () => {
    const { identidade, reconfigurar } = await cenario();
    await reconfigurar.executar(peloEmail(EMAIL));

    expect(identidade.auditoria.entradas).toEqual([
      {
        atorTipo: 'admin',
        atorId: OPERADOR,
        acao: 'segundo_fator_reconfigurado',
        recurso: 'conta',
        recursoId: CONTA,
        depois: { sessoesRevogadas: 2, senhaRemovida: true },
        origem: 'cli',
      },
    ]);
    expect(JSON.stringify(identidade.auditoria.entradas)).not.toContain('ana');
    expect(JSON.stringify(identidade.auditoria.entradas)).not.toContain('dono');
  });

  it('apaga a senha e pede a recuperação pelo e-mail: a nova configuração exige o e-mail (S97)', async () => {
    const { identidade, reconfigurar } = await cenario();

    await reconfigurar.executar(peloEmail(EMAIL));

    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).toBeNull();
    expect(identidade.contas.dadosDe(OUTRA_CONTA)?.senhaHash).not.toBeNull();
    expect(identidade.publicador.publicados).toEqual([
      {
        tipo: 'identidade.RecuperacaoSolicitada',
        versao: 1,
        agregadoId: CONTA,
        payload: { contaId: CONTA },
      },
    ]);
  });

  it('pela conta (`--conta <uuid>`), sem e-mail nenhum', async () => {
    const { identidade, reconfigurar } = await cenario();
    await expect(
      reconfigurar.executar({ conta: { contaId: CONTA }, operadorId: OPERADOR }),
    ).resolves.toEqual({ tipo: 'reconfigurado', contaId: CONTA, sessoesRevogadas: 2 });
    expect(await identidade.segundoFator.buscar(CONTA)).toBeNull();
    await expect(
      reconfigurar.executar({ conta: { contaId: 'nao-e-uuid' }, operadorId: OPERADOR }),
    ).resolves.toEqual({ tipo: 'conta_nao_encontrada' });
  });

  it.each([
    ['inexistente', 'eeeeeeee-0000-4000-8000-000000000099'],
    ['que não é UUID', 'operador'],
    ['sem o perfil admin', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
  ])('operador %s: operador_invalido, nada muda (S99)', async (_caso, operadorId) => {
    const { identidade, reconfigurar } = await cenario();
    await identidade.contas.inserir(
      conta('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'cliente@exemplo.com', false),
    );
    await expect(reconfigurar.executar(peloEmail(EMAIL, operadorId))).resolves.toEqual({
      tipo: 'operador_invalido',
    });
    expect(await identidade.segundoFator.buscar(CONTA)).not.toBeNull();
    expect(identidade.auditoria.entradas).toEqual([]);
  });

  it('operador desativado: operador_invalido', async () => {
    const { identidade, reconfigurar } = await cenario();
    await identidade.contas.gravarDesativacao(OPERADOR, AGORA);
    await expect(reconfigurar.executar(peloEmail(EMAIL))).resolves.toEqual({
      tipo: 'operador_invalido',
    });
  });

  it('o próprio admin pode ser o operador (o dono que perdeu o celular)', async () => {
    const { reconfigurar } = await cenario();
    await expect(reconfigurar.executar(peloEmail(EMAIL, CONTA))).resolves.toMatchObject({
      tipo: 'reconfigurado',
    });
  });

  it('conta admin desativada: conta_inativa, nada muda', async () => {
    const { identidade, reconfigurar } = await cenario();
    await identidade.contas.gravarDesativacao(CONTA, AGORA);
    await expect(reconfigurar.executar(peloEmail(EMAIL))).resolves.toEqual({
      tipo: 'conta_inativa',
    });
    expect(await identidade.segundoFator.buscar(CONTA)).not.toBeNull();
    expect(identidade.publicador.publicados).toEqual([]);
  });

  it('a conta sai de ativa antes de a senha ser apagada: desfaz tudo e responde conta_inativa', async () => {
    const { identidade, reconfigurar } = await cenario();
    identidade.contas.gravarSenhaRemovida = () => Promise.resolve(false);

    await expect(reconfigurar.executar(peloEmail(EMAIL))).resolves.toEqual({
      tipo: 'conta_inativa',
    });
    expect(await identidade.segundoFator.buscar(CONTA)).not.toBeNull();
    expect(identidade.sessoes.todas().every((s) => s.revogadaEm === null)).toBe(true);
    expect(identidade.publicador.publicados).toEqual([]);
    expect(identidade.auditoria.entradas).toEqual([]);
  });

  it('o freio de segundo fator fica como está (só zera com o segundo fator concluído)', async () => {
    const { identidade, reconfigurar, cifrador } = await cenario();
    const freio = BloqueioDeLogin.reconstituir({
      chaveHmac: chaveDoFreioDeSegundoFator(cifrador, CONTA),
      tipo: 'segundo_fator',
      falhas: 3,
      nivel: 1,
      janelaInicio: AGORA,
      bloqueadoAte: null,
    });
    await identidade.bloqueios.salvar(freio);

    await reconfigurar.executar(peloEmail(EMAIL));

    expect(identidade.bloqueios.todos()).toEqual([freio.dados]);
  });

  it('trava o freio por e-mail da conta antes dos desafios, do freio de 2FA e da senha (A-R13)', async () => {
    const { identidade, reconfigurar, cifrador } = await cenario();
    const travaFreio = vi.spyOn(identidade.bloqueios, 'buscarParaAtualizar');
    const invalida = vi.spyOn(identidade.desafios, 'invalidarVigentes');
    const apagaSenha = vi.spyOn(identidade.contas, 'gravarSenhaRemovida');

    await reconfigurar.executar(peloEmail(EMAIL));

    expect(travaFreio.mock.calls.map(([chave, tipo]) => [chave, tipo])).toEqual([
      [chaveDoFreioPorEmail(cifrador, Email.criar(EMAIL)), 'email'],
      [chaveDoFreioDeSegundoFator(cifrador, CONTA), 'segundo_fator'],
    ]);
    const [freioDoEmail, freioDoSegundoFator] = travaFreio.mock.invocationCallOrder;
    expect(freioDoEmail).toBeLessThan(invalida.mock.invocationCallOrder[0] ?? 0);
    expect(invalida.mock.invocationCallOrder.at(-1)).toBeLessThan(freioDoSegundoFator ?? 0);
    expect(freioDoSegundoFator).toBeLessThan(apagaSenha.mock.invocationCallOrder[0] ?? 0);
  });

  it('um login que já conferiu a senha antiga e está na conclusão termina antes, e a sessão dele sai revogada (A-R13)', async () => {
    const { identidade, reconfigurar, cifrador } = await cenario();
    // A conclusão do login segura o freio por e-mail até gravar a sessão.
    let liberar: () => void = () => undefined;
    const liberada = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    let avisar: () => void = () => undefined;
    const travou = new Promise<void>((resolver) => {
      avisar = resolver;
    });
    const login = identidade.unidade.executar(async () => {
      await identidade.bloqueios.buscarParaAtualizar(
        chaveDoFreioPorEmail(cifrador, Email.criar(EMAIL)),
        'email',
        AGORA,
      );
      avisar();
      await liberada;
      await identidade.sessoes.inserir(
        Sessao.criar({
          id: 'eeeeeeee-eeee-4eee-8eee-0000000000aa',
          contaId: CONTA,
          cliente: 'app_consumidor',
          tokenHash: 'token-do-login-no-meio',
          mfa: false,
          agora: AGORA,
        }),
      );
    });
    await travou;
    const reconfiguracao = reconfigurar.executar(peloEmail(EMAIL));
    await new Promise<void>((resolver) => setImmediate(resolver));
    liberar();
    await login;

    await expect(reconfiguracao).resolves.toMatchObject({ sessoesRevogadas: 3 });
    expect(
      identidade.sessoes.todas().filter((s) => s.contaId === CONTA && s.revogadaEm === null),
    ).toEqual([]);
  });

  it('a trava do freio não deixa linha zerada para trás', async () => {
    const { identidade, reconfigurar } = await cenario();
    await reconfigurar.executar(peloEmail(EMAIL));
    expect(identidade.bloqueios.todos()).toEqual([]);
  });

  it.each([
    ['e-mail inválido', 'nao-e-email', { tipo: 'email_invalido' }],
    ['conta inexistente', 'ninguem@exemplo.com', { tipo: 'conta_nao_encontrada' }],
  ])('%s: nada muda', async (_caso, email, esperado) => {
    const { identidade, reconfigurar } = await cenario();
    await expect(reconfigurar.executar(peloEmail(email))).resolves.toEqual(esperado);
    expect(await identidade.segundoFator.buscar(CONTA)).not.toBeNull();
    expect(identidade.sessoes.todas().every((s) => s.revogadaEm === null)).toBe(true);
    expect(identidade.auditoria.entradas).toEqual([]);
  });

  it('conta sem o perfil admin: nao_e_admin, nada muda', async () => {
    const { identidade, reconfigurar } = await cenario();
    await identidade.contas.inserir(
      conta('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'cliente@exemplo.com', false),
    );
    await expect(reconfigurar.executar(peloEmail('cliente@exemplo.com'))).resolves.toEqual({
      tipo: 'nao_e_admin',
    });
    expect(identidade.auditoria.entradas).toEqual([]);
  });

  it('falha no meio desfaz tudo (mesma transação)', async () => {
    const { identidade, reconfigurar } = await cenario();
    identidade.auditoria.registrar = () => Promise.reject(new Error('auditoria fora do ar'));

    await expect(reconfigurar.executar(peloEmail(EMAIL))).rejects.toThrow('auditoria fora do ar');

    expect(await identidade.segundoFator.buscar(CONTA)).not.toBeNull();
    expect(identidade.segundoFator.codigosDeRecuperacao()).toHaveLength(2);
    expect(identidade.sessoes.todas().every((s) => s.revogadaEm === null)).toBe(true);
    expect(identidade.contas.dadosDe(CONTA)?.senhaHash).not.toBeNull();
    expect(identidade.publicador.publicados).toEqual([]);
  });
});
