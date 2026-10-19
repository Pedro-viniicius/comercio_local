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

describe('serviços falsos', () => {
  it('o hasher aplica NFKC como o adaptador e conta as chamadas', async () => {
    const hasher = new HasherFalso();
    const hash = await hasher.gerarHash('café');
    await expect(hasher.verificar('café', hash)).resolves.toBe(true);
    await hasher.simularVerificacao('x');
    expect(hasher.chamadas).toEqual({ gerarHash: 1, verificar: 1, simularVerificacao: 1 });
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
