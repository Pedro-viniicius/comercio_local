// Pedido de cópia dos dados (CA-10, S10, S98): grava a solicitação e publica
// `ExportacaoSolicitada` (só ids) na mesma transação; um pedido por conta a
// cada 24 h, também com dois pedidos ao mesmo tempo.
import { describe, expect, it } from 'vitest';
import {
  type EventoDeDominio,
  PublicadorDeEventos,
} from '../../../../compartilhado/eventos/publicador.ts';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  criarIdentidadeEmMemoria,
  SolicitacoesEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import type { RepositorioDeSolicitacoes } from '../../dominio/repositorios.ts';
import { GeradorDeSegredosFalso } from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { SolicitarExportacaoCasoDeUso } from './solicitar-exportacao.ts';

const AGORA = new Date('2026-10-18T12:00:00.000Z');
const CONTA = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';
const OUTRA = '7a2e4d3b-2c3d-4e4f-9a01-23456789abcd';
const UMA_HORA_EM_MS = 60 * 60 * 1000;

class PublicadorQueFalha extends PublicadorDeEventos {
  override publicar(..._eventos: readonly EventoDeDominio[]): Promise<void> {
    return Promise.reject(new Error('outbox fora do ar'));
  }
}

/** As duas primeiras leituras esperam uma pela outra: os dois pedidos leem antes de gravar. */
class SolicitacoesComLeiturasJuntas extends SolicitacoesEmMemoria {
  #leituras = 0;
  #liberar: () => void = () => undefined;
  readonly #juntas = new Promise<void>((resolver) => {
    this.#liberar = resolver;
  });

  override async buscarUltima(
    ...argumentos: Parameters<SolicitacoesEmMemoria['buscarUltima']>
  ): ReturnType<SolicitacoesEmMemoria['buscarUltima']> {
    const lida = await super.buscarUltima(...argumentos);
    this.#leituras += 1;
    if (this.#leituras === 2) this.#liberar();
    if (this.#leituras <= 2) await this.#juntas;
    return lida;
  }
}

function montar(
  publicador?: PublicadorDeEventos,
  solicitacoesDoCenario?: (
    identidade: ReturnType<typeof criarIdentidadeEmMemoria>,
  ) => RepositorioDeSolicitacoes,
) {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  const caso = new SolicitarExportacaoCasoDeUso(
    identidade.unidade,
    identidade.contas,
    solicitacoesDoCenario?.(identidade) ?? identidade.solicitacoes,
    publicador ?? identidade.publicador,
    new GeradorDeSegredosFalso(),
    relogio,
  );
  return { identidade, relogio, caso };
}

describe('SolicitarExportacaoCasoDeUso', () => {
  it('grava a solicitação pendente e publica ExportacaoSolicitada só com ids', async () => {
    const { identidade, caso } = montar();

    await expect(caso.executar({ contaId: CONTA })).resolves.toEqual({ tipo: 'solicitada' });

    const [solicitacao] = identidade.solicitacoes.todas();
    expect(solicitacao).toEqual({
      id: expect.any(String) as string,
      contaId: CONTA,
      tipo: 'exportacao',
      status: 'pendente',
      solicitadaEm: AGORA,
      concluidaEm: null,
    });
    expect(identidade.publicador.publicados).toEqual([
      {
        tipo: 'identidade.ExportacaoSolicitada',
        versao: 1,
        agregadoId: CONTA,
        payload: { contaId: CONTA, solicitacaoId: solicitacao?.id },
      },
    ]);
  });

  it('um pedido a cada 24 h: o segundo recebe ja_solicitada com a hora em que pode pedir de novo', async () => {
    const { identidade, relogio, caso } = montar();
    await caso.executar({ contaId: CONTA });

    relogio.avancar(23 * UMA_HORA_EM_MS);
    await expect(caso.executar({ contaId: CONTA })).resolves.toEqual({
      tipo: 'ja_solicitada',
      proximaEm: new Date(AGORA.getTime() + 24 * UMA_HORA_EM_MS),
    });
    expect(identidade.solicitacoes.todas()).toHaveLength(1);
    expect(identidade.publicador.publicados).toHaveLength(1);

    relogio.avancar(UMA_HORA_EM_MS);
    await expect(caso.executar({ contaId: CONTA })).resolves.toEqual({ tipo: 'solicitada' });
    expect(identidade.solicitacoes.todas()).toHaveLength(2);
  });

  it('dois pedidos ao mesmo tempo, que leem antes de qualquer um gravar: um solicita, o outro recebe ja_solicitada (Q23, S98)', async () => {
    let solicitacoes: SolicitacoesComLeiturasJuntas | undefined;
    const { identidade, caso } = montar(undefined, (identidade) => {
      solicitacoes = new SolicitacoesComLeiturasJuntas(identidade.unidade);
      return solicitacoes;
    });
    if (solicitacoes === undefined) throw new Error('repositório de solicitações não montado');

    const resultados = await Promise.all([
      caso.executar({ contaId: CONTA }),
      caso.executar({ contaId: CONTA }),
    ]);

    expect(resultados.map((r) => r.tipo).sort()).toEqual(['ja_solicitada', 'solicitada']);
    expect(resultados).toContainEqual({
      tipo: 'ja_solicitada',
      proximaEm: new Date(AGORA.getTime() + 24 * UMA_HORA_EM_MS),
    });
    expect(solicitacoes.todas()).toHaveLength(1);
    expect(identidade.publicador.publicados).toHaveLength(1);
  });

  it('o limite é por conta: o pedido de uma não segura o da outra', async () => {
    const { identidade, caso } = montar();
    await caso.executar({ contaId: CONTA });

    await expect(caso.executar({ contaId: OUTRA })).resolves.toEqual({ tipo: 'solicitada' });
    expect(identidade.publicador.publicados.map((e) => e.agregadoId)).toEqual([CONTA, OUTRA]);
  });

  it('pedido de exclusão não conta no limite da exportação', async () => {
    const { identidade, caso } = montar();
    await identidade.solicitacoes.inserir({
      id: 'exclusao-da-ana',
      contaId: CONTA,
      tipo: 'exclusao',
      status: 'aguardando_pendencias',
      solicitadaEm: AGORA,
      concluidaEm: null,
    });

    await expect(caso.executar({ contaId: CONTA })).resolves.toEqual({ tipo: 'solicitada' });
  });

  it('solicitação e evento ficam juntos: se a outbox falha, o pedido não fica gravado', async () => {
    const { identidade, caso } = montar(new PublicadorQueFalha());

    await expect(caso.executar({ contaId: CONTA })).rejects.toThrow('outbox fora do ar');

    expect(identidade.solicitacoes.todas()).toEqual([]);
  });
});
