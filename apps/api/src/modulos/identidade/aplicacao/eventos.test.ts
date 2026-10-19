// Eventos da Identidade montados a partir do contrato (P4): cada nome de
// `EVENTOS_DE_IDENTIDADE` passa em `validarEvento`, com `tipo`
// `identidade.<Nome>`, versão 1 e `agregadoId` = `contaId`; payload fora do
// contrato lança antes do publicador, sem repetir valores.
import {
  EVENTOS_DE_IDENTIDADE,
  type NomeDoEventoDeIdentidade,
  type PayloadDoEventoDeIdentidade,
} from '@bairrin/contratos';
import { describe, expect, it } from 'vitest';
import { EventoInvalido, validarEvento } from '../../../compartilhado/eventos/publicador.ts';
import { DadoPessoalRecusado } from '../../../compartilhado/titular/dado-pessoal.ts';
import { eventoDeIdentidade } from './eventos.ts';

const CONTA = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';
const SOLICITACAO = '0b8e1f2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b';

/** Um payload válido por evento; o tipo obriga a cobrir todo evento novo do contrato. */
const EXEMPLOS: { [Nome in NomeDoEventoDeIdentidade]: PayloadDoEventoDeIdentidade<Nome> } = {
  ContaCriada: { contaId: CONTA },
  CadastroRepetidoTentado: { contaId: CONTA },
  VerificacaoReenviada: { contaId: CONTA },
  RecuperacaoSolicitada: { contaId: CONTA },
  SenhaRedefinida: { contaId: CONTA },
  ExportacaoSolicitada: { contaId: CONTA, solicitacaoId: SOLICITACAO },
  ContaDesativada: { contaId: CONTA },
  ContaAnonimizada: { contaId: CONTA },
};

const NOMES = Object.keys(EVENTOS_DE_IDENTIDADE) as NomeDoEventoDeIdentidade[];

/** Chama o helper com um payload qualquer, como chegaria de um caso de uso mal escrito. */
function montarSemTipo(nome: NomeDoEventoDeIdentidade, payload: unknown) {
  return eventoDeIdentidade(nome, payload as PayloadDoEventoDeIdentidade<typeof nome>);
}

describe('eventoDeIdentidade', () => {
  it('cobre todos os eventos do contrato', () => {
    expect(NOMES.sort()).toEqual(Object.keys(EXEMPLOS).sort());
  });

  it.each(NOMES)(
    '%s: tipo identidade.<Nome>, versão 1, agregado = conta e passa em validarEvento',
    (nome) => {
      const evento = eventoDeIdentidade(nome, EXEMPLOS[nome]);
      expect(evento).toEqual({
        tipo: `identidade.${nome}`,
        versao: 1,
        agregadoId: CONTA,
        payload: EXEMPLOS[nome],
      });
      expect(() => validarEvento(evento)).not.toThrow();
    },
  );

  it.each(NOMES)('%s: chave a mais no payload lança EventoInvalido', (nome) => {
    expect(() => montarSemTipo(nome, { ...EXEMPLOS[nome], extra: 1 })).toThrow(EventoInvalido);
  });

  it('a mensagem traz o caminho e o código do problema, nunca o valor', () => {
    const tentar = () =>
      montarSemTipo('ContaCriada', { contaId: 'fulano@exemplo.com', nomeCompleto: 'Fulano' });
    expect(tentar).toThrow(EventoInvalido);
    try {
      tentar();
    } catch (erro) {
      const mensagem = (erro as Error).message;
      expect(mensagem).toContain('identidade.ContaCriada');
      expect(mensagem).toContain('contaId');
      expect(mensagem).not.toMatch(/fulano|exemplo/i);
    }
  });

  it.each([
    ['sem contaId', {}],
    ['contaId que não é UUID', { contaId: '123' }],
    ['e-mail no lugar do id', { contaId: 'fulano@exemplo.com' }],
    ['payload que não é objeto', 'texto'],
  ])('recusa payload %s', (_caso, payload) => {
    expect(() => montarSemTipo('ContaCriada', payload)).toThrow(EventoInvalido);
  });

  it('ExportacaoSolicitada exige o id da solicitação', () => {
    expect(() => montarSemTipo('ExportacaoSolicitada', { contaId: CONTA })).toThrow(EventoInvalido);
  });

  it('dado pessoal com nome de chave conhecido nunca chega ao evento', () => {
    // O esquema estrito recusa antes; o publicador recusaria de novo (DadoPessoalRecusado).
    expect(() => montarSemTipo('ContaCriada', { contaId: CONTA, email: 'a@b.com' })).toThrow(
      EventoInvalido,
    );
    expect(() =>
      validarEvento({
        tipo: 'identidade.ContaCriada',
        versao: 1,
        agregadoId: CONTA,
        payload: { contaId: CONTA, email: 'a@b.com' },
      }),
    ).toThrow(DadoPessoalRecusado);
  });

  it('o payload devolvido é uma cópia: mudar o original não muda o evento', () => {
    const payload = { contaId: CONTA };
    const evento = eventoDeIdentidade('ContaCriada', payload);
    payload.contaId = SOLICITACAO;
    expect(evento.payload).toEqual({ contaId: CONTA });
  });
});
