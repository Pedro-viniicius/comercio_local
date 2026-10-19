// Download da cópia dos dados (CA-10, S10): só a conta dona, uso único e até 7
// dias; exportação que não decifra não é entregue nem marcada como baixada.
import { describe, expect, it } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import type { ExportacaoDoTitular } from '../../dominio/repositorios.ts';
import {
  criarIdentidadeEmMemoria,
  ExportacoesEmMemoria,
  type IdentidadeEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import { CifradorFalso } from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { BaixarExportacaoCasoDeUso, ExportacaoIlegivel } from './baixar-exportacao.ts';

const GERADA = new Date('2026-10-18T12:00:00.000Z');
const SETE_DIAS_EM_MS = 7 * 24 * 60 * 60 * 1000;
const CONTA = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';
const OUTRA = '7a2e4d3b-2c3d-4e4f-9a01-23456789abcd';
const JSON_DA_ANA = '{"identidade":{"conta":{"email":"ana@exemplo.com"}}}';

/**
 * Faz as duas leituras acontecerem antes de qualquer marcação: cada
 * `buscarDisponivel` espera a outra requisição também ter lido, como dois
 * downloads que chegam juntos.
 */
class ExportacoesComLeiturasJuntas extends ExportacoesEmMemoria {
  #leituras = 0;
  #liberar: () => void = () => undefined;
  readonly #todasLeram = new Promise<void>((resolver) => {
    this.#liberar = resolver;
  });

  override async buscarDisponivel(
    contaId: string,
    agora: Date,
  ): Promise<ExportacaoDoTitular | null> {
    const lida = await super.buscarDisponivel(contaId, agora);
    this.#leituras += 1;
    if (this.#leituras === 2) this.#liberar();
    await this.#todasLeram;
    return lida;
  }
}

function montar() {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(GERADA);
  const cifrador = new CifradorFalso();
  const caso = new BaixarExportacaoCasoDeUso(
    identidade.unidade,
    identidade.exportacoes,
    cifrador,
    relogio,
  );
  return { identidade, relogio, cifrador, caso };
}

async function gravarExportacao(
  identidade: IdentidadeEmMemoria,
  conteudoCifrado: string,
  contaId = CONTA,
): Promise<void> {
  await identidade.exportacoes.inserir({
    id: `exportacao-${contaId}`,
    contaId,
    conteudoCifrado,
    criadaEm: GERADA,
    expiraEm: new Date(GERADA.getTime() + SETE_DIAS_EM_MS),
    baixadaEm: null,
  });
}

describe('BaixarExportacaoCasoDeUso', () => {
  it('entrega o JSON decifrado e marca a exportação como baixada', async () => {
    const { identidade, cifrador, caso, relogio } = montar();
    await gravarExportacao(identidade, cifrador.cifrar('exportacao_titular', JSON_DA_ANA, CONTA));
    relogio.avancar(60 * 60 * 1000);

    await expect(caso.executar({ contaId: CONTA })).resolves.toEqual({
      tipo: 'disponivel',
      json: JSON_DA_ANA,
    });
    expect(identidade.exportacoes.todas()[0]?.baixadaEm).toEqual(relogio.agora());
  });

  it('uso único: o segundo download não encontra arquivo', async () => {
    const { identidade, cifrador, caso } = montar();
    await gravarExportacao(identidade, cifrador.cifrar('exportacao_titular', JSON_DA_ANA, CONTA));
    await caso.executar({ contaId: CONTA });

    await expect(caso.executar({ contaId: CONTA })).resolves.toEqual({ tipo: 'indisponivel' });
  });

  it('dois downloads ao mesmo tempo: só um recebe o arquivo, o outro recebe indisponivel', async () => {
    const { identidade, cifrador, relogio } = montar();
    const exportacoes = new ExportacoesComLeiturasJuntas(identidade.unidade);
    const caso = new BaixarExportacaoCasoDeUso(identidade.unidade, exportacoes, cifrador, relogio);
    await exportacoes.inserir({
      id: 'exportacao-da-ana',
      contaId: CONTA,
      conteudoCifrado: cifrador.cifrar('exportacao_titular', JSON_DA_ANA, CONTA),
      criadaEm: GERADA,
      expiraEm: new Date(GERADA.getTime() + SETE_DIAS_EM_MS),
      baixadaEm: null,
    });

    const resultados = await Promise.all([
      caso.executar({ contaId: CONTA }),
      caso.executar({ contaId: CONTA }),
    ]);

    expect(resultados).toHaveLength(2);
    expect(resultados.filter((r) => r.tipo === 'disponivel')).toEqual([
      { tipo: 'disponivel', json: JSON_DA_ANA },
    ]);
    expect(resultados.filter((r) => r.tipo === 'indisponivel')).toHaveLength(1);
    expect(JSON.stringify(resultados.find((r) => r.tipo === 'indisponivel'))).not.toContain(
      'ana@exemplo.com',
    );
    expect(exportacoes.todas()[0]?.baixadaEm).toEqual(GERADA);
  });

  it('vale até 7 dias depois de gerada', async () => {
    const { identidade, cifrador, caso, relogio } = montar();
    await gravarExportacao(identidade, cifrador.cifrar('exportacao_titular', JSON_DA_ANA, CONTA));

    relogio.avancar(SETE_DIAS_EM_MS);

    await expect(caso.executar({ contaId: CONTA })).resolves.toEqual({ tipo: 'indisponivel' });
    expect(identidade.exportacoes.todas()[0]?.baixadaEm).toBeNull();
  });

  it('só a conta dona baixa: a exportação de outra conta não aparece nem é gasta', async () => {
    const { identidade, cifrador, caso } = montar();
    await gravarExportacao(identidade, cifrador.cifrar('exportacao_titular', JSON_DA_ANA, CONTA));

    await expect(caso.executar({ contaId: OUTRA })).resolves.toEqual({ tipo: 'indisponivel' });
    expect(identidade.exportacoes.todas()[0]?.baixadaEm).toBeNull();
  });

  it('sem exportação pronta: indisponivel', async () => {
    const { caso } = montar();
    await expect(caso.executar({ contaId: CONTA })).resolves.toEqual({ tipo: 'indisponivel' });
  });

  it('cifrado que não decifra com a conta: erro sem conteúdo, e a exportação não é marcada', async () => {
    const { identidade, cifrador, caso } = montar();
    // Cifrado com a conta errada na AAD (linha trocada ou adulterada).
    await gravarExportacao(identidade, cifrador.cifrar('exportacao_titular', JSON_DA_ANA, OUTRA));

    const erro = await caso.executar({ contaId: CONTA }).then(
      () => new Error('deveria falhar'),
      (falha: unknown) => falha as Error,
    );

    expect(erro).toBeInstanceOf(ExportacaoIlegivel);
    expect(erro.message).not.toContain('ana@exemplo.com');
    expect(erro.message).not.toContain(CONTA);
    expect(identidade.exportacoes.todas()[0]?.baixadaEm).toBeNull();
  });
});
