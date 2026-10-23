// Ligação entre os eventos de Identidade e os assinantes (plano 01b, etapa 13; CA-01, CA-02,
// CA-06, CA-10; P4, S10, S92): cada evento que gera e-mail tem um assinante só (dois
// assinantes no mesmo evento mandariam dois e-mails), nenhum outro evento gera e-mail, os
// nomes dos assinantes são únicos (a deduplicação da entrega usa assinante + evento) e todos
// recusam payload com campo a mais, em vez de confiar num e-mail vindo no evento.
import { EVENTOS_DE_IDENTIDADE } from '@bairrin/contratos';
import { describe, expect, it } from 'vitest';
import type { EventoPublicado } from '../../../../compartilhado/eventos/assinantes.ts';
import { EventoInvalido } from '../../../../compartilhado/eventos/publicador.ts';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import { EnviadorDeEmailFalso } from '../../../../../test/fakes/compartilhado/enviador-de-email-falso.ts';
import { criarIdentidadeEmMemoria } from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import {
  CifradorFalso,
  GeradorDeSegredosFalso,
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { Conta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { GerarExportacaoCasoDeUso } from '../privacidade/gerar-exportacao.ts';
import { AvisarCadastroRepetidoAssinante } from './avisar-cadastro-repetido.assinante.ts';
import { AvisarSegundoFatorFreadoAssinante } from './avisar-segundo-fator-freado.assinante.ts';
import { EnviarCodigoDeRecuperacaoAssinante } from './enviar-codigo-de-recuperacao.assinante.ts';
import { EnviarCodigoDeVerificacaoAssinante } from './enviar-codigo-de-verificacao.assinante.ts';
import { GerarExportacaoAssinante } from './gerar-exportacao.assinante.ts';
import { ModelosDeEmailDaIdentidade } from './modelos-de-email.ts';

const AGORA = new Date('2026-10-20T12:00:00.000Z');
const CONTA = 'f0f0f0f0-0000-4000-8000-000000000001';
const SOLICITACAO = 'f1f1f1f1-0000-4000-8000-000000000001';

class ModelosFalsos extends ModelosDeEmailDaIdentidade {
  override codigoDeVerificacao() {
    return { assunto: 'verificacao', texto: 'x', html: '' };
  }
  override cadastroRepetido() {
    return { assunto: 'cadastro_repetido', texto: 'x', html: '' };
  }
  override codigoDeRecuperacao() {
    return { assunto: 'recuperacao', texto: 'x', html: '' };
  }
  override exportacaoPronta() {
    return { assunto: 'exportacao', texto: 'x', html: '' };
  }
  override segundoFatorFreado() {
    return { assunto: 'segundo_fator', texto: 'x', html: '' };
  }
}

function montar() {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  const cifrador = new CifradorFalso();
  const gerador = new GeradorDeSegredosFalso();
  const enviador = new EnviadorDeEmailFalso();
  const modelos = new ModelosFalsos();
  const gerar = new GerarExportacaoCasoDeUso(
    identidade.unidade,
    identidade.contas,
    identidade.documentos,
    identidade.segundoFator,
    identidade.solicitacoes,
    identidade.exportacoes,
    cifrador,
    gerador,
    relogio,
  );
  const assinantes = {
    verificacao: new EnviarCodigoDeVerificacaoAssinante(
      identidade.unidade,
      relogio,
      identidade.contas,
      identidade.codigos,
      cifrador,
      gerador,
      modelos,
      enviador,
    ),
    recuperacao: new EnviarCodigoDeRecuperacaoAssinante(
      identidade.unidade,
      relogio,
      identidade.contas,
      identidade.codigos,
      cifrador,
      gerador,
      modelos,
      enviador,
    ),
    cadastroRepetido: new AvisarCadastroRepetidoAssinante(
      identidade.unidade,
      relogio,
      identidade.contas,
      identidade.bloqueios,
      cifrador,
      modelos,
      enviador,
    ),
    exportacao: new GerarExportacaoAssinante(
      identidade.unidade,
      identidade.contas,
      gerar,
      modelos,
      enviador,
    ),
    segundoFator: new AvisarSegundoFatorFreadoAssinante(
      identidade.unidade,
      identidade.contas,
      modelos,
      enviador,
    ),
  };
  return { identidade, enviador, assinantes };
}

describe('assinantes da Identidade: quem escuta cada evento', () => {
  const ESPERADO: Record<string, readonly string[]> = {
    ContaCriada: ['identidade.enviar-codigo-de-verificacao'],
    VerificacaoReenviada: ['identidade.enviar-codigo-de-verificacao'],
    RecuperacaoSolicitada: ['identidade.enviar-codigo-de-recuperacao'],
    CadastroRepetidoTentado: ['identidade.avisar-cadastro-repetido'],
    ExportacaoSolicitada: ['identidade.gerar-exportacao'],
    SegundoFatorFreado: ['identidade.avisar-segundo-fator-freado'],
    // Sem e-mail: a senha trocada, a desativação e a anonimização não têm assinante aqui.
    SenhaRedefinida: [],
    ContaDesativada: [],
    ContaAnonimizada: [],
  };

  it('cada evento de e-mail tem exatamente um assinante, e os outros eventos nenhum', () => {
    const { assinantes } = montar();
    const todos = Object.values(assinantes);
    const porEvento = Object.fromEntries(
      Object.entries(EVENTOS_DE_IDENTIDADE).map(([nome, contrato]) => [
        nome,
        todos.filter((a) => a.eventos.includes(contrato.tipo)).map((a) => a.nome),
      ]),
    );

    expect(porEvento).toEqual(ESPERADO);
  });

  it('os nomes dos assinantes são únicos e começam por "identidade."', () => {
    const nomes = Object.values(montar().assinantes).map((a) => a.nome);

    expect(new Set(nomes).size).toBe(nomes.length);
    expect(nomes.every((nome) => nome.startsWith('identidade.'))).toBe(true);
  });
});

describe('assinantes da Identidade: o e-mail nunca vem do evento (P4)', () => {
  const casos: [string, keyof ReturnType<typeof montar>['assinantes'], string, object][] = [
    ['verificação', 'verificacao', 'identidade.ContaCriada', { contaId: CONTA }],
    ['verificação (reenvio)', 'verificacao', 'identidade.VerificacaoReenviada', { contaId: CONTA }],
    ['recuperação', 'recuperacao', 'identidade.RecuperacaoSolicitada', { contaId: CONTA }],
    [
      'cadastro repetido',
      'cadastroRepetido',
      'identidade.CadastroRepetidoTentado',
      { contaId: CONTA },
    ],
    [
      'exportação',
      'exportacao',
      'identidade.ExportacaoSolicitada',
      { contaId: CONTA, solicitacaoId: SOLICITACAO },
    ],
    ['freio do segundo fator', 'segundoFator', 'identidade.SegundoFatorFreado', { contaId: CONTA }],
  ];

  it.each(casos)(
    '%s: payload com um e-mail a mais é EventoInvalido, e nada é enviado nem gravado',
    async (_nome, assinante, tipo, payload) => {
      const { identidade, enviador, assinantes } = montar();
      await identidade.contas.inserir(
        Conta.criar({
          id: CONTA,
          nome: 'Ana Souza',
          email: Email.criar('ana.souza@exemplo.com'),
          telefone: Telefone.criar('35999991234'),
          senhaHash: 'hash-falso:senha',
          agora: new Date(AGORA.getTime() - 86_400_000),
        }),
      );
      const evento: EventoPublicado = {
        id: 'e0e0e0e0-0000-4000-8000-000000000001',
        tipo,
        versao: 1,
        agregadoId: CONTA,
        payload: { ...payload, email: 'atacante@exemplo.com' },
        ocorridoEm: AGORA.toISOString(),
      };

      const erro: unknown = await identidade.unidade
        .executar(() => assinantes[assinante].tratar(evento))
        .then(
          () => null,
          (e: unknown) => e,
        );

      expect(erro).toBeInstanceOf(EventoInvalido);
      expect(String((erro as Error).message)).not.toContain('atacante');
      expect(enviador.enviadas).toEqual([]);
      expect(identidade.codigos.todos()).toEqual([]);
    },
  );
});
