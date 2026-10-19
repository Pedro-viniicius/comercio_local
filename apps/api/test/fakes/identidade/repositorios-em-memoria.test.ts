// Os fakes da Identidade se comportam como o banco no que os casos de uso
// sentem: rollback junto com a unidade de trabalho, unicidade de e-mail,
// cascata ao apagar a conta e cópias isoladas do que está guardado.
import { describe, expect, it } from 'vitest';
import { RelogioFixo } from '../../../src/compartilhado/tempo/relogio.ts';
import { eventoDeIdentidade } from '../../../src/modulos/identidade/aplicacao/eventos.ts';
import { Conta, EmailJaCadastrado } from '../../../src/modulos/identidade/dominio/conta.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import { Sessao } from '../../../src/modulos/identidade/dominio/sessao.ts';
import { Telefone } from '../../../src/modulos/identidade/dominio/telefone.ts';
import { criarIdentidadeEmMemoria } from './repositorios-em-memoria.ts';
import {
  CifradorFalso,
  EmissorDeJwtFalso,
  GeradorDeSegredosFalso,
  HashDentroDaTransacao,
  HasherFalso,
  VerificadorTotpFalso,
} from './servicos-falsos.ts';

const relogio = new RelogioFixo(new Date('2026-10-17T12:00:00.000Z'));
const ID = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';

function conta(id = ID, email = 'ana@exemplo.com'): Conta {
  return Conta.criar({
    id,
    nome: 'Ana',
    email: Email.criar(email),
    telefone: Telefone.criar('35999991234'),
    senhaHash: 'hash',
    agora: relogio.agora(),
  });
}

describe('criarIdentidadeEmMemoria', () => {
  it('desfaz contas e eventos quando a unidade de trabalho falha', async () => {
    const identidade = criarIdentidadeEmMemoria();
    const falha = identidade.unidade.executar(async () => {
      await identidade.contas.inserir(conta());
      await identidade.publicador.publicar(eventoDeIdentidade('ContaCriada', { contaId: ID }));
      throw new Error('falha depois de gravar');
    });
    await expect(falha).rejects.toThrow('falha depois de gravar');
    expect(identidade.contas.todas()).toEqual([]);
    expect(identidade.publicador.publicados).toEqual([]);
  });

  it('confirma quando o trabalho termina', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await identidade.unidade.executar(async () => {
      await identidade.contas.inserir(conta());
      await identidade.publicador.publicar(eventoDeIdentidade('ContaCriada', { contaId: ID }));
    });
    expect(identidade.contas.todas()).toHaveLength(1);
    expect(identidade.publicador.tipos).toEqual(['identidade.ContaCriada']);
  });

  it('o publicador recusa publicar fora da unidade', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await expect(
      identidade.publicador.publicar(eventoDeIdentidade('ContaCriada', { contaId: ID })),
    ).rejects.toThrow(/UnidadeDeTrabalho/);
  });

  it('e-mail é único', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await identidade.contas.inserir(conta());
    await expect(
      identidade.contas.inserir(conta('7a2e4d3b-2c3d-4e4f-9a01-23456789abcd')),
    ).rejects.toThrow(EmailJaCadastrado);
  });

  it('o objeto lido é uma cópia: mudar sem atualizar não muda o guardado', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await identidade.contas.inserir(conta());
    const lida = await identidade.contas.buscarPorId(ID);
    lida?.verificarEmail(relogio.agora());
    expect(identidade.contas.dadosDe(ID)?.emailVerificadoEm).toBeNull();
  });

  it('gravarUltimoLogin muda só ultimo_login_em, e só em conta ativa', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await identidade.contas.inserir(conta());
    const antes = identidade.contas.dadosDe(ID);
    const depois = new Date('2026-10-18T09:00:00.000Z');

    await expect(identidade.contas.gravarUltimoLogin(ID, depois)).resolves.toBe(true);
    expect(identidade.contas.dadosDe(ID)).toEqual({ ...antes, ultimoLoginEm: depois });

    const desativada = await identidade.contas.buscarPorId(ID);
    desativada?.desativar(relogio.agora());
    if (desativada !== null) await identidade.contas.atualizar(desativada);
    const naExclusao = identidade.contas.dadosDe(ID);
    await expect(
      identidade.contas.gravarUltimoLogin(ID, new Date('2026-10-19T09:00:00.000Z')),
    ).resolves.toBe(false);
    expect(identidade.contas.dadosDe(ID)).toEqual(naExclusao);
    await expect(identidade.contas.gravarUltimoLogin('nao-existe', depois)).resolves.toBe(false);
  });

  it('gravarEmailVerificado muda só email_verificado_em, guarda a primeira data e só em conta ativa', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await identidade.contas.inserir(conta());
    const antes = identidade.contas.dadosDe(ID);
    const primeira = new Date('2026-10-18T09:00:00.000Z');

    await expect(identidade.contas.gravarEmailVerificado(ID, primeira)).resolves.toBe(true);
    await expect(
      identidade.contas.gravarEmailVerificado(ID, new Date('2026-10-18T10:00:00.000Z')),
    ).resolves.toBe(true);
    expect(identidade.contas.dadosDe(ID)).toEqual({ ...antes, emailVerificadoEm: primeira });

    const desativada = await identidade.contas.buscarPorId(ID);
    desativada?.desativar(relogio.agora());
    if (desativada !== null) await identidade.contas.atualizar(desativada);
    await expect(identidade.contas.gravarEmailVerificado(ID, primeira)).resolves.toBe(false);
    await expect(identidade.contas.gravarEmailVerificado('nao-existe', primeira)).resolves.toBe(
      false,
    );
  });

  it('marcarBaixada devolve true só para o primeiro download (S10)', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await identidade.contas.inserir(conta());
    const agora = relogio.agora();
    await identidade.exportacoes.inserir({
      id: 'exportacao',
      contaId: ID,
      conteudoCifrado: 'cifrado',
      criadaEm: agora,
      expiraEm: new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000),
      baixadaEm: null,
    });
    await expect(identidade.exportacoes.marcarBaixada('exportacao', agora)).resolves.toBe(true);
    await expect(
      identidade.exportacoes.marcarBaixada('exportacao', new Date(agora.getTime() + 1_000)),
    ).resolves.toBe(false);
    expect(identidade.exportacoes.todas()[0]?.baixadaEm).toEqual(agora);
    await expect(identidade.exportacoes.marcarBaixada('nao-existe', agora)).resolves.toBe(false);
  });

  it('listarConsentimentos traz todos os aceites com tipo e versão, do mais antigo para o mais novo', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await identidade.contas.inserir(conta());
    const documento = (id: string, versao: string, vigenteDesde: string) => ({
      id,
      tipo: 'termos' as const,
      versao,
      conteudo: 'Termos',
      vigenteDesde: new Date(vigenteDesde),
    });
    identidade.documentos.adicionarDocumento(documento('termos-1', '1', '2026-01-01T00:00:00Z'));
    identidade.documentos.adicionarDocumento(documento('termos-2', '2', '2026-06-01T00:00:00Z'));
    const aceite = (id: string, documentoId: string, aceitoEm: string) => ({
      id,
      contaId: ID,
      documentoId,
      aceitoEm: new Date(aceitoEm),
    });
    await identidade.documentos.registrarConsentimento(
      aceite('c2', 'termos-2', '2026-07-01T00:00:00Z'),
    );
    await identidade.documentos.registrarConsentimento(
      aceite('c1', 'termos-1', '2026-02-01T00:00:00Z'),
    );

    await expect(identidade.documentos.listarConsentimentos(ID)).resolves.toEqual([
      { ...aceite('c1', 'termos-1', '2026-02-01T00:00:00Z'), tipo: 'termos', versao: '1' },
      { ...aceite('c2', 'termos-2', '2026-07-01T00:00:00Z'), tipo: 'termos', versao: '2' },
    ]);
    await expect(identidade.documentos.listarConsentimentos('outra')).resolves.toEqual([]);
  });

  it('apagar a conta apaga as sessões em cascata', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await identidade.contas.inserir(conta());
    await identidade.sessoes.inserir(
      Sessao.criar({
        id: '0b8e1f2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
        contaId: ID,
        cliente: 'app_consumidor',
        tokenHash: 'hash-1',
        mfa: false,
        agora: relogio.agora(),
      }),
    );
    await identidade.contas.apagar(ID);
    expect(identidade.sessoes.todas()).toEqual([]);
    await expect(identidade.sessoes.buscarPorTokenHash('hash-1')).resolves.toBeNull();
  });
});

describe('gravações restritas da conta e travas (S95, S97, Q24)', () => {
  const quando = new Date('2026-10-18T12:00:00.000Z');
  const OUTRA = '6f1d3c2a-1b2c-4d3e-8f90-000000000002';

  it('gravarSenhaRedefinida muda só a senha e a verificação (a primeira data fica), e só em conta ativa', async () => {
    const identidade = criarIdentidadeEmMemoria();
    const verificada = conta();
    verificada.verificarEmail(relogio.agora());
    await identidade.contas.inserir(verificada);
    const antes = identidade.contas.dadosDe(ID);

    await expect(identidade.contas.gravarSenhaRedefinida(ID, 'hash-novo', quando)).resolves.toBe(
      true,
    );
    expect(identidade.contas.dadosDe(ID)).toEqual({ ...antes, senhaHash: 'hash-novo' });

    await identidade.contas.inserir(conta(OUTRA, 'bia@exemplo.com'));
    await identidade.contas.gravarSenhaRedefinida(OUTRA, 'hash-novo', quando);
    expect(identidade.contas.dadosDe(OUTRA)?.emailVerificadoEm).toEqual(quando);
  });

  it.each(['gravarSenhaRedefinida', 'gravarSenhaRemovida', 'gravarDesativacao'] as const)(
    '%s: conta desativada ou inexistente devolve false e não muda nada',
    async (metodo) => {
      const identidade = criarIdentidadeEmMemoria();
      const desativada = conta();
      desativada.desativar(relogio.agora());
      await identidade.contas.inserir(desativada);
      const antes = identidade.contas.dadosDe(ID);
      const gravar = (id: string) =>
        metodo === 'gravarSenhaRedefinida'
          ? identidade.contas.gravarSenhaRedefinida(id, 'hash-novo', quando)
          : metodo === 'gravarSenhaRemovida'
            ? identidade.contas.gravarSenhaRemovida(id)
            : identidade.contas.gravarDesativacao(id, quando);
      await expect(gravar(ID)).resolves.toBe(false);
      await expect(gravar(OUTRA)).resolves.toBe(false);
      expect(identidade.contas.dadosDe(ID)).toEqual(antes);
    },
  );

  it('gravarSenhaRemovida e gravarDesativacao mudam só as suas colunas', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await identidade.contas.inserir(conta());
    const antes = identidade.contas.dadosDe(ID);
    await expect(identidade.contas.gravarSenhaRemovida(ID)).resolves.toBe(true);
    expect(identidade.contas.dadosDe(ID)).toEqual({ ...antes, senhaHash: null });
    await expect(identidade.contas.gravarDesativacao(ID, quando)).resolves.toBe(true);
    expect(identidade.contas.dadosDe(ID)).toEqual({
      ...antes,
      senhaHash: null,
      status: 'desativada',
      desativadaEm: quando,
    });
  });

  it('buscarPorIdParaAtualizar rejeita fora da unidade e serializa duas unidades na mesma conta', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await identidade.contas.inserir(conta());
    await expect(identidade.contas.buscarPorIdParaAtualizar(ID)).rejects.toThrow(
      'fora da UnidadeDeTrabalho',
    );
    const lidas: string[] = [];
    const desativar = () =>
      identidade.unidade.executar(async () => {
        const lida = await identidade.contas.buscarPorIdParaAtualizar(ID);
        lidas.push(lida?.status ?? 'nenhuma');
        await new Promise<void>((resolver) => setImmediate(resolver));
        if (lida?.status === 'ativa') await identidade.contas.gravarDesativacao(ID, quando);
      });
    await Promise.all([desativar(), desativar()]);
    expect(lidas).toEqual(['ativa', 'desativada']);
  });

  it('contarDesde conta só as solicitações da conta e do tipo feitas depois da data', async () => {
    const identidade = criarIdentidadeEmMemoria();
    const base = { contaId: ID, status: 'pendente' as const, concluidaEm: null };
    await identidade.solicitacoes.inserir({
      ...base,
      id: 's1',
      tipo: 'exportacao',
      solicitadaEm: relogio.agora(),
    });
    await identidade.solicitacoes.inserir({
      ...base,
      id: 's2',
      tipo: 'exportacao',
      solicitadaEm: quando,
    });
    await identidade.solicitacoes.inserir({
      ...base,
      id: 's3',
      tipo: 'exclusao',
      solicitadaEm: quando,
    });
    expect(await identidade.solicitacoes.contarDesde(ID, 'exportacao', relogio.agora())).toBe(1);
    expect(await identidade.solicitacoes.contarDesde(ID, 'exportacao', new Date(0))).toBe(2);
    expect(await identidade.solicitacoes.contarDesde(OUTRA, 'exportacao', new Date(0))).toBe(0);
  });

  it('apagarNaoBaixadas apaga só as não baixadas da conta e devolve quantas', async () => {
    const identidade = criarIdentidadeEmMemoria();
    const base = {
      contaId: ID,
      conteudoCifrado: 'x',
      criadaEm: relogio.agora(),
      expiraEm: quando,
      baixadaEm: null,
    };
    await identidade.exportacoes.inserir({ ...base, id: 'e1' });
    await identidade.exportacoes.inserir({ ...base, id: 'e2', baixadaEm: relogio.agora() });
    await identidade.exportacoes.inserir({ ...base, id: 'e3', contaId: OUTRA });
    expect(await identidade.exportacoes.apagarNaoBaixadas(ID)).toBe(1);
    expect(
      identidade.exportacoes
        .todas()
        .map((e) => e.id)
        .sort(),
    ).toEqual(['e2', 'e3']);
  });
});

describe('serviços falsos', () => {
  it('o hasher aplica NFKC como o adaptador e conta as chamadas', async () => {
    const hasher = new HasherFalso();
    const hash = await hasher.gerarHash('café');
    await expect(hasher.verificar('café', hash)).resolves.toBe(true);
    await hasher.simularVerificacao('x');
    expect(hasher.chamadas).toEqual({ gerarHash: 1, verificar: 1, simularVerificacao: 1 });
  });

  it('com a unidade de trabalho, o hasher rejeita chamada com a transação aberta (S91)', async () => {
    const identidade = criarIdentidadeEmMemoria();
    const hasher = new HasherFalso(identidade.unidade);
    const hash = await hasher.gerarHash('senha');
    await expect(hasher.verificar('senha', hash)).resolves.toBe(true);
    const chamadas: (() => Promise<unknown>)[] = [
      () => hasher.gerarHash('senha'),
      () => hasher.verificar('senha', hash),
      () => hasher.simularVerificacao('senha'),
    ];
    for (const chamar of chamadas) {
      await expect(identidade.unidade.executar(chamar)).rejects.toThrow(HashDentroDaTransacao);
    }
  });

  it('o gerador devolve UUIDs, tokens e códigos válidos em sequência', () => {
    const gerador = new GeradorDeSegredosFalso();
    expect(gerador.novoId()).toBe('00000000-0000-4000-8000-000000000001');
    expect(gerador.tokenOpaco()).toBe('token-falso-1');
    gerador.definirProximosCodigos('000123');
    expect(gerador.codigoNumerico()).toBe('000123');
    expect(gerador.codigoNumerico()).toMatch(/^[0-9]{6}$/);
    expect(gerador.codigoDeRecuperacao()).toMatch(/^[A-Z2-7]{10}$/);
  });

  it('o HMAC depende da finalidade e das partes; a cifragem só abre com a mesma conta', () => {
    const cifrador = new CifradorFalso();
    const hmac = cifrador.hmac('verificacao_email', [ID, '123456']);
    expect(cifrador.hmacConfere('verificacao_email', [ID, '123456'], hmac)).toBe(true);
    expect(cifrador.hmacConfere('recuperacao_senha', [ID, '123456'], hmac)).toBe(false);
    expect(cifrador.hmac('token_renovacao', ['ab', 'c'])).not.toBe(
      cifrador.hmac('token_renovacao', ['a', 'bc']),
    );
    const cifrado = cifrador.cifrar('par_novo_da_sessao', 'segredo', ID);
    expect(cifrador.decifrar('par_novo_da_sessao', cifrado, ID)).toBe('segredo');
    expect(cifrador.decifrar('par_novo_da_sessao', cifrado, 'outra')).toBeNull();
    expect(cifrador.decifrar('segredo_totp', cifrado, ID)).toBeNull();
  });

  it('o JWT falso vence em 15 min', async () => {
    const emissor = new EmissorDeJwtFalso();
    const agora = relogio.agora();
    const claims = {
      contaId: ID,
      sid: ID,
      perfis: ['consumidor' as const],
      mfa: false,
      emailVerificado: false,
    };
    const { token, expiraEm } = await emissor.emitir(claims, agora);
    expect(expiraEm.getTime() - agora.getTime()).toBe(900_000);
    await expect(emissor.verificar(token, agora)).resolves.toEqual(claims);
    await expect(emissor.verificar(token, expiraEm)).resolves.toBeNull();
    await expect(emissor.verificar('outro', agora)).resolves.toBeNull();
  });

  it('o TOTP falso não aceita o mesmo passo duas vezes', () => {
    const totp = new VerificadorTotpFalso();
    const passo = totp.verificar(totp.segredoBase32, totp.codigoCerto, relogio.agora(), null);
    expect(passo).not.toBeNull();
    expect(totp.verificar(totp.segredoBase32, totp.codigoCerto, relogio.agora(), passo)).toBeNull();
    expect(totp.gerarConfiguracao('an***@exemplo.com').otpauthUri).toContain('issuer=Bairrin');
  });
});
