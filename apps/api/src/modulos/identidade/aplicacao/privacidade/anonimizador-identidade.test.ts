// O anonimizador da Identidade (S5, CA-11): somem nome, e-mail, telefone,
// senha, segundo fator, sessões, códigos e exportações; ficam a conta com o id
// e o e-mail substituto (nos CHECKs da migração), os perfis, os consentimentos
// e as solicitações. Idempotente; recusa conta ativa; não toca outra conta.
import { describe, expect, it } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  criarIdentidadeEmMemoria,
  type IdentidadeEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import { CodigoDeVerificacao } from '../../dominio/codigo-de-verificacao.ts';
import { Conta, NOME_DA_CONTA_ANONIMIZADA, OperacaoInvalidaNaConta } from '../../dominio/conta.ts';
import { DesafioDeSegundoFator } from '../../dominio/desafio-de-segundo-fator.ts';
import { Email } from '../../dominio/email.ts';
import { Sessao } from '../../dominio/sessao.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { AnonimizadorDeIdentidade } from './anonimizador-identidade.ts';

const CADASTRO = new Date('2026-09-01T12:00:00.000Z');
const EXCLUSAO = new Date('2026-10-01T12:00:00.000Z');
const AGORA = new Date('2026-10-18T12:00:00.000Z');
const CONTA = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';
const OUTRA = '7a2e4d3b-2c3d-4e4f-9a01-23456789abcd';
const DOCUMENTO = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';

function montar() {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  const anonimizador = new AnonimizadorDeIdentidade(
    identidade.contas,
    identidade.sessoes,
    identidade.codigos,
    identidade.segundoFator,
    identidade.exportacoes,
    relogio,
  );
  identidade.documentos.adicionarDocumento({
    id: DOCUMENTO,
    tipo: 'privacidade',
    versao: '1',
    conteudo: 'Política',
    vigenteDesde: CADASTRO,
  });
  return { identidade, anonimizador };
}

/** Conta com tudo o que a Identidade guarda dela; `desativar` simula a exclusão confirmada. */
async function popularConta(
  identidade: IdentidadeEmMemoria,
  id: string,
  email: string,
  desativar: boolean,
): Promise<void> {
  const conta = Conta.criar({
    id,
    nome: 'Ana Souza',
    email: Email.criar(email),
    telefone: Telefone.criar('35999991234'),
    senhaHash: 'hash-da-senha',
    agora: CADASTRO,
  });
  if (desativar) conta.desativar(EXCLUSAO);
  await identidade.contas.inserir(conta);
  await identidade.sessoes.inserir(
    Sessao.criar({
      id: `${id}-sessao`,
      contaId: id,
      cliente: 'app_consumidor',
      tokenHash: `token-${id}`,
      mfa: false,
      agora: CADASTRO,
    }),
  );
  await identidade.codigos.inserir(
    CodigoDeVerificacao.emitir({
      id: `${id}-codigo`,
      contaId: id,
      finalidade: 'verificacao_email',
      codigoHmac: `hmac-codigo-${id}`,
      agora: CADASTRO,
    }),
  );
  await identidade.desafios.inserir(
    DesafioDeSegundoFator.emitir({
      id: `${id}-desafio`,
      contaId: id,
      etapa: 'configurar',
      tokenHmac: `hmac-desafio-${id}`,
      agora: CADASTRO,
    }),
  );
  await identidade.segundoFator.salvar({
    contaId: id,
    segredoCifrado: `segredo-${id}`,
    confirmadoEm: CADASTRO,
    ultimoPassoUsado: 1,
  });
  await identidade.segundoFator.substituirCodigosDeRecuperacao(id, [
    { id: `${id}-recuperacao`, contaId: id, codigoHmac: `hmac-rec-${id}`, usadoEm: null },
  ]);
  await identidade.exportacoes.inserir({
    id: `${id}-exportacao`,
    contaId: id,
    conteudoCifrado: `cifrado-${id}`,
    criadaEm: CADASTRO,
    expiraEm: AGORA,
    baixadaEm: null,
  });
  await identidade.documentos.registrarConsentimento({
    id: `${id}-consentimento`,
    contaId: id,
    documentoId: DOCUMENTO,
    aceitoEm: CADASTRO,
  });
  await identidade.solicitacoes.inserir({
    id: `${id}-solicitacao`,
    contaId: id,
    tipo: 'exclusao',
    status: 'pendente',
    solicitadaEm: EXCLUSAO,
    concluidaEm: null,
  });
}

function daConta<T extends { contaId: string }>(linhas: readonly T[], contaId: string): T[] {
  return linhas.filter((linha) => linha.contaId === contaId);
}

describe('AnonimizadorDeIdentidade', () => {
  it('registra-se como o módulo identidade', () => {
    expect(montar().anonimizador.modulo).toBe('identidade');
  });

  it('troca nome e e-mail, apaga telefone e senha e preenche anonimizada_em (CHECKs da migração)', async () => {
    const { identidade, anonimizador } = montar();
    await popularConta(identidade, CONTA, 'ana@exemplo.com', true);

    await anonimizador.anonimizar(CONTA);

    const dados = identidade.contas.dadosDe(CONTA);
    expect(dados).toMatchObject({
      id: CONTA,
      nome: NOME_DA_CONTA_ANONIMIZADA,
      emailNormalizado: Email.substitutoDaAnonimizacao(CONTA).valor,
      telefoneE164: null,
      senhaHash: null,
      status: 'anonimizada',
      criadaEm: CADASTRO,
      desativadaEm: EXCLUSAO,
      anonimizadaEm: AGORA,
    });
    expect(dados?.perfis.map(({ perfil }) => perfil)).toEqual(['consumidor']);
    // O estado gravado passa nas regras do banco (remontar não lança).
    if (dados === undefined) throw new Error('conta sumiu');
    expect(() => Conta.reconstituir(dados)).not.toThrow();
    const texto = JSON.stringify(dados);
    for (const pessoal of ['ana@exemplo.com', 'Ana Souza', '35999991234', 'hash-da-senha']) {
      expect(texto).not.toContain(pessoal);
    }
  });

  it('apaga sessões, códigos, desafios, segundo fator, códigos de recuperação e exportações; mantém consentimento e solicitação', async () => {
    const { identidade, anonimizador } = montar();
    await popularConta(identidade, CONTA, 'ana@exemplo.com', true);

    await anonimizador.anonimizar(CONTA);

    expect(daConta(identidade.sessoes.todas(), CONTA)).toEqual([]);
    expect(daConta(identidade.codigos.todos(), CONTA)).toEqual([]);
    expect(daConta(identidade.desafios.todos(), CONTA)).toEqual([]);
    await expect(identidade.segundoFator.buscar(CONTA)).resolves.toBeNull();
    expect(daConta(identidade.segundoFator.codigosDeRecuperacao(), CONTA)).toEqual([]);
    expect(daConta(identidade.exportacoes.todas(), CONTA)).toEqual([]);
    expect(daConta(identidade.documentos.consentimentos(), CONTA)).toEqual([
      { id: `${CONTA}-consentimento`, contaId: CONTA, documentoId: DOCUMENTO, aceitoEm: CADASTRO },
    ]);
    expect(daConta(identidade.solicitacoes.todas(), CONTA)).toHaveLength(1);
  });

  it('não toca nos dados de outra conta', async () => {
    const { identidade, anonimizador } = montar();
    await popularConta(identidade, CONTA, 'ana@exemplo.com', true);
    await popularConta(identidade, OUTRA, 'bia@exemplo.com', true);

    await anonimizador.anonimizar(CONTA);

    expect(identidade.contas.dadosDe(OUTRA)).toMatchObject({
      nome: 'Ana Souza',
      emailNormalizado: 'bia@exemplo.com',
      status: 'desativada',
    });
    expect(daConta(identidade.sessoes.todas(), OUTRA)).toHaveLength(1);
    expect(daConta(identidade.codigos.todos(), OUTRA)).toHaveLength(1);
    expect(daConta(identidade.desafios.todos(), OUTRA)).toHaveLength(1);
    await expect(identidade.segundoFator.buscar(OUTRA)).resolves.not.toBeNull();
    expect(daConta(identidade.exportacoes.todas(), OUTRA)).toHaveLength(1);
  });

  it('é idempotente: rodar de novo não falha nem muda a data da anonimização', async () => {
    const { identidade, anonimizador } = montar();
    await popularConta(identidade, CONTA, 'ana@exemplo.com', true);
    await anonimizador.anonimizar(CONTA);
    const depoisDaPrimeira = identidade.contas.dadosDe(CONTA);

    await expect(anonimizador.anonimizar(CONTA)).resolves.toBeUndefined();

    expect(identidade.contas.dadosDe(CONTA)).toEqual(depoisDaPrimeira);
  });

  it('conta inexistente: nada a apagar, sem erro', async () => {
    const { anonimizador } = montar();
    await expect(anonimizador.anonimizar(CONTA)).resolves.toBeUndefined();
  });

  it('recusa conta ativa antes de apagar qualquer coisa', async () => {
    const { identidade, anonimizador } = montar();
    await popularConta(identidade, CONTA, 'ana@exemplo.com', false);

    await expect(anonimizador.anonimizar(CONTA)).rejects.toBeInstanceOf(OperacaoInvalidaNaConta);

    expect(identidade.contas.dadosDe(CONTA)?.status).toBe('ativa');
    expect(daConta(identidade.sessoes.todas(), CONTA)).toHaveLength(1);
    expect(daConta(identidade.exportacoes.todas(), CONTA)).toHaveLength(1);
    await expect(identidade.segundoFator.buscar(CONTA)).resolves.not.toBeNull();
  });
});
