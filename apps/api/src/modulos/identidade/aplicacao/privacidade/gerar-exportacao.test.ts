// Geração da cópia dos dados (CA-10, S10): JSON com os dados da própria conta,
// sem segredo, cifrado com a conta como AAD, válido por 7 dias; a solicitação
// é concluída na mesma transação e a reentrega do evento não gera de novo.
import { describe, expect, it } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  criarIdentidadeEmMemoria,
  type IdentidadeEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import {
  CifradorFalso,
  GeradorDeSegredosFalso,
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { Conta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import type { TipoDeSolicitacao } from '../../dominio/repositorios.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { type ArquivoDeExportacao, GerarExportacaoCasoDeUso } from './gerar-exportacao.ts';

const CADASTRO = new Date('2026-09-01T12:00:00.000Z');
const ACEITE_POLITICA_V1 = new Date('2026-09-01T12:00:01.000Z');
const ACEITE_POLITICA_V2 = new Date('2026-10-12T09:30:00.000Z');
const AGORA = new Date('2026-10-18T12:00:00.000Z');
const SETE_DIAS_EM_MS = 7 * 24 * 60 * 60 * 1000;
const CONTA = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';
const OUTRA = '7a2e4d3b-2c3d-4e4f-9a01-23456789abcd';
const SOLICITACAO = '0b8e1f2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const TERMOS_V1 = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
const POLITICA_V1 = '2c8e7ace-ccfe-4c3e-8c6e-bc9ecccd5cfe';
const POLITICA_V2 = '3d7f6bdf-ddff-4d4f-9d7f-cdafdddd6dff';

function montar() {
  const identidade = criarIdentidadeEmMemoria();
  const cifrador = new CifradorFalso();
  const caso = new GerarExportacaoCasoDeUso(
    identidade.unidade,
    identidade.contas,
    identidade.documentos,
    identidade.segundoFator,
    identidade.solicitacoes,
    identidade.exportacoes,
    cifrador,
    new GeradorDeSegredosFalso(),
    new RelogioFixo(AGORA),
  );
  identidade.documentos.adicionarDocumento({
    id: TERMOS_V1,
    tipo: 'termos',
    versao: '1',
    conteudo: 'Termos',
    vigenteDesde: CADASTRO,
  });
  identidade.documentos.adicionarDocumento({
    id: POLITICA_V1,
    tipo: 'privacidade',
    versao: '1',
    conteudo: 'Política v1',
    vigenteDesde: CADASTRO,
  });
  return { identidade, cifrador, caso };
}

async function prepararConta(identidade: IdentidadeEmMemoria, id = CONTA): Promise<void> {
  const conta = Conta.criar({
    id,
    nome: 'Ana Souza',
    email: Email.criar(id === CONTA ? 'ana@exemplo.com' : 'bia@exemplo.com'),
    telefone: Telefone.criar('35999991234'),
    senhaHash: 'hash-secreto-da-senha',
    agora: CADASTRO,
  });
  conta.registrarLogin(new Date('2026-10-17T08:00:00.000Z'));
  await identidade.contas.inserir(conta);
  for (const [documentoId, aceitoEm] of [
    [TERMOS_V1, CADASTRO],
    [POLITICA_V1, ACEITE_POLITICA_V1],
  ] as const) {
    await identidade.documentos.registrarConsentimento({
      id: `${id}-${documentoId}`,
      contaId: id,
      documentoId,
      aceitoEm,
    });
  }
}

async function solicitar(
  identidade: IdentidadeEmMemoria,
  contaId = CONTA,
  tipo: TipoDeSolicitacao = 'exportacao',
  id = SOLICITACAO,
): Promise<void> {
  await identidade.solicitacoes.inserir({
    id,
    contaId,
    tipo,
    status: 'pendente',
    solicitadaEm: AGORA,
    concluidaEm: null,
  });
}

describe('GerarExportacaoCasoDeUso', () => {
  it('grava o arquivo cifrado, válido por 7 dias, e conclui a solicitação', async () => {
    const { identidade, cifrador, caso } = montar();
    await prepararConta(identidade);
    await solicitar(identidade);

    const expiraEm = new Date(AGORA.getTime() + SETE_DIAS_EM_MS);
    await expect(caso.executar({ contaId: CONTA, solicitacaoId: SOLICITACAO })).resolves.toEqual({
      tipo: 'gerada',
      expiraEm,
    });

    const [exportacao] = identidade.exportacoes.todas();
    expect(exportacao).toMatchObject({
      contaId: CONTA,
      criadaEm: AGORA,
      expiraEm,
      baixadaEm: null,
    });
    const cifrado = exportacao?.conteudoCifrado ?? '';
    expect(cifrado).not.toContain('ana@exemplo.com');
    expect(cifrador.decifrar('exportacao_titular', cifrado, OUTRA)).toBeNull();
    expect(cifrador.decifrar('par_novo_da_sessao', cifrado, CONTA)).toBeNull();
    expect(cifrador.decifrar('exportacao_titular', cifrado, CONTA)).not.toBeNull();
    expect(identidade.solicitacoes.todas()).toEqual([
      {
        id: SOLICITACAO,
        contaId: CONTA,
        tipo: 'exportacao',
        status: 'concluida',
        solicitadaEm: AGORA,
        concluidaEm: AGORA,
      },
    ]);
  });

  it('o arquivo traz os dados da conta, perfis, o histórico de aceites e o segundo fator, sem nenhum segredo', async () => {
    const { identidade, cifrador, caso } = montar();
    await prepararConta(identidade);
    await prepararConta(identidade, OUTRA);
    await identidade.segundoFator.salvar({
      contaId: CONTA,
      segredoCifrado: 'segredo-totp-cifrado',
      confirmadoEm: CADASTRO,
      ultimoPassoUsado: 7,
    });
    // Política nova aceita depois: a v1, fora de vigor, continua no histórico.
    identidade.documentos.adicionarDocumento({
      id: POLITICA_V2,
      tipo: 'privacidade',
      versao: '2',
      conteudo: 'Política v2',
      vigenteDesde: new Date('2026-10-10T00:00:00.000Z'),
    });
    await identidade.documentos.registrarConsentimento({
      id: 'aceite-politica-v2',
      contaId: CONTA,
      documentoId: POLITICA_V2,
      aceitoEm: ACEITE_POLITICA_V2,
    });
    await solicitar(identidade);

    await caso.executar({ contaId: CONTA, solicitacaoId: SOLICITACAO });

    const cifrado = identidade.exportacoes.todas()[0]?.conteudoCifrado ?? '';
    const json = cifrador.decifrar('exportacao_titular', cifrado, CONTA) ?? '';
    const arquivo = JSON.parse(json) as ArquivoDeExportacao;
    expect(arquivo).toEqual({
      formato: 'bairrin.exportacao-do-titular',
      versao: 1,
      geradaEm: AGORA.toISOString(),
      identidade: {
        conta: {
          id: CONTA,
          nome: 'Ana Souza',
          email: 'ana@exemplo.com',
          telefone: '+5535999991234',
          status: 'ativa',
          criadaEm: CADASTRO.toISOString(),
          emailVerificadoEm: null,
          ultimoLoginEm: '2026-10-17T08:00:00.000Z',
        },
        perfis: [{ perfil: 'consumidor', concedidoEm: CADASTRO.toISOString() }],
        aceites: [
          { documento: 'termos', versao: '1', aceitoEm: CADASTRO.toISOString() },
          { documento: 'privacidade', versao: '1', aceitoEm: ACEITE_POLITICA_V1.toISOString() },
          { documento: 'privacidade', versao: '2', aceitoEm: ACEITE_POLITICA_V2.toISOString() },
        ],
        segundoFator: { configurado: true, confirmadoEm: CADASTRO.toISOString() },
      },
    });
    for (const segredo of ['hash-secreto-da-senha', 'segredo-totp-cifrado', 'ultimoPasso']) {
      expect(json).not.toContain(segredo);
    }
  });

  it('reentrega do evento: a solicitação já concluída não gera outro arquivo', async () => {
    const { identidade, caso } = montar();
    await prepararConta(identidade);
    await solicitar(identidade);
    await caso.executar({ contaId: CONTA, solicitacaoId: SOLICITACAO });

    await expect(caso.executar({ contaId: CONTA, solicitacaoId: SOLICITACAO })).resolves.toEqual({
      tipo: 'ignorada',
    });
    expect(identidade.exportacoes.todas()).toHaveLength(1);
  });

  it.each([
    ['inexistente', async (_identidade: IdentidadeEmMemoria) => {}],
    ['de outra conta', (identidade: IdentidadeEmMemoria) => solicitar(identidade, OUTRA)],
    ['de exclusão', (identidade: IdentidadeEmMemoria) => solicitar(identidade, CONTA, 'exclusao')],
  ])('solicitação %s: ignorada, nenhum arquivo', async (_caso, preparar) => {
    const { identidade, caso } = montar();
    await prepararConta(identidade);
    await prepararConta(identidade, OUTRA);
    await preparar(identidade);

    await expect(caso.executar({ contaId: CONTA, solicitacaoId: SOLICITACAO })).resolves.toEqual({
      tipo: 'ignorada',
    });
    expect(identidade.exportacoes.todas()).toEqual([]);
  });

  it('a cópia nova apaga as anteriores ainda não baixadas: só a mais recente pode ser baixada (S98)', async () => {
    const { identidade, caso } = montar();
    await prepararConta(identidade);
    const base = {
      contaId: CONTA,
      conteudoCifrado: 'antiga',
      expiraEm: new Date(AGORA.getTime() + 1),
    };
    await identidade.exportacoes.inserir({
      ...base,
      id: 'nao-baixada',
      criadaEm: CADASTRO,
      baixadaEm: null,
    });
    await identidade.exportacoes.inserir({
      ...base,
      id: 'baixada',
      criadaEm: CADASTRO,
      baixadaEm: CADASTRO,
    });
    await solicitar(identidade);

    await caso.executar({ contaId: CONTA, solicitacaoId: SOLICITACAO });

    const ids = identidade.exportacoes.todas().map((e) => e.id);
    expect(ids).not.toContain('nao-baixada');
    expect(ids).toContain('baixada');
    expect(ids).toHaveLength(2);
  });

  it('duas entregas simultâneas do mesmo evento geram uma cópia só', async () => {
    const { identidade, caso } = montar();
    await prepararConta(identidade);
    await solicitar(identidade);

    const resultados = await Promise.all([
      caso.executar({ contaId: CONTA, solicitacaoId: SOLICITACAO }),
      caso.executar({ contaId: CONTA, solicitacaoId: SOLICITACAO }),
    ]);

    expect(resultados.map((r) => r.tipo).sort()).toEqual(['gerada', 'ignorada']);
    expect(identidade.exportacoes.todas()).toHaveLength(1);
  });

  it('conta excluída depois do pedido: conclui a solicitação sem gerar arquivo', async () => {
    const { identidade, caso } = montar();
    await prepararConta(identidade);
    await solicitar(identidade);
    const conta = await identidade.contas.buscarPorId(CONTA);
    conta?.desativar(AGORA);
    if (conta) await identidade.contas.atualizar(conta);

    await expect(caso.executar({ contaId: CONTA, solicitacaoId: SOLICITACAO })).resolves.toEqual({
      tipo: 'conta_indisponivel',
    });
    expect(identidade.exportacoes.todas()).toEqual([]);
    expect(identidade.solicitacoes.todas()[0]).toMatchObject({
      status: 'concluida',
      concluidaEm: AGORA,
    });
  });
});
