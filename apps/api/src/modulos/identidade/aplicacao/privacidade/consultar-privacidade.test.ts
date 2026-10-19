// Tela de Privacidade (CA-10): política vigente com versão e texto, versão dos
// termos, data do aceite da política vigente e prazo da cópia pronta, na forma
// do contrato `privacidadeSchema`.
import { privacidadeSchema } from '@bairrin/contratos';
import { describe, expect, it } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  criarIdentidadeEmMemoria,
  type IdentidadeEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import { ConsultarPrivacidadeCasoDeUso, DocumentoLegalAusente } from './consultar-privacidade.ts';

const CADASTRO = new Date('2026-09-01T12:00:00.000Z');
const AGORA = new Date('2026-10-18T12:00:00.000Z');
const CONTA = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';
const OUTRA = '7a2e4d3b-2c3d-4e4f-9a01-23456789abcd';
const TERMOS_V1 = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
const POLITICA_V1 = '2c8e7ace-ccfe-4c3e-8c6e-bc9ecccd5cfe';
const POLITICA_V2 = '3d7f6bdf-ddff-4d4f-9d7f-cdafdddd6dff';

function montar(comDocumentos = true) {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  const caso = new ConsultarPrivacidadeCasoDeUso(
    identidade.documentos,
    identidade.exportacoes,
    relogio,
  );
  if (comDocumentos) {
    identidade.documentos.adicionarDocumento({
      id: TERMOS_V1,
      tipo: 'termos',
      versao: '1',
      conteudo: 'Termos v1',
      vigenteDesde: CADASTRO,
    });
    identidade.documentos.adicionarDocumento({
      id: POLITICA_V1,
      tipo: 'privacidade',
      versao: '1',
      conteudo: 'Política v1',
      vigenteDesde: CADASTRO,
    });
  }
  return { identidade, relogio, caso };
}

async function aceitar(identidade: IdentidadeEmMemoria, contaId: string, documentoId: string) {
  await identidade.documentos.registrarConsentimento({
    id: `${contaId}-${documentoId}`,
    contaId,
    documentoId,
    aceitoEm: CADASTRO,
  });
}

describe('ConsultarPrivacidadeCasoDeUso', () => {
  it('mostra a política vigente, a versão dos termos e a data do aceite (CA-10)', async () => {
    const { identidade, caso } = montar();
    await aceitar(identidade, CONTA, TERMOS_V1);
    await aceitar(identidade, CONTA, POLITICA_V1);

    const resposta = await caso.executar({ contaId: CONTA });

    expect(resposta).toEqual({
      politica: { versao: '1', conteudo: 'Política v1' },
      termos: { versao: '1' },
      aceitoEm: '2026-09-01T12:00:00.000Z',
      exportacaoDisponivelAte: null,
    });
    expect(privacidadeSchema.parse(resposta)).toEqual(resposta);
  });

  it('com política nova ainda não aceita, aceitoEm é nulo (o aceite é do texto que a tela mostra)', async () => {
    const { identidade, caso } = montar();
    await aceitar(identidade, CONTA, POLITICA_V1);
    identidade.documentos.adicionarDocumento({
      id: POLITICA_V2,
      tipo: 'privacidade',
      versao: '2',
      conteudo: 'Política v2',
      vigenteDesde: new Date('2026-10-10T00:00:00.000Z'),
    });

    await expect(caso.executar({ contaId: CONTA })).resolves.toMatchObject({
      politica: { versao: '2', conteudo: 'Política v2' },
      aceitoEm: null,
    });
  });

  it('conta sem aceite (admin criado pela CLI): aceitoEm nulo', async () => {
    const { caso } = montar();
    await expect(caso.executar({ contaId: CONTA })).resolves.toMatchObject({ aceitoEm: null });
  });

  it('o aceite de outra conta não aparece', async () => {
    const { identidade, caso } = montar();
    await aceitar(identidade, OUTRA, POLITICA_V1);
    await expect(caso.executar({ contaId: CONTA })).resolves.toMatchObject({ aceitoEm: null });
  });

  it('com cópia pronta e não baixada, mostra até quando ela pode ser baixada', async () => {
    const { identidade, relogio, caso } = montar();
    const expiraEm = new Date('2026-10-25T12:00:00.000Z');
    await identidade.exportacoes.inserir({
      id: 'exportacao-da-ana',
      contaId: CONTA,
      conteudoCifrado: 'cifrado',
      criadaEm: AGORA,
      expiraEm,
      baixadaEm: null,
    });

    await expect(caso.executar({ contaId: CONTA })).resolves.toMatchObject({
      exportacaoDisponivelAte: '2026-10-25T12:00:00.000Z',
    });
    // Não aparece para outra conta, nem depois de baixada ou vencida.
    await expect(caso.executar({ contaId: OUTRA })).resolves.toMatchObject({
      exportacaoDisponivelAte: null,
    });
    await identidade.exportacoes.marcarBaixada('exportacao-da-ana', AGORA);
    await expect(caso.executar({ contaId: CONTA })).resolves.toMatchObject({
      exportacaoDisponivelAte: null,
    });
    relogio.definir(expiraEm);
    await expect(caso.executar({ contaId: CONTA })).resolves.toMatchObject({
      exportacaoDisponivelAte: null,
    });
  });

  it('sem documento vigente: erro de configuração que só cita o tipo', async () => {
    const { caso } = montar(false);

    const erro = await caso.executar({ contaId: CONTA }).then(
      () => new Error('deveria falhar'),
      (falha: unknown) => falha as Error,
    );

    expect(erro).toBeInstanceOf(DocumentoLegalAusente);
    expect(erro.message).toBe('Não há documento legal vigente do tipo privacidade.');
  });
});
