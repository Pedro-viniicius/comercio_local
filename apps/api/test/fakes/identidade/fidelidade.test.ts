// Fidelidade dos fakes da Identidade ao banco (etapa 4): os casos de uso das etapas 8 a 13 só
// provam o que o fake imita. Cada caso aqui espelha uma regra do esquema (FK, índice único,
// ON DELETE CASCADE) ou da consulta do repositório real (expurgo de não verificadas).
import { describe, expect, it } from 'vitest';
import { eventoDeIdentidade } from '../../../src/modulos/identidade/aplicacao/eventos.ts';
import { BloqueioDeLogin } from '../../../src/modulos/identidade/dominio/bloqueio-de-login.ts';
import { CodigoDeVerificacao } from '../../../src/modulos/identidade/dominio/codigo-de-verificacao.ts';
import { Conta, limiteDoExpurgo } from '../../../src/modulos/identidade/dominio/conta.ts';
import { DesafioDeSegundoFator } from '../../../src/modulos/identidade/dominio/desafio-de-segundo-fator.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import { Sessao } from '../../../src/modulos/identidade/dominio/sessao.ts';
import { Telefone } from '../../../src/modulos/identidade/dominio/telefone.ts';
import { criarIdentidadeEmMemoria } from './repositorios-em-memoria.ts';

const AGORA = new Date('2026-10-17T12:00:00.000Z');
const DIA = 24 * 60 * 60 * 1000;

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const ANA = uuid(1);
const BIA = uuid(2);

function conta(id: string, email: string, criadaEm: Date = AGORA): Conta {
  return Conta.criar({
    id,
    nome: 'Pessoa',
    email: Email.criar(email),
    telefone: Telefone.criar('(35) 99999-1234'),
    senhaHash: 'hash',
    agora: criadaEm,
  });
}

/** Grava uma linha de cada tabela filha para a conta. */
async function povoar(
  identidade: ReturnType<typeof criarIdentidadeEmMemoria>,
  contaId: string,
  n: number,
) {
  await identidade.sessoes.inserir(
    Sessao.criar({
      id: uuid(100 + n),
      contaId,
      cliente: 'app_consumidor',
      tokenHash: `token-${n}`,
      mfa: false,
      agora: AGORA,
    }),
  );
  await identidade.codigos.inserir(
    CodigoDeVerificacao.emitir({
      id: uuid(200 + n),
      contaId,
      finalidade: 'verificacao_email',
      codigoHmac: `codigo-${n}`,
      agora: AGORA,
    }),
  );
  await identidade.desafios.inserir(
    DesafioDeSegundoFator.emitir({
      id: uuid(300 + n),
      contaId,
      etapa: 'verificar',
      tokenHmac: `desafio-${n}`,
      agora: AGORA,
    }),
  );
  identidade.documentos.adicionarDocumento({
    id: uuid(400),
    tipo: 'termos',
    versao: '1.0',
    conteudo: 'texto',
    vigenteDesde: AGORA,
  });
  await identidade.documentos.registrarConsentimento({
    id: uuid(500 + n),
    contaId,
    documentoId: uuid(400),
    aceitoEm: AGORA,
  });
  await identidade.segundoFator.salvar({
    contaId,
    segredoCifrado: 'cifrado',
    confirmadoEm: null,
    ultimoPassoUsado: null,
  });
  await identidade.segundoFator.substituirCodigosDeRecuperacao(contaId, [
    { id: uuid(600 + n), contaId, codigoHmac: `rec-${n}`, usadoEm: null },
  ]);
  await identidade.solicitacoes.inserir({
    id: uuid(700 + n),
    contaId,
    tipo: 'exclusao',
    status: 'pendente',
    solicitadaEm: AGORA,
    concluidaEm: null,
  });
  await identidade.exportacoes.inserir({
    id: uuid(800 + n),
    contaId,
    conteudoCifrado: 'cifrado',
    criadaEm: AGORA,
    expiraEm: new Date(AGORA.getTime() + 7 * DIA),
    baixadaEm: null,
  });
}

async function totaisDaConta(
  identidade: ReturnType<typeof criarIdentidadeEmMemoria>,
  contaId: string,
) {
  return {
    sessoes: identidade.sessoes.todas().filter((s) => s.contaId === contaId).length,
    codigos: identidade.codigos.todos().filter((c) => c.contaId === contaId).length,
    desafios: identidade.desafios.todos().filter((d) => d.contaId === contaId).length,
    consentimentos: identidade.documentos.consentimentos().filter((c) => c.contaId === contaId)
      .length,
    segundoFator: (await identidade.segundoFator.buscar(contaId)) === null ? 0 : 1,
    codigosDeRecuperacao: identidade.segundoFator
      .codigosDeRecuperacao()
      .filter((c) => c.contaId === contaId).length,
    solicitacoes: identidade.solicitacoes.todas().filter((s) => s.contaId === contaId).length,
    exportacoes: identidade.exportacoes.todas().filter((e) => e.contaId === contaId).length,
  };
}

const UM_DE_CADA = {
  sessoes: 1,
  codigos: 1,
  desafios: 1,
  consentimentos: 1,
  segundoFator: 1,
  codigosDeRecuperacao: 1,
  solicitacoes: 1,
  exportacoes: 1,
};
const NENHUM = Object.fromEntries(Object.keys(UM_DE_CADA).map((chave) => [chave, 0]));

describe('cascata ao apagar a conta (ON DELETE CASCADE)', () => {
  it('apagar a conta leva sessões, códigos, desafios, consentimentos, 2FA, pedidos e exportações, e só os dela', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await identidade.contas.inserir(conta(ANA, 'ana@exemplo.com'));
    await identidade.contas.inserir(conta(BIA, 'bia@exemplo.com'));
    await povoar(identidade, ANA, 1);
    await povoar(identidade, BIA, 2);
    expect(await totaisDaConta(identidade, ANA)).toEqual(UM_DE_CADA);

    await identidade.contas.apagar(ANA);

    expect(await totaisDaConta(identidade, ANA)).toEqual(NENHUM);
    expect(await totaisDaConta(identidade, BIA)).toEqual(UM_DE_CADA);
    // O documento legal não pertence à conta e fica.
    await expect(identidade.documentos.buscarVigente('termos', AGORA)).resolves.not.toBeNull();
  });
});

describe('restrições do esquema que o fake imita', () => {
  it('consentimento de documento que não existe é recusado (FK)', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await expect(
      identidade.documentos.registrarConsentimento({
        id: uuid(1),
        contaId: ANA,
        documentoId: uuid(999),
        aceitoEm: AGORA,
      }),
    ).rejects.toThrow();
  });

  it('a mesma conta não aceita o mesmo documento duas vezes (índice único)', async () => {
    const identidade = criarIdentidadeEmMemoria();
    identidade.documentos.adicionarDocumento({
      id: uuid(400),
      tipo: 'privacidade',
      versao: '1.0',
      conteudo: 'texto',
      vigenteDesde: AGORA,
    });
    const aceite = (id: number) => ({
      id: uuid(id),
      contaId: ANA,
      documentoId: uuid(400),
      aceitoEm: AGORA,
    });
    await identidade.documentos.registrarConsentimento(aceite(1));
    await expect(identidade.documentos.registrarConsentimento(aceite(2))).rejects.toThrow();
    expect(identidade.documentos.consentimentos()).toHaveLength(1);
  });

  it('freio zerado não deixa linha; freio com falha fica gravado', async () => {
    const identidade = criarIdentidadeEmMemoria();
    const freio = BloqueioDeLogin.novo('chave', 'email', AGORA);
    await identidade.bloqueios.salvar(freio);
    expect(identidade.bloqueios.todos()).toEqual([]);

    freio.registrarFalha(AGORA);
    await identidade.bloqueios.salvar(freio);
    expect(identidade.bloqueios.todos()).toHaveLength(1);

    freio.registrarSucesso('senha');
    await identidade.bloqueios.salvar(freio);
    expect(identidade.bloqueios.todos()).toEqual([]);
  });

  it('o publicador falso recusa dado pessoal no payload, como o da outbox, e não guarda o evento', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await expect(
      identidade.unidade.executar(() =>
        identidade.publicador.publicar({
          tipo: 'identidade.ContaCriada',
          versao: 1,
          agregadoId: ANA,
          payload: { email: 'ana@exemplo.com' },
        }),
      ),
    ).rejects.toThrow(/dado pessoal/);
    await expect(
      identidade.unidade.executar(() =>
        identidade.publicador.publicar(eventoDeIdentidade('ContaCriada', { contaId: ANA })),
      ),
    ).resolves.toBeUndefined();
    expect(identidade.publicador.tipos).toEqual(['identidade.ContaCriada']);
  });
});

describe('listarParaExpurgo imita a consulta do repositório real (P1-dono)', () => {
  async function cenario() {
    const identidade = criarIdentidadeEmMemoria();
    const velha = AGORA;
    const agora = new Date(AGORA.getTime() + 8 * DIA);
    const grava = (c: Conta) => identidade.contas.inserir(c);

    await grava(conta(uuid(10), 'velha1@exemplo.com', velha));
    await grava(conta(uuid(11), 'velha2@exemplo.com', new Date(velha.getTime() + 1_000)));
    const verificada = conta(uuid(12), 'verificada@exemplo.com', velha);
    verificada.verificarEmail(velha);
    await grava(verificada);
    const desativada = conta(uuid(13), 'desativada@exemplo.com', velha);
    desativada.desativar(velha);
    await grava(desativada);
    const lojista = conta(uuid(14), 'lojista@exemplo.com', velha);
    lojista.concederPerfil('lojista', velha);
    await grava(lojista);
    const admin = conta(uuid(15), 'admin@exemplo.com', velha);
    admin.concederAdmin(velha);
    await grava(admin);
    const recente = conta(uuid(16), 'recente@exemplo.com', velha);
    recente.registrarLogin(new Date(agora.getTime() - DIA));
    await grava(recente);
    return { identidade, agora };
  }

  it('só as ativas, não verificadas, sem perfil lojista ou admin e sem login há mais de 7 dias, em ordem de id', async () => {
    const { identidade, agora } = await cenario();
    await expect(identidade.contas.listarParaExpurgo(limiteDoExpurgo(agora), 10)).resolves.toEqual([
      uuid(10),
      uuid(11),
    ]);
  });

  it('respeita a quantidade pedida', async () => {
    const { identidade, agora } = await cenario();
    await expect(identidade.contas.listarParaExpurgo(limiteDoExpurgo(agora), 1)).resolves.toEqual([
      uuid(10),
    ]);
  });

  it('com cursor, só os ids depois dele (S105)', async () => {
    const { identidade, agora } = await cenario();
    const limite = limiteDoExpurgo(agora);
    await expect(identidade.contas.listarParaExpurgo(limite, 10, uuid(10))).resolves.toEqual([
      uuid(11),
    ]);
    await expect(identidade.contas.listarParaExpurgo(limite, 10, uuid(11))).resolves.toEqual([]);
  });
});

describe('listarPorStatus imita a consulta do repositório real (S105)', () => {
  it('ordena por (solicitada_em, id) e, com cursor, só devolve as que vêm depois dele', async () => {
    const identidade = criarIdentidadeEmMemoria();
    await identidade.contas.inserir(conta(ANA, 'ana@exemplo.com'));
    const nova = (n: number, solicitadaEm: Date) => ({
      id: uuid(100 + n),
      contaId: ANA,
      tipo: 'exclusao' as const,
      status: 'pendente' as const,
      solicitadaEm,
      concluidaEm: null,
    });
    const empate = new Date(AGORA.getTime() + DIA);
    // Inseridas fora de ordem; duas no mesmo instante (o id desempata).
    for (const s of [nova(3, empate), nova(1, AGORA), nova(2, empate)]) {
      await identidade.solicitacoes.inserir(s);
    }

    const todas = await identidade.solicitacoes.listarPorStatus('exclusao', 'pendente', 10);
    expect(todas.map((s) => s.id)).toEqual([uuid(101), uuid(102), uuid(103)]);
    const depoisDaPrimeira = await identidade.solicitacoes.listarPorStatus(
      'exclusao',
      'pendente',
      10,
      { solicitadaEm: AGORA, id: uuid(101) },
    );
    expect(depoisDaPrimeira.map((s) => s.id)).toEqual([uuid(102), uuid(103)]);
    const noEmpate = await identidade.solicitacoes.listarPorStatus('exclusao', 'pendente', 10, {
      solicitadaEm: empate,
      id: uuid(102),
    });
    expect(noEmpate.map((s) => s.id)).toEqual([uuid(103)]);
  });
});
